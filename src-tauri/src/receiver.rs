//! Listen side: subscribe to a sender, reorder packets in a jitter buffer,
//! decode Opus (concealing lost packets) and play through a cpal output.

use crate::audio::{self, StereoResampler};
use crate::events::{Event, EventSink};
use crate::protocol::{self, Kind, CHANNELS, FRAME_SAMPLES, SAMPLE_RATE};
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};
use std::io::ErrorKind;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const SUBSCRIBE_INTERVAL: Duration = Duration::from_secs(1);
const NO_SIGNAL_AFTER: Duration = Duration::from_secs(3);
const STATS_INTERVAL: Duration = Duration::from_millis(100);
/// Packets allowed to queue beyond the latency target before skipping ahead
/// (absorbs bursts; bounds the delay that sender/receiver clock drift can add)
const MAX_BACKLOG_EXTRA: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverStats {
    /// "connecting" | "buffering" | "playing" | "no-signal"
    pub state: &'static str,
    pub address: String,
    pub buffered_ms: f32,
    pub packets_received: u64,
    pub packets_lost: u64,
    pub underruns: u64,
    pub level: f32,
}

/// Shared settings the UI can change while a stream is playing.
#[derive(Clone)]
pub struct Controls {
    /// f32 bits, 0..1
    pub volume: Arc<AtomicU32>,
    pub latency_ms: Arc<AtomicU32>,
}

struct Playback {
    /// Interleaved stereo at the output device rate
    buf: VecDeque<f32>,
    /// Output only starts consuming once the buffer reaches the latency target
    primed: bool,
    target_frames: usize,
    underruns: u64,
}

fn lock(pb: &Mutex<Playback>) -> MutexGuard<'_, Playback> {
    pb.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct Receiver {
    pub address: SocketAddr,
    stop: Arc<AtomicBool>,
    output_stop: mpsc::Sender<()>,
    threads: Vec<JoinHandle<()>>,
}

impl Receiver {
    pub fn start(
        events: EventSink,
        address: SocketAddr,
        output_device: Option<String>,
        controls: Controls,
    ) -> Result<Self, String> {
        let socket = UdpSocket::bind(("0.0.0.0", 0))
            .map_err(|e| format!("Could not open a network port: {e}"))?;
        socket
            .set_read_timeout(Some(Duration::from_millis(5)))
            .map_err(|e| e.to_string())?;

        let playback = Arc::new(Mutex::new(Playback {
            buf: VecDeque::new(),
            primed: false,
            target_frames: 0,
            underruns: 0,
        }));

        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
        let (output_stop, output_stop_rx) = mpsc::channel::<()>();
        let out_playback = playback.clone();
        let volume = controls.volume.clone();

        // cpal streams are not Send on every platform, so the stream lives on its own thread
        let output = thread::Builder::new()
            .name("auracast-output".into())
            .spawn(move || {
                let started = audio::resolve_output(output_device.as_deref()).and_then(|device| {
                    let supported = device
                        .default_output_config()
                        .map_err(|e| format!("Could not read speaker format: {e}"))?;
                    let stream = build_output(&device, &supported, out_playback, volume)?;
                    stream
                        .play()
                        .map_err(|e| format!("Could not start playback: {e}"))?;
                    Ok((stream, supported.sample_rate().0))
                });
                match started {
                    Ok((stream, rate)) => {
                        let _ = ready_tx.send(Ok(rate));
                        let _ = output_stop_rx.recv();
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let output_rate = ready_rx
            .recv()
            .map_err(|_| "Audio playback stopped unexpectedly".to_string())??;

        let stop = Arc::new(AtomicBool::new(false));
        let net_stop = stop.clone();
        let network = thread::Builder::new()
            .name("auracast-receiver".into())
            .spawn(move || {
                run_network(
                    events,
                    socket,
                    address,
                    playback,
                    output_rate,
                    controls,
                    net_stop,
                )
            })
            .map_err(|e| e.to_string())?;

        Ok(Self {
            address,
            stop,
            output_stop,
            threads: vec![output, network],
        })
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.output_stop.send(());
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

fn build_output(
    device: &cpal::Device,
    supported: &cpal::SupportedStreamConfig,
    playback: Arc<Mutex<Playback>>,
    volume: Arc<AtomicU32>,
) -> Result<cpal::Stream, String> {
    use cpal::SampleFormat as F;
    let config: cpal::StreamConfig = supported.clone().into();
    match supported.sample_format() {
        F::F32 => build_output_typed::<f32>(device, &config, playback, volume),
        F::I16 => build_output_typed::<i16>(device, &config, playback, volume),
        F::U16 => build_output_typed::<u16>(device, &config, playback, volume),
        F::I32 => build_output_typed::<i32>(device, &config, playback, volume),
        other => Err(format!("Unsupported speaker format: {other:?}")),
    }
}

fn build_output_typed<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    playback: Arc<Mutex<Playback>>,
    volume: Arc<AtomicU32>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let vol = f32::from_bits(volume.load(Ordering::Relaxed));
                let mut pb = lock(&playback);
                if !pb.primed && pb.target_frames > 0 && pb.buf.len() / CHANNELS >= pb.target_frames
                {
                    pb.primed = true;
                }
                for frame in data.chunks_mut(channels) {
                    let (l, r) = if pb.primed {
                        match (pb.buf.pop_front(), pb.buf.pop_front()) {
                            (Some(l), Some(r)) => (l * vol, r * vol),
                            _ => {
                                // Ran dry: go silent and rebuild the cushion before resuming
                                pb.primed = false;
                                pb.underruns += 1;
                                (0.0, 0.0)
                            }
                        }
                    } else {
                        (0.0, 0.0)
                    };
                    if channels == 1 {
                        frame[0] = T::from_sample((l + r) * 0.5);
                    } else {
                        frame[0] = T::from_sample(l);
                        frame[1] = T::from_sample(r);
                        for s in &mut frame[2..] {
                            *s = T::from_sample(0.0f32);
                        }
                    }
                }
            },
            |e| eprintln!("[auracast] playback stream error: {e}"),
            None,
        )
        .map_err(|e| format!("Could not open speaker: {e}"))
}

/// True if sequence number `a` comes before `b`, accounting for wraparound.
fn seq_before(a: u32, b: u32) -> bool {
    (a.wrapping_sub(b) as i32) < 0
}

fn run_network(
    events: EventSink,
    socket: UdpSocket,
    address: SocketAddr,
    playback: Arc<Mutex<Playback>>,
    output_rate: u32,
    controls: Controls,
    stop: Arc<AtomicBool>,
) {
    let mut decoder = match opus::Decoder::new(SAMPLE_RATE, opus::Channels::Stereo) {
        Ok(d) => d,
        Err(e) => {
            events(Event::StreamError(format!(
                "Opus decoder failed to start: {e}"
            )));
            return;
        }
    };
    let mut resampler = StereoResampler::new(SAMPLE_RATE, output_rate);

    let subscribe = protocol::control(Kind::Subscribe);
    let mut last_subscribe: Option<Instant> = None;

    let mut jitter: BTreeMap<u32, Vec<u8>> = BTreeMap::new();
    let mut next_seq: Option<u32> = None;
    let mut stream_id: Option<u16> = None;
    let mut last_packet: Option<Instant> = None;

    // Opus frames are at most 120 ms
    let mut pcm = vec![0f32; FRAME_SAMPLES * 6 * CHANNELS];
    let mut resampled = Vec::new();
    let mut recv_buf = [0u8; 2048];

    let mut packets_received = 0u64;
    let mut packets_lost = 0u64;
    let mut level = 0f32;
    let mut last_stats = Instant::now();

    while !stop.load(Ordering::SeqCst) {
        if last_subscribe.is_none_or(|t| t.elapsed() >= SUBSCRIBE_INTERVAL) {
            let _ = socket.send_to(&subscribe, address);
            last_subscribe = Some(Instant::now());
        }

        match socket.recv_from(&mut recv_buf) {
            Ok((n, _from)) => {
                if let Some((h, payload)) = protocol::decode(&recv_buf[..n]) {
                    if h.kind == Kind::Audio {
                        if stream_id != Some(h.stream_id) {
                            // Sender (re)started its broadcast: start from a clean slate
                            stream_id = Some(h.stream_id);
                            jitter.clear();
                            next_seq = None;
                            let _ = decoder.reset_state();
                            let mut pb = lock(&playback);
                            pb.buf.clear();
                            pb.primed = false;
                        }
                        packets_received += 1;
                        last_packet = Some(Instant::now());
                        let late = next_seq.is_some_and(|ns| seq_before(h.seq, ns));
                        if !late {
                            jitter.insert(h.seq, payload.to_vec());
                        }
                    }
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::ConnectionReset
                ) => {}
            Err(e) => {
                eprintln!("[auracast] receive error: {e}");
                thread::sleep(Duration::from_millis(5));
            }
        }

        // Decode just enough to keep the playback buffer at the latency target
        let latency_ms = controls.latency_ms.load(Ordering::Relaxed).max(1) as usize;
        let target_frames = latency_ms * output_rate as usize / 1000;
        lock(&playback).target_frames = target_frames;
        loop {
            let buffered = lock(&playback).buf.len() / CHANNELS;
            if buffered >= target_frames {
                break;
            }
            let Some(&first) = jitter.keys().next() else {
                break;
            };
            let seq = *next_seq.get_or_insert(first);

            let decoded = if let Some(packet) = jitter.remove(&seq) {
                decoder.decode_float(&packet, &mut pcm, false)
            } else if jitter.len() >= 3 || buffered < target_frames / 2 {
                // The expected packet is missing and later ones are here: treat it as lost
                packets_lost += 1;
                decoder.decode_float(&[], &mut pcm[..FRAME_SAMPLES * CHANNELS], false)
            } else {
                break; // give a late packet a moment to arrive
            };
            next_seq = Some(seq.wrapping_add(1));

            match decoded {
                Ok(samples) => {
                    let frame = &pcm[..samples * CHANNELS];
                    level = level.max(audio::meter_level(frame));
                    resampled.clear();
                    resampler.process(frame, &mut resampled);
                    lock(&playback).buf.extend(resampled.iter().copied());
                }
                Err(e) => eprintln!("[auracast] opus decode error: {e}"),
            }
        }

        // If packets pile up (sender clock faster than ours, or a burst), skip ahead
        let max_backlog = latency_ms / 20 + MAX_BACKLOG_EXTRA;
        if jitter.len() > max_backlog {
            while jitter.len() > latency_ms / 20 + 1 {
                jitter.pop_first();
            }
            next_seq = jitter.keys().next().copied();
        }

        if last_stats.elapsed() >= STATS_INTERVAL {
            let pb = lock(&playback);
            let state = match last_packet {
                None => "connecting",
                Some(t) if t.elapsed() > NO_SIGNAL_AFTER => "no-signal",
                Some(_) if !pb.primed => "buffering",
                Some(_) => "playing",
            };
            let stats = ReceiverStats {
                state,
                address: address.to_string(),
                buffered_ms: (pb.buf.len() / CHANNELS) as f32 * 1000.0 / output_rate as f32,
                packets_received,
                packets_lost,
                underruns: pb.underruns,
                level,
            };
            drop(pb);
            events(Event::ReceiverStats(stats));
            level = 0.0;
            last_stats = Instant::now();
        }
    }

    let _ = socket.send_to(&protocol::control(Kind::Unsubscribe), address);
}

#[cfg(test)]
mod tests {
    use super::seq_before;

    #[test]
    fn sequence_ordering_wraps() {
        assert!(seq_before(1, 2));
        assert!(!seq_before(2, 1));
        assert!(seq_before(u32::MAX, 0));
        assert!(!seq_before(0, u32::MAX));
    }
}
