//! Audio device discovery and sample-format helpers shared by sender and receiver.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
    /// Opaque id passed back to `start_sending`
    pub id: String,
    pub label: String,
    /// "microphone" (any capture device), "system" (loopback of an output device) or "test"
    pub kind: &'static str,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub name: String,
    pub is_default: bool,
}

const INPUT_PREFIX: &str = "input:";
const LOOPBACK_PREFIX: &str = "loopback:";
/// The system default input
pub const DEFAULT_INPUT_ID: &str = "input-default";
/// Everything playing on this Mac (Core Audio process tap)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const MAC_SYSTEM_ID: &str = "system:mac";
/// Everything playing on this phone (Android playback capture, fed from Kotlin)
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub const ANDROID_SYSTEM_ID: &str = "system:android";
/// Built-in sine generator, for checking a connection without a microphone
pub const TEST_TONE_ID: &str = "test:tone";

/// Device names, without duplicates (devices are identified by name).
fn unique_names(
    devices: Result<impl Iterator<Item = cpal::Device>, cpal::DevicesError>,
) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for name in devices.into_iter().flatten().filter_map(|d| d.name().ok()) {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

pub fn list_sources() -> Vec<AudioSource> {
    let host = cpal::default_host();
    let mut sources = Vec::new();

    if cfg!(target_os = "android") {
        // Android names every input (mic, voice call, ...) after the phone model,
        // so the only meaningful choice is the system default microphone
        sources.push(AudioSource {
            id: DEFAULT_INPUT_ID.into(),
            label: "Microphone".into(),
            kind: "microphone",
            is_default: true,
        });
    } else {
        let default_in = host.default_input_device().and_then(|d| d.name().ok());
        for name in unique_names(host.input_devices()) {
            sources.push(AudioSource {
                id: format!("{INPUT_PREFIX}{name}"),
                is_default: default_in.as_deref() == Some(name.as_str()),
                label: name,
                kind: "microphone",
            });
        }
    }

    // WASAPI can capture whatever an output device is playing (loopback)
    if cfg!(target_os = "windows") {
        let default_out = host.default_output_device().and_then(|d| d.name().ok());
        let mut names = unique_names(host.output_devices());
        // The default output first: it is what most people want to share
        names.sort_by_key(|name| default_out.as_deref() != Some(name.as_str()));
        for name in names {
            sources.push(AudioSource {
                id: format!("{LOOPBACK_PREFIX}{name}"),
                is_default: false,
                label: format!("System audio ({name})"),
                kind: "system",
            });
        }
    }

    #[cfg(target_os = "macos")]
    if crate::macos_tap::is_supported() {
        sources.push(AudioSource {
            id: MAC_SYSTEM_ID.into(),
            label: "System audio (this Mac)".into(),
            kind: "system",
            is_default: false,
        });
    }

    #[cfg(target_os = "android")]
    if crate::android::supports_playback_capture() {
        sources.push(AudioSource {
            id: ANDROID_SYSTEM_ID.into(),
            label: "System audio (this phone)".into(),
            kind: "system",
            is_default: false,
        });
    }

    sources.push(AudioSource {
        id: TEST_TONE_ID.into(),
        label: "Test tone (440 Hz)".into(),
        kind: "test",
        is_default: false,
    });

    sources
}

pub fn list_outputs() -> Vec<OutputDevice> {
    let host = cpal::default_host();
    let default_out = host.default_output_device().and_then(|d| d.name().ok());
    unique_names(host.output_devices())
        .into_iter()
        .map(|name| OutputDevice {
            is_default: default_out.as_deref() == Some(name.as_str()),
            name,
        })
        .collect()
}

/// Capture device plus the config to open it with.
pub struct CaptureTarget {
    pub device: cpal::Device,
    pub config: cpal::SupportedStreamConfig,
    /// Anything that must outlive the stream (e.g. the macOS system-audio tap)
    pub _keepalive: Option<Box<dyn std::any::Any + Send>>,
}

pub fn resolve_source(id: Option<&str>) -> Result<CaptureTarget, String> {
    let host = cpal::default_host();

    #[cfg(target_os = "macos")]
    if id == Some(MAC_SYSTEM_ID) {
        return open_mac_system_audio(&host);
    }

    let (device, loopback) = match id {
        Some(id) if id.starts_with(LOOPBACK_PREFIX) => {
            let name = &id[LOOPBACK_PREFIX.len()..];
            let dev = host
                .output_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("Output device \"{name}\" is no longer available"))?;
            (dev, true)
        }
        Some(id) if id.starts_with(INPUT_PREFIX) => {
            let name = &id[INPUT_PREFIX.len()..];
            let dev = host
                .input_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("Input device \"{name}\" is no longer available"))?;
            (dev, false)
        }
        _ => (
            host.default_input_device()
                .ok_or("No microphone or audio input was found on this device")?,
            false,
        ),
    };

    let config = if loopback {
        device.default_output_config()
    } else {
        device.default_input_config()
    }
    .map_err(|e| format!("Could not read audio input format: {e}"))?;

    Ok(CaptureTarget {
        device,
        config,
        _keepalive: None,
    })
}

#[cfg(target_os = "macos")]
fn open_mac_system_audio(host: &cpal::Host) -> Result<CaptureTarget, String> {
    use crate::macos_tap::{SystemTap, DEVICE_NAME};
    let tap = SystemTap::create()?;
    // The tap is exposed through a private aggregate device, which can take a moment to appear
    let device = (0..40)
        .find_map(|_| {
            let found = host
                .input_devices()
                .ok()?
                .find(|d| d.name().ok().as_deref() == Some(DEVICE_NAME));
            if found.is_none() {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            found
        })
        .ok_or("The system audio capture device did not appear")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("Could not read system audio format: {e}"))?;
    Ok(CaptureTarget {
        device,
        config,
        _keepalive: Some(Box::new(tap)),
    })
}

pub fn resolve_output(name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(name) = name {
        if let Some(dev) = host
            .output_devices()
            .ok()
            .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(name)))
        {
            return Ok(dev);
        }
    }
    host.default_output_device()
        .ok_or_else(|| "No speaker or audio output was found on this device".into())
}

/// Append `frames` of interleaved audio with `channels` channels as stereo.
pub fn push_as_stereo(input: &[f32], channels: usize, out: &mut Vec<f32>) {
    match channels {
        0 => {}
        1 => {
            for &s in input {
                out.push(s);
                out.push(s);
            }
        }
        2 => out.extend_from_slice(input),
        n => {
            for frame in input.chunks_exact(n) {
                out.push(frame[0]);
                out.push(frame[1]);
            }
        }
    }
}

/// Streaming linear-interpolation resampler for interleaved stereo audio.
///
/// Linear interpolation is not audiophile grade, but it is cheap, has no
/// latency, and is inaudible for the common 44.1 kHz <-> 48 kHz conversion.
pub struct StereoResampler {
    /// input frames advanced per output frame
    step: f64,
    /// fractional read position, relative to `prev`
    pos: f64,
    prev: Option<[f32; 2]>,
}

impl StereoResampler {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        Self {
            step: from_rate as f64 / to_rate as f64,
            pos: 0.0,
            prev: None,
        }
    }

    pub fn is_passthrough(&self) -> bool {
        self.step == 1.0
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.is_passthrough() {
            out.extend_from_slice(input);
            return;
        }
        let frames = input.len() / 2;
        if frames == 0 {
            return;
        }
        let prev = self.prev.unwrap_or([input[0], input[1]]);
        // Frame `i` of the virtual buffer [prev, input...]
        let frame = |i: usize| -> [f32; 2] {
            if i == 0 {
                prev
            } else {
                [input[(i - 1) * 2], input[(i - 1) * 2 + 1]]
            }
        };
        let last = frames; // index of the final frame in the virtual buffer
        while self.pos < last as f64 {
            let i = self.pos as usize;
            let t = (self.pos - i as f64) as f32;
            let a = frame(i);
            let b = frame(i + 1);
            out.push(a[0] + (b[0] - a[0]) * t);
            out.push(a[1] + (b[1] - a[1]) * t);
            self.pos += self.step;
        }
        self.pos -= last as f64;
        self.prev = Some(frame(last));
    }
}

/// RMS level of an interleaved buffer, mapped to 0..1 on a -60..0 dBFS scale.
pub fn meter_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    if rms <= 0.0 {
        return 0.0;
    }
    let db = 20.0 * rms.log10();
    ((db + 60.0) / 60.0).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_passthrough() {
        let mut r = StereoResampler::new(48_000, 48_000);
        let mut out = Vec::new();
        r.process(&[0.1, 0.2, 0.3, 0.4], &mut out);
        assert_eq!(out, vec![0.1, 0.2, 0.3, 0.4]);
    }

    #[test]
    fn resampler_ratio_is_preserved_across_chunks() {
        let mut r = StereoResampler::new(44_100, 48_000);
        let mut out = Vec::new();
        let chunk = vec![0.5f32; 441 * 2];
        for _ in 0..100 {
            r.process(&chunk, &mut out);
        }
        // 44_100 input frames -> ~48_000 output frames
        let frames = out.len() / 2;
        assert!((47_990..=48_010).contains(&frames), "got {frames}");
        assert!(out.iter().all(|&s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn stereo_conversion() {
        let mut out = Vec::new();
        push_as_stereo(&[1.0, 2.0], 1, &mut out);
        assert_eq!(out, vec![1.0, 1.0, 2.0, 2.0]);
        out.clear();
        push_as_stereo(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0], 3, &mut out);
        assert_eq!(out, vec![1.0, 2.0, 4.0, 5.0]);
    }
}
