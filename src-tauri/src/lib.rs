// src-tauri/src/lib.rs
// AuraCast: stream audio between devices on the same Wi-Fi / LAN.
//
// A device either *sends* (captures an input, encodes Opus, streams over UDP)
// or *listens* (subscribes to a sender and plays the stream). Senders are
// found automatically with mDNS, or reached directly by `ip:port`.

#[cfg(target_os = "android")]
mod android;
mod audio;
mod discovery;
mod events;
#[cfg(target_os = "macos")]
mod macos_tap;
mod protocol;
mod receiver;
mod sender;

use discovery::{Discovery, Peer};
use receiver::{Controls, Receiver};
use sender::Sender;
use serde::Serialize;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const DEFAULT_LATENCY_MS: u32 = 100;

struct AppState {
    device_id: String,
    device_name: Mutex<String>,
    discovery: Result<Discovery, String>,
    sender: Mutex<Option<Sender>>,
    receiver: Mutex<Option<Receiver>>,
    output_device: Mutex<Option<String>>,
    controls: Controls,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    id: String,
    name: String,
    os: &'static str,
    local_ip: Option<String>,
    discovery_error: Option<String>,
    volume: f32,
    latency_ms: u32,
    output_device: Option<String>,
    sending: Option<SendingInfo>,
    listening_to: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SendingInfo {
    port: u16,
    source: String,
    local_ip: Option<String>,
}

pub(crate) fn random_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default(),
    );
    hasher.finish()
}

/// Best guess at this device's LAN address, shown so others can connect manually.
fn local_ip() -> Option<String> {
    // Connecting a UDP socket sends nothing; it only asks the OS which interface would be used
    ["8.8.8.8:80", "192.168.0.1:80", "10.0.0.1:80"]
        .iter()
        .find_map(|target| {
            let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
            socket.connect(target).ok()?;
            let ip = socket.local_addr().ok()?.ip();
            (!ip.is_unspecified() && !ip.is_loopback()).then(|| ip.to_string())
        })
}

fn default_device_name() -> String {
    let name = if cfg!(target_os = "macos") {
        std::process::Command::new("scutil")
            .args(["--get", "ComputerName"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
    } else if cfg!(target_os = "windows") {
        std::env::var("COMPUTERNAME").ok()
    } else if cfg!(target_os = "android") {
        None
    } else {
        std::fs::read_to_string("/etc/hostname").ok()
    };
    name.map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| match std::env::consts::OS {
            "android" => "Android device".into(),
            "ios" => "iPhone".into(),
            os => format!("AuraCast ({os})"),
        })
}

fn sending_info(sender: &Sender) -> SendingInfo {
    SendingInfo {
        port: sender.port,
        source: sender.source_label.clone(),
        local_ip: local_ip(),
    }
}

/// Accepts `ip:port`, `host:port`, or a bare IP/host (default port).
fn parse_address(input: &str) -> Result<SocketAddr, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Enter the address shown on the sending device".into());
    }
    let with_port = if input.parse::<std::net::IpAddr>().is_ok() || !input.contains(':') {
        format!("{input}:{}", sender::DEFAULT_PORT)
    } else {
        input.to_string()
    };
    with_port
        .to_socket_addrs()
        .map_err(|e| format!("\"{input}\" is not a valid address: {e}"))?
        .find(|a| a.is_ipv4())
        .ok_or_else(|| format!("Could not resolve \"{input}\""))
}

#[tauri::command]
fn get_device_info(state: State<'_, AppState>) -> DeviceInfo {
    DeviceInfo {
        id: state.device_id.clone(),
        name: state.device_name.lock().unwrap().clone(),
        os: std::env::consts::OS,
        local_ip: local_ip(),
        discovery_error: state.discovery.as_ref().err().cloned(),
        volume: f32::from_bits(state.controls.volume.load(Ordering::Relaxed)),
        latency_ms: state.controls.latency_ms.load(Ordering::Relaxed),
        output_device: state.output_device.lock().unwrap().clone(),
        sending: state.sender.lock().unwrap().as_ref().map(sending_info),
        listening_to: state
            .receiver
            .lock()
            .unwrap()
            .as_ref()
            .map(|r| r.address.to_string()),
    }
}

#[tauri::command]
fn set_device_name(name: String, state: State<'_, AppState>) -> Result<String, String> {
    let name = name.trim().chars().take(60).collect::<String>();
    if name.is_empty() {
        return Err("Device name cannot be empty".into());
    }
    *state.device_name.lock().unwrap() = name.clone();
    // Re-announce under the new name if we are broadcasting
    if let (Some(sender), Ok(discovery)) = (state.sender.lock().unwrap().as_ref(), &state.discovery)
    {
        discovery.advertise(&name, sender.port)?;
    }
    Ok(name)
}

#[tauri::command]
fn list_audio_sources() -> Vec<audio::AudioSource> {
    audio::list_sources()
}

#[tauri::command]
fn list_output_devices() -> Vec<audio::OutputDevice> {
    audio::list_outputs()
}

#[tauri::command]
fn get_peers(state: State<'_, AppState>) -> Vec<Peer> {
    state
        .discovery
        .as_ref()
        .map(|d| d.peers())
        .unwrap_or_default()
}

#[tauri::command]
fn start_sending(
    source_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SendingInfo, String> {
    let mut slot = state.sender.lock().unwrap();
    slot.take(); // stop any previous broadcast first so the port is free
    let sender = Sender::start(events::tauri_sink(app), source_id)?;
    let info = sending_info(&sender);
    if let Ok(discovery) = &state.discovery {
        if let Err(e) = discovery.advertise(&state.device_name.lock().unwrap(), sender.port) {
            // Still reachable by address; just not auto-discoverable
            eprintln!("[auracast] {e}");
        }
    }
    *slot = Some(sender);
    Ok(info)
}

#[tauri::command]
fn stop_sending(state: State<'_, AppState>) {
    if let Ok(discovery) = &state.discovery {
        discovery.withdraw();
    }
    state.sender.lock().unwrap().take();
}

#[tauri::command]
fn connect(address: String, app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let address = parse_address(&address)?;
    let mut slot = state.receiver.lock().unwrap();
    slot.take();
    let output = state.output_device.lock().unwrap().clone();
    *slot = Some(Receiver::start(
        events::tauri_sink(app),
        address,
        output,
        state.controls.clone(),
    )?);
    Ok(address.to_string())
}

#[tauri::command]
fn disconnect(state: State<'_, AppState>) {
    state.receiver.lock().unwrap().take();
}

#[tauri::command]
fn set_volume(volume: f32, state: State<'_, AppState>) {
    state
        .controls
        .volume
        .store(volume.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
}

#[tauri::command]
fn set_latency(latency_ms: u32, state: State<'_, AppState>) {
    state
        .controls
        .latency_ms
        .store(latency_ms.clamp(20, 1000), Ordering::Relaxed);
}

#[tauri::command]
fn set_output_device(
    name: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    *state.output_device.lock().unwrap() = name.clone();
    // Reopen playback on the new device if we are listening
    let mut slot = state.receiver.lock().unwrap();
    if let Some(address) = slot.as_ref().map(|r| r.address) {
        slot.take();
        *slot = Some(Receiver::start(
            events::tauri_sink(app),
            address,
            name,
            state.controls.clone(),
        )?);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let device_id = format!("{:016x}", random_u64());
            let discovery = Discovery::start(app.handle().clone(), device_id.clone());
            if let Err(e) = &discovery {
                eprintln!("[auracast] {e}");
            }
            app.manage(AppState {
                device_id,
                device_name: Mutex::new(default_device_name()),
                discovery,
                sender: Mutex::new(None),
                receiver: Mutex::new(None),
                output_device: Mutex::new(None),
                controls: Controls {
                    volume: Arc::new(AtomicU32::new(1.0f32.to_bits())),
                    latency_ms: Arc::new(AtomicU32::new(DEFAULT_LATENCY_MS)),
                },
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_info,
            set_device_name,
            list_audio_sources,
            list_output_devices,
            get_peers,
            start_sending,
            stop_sending,
            connect,
            disconnect,
            set_volume,
            set_latency,
            set_output_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraCast");
}

#[cfg(test)]
mod tests {
    use super::*;
    use events::Event;

    fn seconds_from_env() -> u64 {
        std::env::var("AURACAST_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60)
    }

    /// Manual testing: broadcast the test tone so another device can listen.
    /// `AURACAST_SECONDS=120 cargo test manual_send_tone -- --ignored --nocapture`
    #[test]
    #[ignore = "manual tool"]
    fn manual_send_tone() {
        let sink: events::EventSink = Arc::new(|event| match event {
            Event::SenderStats(s) if !s.listeners.is_empty() => {
                println!("listeners={:?} sent={}", s.listeners, s.packets_sent)
            }
            Event::StreamError(e) => println!("error: {e}"),
            _ => {}
        });
        let sender = Sender::start(sink, Some(audio::TEST_TONE_ID.into())).expect("sender starts");
        println!(
            "sending test tone on port {} (local ip {:?})",
            sender.port,
            local_ip()
        );
        std::thread::sleep(std::time::Duration::from_secs(seconds_from_env()));
    }

    /// Manual testing: capture this Mac's system audio for a few seconds and
    /// report the level (play something while it runs).
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "manual tool"]
    fn manual_mac_system_audio_level() {
        let levels = Arc::new(Mutex::new(Vec::new()));
        let errors = Arc::new(Mutex::new(Vec::new()));
        let sink: events::EventSink = {
            let (levels, errors) = (levels.clone(), errors.clone());
            Arc::new(move |event| match event {
                Event::SenderStats(s) => levels.lock().unwrap().push(s.level),
                Event::StreamError(e) => errors.lock().unwrap().push(e),
                _ => {}
            })
        };
        let sender = Sender::start(sink, Some(audio::MAC_SYSTEM_ID.into()))
            .expect("system audio capture starts");
        println!("capturing: {}", sender.source_label);
        std::thread::sleep(std::time::Duration::from_secs(seconds_from_env()));
        drop(sender);
        let levels = levels.lock().unwrap();
        let peak = levels.iter().cloned().fold(0f32, f32::max);
        println!(
            "stats={} peak level={peak:.2} errors={:?}",
            levels.len(),
            errors.lock().unwrap()
        );
    }

    /// Manual testing: listen to `AURACAST_ADDR` and print receiver stats.
    /// `AURACAST_ADDR=192.168.1.20:47800 cargo test manual_listen -- --ignored --nocapture`
    #[test]
    #[ignore = "manual tool"]
    fn manual_listen() {
        let address =
            parse_address(&std::env::var("AURACAST_ADDR").expect("set AURACAST_ADDR")).unwrap();
        let last_print = Mutex::new(std::time::Instant::now());
        let sink: events::EventSink = Arc::new(move |event| match event {
            Event::ReceiverStats(s) => {
                let mut last = last_print.lock().unwrap();
                if last.elapsed().as_secs() >= 1 {
                    *last = std::time::Instant::now();
                    println!(
                        "state={} received={} lost={} underruns={} buffered={:.0}ms level={:.2}",
                        s.state,
                        s.packets_received,
                        s.packets_lost,
                        s.underruns,
                        s.buffered_ms,
                        s.level
                    );
                }
            }
            Event::StreamError(e) => println!("error: {e}"),
            _ => {}
        });
        let controls = Controls {
            volume: Arc::new(AtomicU32::new(0.3f32.to_bits())),
            latency_ms: Arc::new(AtomicU32::new(DEFAULT_LATENCY_MS)),
        };
        let _receiver = Receiver::start(sink, address, None, controls).expect("receiver starts");
        std::thread::sleep(std::time::Duration::from_secs(seconds_from_env()));
    }

    /// Streams the test tone to the default output over localhost UDP.
    /// Run with `cargo test streams_end_to_end -- --ignored` on a machine with audio output.
    #[test]
    #[ignore = "needs a real audio output device"]
    fn streams_end_to_end_over_udp() {
        let receiver_stats = Arc::new(Mutex::new(Vec::new()));
        let listeners = Arc::new(Mutex::new(0usize));
        let errors = Arc::new(Mutex::new(Vec::new()));
        let sink: events::EventSink = {
            let (receiver_stats, listeners, errors) =
                (receiver_stats.clone(), listeners.clone(), errors.clone());
            Arc::new(move |event| match event {
                Event::ReceiverStats(s) => receiver_stats.lock().unwrap().push(s),
                Event::SenderStats(s) => *listeners.lock().unwrap() = s.listeners.len(),
                Event::StreamError(e) => errors.lock().unwrap().push(e),
            })
        };

        let sender =
            Sender::start(sink.clone(), Some(audio::TEST_TONE_ID.into())).expect("sender starts");
        let controls = Controls {
            // silent, so running the test does not beep
            volume: Arc::new(AtomicU32::new(0f32.to_bits())),
            latency_ms: Arc::new(AtomicU32::new(DEFAULT_LATENCY_MS)),
        };
        let address: SocketAddr = format!("127.0.0.1:{}", sender.port).parse().unwrap();
        let receiver = Receiver::start(sink, address, None, controls).expect("receiver starts");

        std::thread::sleep(std::time::Duration::from_secs(3));
        drop(receiver);
        drop(sender);

        assert!(
            errors.lock().unwrap().is_empty(),
            "stream errors: {:?}",
            errors.lock().unwrap()
        );
        assert_eq!(
            *listeners.lock().unwrap(),
            1,
            "sender should see exactly one listener"
        );
        let stats = receiver_stats.lock().unwrap();
        let last = stats.last().expect("receiver reported stats");
        println!(
            "state={} received={} lost={} underruns={} buffered={:.0}ms",
            last.state, last.packets_received, last.packets_lost, last.underruns, last.buffered_ms
        );
        assert_eq!(last.state, "playing");
        // ~3 s of 20 ms packets, minus subscribe/buffering time
        assert!(
            last.packets_received > 100,
            "only {} packets",
            last.packets_received
        );
        // The tone is -12 dBFS; the decoded level proves real audio came through
        assert!(last.level > 0.5, "decoded level {} is too low", last.level);
        assert!(
            last.packets_lost <= 2,
            "{} packets lost on localhost",
            last.packets_lost
        );
    }

    #[test]
    fn parses_addresses() {
        assert_eq!(
            parse_address("192.168.1.20:5000").unwrap().to_string(),
            "192.168.1.20:5000"
        );
        assert_eq!(
            parse_address(" 192.168.1.20 ").unwrap().to_string(),
            "192.168.1.20:47800"
        );
        assert!(parse_address("").is_err());
        assert!(parse_address("not an address!").is_err());
    }
}
