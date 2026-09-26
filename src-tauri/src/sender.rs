//! Broadcast side: capture audio, encode it with Opus and send it over UDP to
//! every receiver that has subscribed within the last few seconds.

use crate::audio::{self, CaptureTarget, StereoResampler};
use crate::events::{Event, EventSink};
use crate::protocol::{self, Header, Kind, CHANNELS, FRAME_SAMPLES, SAMPLE_RATE};
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::SizedSample;
use serde::Serialize;
use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 47800;
const SUBSCRIBER_TIMEOUT: Duration = Duration::from_secs(5);
const BITRATE: i32 = 128_000;
const STATS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderStats {
    /// 0..1 input level
    pub level: f32,
    /// `ip:port` of every active listener
    pub listeners: Vec<String>,
    pub packets_sent: u64,
}

pub struct Sender {
    pub port: u16,
    pub source_label: String,
    stop: Arc<AtomicBool>,
    capture_stop: mpsc::Sender<()>,
    threads: Vec<JoinHandle<()>>,
}

impl Sender {
    pub fn start(events: EventSink, source_id: Option<String>) -> Result<Self, String> {
        let socket = UdpSocket::bind(("0.0.0.0", DEFAULT_PORT))
            .or_else(|_| UdpSocket::bind(("0.0.0.0", 0)))
            .map_err(|e| format!("Could not open a network port: {e}"))?;
        socket.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = socket.local_addr().map_err(|e| e.to_string())?.port();

        // Bounded so a stalled encoder cannot grow memory without limit
        let (pcm_tx, pcm_rx) = mpsc::sync_channel::<Vec<f32>>(64);
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, usize, String), String>>();
        let (capture_stop, capture_stop_rx) = mpsc::channel::<()>();

        // cpal streams are not Send on every platform, so the stream lives on its own thread
        let capture = thread::Builder::new()
            .name("auracast-capture".into())
            .spawn(move || {
                if source_id.as_deref() == Some(audio::TEST_TONE_ID) {
                    let _ = ready_tx.send(Ok((SAMPLE_RATE, CHANNELS, "Test tone (440 Hz)".into())));
                    generate_tone(pcm_tx, capture_stop_rx);
                    return;
                }
                #[cfg(target_os = "macos")]
                if source_id.as_deref() == Some(audio::MAC_SYSTEM_ID) {
                    let started = crate::macos_tap::SystemTap::create().and_then(|tap| {
                        let (rate, channels) = tap.format()?;
                        let capture = tap.start(pcm_tx)?;
                        Ok((tap, capture, rate, channels))
                    });
                    match started {
                        Ok((tap, capture, rate, channels)) => {
                            let _ = ready_tx.send(Ok((rate, channels, "System audio".into())));
                            let _ = capture_stop_rx.recv();
                            // Stop reading before tearing down the tap
                            drop(capture);
                            drop(tap);
                        }
                        Err(e) => {
                            let _ = ready_tx.send(Err(e));
                        }
                    }
                    return;
                }
                #[cfg(target_os = "android")]
                if source_id.as_deref() == Some(audio::ANDROID_SYSTEM_ID) {
                    // Kotlin's playback-capture service pushes 48 kHz stereo into this channel
                    crate::android::set_system_audio_sink(Some(pcm_tx));
                    let _ = ready_tx.send(Ok((SAMPLE_RATE, CHANNELS, "System audio".into())));
                    let _ = capture_stop_rx.recv();
                    crate::android::set_system_audio_sink(None);
                    return;
                }
                let started = audio::resolve_source(source_id.as_deref()).and_then(|target| {
                    let stream = build_input(&target, pcm_tx)?;
                    stream
                        .play()
                        .map_err(|e| format!("Could not start audio capture: {e}"))?;
                    Ok((stream, target))
                });
                match started {
                    Ok((stream, target)) => {
                        let label = target
                            .device
                            .name()
                            .unwrap_or_else(|_| "Audio input".into());
                        let _ = ready_tx.send(Ok((
                            target.config.sample_rate().0,
                            target.config.channels() as usize,
                            label,
                        )));
                        // Park until asked to stop (or the Sender is dropped)
                        let _ = capture_stop_rx.recv();
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let (rate, channels, source_label) = ready_rx
            .recv()
            .map_err(|_| "Audio capture stopped unexpectedly".to_string())??;

        let stop = Arc::new(AtomicBool::new(false));
        let encoder_stop = stop.clone();
        let encoder = thread::Builder::new()
            .name("auracast-encoder".into())
            .spawn(move || run_encoder(events, socket, pcm_rx, rate, channels, encoder_stop))
            .map_err(|e| e.to_string())?;

        Ok(Self {
            port,
            source_label,
            stop,
            capture_stop,
            threads: vec![capture, encoder],
        })
    }
}

impl Drop for Sender {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.capture_stop.send(());
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

/// Real-time 440 Hz sine at -12 dBFS, paced to the wall clock like a capture device.
fn generate_tone(tx: SyncSender<Vec<f32>>, stop: mpsc::Receiver<()>) {
    const CHUNK: u64 = 480; // 10 ms
    let started = Instant::now();
    let mut produced: u64 = 0;
    let step = 2.0 * std::f32::consts::PI * 440.0 / SAMPLE_RATE as f32;
    let mut phase = 0f32;
    loop {
        match stop.recv_timeout(Duration::from_millis(5)) {
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            _ => return,
        }
        let due = started.elapsed().as_micros() as u64 * SAMPLE_RATE as u64 / 1_000_000;
        while produced + CHUNK <= due {
            let mut chunk = Vec::with_capacity(CHUNK as usize * CHANNELS);
            for _ in 0..CHUNK {
                let s = phase.sin() * 0.25;
                chunk.push(s);
                chunk.push(s);
                phase = (phase + step) % (2.0 * std::f32::consts::PI);
            }
            let _ = tx.try_send(chunk);
            produced += CHUNK;
        }
    }
}

fn build_input(target: &CaptureTarget, tx: SyncSender<Vec<f32>>) -> Result<cpal::Stream, String> {
    use cpal::SampleFormat as F;
    let config: cpal::StreamConfig = target.config.clone().into();
    match target.config.sample_format() {
        F::F32 => build_input_typed::<f32>(&target.device, &config, tx),
        F::I16 => build_input_typed::<i16>(&target.device, &config, tx),
        F::U16 => build_input_typed::<u16>(&target.device, &config, tx),
        F::I32 => build_input_typed::<i32>(&target.device, &config, tx),
        other => Err(format!("Unsupported audio input format: {other:?}")),
    }
}

fn build_input_typed<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    tx: SyncSender<Vec<f32>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let chunk: Vec<f32> = data.iter().map(|&s| s.to_sample::<f32>()).collect();
                // Drop audio rather than block the audio thread if the encoder falls behind
                let _ = tx.try_send(chunk);
            },
            |e| eprintln!("[auracast] capture stream error: {e}"),
            None,
        )
        .map_err(|e| format!("Could not open audio input: {e}"))
}

fn run_encoder(
    events: EventSink,
    socket: UdpSocket,
    pcm_rx: mpsc::Receiver<Vec<f32>>,
    input_rate: u32,
    input_channels: usize,
    stop: Arc<AtomicBool>,
) {
    let mut encoder = match opus::Encoder::new(
        SAMPLE_RATE,
        opus::Channels::Stereo,
        opus::Application::Audio,
    ) {
        Ok(e) => e,
        Err(e) => {
            events(Event::StreamError(format!(
                "Opus encoder failed to start: {e}"
            )));
            return;
        }
    };
    let _ = encoder.set_bitrate(opus::Bitrate::Bits(BITRATE));

    let stream_id = crate::random_u64() as u16;
    let mut seq: u32 = 0;
    let mut sample_pos: u64 = 0;

    let mut resampler = StereoResampler::new(input_rate, SAMPLE_RATE);
    let mut stereo = Vec::new();
    let mut pending: Vec<f32> = Vec::new();
    let mut opus_out = vec![0u8; 4000];
    let mut packet = Vec::with_capacity(4000);
    let mut control_buf = [0u8; 256];

    let mut subscribers: HashMap<SocketAddr, Instant> = HashMap::new();
    let mut packets_sent = 0u64;
    let mut level = 0f32;
    let mut last_stats = Instant::now();

    while !stop.load(Ordering::SeqCst) {
        loop {
            match socket.recv_from(&mut control_buf) {
                Ok((n, from)) => match protocol::decode(&control_buf[..n]) {
                    Some((h, _)) if h.kind == Kind::Subscribe => {
                        subscribers.insert(from, Instant::now());
                    }
                    Some((h, _)) if h.kind == Kind::Unsubscribe => {
                        subscribers.remove(&from);
                    }
                    _ => {}
                },
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                // Windows reports ICMP "port unreachable" from an earlier send as a recv error
                Err(e) if e.kind() == ErrorKind::ConnectionReset => continue,
                Err(e) => {
                    eprintln!("[auracast] control socket error: {e}");
                    break;
                }
            }
        }
        subscribers.retain(|_, seen| seen.elapsed() < SUBSCRIBER_TIMEOUT);

        match pcm_rx.recv_timeout(Duration::from_millis(10)) {
            Ok(chunk) => {
                stereo.clear();
                audio::push_as_stereo(&chunk, input_channels, &mut stereo);
                resampler.process(&stereo, &mut pending);

                let frame_len = FRAME_SAMPLES * CHANNELS;
                let mut offset = 0;
                while pending.len() - offset >= frame_len {
                    let frame = &pending[offset..offset + frame_len];
                    offset += frame_len;
                    level = level.max(audio::meter_level(frame));

                    if !subscribers.is_empty() {
                        match encoder.encode_float(frame, &mut opus_out) {
                            Ok(len) => {
                                let header = Header {
                                    kind: Kind::Audio,
                                    stream_id,
                                    seq,
                                    sample_pos,
                                };
                                protocol::encode(&header, &opus_out[..len], &mut packet);
                                for addr in subscribers.keys() {
                                    let _ = socket.send_to(&packet, addr);
                                }
                                packets_sent += 1;
                            }
                            Err(e) => eprintln!("[auracast] opus encode error: {e}"),
                        }
                    }
                    seq = seq.wrapping_add(1);
                    sample_pos += FRAME_SAMPLES as u64;
                }
                pending.drain(..offset);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                // Expected while shutting down; otherwise the capture device went away
                if !stop.load(Ordering::SeqCst) {
                    events(Event::StreamError(
                        "The audio input stopped. Was the device unplugged?".into(),
                    ));
                }
                break;
            }
        }

        if last_stats.elapsed() >= STATS_INTERVAL {
            events(Event::SenderStats(SenderStats {
                level,
                listeners: subscribers.keys().map(|a| a.to_string()).collect(),
                packets_sent,
            }));
            level = 0.0;
            last_stats = Instant::now();
        }
    }
}
