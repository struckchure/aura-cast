// Typed wrappers around the Rust commands and events in src-tauri/src/lib.rs.

import {invoke, isTauri} from '@tauri-apps/api/core';
import {listen, type UnlistenFn} from '@tauri-apps/api/event';

export {isTauri};

export interface SendingInfo {
  port: number;
  source: string;
  localIp: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  os: string;
  localIp: string | null;
  discoveryError: string | null;
  volume: number;
  latencyMs: number;
  outputDevice: string | null;
  sending: SendingInfo | null;
  listeningTo: string | null;
}

export interface AudioSource {
  id: string;
  label: string;
  kind: 'microphone' | 'system' | 'test';
  isDefault: boolean;
}

export interface OutputDevice {
  name: string;
  isDefault: boolean;
}

export interface Peer {
  id: string;
  name: string;
  os: string;
  address: string;
}

export interface SenderStats {
  level: number;
  listeners: string[];
  packetsSent: number;
}

export type ReceiverState = 'connecting' | 'buffering' | 'playing' | 'no-signal';

export interface ReceiverStats {
  state: ReceiverState;
  address: string;
  bufferedMs: number;
  packetsReceived: number;
  packetsLost: number;
  underruns: number;
  level: number;
}

export const api = {
  getDeviceInfo: () => invoke<DeviceInfo>('get_device_info'),
  setDeviceName: (name: string) => invoke<string>('set_device_name', {name}),
  listAudioSources: () => invoke<AudioSource[]>('list_audio_sources'),
  listOutputDevices: () => invoke<OutputDevice[]>('list_output_devices'),
  getPeers: () => invoke<Peer[]>('get_peers'),
  startSending: (sourceId: string | null) => invoke<SendingInfo>('start_sending', {sourceId}),
  stopSending: () => invoke<void>('stop_sending'),
  connect: (address: string) => invoke<string>('connect', {address}),
  disconnect: () => invoke<void>('disconnect'),
  setVolume: (volume: number) => invoke<void>('set_volume', {volume}),
  setLatency: (latencyMs: number) => invoke<void>('set_latency', {latencyMs}),
  setOutputDevice: (name: string | null) => invoke<void>('set_output_device', {name}),
};

export const events = {
  onPeers: (cb: (peers: Peer[]) => void): Promise<UnlistenFn> =>
    listen<Peer[]>('peers-changed', (e) => cb(e.payload)),
  onSenderStats: (cb: (stats: SenderStats) => void): Promise<UnlistenFn> =>
    listen<SenderStats>('sender-stats', (e) => cb(e.payload)),
  onReceiverStats: (cb: (stats: ReceiverStats) => void): Promise<UnlistenFn> =>
    listen<ReceiverStats>('receiver-stats', (e) => cb(e.payload)),
  onStreamError: (cb: (message: string) => void): Promise<UnlistenFn> =>
    listen<string>('stream-error', (e) => cb(e.payload)),
};

/** Tauri rejects with the Rust `Err(String)`; normalise anything else. */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
