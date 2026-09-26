export type DeviceRole = 'receiver' | 'transmitter';

export type ProtocolType = 'bluetooth' | 'airplay' | 'snapcast' | 'dlna' | 'lowlatency';

export type AudioCodec = 'SBC' | 'AAC' | 'aptX' | 'aptX HD' | 'LDAC' | 'Opus' | 'ALAC';

export interface DiscoveredDevice {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'tablet' | 'tv' | 'hifi_dac';
  os: 'macOS' | 'iOS' | 'Android' | 'Windows' | 'Linux';
  protocols: ProtocolType[];
  ipAddress: string;
  macAddress: string;
  rssi: number; // dBm
  batteryLevel?: number;
  isPaired: boolean;
  isConnected: boolean;
  stereoRole: 'stereo' | 'left' | 'right' | 'mono';
  volume: number;
  latencyMs: number;
}

export interface AudioEngineSettings {
  masterVolume: number;
  isMuted: boolean;
  eqBands: {
    sub: number;       // 60Hz (-12 to +12 dB)
    low: number;       // 250Hz
    mid: number;       // 1000Hz
    presence: number;  // 4000Hz
    high: number;      // 12000Hz
  };
  bassBoost: boolean;
  spatialWiden: number; // 0 to 100%
  jitterBufferMs: number; // 5 to 250ms
  sampleRate: number; // 44100, 48000, 96000
  bitDepth: 16 | 24 | 32;
  channelRouting: 'stereo' | 'left' | 'right' | 'mono';
}

export interface StreamMetadata {
  title: string;
  artist: string;
  album: string;
  codec: AudioCodec;
  bitrateKbps: number;
  sampleRate: number;
  bitDepth: number;
  latencyMs: number;
  bufferHealthPercent: number;
}

export interface TauriIPCLog {
  id: string;
  timestamp: string;
  command: string;
  args?: Record<string, any>;
  response?: string;
  status: 'invoked' | 'success' | 'event';
}
