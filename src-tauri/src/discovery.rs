//! Finds other AuraCast devices on the local network via mDNS / DNS-SD, and
//! advertises this device while it is broadcasting.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub const SERVICE_TYPE: &str = "_auracast._udp.local.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub os: String,
    /// `ip:port` to connect to
    pub address: String,
}

pub struct Discovery {
    daemon: ServiceDaemon,
    peers: Arc<Mutex<HashMap<String, Peer>>>,
    advertised: Mutex<Option<String>>,
    device_id: String,
}

impl Discovery {
    pub fn start(app: AppHandle, device_id: String) -> Result<Self, String> {
        let daemon =
            ServiceDaemon::new().map_err(|e| format!("Network discovery unavailable: {e}"))?;
        let events = daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("Network discovery unavailable: {e}"))?;
        let peers: Arc<Mutex<HashMap<String, Peer>>> = Arc::default();

        let own_id = device_id.clone();
        let thread_peers = peers.clone();
        thread::Builder::new()
            .name("auracast-discovery".into())
            .spawn(move || {
                while let Ok(event) = events.recv() {
                    let changed = match event {
                        ServiceEvent::ServiceResolved(info) => match peer_from(&info) {
                            Some(peer) if peer.id != own_id => {
                                thread_peers
                                    .lock()
                                    .unwrap()
                                    .insert(info.get_fullname().to_string(), peer);
                                true
                            }
                            _ => false,
                        },
                        ServiceEvent::ServiceRemoved(_, fullname) => {
                            thread_peers.lock().unwrap().remove(&fullname).is_some()
                        }
                        _ => false,
                    };
                    if changed {
                        let _ = app.emit("peers-changed", sorted(&thread_peers.lock().unwrap()));
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(Self {
            daemon,
            peers,
            advertised: Mutex::new(None),
            device_id,
        })
    }

    pub fn peers(&self) -> Vec<Peer> {
        sorted(&self.peers.lock().unwrap())
    }

    /// Announce this device as a sender reachable on `port`.
    pub fn advertise(&self, name: &str, port: u16) -> Result<(), String> {
        self.withdraw();
        let short_id = &self.device_id[..8];
        // Instance names must be unique on the network and at most 63 bytes
        let base: String = name.chars().filter(|c| *c != '.').take(40).collect();
        let instance = format!("{base} {short_id}");
        let host = format!("auracast-{short_id}.local.");
        let props = [
            ("id", self.device_id.as_str()),
            ("name", name),
            ("os", std::env::consts::OS),
        ];
        let info = ServiceInfo::new(SERVICE_TYPE, &instance, &host, "", port, &props[..])
            .map_err(|e| format!("Could not announce this device: {e}"))?
            .enable_addr_auto();
        let fullname = info.get_fullname().to_string();
        self.daemon
            .register(info)
            .map_err(|e| format!("Could not announce this device: {e}"))?;
        *self.advertised.lock().unwrap() = Some(fullname);
        Ok(())
    }

    pub fn withdraw(&self) {
        if let Some(fullname) = self.advertised.lock().unwrap().take() {
            let _ = self.daemon.unregister(&fullname);
        }
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        self.withdraw();
        let _ = self.daemon.shutdown();
    }
}

fn peer_from(info: &ServiceInfo) -> Option<Peer> {
    let id = info.get_property_val_str("id")?.to_string();
    // Prefer a private LAN address; any IPv4 address is better than none
    let mut v4: Vec<_> = info.get_addresses_v4().into_iter().copied().collect();
    v4.sort_by_key(|ip| (!ip.is_private(), *ip));
    let ip = v4.first()?;
    Some(Peer {
        name: info
            .get_property_val_str("name")
            .unwrap_or("AuraCast device")
            .to_string(),
        os: info.get_property_val_str("os").unwrap_or("").to_string(),
        address: format!("{ip}:{}", info.get_port()),
        id,
    })
}

fn sorted(peers: &HashMap<String, Peer>) -> Vec<Peer> {
    let mut list: Vec<Peer> = peers.values().cloned().collect();
    list.sort_by_key(|p| p.name.to_lowercase());
    list
}
