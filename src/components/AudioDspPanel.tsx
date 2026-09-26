import React from 'react';
import { AudioEngineSettings } from '../types/audio';
import { Sliders, Waves, Gauge, Volume2, ShieldCheck } from 'lucide-react';

interface Props {
  settings: AudioEngineSettings;
  onChange: (settings: AudioEngineSettings) => void;
}

export const AudioDspPanel: React.FC<Props> = ({ settings, onChange }) => {
  const updateBand = (band: keyof AudioEngineSettings['eqBands'], val: number) => {
    onChange({
      ...settings,
      eqBands: {
        ...settings.eqBands,
        [band]: val,
      },
    });
  };

  const applyPreset = (preset: 'flat' | 'bass' | 'vocal' | 'acoustic' | 'club') => {
    switch (preset) {
      case 'flat':
        onChange({
          ...settings,
          eqBands: { sub: 0, low: 0, mid: 0, presence: 0, high: 0 },
          bassBoost: false,
        });
        break;
      case 'bass':
        onChange({
          ...settings,
          eqBands: { sub: 8, low: 5, mid: -1, presence: 1, high: 3 },
          bassBoost: true,
        });
        break;
      case 'vocal':
        onChange({
          ...settings,
          eqBands: { sub: -3, low: -1, mid: 5, presence: 4, high: 2 },
          bassBoost: false,
        });
        break;
      case 'acoustic':
        onChange({
          ...settings,
          eqBands: { sub: 3, low: 1, mid: -2, presence: 3, high: 6 },
          bassBoost: false,
        });
        break;
      case 'club':
        onChange({
          ...settings,
          eqBands: { sub: 7, low: 4, mid: 0, presence: 3, high: 5 },
          bassBoost: true,
        });
        break;
    }
  };

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 flex flex-col gap-4">
      {/* Header with Presets */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-neutral-200">Hardware DSP & 5-Band Equalizer</h3>
        </div>

        {/* EQ Presets segmented buttons */}
        <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
          <button
            onClick={() => applyPreset('flat')}
            className="px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-200 rounded transition-colors"
          >
            Flat
          </button>
          <button
            onClick={() => applyPreset('bass')}
            className="px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-amber-400 rounded transition-colors"
          >
            Bass+
          </button>
          <button
            onClick={() => applyPreset('vocal')}
            className="px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-200 rounded transition-colors"
          >
            Vocal
          </button>
          <button
            onClick={() => applyPreset('acoustic')}
            className="px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-200 rounded transition-colors"
          >
            Acoustic
          </button>
          <button
            onClick={() => applyPreset('club')}
            className="px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-200 rounded transition-colors"
          >
            Club
          </button>
        </div>
      </div>

      {/* 5-Band Graphic Equalizer Sliders */}
      <div className="grid grid-cols-5 gap-3 pt-2 pb-1">
        {[
          { key: 'sub', label: '60Hz', subtext: 'Sub' },
          { key: 'low', label: '250Hz', subtext: 'Bass' },
          { key: 'mid', label: '1kHz', subtext: 'Mid' },
          { key: 'presence', label: '4kHz', subtext: 'Presence' },
          { key: 'high', label: '12kHz', subtext: 'Treble' },
        ].map((item) => {
          const val = settings.eqBands[item.key as keyof AudioEngineSettings['eqBands']];
          return (
            <div key={item.key} className="flex flex-col items-center gap-2">
              <span className="font-mono text-xs text-amber-400/90 font-medium">
                {val > 0 ? `+${val}` : val}dB
              </span>
              <div className="h-28 flex items-center justify-center">
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={val}
                  onChange={(e) => updateBand(item.key as any, parseFloat(e.target.value))}
                  className="h-24 w-1.5 bg-neutral-950 rounded-lg appearance-none cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
                />
              </div>
              <span className="text-[11px] font-semibold text-neutral-200">{item.label}</span>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{item.subtext}</span>
            </div>
          );
        })}
      </div>

      {/* Acoustic Enhancements & Latency Calibration */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-neutral-800/80">
        {/* Bass Boost Switch */}
        <div className="bg-neutral-950/60 p-3 rounded-lg border border-neutral-800/60 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-neutral-200">Analog Bass Boost</span>
            <span className="text-[11px] text-neutral-500">+4dB Sub-harmonic driver</span>
          </div>
          <button
            onClick={() => onChange({ ...settings, bassBoost: !settings.bassBoost })}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${settings.bassBoost ? 'bg-amber-500 justify-end' : 'bg-neutral-800 justify-start'}`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-md" />
          </button>
        </div>

        {/* Stereo Widening Slider */}
        <div className="bg-neutral-950/60 p-3 rounded-lg border border-neutral-800/60 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-amber-400" />
              Spatial Width
            </span>
            <span className="font-mono text-neutral-400">{settings.spatialWiden}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.spatialWiden}
            onChange={(e) => onChange({ ...settings, spatialWiden: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Jitter Buffer / Latency calibration */}
        <div className="bg-neutral-950/60 p-3 rounded-lg border border-neutral-800/60 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
              Buffer Latency
            </span>
            <span className="font-mono text-neutral-400">{settings.jitterBufferMs}ms</span>
          </div>
          <input
            type="range"
            min={10}
            max={250}
            step={5}
            value={settings.jitterBufferMs}
            onChange={(e) => onChange({ ...settings, jitterBufferMs: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {/* Channel Routing Bar */}
      <div className="flex items-center justify-between bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800/80 text-xs">
        <div className="flex items-center gap-2 text-neutral-400">
          <Volume2 className="w-4 h-4 text-neutral-400" />
          <span className="font-medium text-neutral-300">Channel Mode:</span>
          <span>Assign stereo sound field</span>
        </div>

        <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-md border border-neutral-800">
          {(['stereo', 'left', 'right', 'mono'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChange({ ...settings, channelRouting: mode })}
              className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors ${
                settings.channelRouting === mode
                  ? 'bg-amber-500 text-neutral-950 font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {mode === 'stereo' ? 'Full Stereo' : mode === 'mono' ? 'Mono Sum' : `${mode} Only`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
