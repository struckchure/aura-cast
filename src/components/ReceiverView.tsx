import React, { useState, useEffect } from 'react';
import { ProtocolType, AudioCodec, AudioEngineSettings, StreamMetadata } from '../types/audio';
import { audioEngine } from '../services/audioEngine';
import { tauriBridge } from '../services/tauriBridge';
import { AudioVisualizer } from './AudioVisualizer';
import { AudioDspPanel } from './AudioDspPanel';
import {
  Bluetooth,
  Wifi,
  Radio,
  Cast,
  Volume2,
  VolumeX,
  Play,
  Square,
  Sparkles,
  CheckCircle2,
  Info,
  Smartphone,
  Laptop,
  Music2,
  Share2
} from 'lucide-react';

interface Props {
  settings: AudioEngineSettings;
  onUpdateSettings: (settings: AudioEngineSettings) => void;
}

export const ReceiverView: React.FC<Props> = ({ settings, onUpdateSettings }) => {
  const [activeProtocol, setActiveProtocol] = useState<ProtocolType>('bluetooth');
  const [speakerName, setSpeakerName] = useState('AuraCast-Studio-Speaker');
  const [selectedCodec, setSelectedCodec] = useState<AudioCodec>('LDAC');
  const [isAdvertising, setIsAdvertising] = useState(true);
  const [connectedSource, setConnectedSource] = useState<{
    name: string;
    type: 'phone' | 'laptop';
    deviceModel: string;
  } | null>({
    name: 'iPhone 16 Pro Max',
    type: 'phone',
    deviceModel: 'iOS 18.2 (AAC / LDAC Host)',
  });

  const [streamMeta, setStreamMeta] = useState<StreamMetadata>({
    title: 'Midnight Echoes (24-bit Master)',
    artist: 'Aura Collective',
    album: 'High Fidelity Wireless Vol. 1',
    codec: 'LDAC',
    bitrateKbps: 990,
    sampleRate: 96000,
    bitDepth: 24,
    latencyMs: 14.8,
    bufferHealthPercent: 99.4,
  });

  const [isPlayingTestTrack, setIsPlayingTestTrack] = useState(false);

  useEffect(() => {
    // Notify Tauri Rust backend of protocol selection
    tauriBridge.invoke('start_receiver', {
      protocol: activeProtocol,
      codec: selectedCodec,
      sampleRate: settings.sampleRate,
    });
  }, [activeProtocol, selectedCodec]);

  const toggleTestSound = async (type: 'lofi' | 'synthwave' | 'ambient') => {
    if (isPlayingTestTrack && audioEngine.getCurrentTrack() === type) {
      audioEngine.stopAllSources();
      setIsPlayingTestTrack(false);
    } else {
      await audioEngine.playProceduralTrack(type);
      setIsPlayingTestTrack(true);
      setStreamMeta({
        title: type === 'lofi' ? 'Warm Vinyl Beats' : type === 'synthwave' ? 'Neon Skyline Arp' : 'Cosmic Ambient Drift',
        artist: 'Procedural Audio Generator',
        album: 'AuraCast Hi-Res Soundstage',
        codec: selectedCodec,
        bitrateKbps: 990,
        sampleRate: 96000,
        bitDepth: 24,
        latencyMs: 12.2,
        bufferHealthPercent: 100,
      });
    }
  };

  const protocols = [
    {
      id: 'bluetooth' as ProtocolType,
      name: 'Bluetooth A2DP Sink',
      icon: Bluetooth,
      description: 'Pairs as a wireless headset/speaker with phones, laptops, and smart TVs.',
      codecs: ['LDAC', 'aptX HD', 'AAC', 'SBC'] as AudioCodec[],
      badge: 'Classic Bluetooth 5.4',
    },
    {
      id: 'airplay' as ProtocolType,
      name: 'AirPlay 2 (RAOP)',
      icon: Radio,
      description: 'Stream directly from iPhone, iPad, Mac control center via Apple Lossless.',
      codecs: ['ALAC', 'AAC'] as AudioCodec[],
      badge: 'Apple AirPlay Compatible',
    },
    {
      id: 'snapcast' as ProtocolType,
      name: 'Snapcast Multi-Room',
      icon: Wifi,
      description: 'Microsecond clock synchronized multi-room client for distributed audio.',
      codecs: ['FLAC' as any, 'Opus'] as AudioCodec[],
      badge: 'Sub-1ms Sync Jitter',
    },
    {
      id: 'dlna' as ProtocolType,
      name: 'DLNA / UPnP Renderer',
      icon: Cast,
      description: 'Cast media from Windows Media Player, Android BubbleUPnP, and VLC.',
      codecs: ['FLAC' as any, 'AAC', 'SBC'] as AudioCodec[],
      badge: 'Universal DLNA v1.5',
    },
    {
      id: 'lowlatency' as ProtocolType,
      name: 'Direct Low-Latency UDP',
      icon: Sparkles,
      description: 'Ultra low latency (<18ms) Opus stream tailored for PC gaming & video sync.',
      codecs: ['Opus'] as AudioCodec[],
      badge: 'P2P Gaming Audio',
    },
  ];

  const currentProtocolConfig = protocols.find((p) => p.id === activeProtocol) || protocols[0];

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner: Receiver Status & Advertising Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-neutral-100">{speakerName}</h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active Speaker Sink
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
              <span>Broadcasting: <strong className="text-neutral-300">{currentProtocolConfig.name}</strong></span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-neutral-500">192.168.1.184:5000</span>
            </div>
          </div>
        </div>

        {/* Master Volume Dial & Mute Toggle */}
        <div className="flex items-center gap-3 w-full md:w-auto bg-neutral-950 p-2.5 rounded-lg border border-neutral-800/80">
          <button
            onClick={() => onUpdateSettings({ ...settings, isMuted: !settings.isMuted })}
            className={`p-2 rounded-lg transition-colors ${
              settings.isMuted
                ? 'bg-rose-950/80 text-rose-400 border border-rose-800'
                : 'bg-neutral-800 text-neutral-300 hover:text-white'
            }`}
            title={settings.isMuted ? 'Unmute' : 'Mute'}
          >
            {settings.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          
          <div className="flex flex-col gap-1 w-32 md:w-36">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-400 font-medium">Master Gain</span>
              <span className="font-mono text-neutral-200">
                {settings.isMuted ? 'Muted' : `${Math.round(settings.masterVolume * 100)}%`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.masterVolume}
              onChange={(e) => onUpdateSettings({ ...settings, masterVolume: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Protocol Selection Carousel */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Receiver Audio Protocol
        </label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          {protocols.map((proto) => {
            const Icon = proto.icon;
            const isSelected = activeProtocol === proto.id;
            return (
              <button
                key={proto.id}
                onClick={() => {
                  setActiveProtocol(proto.id);
                  if (proto.codecs.length > 0 && !proto.codecs.includes(selectedCodec)) {
                    setSelectedCodec(proto.codecs[0]);
                  }
                }}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all relative ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500/50 shadow-sm'
                    : 'bg-neutral-900/80 border-neutral-800/80 hover:bg-neutral-900 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-amber-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-400'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-mono text-neutral-400">{proto.badge}</span>
                </div>
                <span className="text-xs font-semibold text-neutral-100 line-clamp-1">{proto.name}</span>
                <span className="text-[11px] text-neutral-400 line-clamp-2 mt-1 leading-relaxed">
                  {proto.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Codec & Stream Quality Bar */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-neutral-400 font-medium">Negotiated Codec:</span>
          <div className="flex items-center gap-1">
            {currentProtocolConfig.codecs.map((codec) => (
              <button
                key={codec}
                onClick={() => setSelectedCodec(codec)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors ${
                  selectedCodec === codec
                    ? 'bg-amber-500 text-neutral-950 font-bold'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {codec}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 text-neutral-400 font-mono text-[11px]">
          <span>Bitrate: <strong className="text-neutral-200">{streamMeta.bitrateKbps} kbps</strong></span>
          <span aria-hidden="true">·</span>
          <span>Sample: <strong className="text-neutral-200">{streamMeta.sampleRate / 1000} kHz / {streamMeta.bitDepth}-bit</strong></span>
          <span aria-hidden="true">·</span>
          <span>Jitter Latency: <strong className="text-amber-400">{streamMeta.latencyMs} ms</strong></span>
        </div>
      </div>

      {/* Connected Source & Currently Playing Track */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 w-full md:w-auto">
          <div className="w-14 h-14 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-center text-amber-400 shrink-0">
            <Music2 className="w-7 h-7" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-amber-500 font-semibold uppercase tracking-wider">
              {audioEngine.isPlaying() ? 'Receiving Audio Stream' : 'Ready & Discoverable'}
            </span>
            <h4 className="text-sm font-bold text-neutral-100">{streamMeta.title}</h4>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
              <span>{streamMeta.artist}</span>
              <span aria-hidden="true">·</span>
              <span className="text-neutral-500">{streamMeta.album}</span>
            </div>
          </div>
        </div>

        {/* Quick Audio Test & Procedural Sound generator triggers */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <span className="text-xs text-neutral-400 mr-1 hidden sm:inline">Test Sound:</span>
          <button
            onClick={() => toggleTestSound('lofi')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              audioEngine.getCurrentTrack() === 'lofi'
                ? 'bg-amber-500 text-neutral-950 font-semibold'
                : 'bg-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            {audioEngine.getCurrentTrack() === 'lofi' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            Lo-Fi Beat
          </button>
          <button
            onClick={() => toggleTestSound('synthwave')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              audioEngine.getCurrentTrack() === 'synthwave'
                ? 'bg-amber-500 text-neutral-950 font-semibold'
                : 'bg-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            {audioEngine.getCurrentTrack() === 'synthwave' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            Synthwave
          </button>
          <button
            onClick={() => toggleTestSound('ambient')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              audioEngine.getCurrentTrack() === 'ambient'
                ? 'bg-amber-500 text-neutral-950 font-semibold'
                : 'bg-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            {audioEngine.getCurrentTrack() === 'ambient' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            Ambient
          </button>
        </div>
      </div>

      {/* Real-Time Audio Visualizer */}
      <AudioVisualizer height={130} />

      {/* 5-Band Equalizer & DSP Enhancements */}
      <AudioDspPanel settings={settings} onChange={onUpdateSettings} />

      {/* Instructions on how to connect external devices */}
      <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-4 text-xs text-neutral-400">
        <div className="flex items-center gap-2 font-semibold text-neutral-200 mb-2">
          <Info className="w-4 h-4 text-amber-500" />
          <span>How to connect your phone or laptop to this speaker:</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-neutral-950/70 p-3 rounded-lg border border-neutral-800/60">
            <span className="font-semibold text-neutral-300 block mb-1">Via Bluetooth:</span>
            <span>Go to Settings &gt; Bluetooth on your phone/tablet and select <strong>"{speakerName}"</strong>. No PIN required.</span>
          </div>
          <div className="bg-neutral-950/70 p-3 rounded-lg border border-neutral-800/60">
            <span className="font-semibold text-neutral-300 block mb-1">Via AirPlay:</span>
            <span>Open Control Center on iOS or Mac, tap AirPlay audio output, and pick <strong>"{speakerName}"</strong>.</span>
          </div>
          <div className="bg-neutral-950/70 p-3 rounded-lg border border-neutral-800/60">
            <span className="font-semibold text-neutral-300 block mb-1">Via Snapcast / DLNA:</span>
            <span>In VLC or BubbleUPnP, tap Cast / Renderers and select <strong>"{speakerName}"</strong> on local Wi-Fi.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
