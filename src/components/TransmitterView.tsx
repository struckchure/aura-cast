import React, { useState, useEffect, useRef } from 'react';
import { DiscoveredDevice, AudioCodec } from '../types/audio';
import { audioEngine } from '../services/audioEngine';
import { tauriBridge } from '../services/tauriBridge';
import { AudioVisualizer } from './AudioVisualizer';
import {
  Cast,
  Mic,
  Music,
  Upload,
  Radio,
  Play,
  Square,
  Volume2,
  CheckCircle2,
  Wifi,
  Bluetooth,
  Gauge,
  SlidersHorizontal,
  FolderOpen
} from 'lucide-react';

interface Props {
  devices: DiscoveredDevice[];
  onToggleDeviceConnection: (id: string) => void;
  onUpdateDeviceVolume: (id: string, vol: number) => void;
  onUpdateDeviceRole: (id: string, role: 'stereo' | 'left' | 'right' | 'mono') => void;
}

export const TransmitterView: React.FC<Props> = ({
  devices,
  onToggleDeviceConnection,
  onUpdateDeviceVolume,
  onUpdateDeviceRole,
}) => {
  const [sourceType, setSourceType] = useState<'synth' | 'mic' | 'file' | 'tone'>('synth');
  const [synthPreset, setSynthPreset] = useState<'lofi' | 'synthwave' | 'ambient'>('lofi');
  const [toneFreq, setToneFreq] = useState(1000);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConnectedDevices = devices.filter((d) => d.isConnected);

  useEffect(() => {
    const handleState = () => {
      setIsBroadcasting(audioEngine.isPlaying());
    };
    audioEngine.addListener(handleState);
    return () => audioEngine.removeListener(handleState);
  }, []);

  const handleStartBroadcast = async () => {
    if (sourceType === 'synth') {
      await audioEngine.playProceduralTrack(synthPreset);
      tauriBridge.invoke('broadcast_audio_packet', { source: 'synth', preset: synthPreset });
    } else if (sourceType === 'tone') {
      await audioEngine.playTestTone(toneFreq);
      tauriBridge.invoke('broadcast_audio_packet', { source: 'tone', freq: toneFreq });
    } else if (sourceType === 'mic') {
      await audioEngine.startMicrophone();
      tauriBridge.invoke('broadcast_audio_packet', { source: 'microphone' });
    }
  };

  const handleStopBroadcast = () => {
    audioEngine.stopAllSources();
    tauriBridge.invoke('broadcast_audio_packet', { status: 'stopped' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      audioEngine.playAudioFile(file);
      tauriBridge.invoke('broadcast_audio_packet', { source: 'file', fileName: file.name });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner: Broadcast Transmitter Hub */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Cast className={`w-6 h-6 ${isBroadcasting ? 'text-amber-400 animate-pulse' : 'text-neutral-500'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-neutral-100">Audio Broadcast Transmitter</h2>
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${isBroadcasting ? 'text-emerald-400' : 'text-neutral-400'}`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isBroadcasting ? 'Live Streaming to Mesh' : 'Ready to Cast'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
              <span>Streaming to: <strong className="text-neutral-200">{activeConnectedDevices.length} Speaker(s)</strong></span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-amber-400/90">{isBroadcasting ? '990 kbps (Lossless/Opus)' : 'Idle'}</span>
            </div>
          </div>
        </div>

        {/* Start/Stop Broadcast CTA */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          {isBroadcasting ? (
            <button
              onClick={handleStopBroadcast}
              className="w-full md:w-auto px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-rose-950/40"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop Broadcast
            </button>
          ) : (
            <button
              onClick={handleStartBroadcast}
              className="w-full md:w-auto px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-950/40"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Wireless Broadcast
            </button>
          )}
        </div>
      </div>

      {/* Audio Source Picker */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Transmit Audio Source
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {/* Synthesizer Track */}
          <button
            onClick={() => setSourceType('synth')}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
              sourceType === 'synth'
                ? 'bg-amber-500/10 border-amber-500/50'
                : 'bg-neutral-900/80 border-neutral-800/80 hover:bg-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-1.5 rounded-lg ${sourceType === 'synth' ? 'bg-amber-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-400'}`}>
                <Music className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-neutral-400">Built-in DSP</span>
            </div>
            <span className="text-xs font-semibold text-neutral-100">Hi-Fi Synthesizer</span>
            <span className="text-[11px] text-neutral-400 mt-0.5">Procedural Lo-Fi & Synthwave</span>
          </button>

          {/* Microphone Live Pass-through */}
          <button
            onClick={() => setSourceType('mic')}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
              sourceType === 'mic'
                ? 'bg-amber-500/10 border-amber-500/50'
                : 'bg-neutral-900/80 border-neutral-800/80 hover:bg-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-1.5 rounded-lg ${sourceType === 'mic' ? 'bg-amber-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-400'}`}>
                <Mic className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-neutral-400">Live Input</span>
            </div>
            <span className="text-xs font-semibold text-neutral-100">Live Microphone</span>
            <span className="text-[11px] text-neutral-400 mt-0.5">Real-time wireless mic</span>
          </button>

          {/* Audio File Player */}
          <button
            onClick={() => {
              setSourceType('file');
              fileInputRef.current?.click();
            }}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
              sourceType === 'file'
                ? 'bg-amber-500/10 border-amber-500/50'
                : 'bg-neutral-900/80 border-neutral-800/80 hover:bg-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-1.5 rounded-lg ${sourceType === 'file' ? 'bg-amber-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-400'}`}>
                <Upload className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-neutral-400">Lossless File</span>
            </div>
            <span className="text-xs font-semibold text-neutral-100">Audio File Stream</span>
            <span className="text-[11px] text-neutral-400 mt-0.5">{fileName || 'Choose MP3 / WAV'}</span>
          </button>

          {/* Test Tone & Calibration */}
          <button
            onClick={() => setSourceType('tone')}
            className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
              sourceType === 'tone'
                ? 'bg-amber-500/10 border-amber-500/50'
                : 'bg-neutral-900/80 border-neutral-800/80 hover:bg-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-1.5 rounded-lg ${sourceType === 'tone' ? 'bg-amber-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-400'}`}>
                <Radio className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-neutral-400">Calibration</span>
            </div>
            <span className="text-xs font-semibold text-neutral-100">Acoustic Test Tone</span>
            <span className="text-[11px] text-neutral-400 mt-0.5">1kHz / Sub-bass calibration</span>
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Source Fine-tuning Parameters */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {sourceType === 'synth' && (
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 font-medium">Synth Track:</span>
            <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
              <button
                onClick={() => {
                  setSynthPreset('lofi');
                  if (isBroadcasting) audioEngine.playProceduralTrack('lofi');
                }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  synthPreset === 'lofi' ? 'bg-amber-500 text-neutral-950 font-semibold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Warm Lo-Fi Chords
              </button>
              <button
                onClick={() => {
                  setSynthPreset('synthwave');
                  if (isBroadcasting) audioEngine.playProceduralTrack('synthwave');
                }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  synthPreset === 'synthwave' ? 'bg-amber-500 text-neutral-950 font-semibold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Cyber Synthwave
              </button>
              <button
                onClick={() => {
                  setSynthPreset('ambient');
                  if (isBroadcasting) audioEngine.playProceduralTrack('ambient');
                }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  synthPreset === 'ambient' ? 'bg-amber-500 text-neutral-950 font-semibold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Deep Ambient Pad
              </button>
            </div>
          </div>
        )}

        {sourceType === 'tone' && (
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 font-medium">Calibration Frequency:</span>
            <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
              {[
                { f: 40, label: '40Hz Sub' },
                { f: 250, label: '250Hz Low' },
                { f: 1000, label: '1kHz Ref' },
                { f: 4000, label: '4kHz Presence' },
                { f: 10000, label: '10kHz Air' },
              ].map((item) => (
                <button
                  key={item.f}
                  onClick={() => {
                    setToneFreq(item.f);
                    if (isBroadcasting) audioEngine.playTestTone(item.f);
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    toneFreq === item.f ? 'bg-amber-500 text-neutral-950 font-semibold' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {sourceType === 'file' && (
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span className="text-neutral-300 font-medium">{fileName || 'No file selected yet.'}</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs"
            >
              Browse Audio File...
            </button>
          </div>
        )}

        {sourceType === 'mic' && (
          <div className="flex items-center gap-2 text-emerald-400">
            <Mic className="w-4 h-4 animate-pulse" />
            <span>Microphone capturing at 48kHz with hardware echo cancellation.</span>
          </div>
        )}

        <div className="flex items-center gap-3 text-neutral-400 font-mono text-[11px]">
          <span>Format: <strong className="text-neutral-200">24-bit / 48kHz</strong></span>
          <span aria-hidden="true">·</span>
          <span>Buffer: <strong className="text-emerald-400">12ms ultra-low</strong></span>
        </div>
      </div>

      {/* Real-time spectrum visualizer */}
      <AudioVisualizer height={120} />

      {/* Multi-Speaker Routing Matrix */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-neutral-200">Target Speaker Routing Matrix</h3>
          </div>
          <span className="text-xs text-neutral-400">
            {activeConnectedDevices.length} of {devices.length} receivers selected
          </span>
        </div>

        <div className="divide-y divide-neutral-800/60">
          {devices.map((device) => {
            return (
              <div key={device.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={device.isConnected}
                    onChange={() => onToggleDeviceConnection(device.id)}
                    className="w-4 h-4 rounded text-amber-500 bg-neutral-800 border-neutral-700 focus:ring-0 cursor-pointer"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-200">{device.name}</span>
                      <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                        {device.ipAddress}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-0.5">
                      <span>{device.os} ({device.type})</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-emerald-400">{device.latencyMs}ms delay</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-neutral-500">RSSI {device.rssi} dBm</span>
                    </div>
                  </div>
                </div>

                {/* Speaker individual volume & stereo role */}
                <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                  {/* Stereo Channel Role */}
                  <div className="flex items-center gap-1 bg-neutral-950 p-0.5 rounded border border-neutral-800 text-[11px]">
                    {(['stereo', 'left', 'right'] as const).map((role) => (
                      <button
                        key={role}
                        onClick={() => onUpdateDeviceRole(device.id, role)}
                        className={`px-2 py-0.5 rounded uppercase font-medium transition-colors ${
                          device.stereoRole === role
                            ? 'bg-amber-500 text-neutral-950 font-bold'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {role === 'stereo' ? 'Stereo' : role === 'left' ? 'L' : 'R'}
                      </button>
                    ))}
                  </div>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-2 w-28">
                    <Volume2 className="w-3.5 h-3.5 text-neutral-400" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={device.volume}
                      disabled={!device.isConnected}
                      onChange={(e) => onUpdateDeviceVolume(device.id, parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer disabled:opacity-30"
                    />
                    <span className="font-mono text-[11px] text-neutral-400 w-7 text-right">
                      {Math.round(device.volume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
