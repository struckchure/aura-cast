import React, { useState, useEffect } from 'react';
import {
  Radio,
  Cast,
  Radar,
  Cpu,
  Volume2,
  VolumeX,
  Play,
  Square,
  Sparkles,
  Sliders,
  CheckCircle2,
  Bluetooth,
  Wifi,
  Info
} from 'lucide-react';
import { DiscoveredDevice, AudioEngineSettings } from './types/audio';
import { audioEngine } from './services/audioEngine';
import { tauriBridge } from './services/tauriBridge';
import { ReceiverView } from './components/ReceiverView';
import { TransmitterView } from './components/TransmitterView';
import { DeviceMeshRadar } from './components/DeviceMeshRadar';
import { TauriRustInspector } from './components/TauriRustInspector';
import { TauriWindowFrame } from './components/TauriWindowFrame';
import { PWAInstallButton } from './components/InstallModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'receiver' | 'transmitter' | 'mesh' | 'rust'>('receiver');
  const [isPlaying, setIsPlaying] = useState(false);

  // Audio Engine DSP Settings
  const [dspSettings, setDspSettings] = useState<AudioEngineSettings>({
    masterVolume: 0.85,
    isMuted: false,
    eqBands: {
      sub: 3,
      low: 1,
      mid: 0,
      presence: 2,
      high: 3,
    },
    bassBoost: true,
    spatialWiden: 35,
    jitterBufferMs: 25,
    sampleRate: 48000,
    bitDepth: 24,
    channelRouting: 'stereo',
  });

  // Mock Discovered Devices Mesh
  const [devices, setDevices] = useState<DiscoveredDevice[]>([
    {
      id: 'dev_1',
      name: 'MacBook Pro 16 (Living Room)',
      type: 'desktop',
      os: 'macOS',
      protocols: ['airplay', 'snapcast', 'bluetooth'],
      ipAddress: '192.168.1.102',
      macAddress: '3C:06:30:4A:91:2E',
      rssi: -42,
      batteryLevel: 94,
      isPaired: true,
      isConnected: true,
      stereoRole: 'left',
      volume: 0.85,
      latencyMs: 14.2,
    },
    {
      id: 'dev_2',
      name: 'Google Pixel 9 Pro (Bedside)',
      type: 'mobile',
      os: 'Android',
      protocols: ['bluetooth', 'dlna', 'snapcast'],
      ipAddress: '192.168.1.115',
      macAddress: '78:4F:43:89:12:AA',
      rssi: -58,
      batteryLevel: 78,
      isPaired: true,
      isConnected: true,
      stereoRole: 'right',
      volume: 0.8,
      latencyMs: 16.8,
    },
    {
      id: 'dev_3',
      name: 'iPad Pro M4 (Studio Desk)',
      type: 'tablet',
      os: 'iOS',
      protocols: ['airplay', 'bluetooth'],
      ipAddress: '192.168.1.130',
      macAddress: '90:B0:ED:11:44:88',
      rssi: -38,
      batteryLevel: 88,
      isPaired: true,
      isConnected: false,
      stereoRole: 'stereo',
      volume: 0.75,
      latencyMs: 11.5,
    },
    {
      id: 'dev_4',
      name: 'Raspberry Pi 5 HiFi DAC (Audiophile)',
      type: 'hifi_dac',
      os: 'Linux',
      protocols: ['snapcast', 'airplay', 'dlna'],
      ipAddress: '192.168.1.140',
      macAddress: 'DC:A6:32:8B:10:04',
      rssi: -31,
      isPaired: true,
      isConnected: false,
      stereoRole: 'stereo',
      volume: 0.9,
      latencyMs: 8.4,
    },
    {
      id: 'dev_5',
      name: 'LG OLED C4 Soundbar',
      type: 'tv',
      os: 'Linux',
      protocols: ['bluetooth', 'dlna', 'airplay'],
      ipAddress: '192.168.1.200',
      macAddress: 'A0:C5:89:33:21:40',
      rssi: -65,
      isPaired: false,
      isConnected: false,
      stereoRole: 'stereo',
      volume: 0.7,
      latencyMs: 24.0,
    },
  ]);

  useEffect(() => {
    // Apply initial DSP settings to audio engine
    audioEngine.applySettings(dspSettings);

    const checkPlayState = () => {
      setIsPlaying(audioEngine.isPlaying());
    };
    audioEngine.addListener(checkPlayState);
    return () => audioEngine.removeListener(checkPlayState);
  }, [dspSettings]);

  const handleUpdateSettings = (newSettings: AudioEngineSettings) => {
    setDspSettings(newSettings);
    audioEngine.applySettings(newSettings);
    tauriBridge.invoke('set_latency_target_ms', { ms: newSettings.jitterBufferMs });
  };

  const handleToggleDeviceConnection = (id: string) => {
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? { ...d, isConnected: !d.isConnected } : d))
    );
  };

  const handleTogglePair = (id: string) => {
    setDevices((prev) =>
      prev.map((d) => {
        if (d.id === id) {
          const nextPaired = !d.isPaired;
          return { ...d, isPaired: nextPaired, isConnected: nextPaired };
        }
        return d;
      })
    );
  };

  const handleUpdateDeviceVolume = (id: string, vol: number) => {
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? { ...d, volume: vol } : d))
    );
  };

  const handleUpdateDeviceRole = (id: string, role: 'stereo' | 'left' | 'right' | 'mono') => {
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? { ...d, stereoRole: role } : d))
    );
  };

  const handleAddCustomDevice = (device: DiscoveredDevice) => {
    setDevices((prev) => [device, ...prev]);
  };

  return (
    <TauriWindowFrame activeMode={activeTab} isPlaying={isPlaying}>
      {/* 3-Zone Top Navigation Contract */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 mb-4 border-b border-neutral-800 gap-3">
        {/* Zone 1: Single element brand wordmark */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight text-white flex items-center gap-1.5">
            <Radio className="w-5 h-5 text-amber-500" />
            AuraCast
          </span>
          <span className="text-xs text-neutral-500 font-mono">v2.3</span>
        </div>

        {/* Zone 2: Navigation Links / Segmented Tabs */}
        <nav className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800 text-xs w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('receiver')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'receiver'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Receiver (Speaker Mode)
          </button>

          <button
            onClick={() => setActiveTab('transmitter')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'transmitter'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Cast className="w-3.5 h-3.5" />
            Transmitter (Source Mode)
          </button>

          <button
            onClick={() => setActiveTab('mesh')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'mesh'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Radar className="w-3.5 h-3.5" />
            Device Mesh ({devices.length})
          </button>

          <button
            onClick={() => setActiveTab('rust')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'rust'
                ? 'bg-amber-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Tauri Rust IPC
          </button>
        </nav>

        {/* Zone 3: Quick Action & Install Button */}
        <div className="flex items-center gap-2">
          <PWAInstallButton />

          {isPlaying ? (
            <button
              onClick={() => audioEngine.stopAllSources()}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              Mute Stream
            </button>
          ) : (
            <button
              onClick={() => audioEngine.playProceduralTrack('lofi')}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border border-neutral-700/60"
            >
              <Play className="w-3 h-3 fill-current text-amber-500" />
              Audio Test
            </button>
          )}
        </div>
      </header>

      {/* Main Tab Views */}
      <main>
        {activeTab === 'receiver' && (
          <ReceiverView
            settings={dspSettings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {activeTab === 'transmitter' && (
          <TransmitterView
            devices={devices}
            onToggleDeviceConnection={handleToggleDeviceConnection}
            onUpdateDeviceVolume={handleUpdateDeviceVolume}
            onUpdateDeviceRole={handleUpdateDeviceRole}
          />
        )}

        {activeTab === 'mesh' && (
          <DeviceMeshRadar
            devices={devices}
            onTogglePair={handleTogglePair}
            onAddCustomDevice={handleAddCustomDevice}
          />
        )}

        {activeTab === 'rust' && (
          <TauriRustInspector />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="mt-8 pt-4 border-t border-neutral-900 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 gap-2">
        <div className="flex items-center gap-2">
          <span>AuraCast Wireless Audio Architecture</span>
          <span aria-hidden="true">·</span>
          <span>Web Audio API + Tauri Rust IPC Core</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-emerald-500/90 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            CPAL Audio Ready
          </span>
          <span aria-hidden="true">·</span>
          <span>Buffer: 24-bit/48kHz</span>
        </div>
      </footer>
    </TauriWindowFrame>
  );
}
