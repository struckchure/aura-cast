import React, { useState } from 'react';
import {
  Monitor,
  Smartphone,
  Maximize2,
  Minimize2,
  Minus,
  Square,
  X,
  Volume2,
  Wifi,
  Battery,
  Radio
} from 'lucide-react';

interface Props {
  children: React.ReactNode;
  activeMode: 'receiver' | 'transmitter' | 'mesh' | 'rust';
  isPlaying: boolean;
}

export const TauriWindowFrame: React.FC<Props> = ({
  children,
  activeMode,
  isPlaying,
}) => {
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile' | 'fullscreen'>('desktop');

  return (
    <div className="min-h-screen bg-neutral-950 p-2 sm:p-4 md:p-6 flex flex-col items-center justify-center">
      {/* Top Floating Viewport Chassis Bar */}
      <div className="w-full max-w-6xl mb-3 flex items-center justify-between px-2 text-xs">
        <div className="flex items-center gap-2 text-neutral-400">
          <span className="font-semibold text-neutral-200">AuraCast</span>
          <span>·</span>
          <span>Tauri v2 Native Prototype</span>
        </div>

        {/* Viewport Chassis Mode Switcher */}
        <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
          <button
            onClick={() => setViewportMode('desktop')}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              viewportMode === 'desktop'
                ? 'bg-amber-500 text-neutral-950 font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop Frame
          </button>
          <button
            onClick={() => setViewportMode('mobile')}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              viewportMode === 'mobile'
                ? 'bg-amber-500 text-neutral-950 font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Mobile Frame
          </button>
          <button
            onClick={() => setViewportMode('fullscreen')}
            className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              viewportMode === 'fullscreen'
                ? 'bg-amber-500 text-neutral-950 font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Borderless
          </button>
        </div>
      </div>

      {/* Frame Container */}
      {viewportMode === 'mobile' ? (
        // Simulated iPhone 16 / Pixel Mobile Chassis
        <div className="relative w-full max-w-[420px] bg-neutral-900 border-[6px] border-neutral-800 rounded-[48px] shadow-2xl overflow-hidden flex flex-col my-4 ring-1 ring-neutral-700/50">
          {/* Dynamic Island / Notch */}
          <div className="pt-3 px-6 flex items-center justify-between text-neutral-400 text-xs font-mono select-none">
            <span>9:41</span>
            <div className="w-24 h-5 bg-black rounded-full flex items-center justify-center gap-2 px-2">
              <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-amber-500 animate-pulse' : 'bg-neutral-700'}`} />
              <Volume2 className="w-2.5 h-2.5 text-neutral-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <Wifi className="w-3 h-3 text-neutral-400" />
              <Battery className="w-3.5 h-3.5 text-neutral-400" />
            </div>
          </div>

          {/* Mobile Inner Viewport */}
          <div className="p-3 sm:p-4 overflow-y-auto max-h-[780px]">
            {children}
          </div>

          {/* iOS Home Indicator Bar */}
          <div className="py-2 flex items-center justify-center">
            <div className="w-32 h-1 bg-neutral-600 rounded-full" />
          </div>
        </div>
      ) : (
        // Desktop Window Frame
        <div
          className={`w-full max-w-6xl bg-neutral-925/90 rounded-2xl border border-neutral-800/90 shadow-2xl overflow-hidden flex flex-col ${
            viewportMode === 'fullscreen' ? 'border-none rounded-none max-w-none' : ''
          }`}
        >
          {/* Native Desktop Window Title Bar */}
          <div className="h-10 bg-neutral-900/95 border-b border-neutral-800/80 px-4 flex items-center justify-between select-none">
            {/* macOS Style Traffic Light buttons */}
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 hover:bg-rose-500 cursor-pointer transition-colors inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-500 cursor-pointer transition-colors inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 cursor-pointer transition-colors inline-block" />
            </div>

            {/* Window Title & Live Audio status */}
            <div className="flex items-center gap-2 text-xs text-neutral-300 font-medium">
              <Radio className={`w-3.5 h-3.5 ${isPlaying ? 'text-amber-500 animate-pulse' : 'text-neutral-500'}`} />
              <span>AuraCast — High Fidelity Wireless Audio Mesh</span>
              {isPlaying && (
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded font-mono">
                  LIVE STREAMING
                </span>
              )}
            </div>

            {/* Windows Style Min / Max / Close indicators */}
            <div className="flex items-center gap-3 text-neutral-500 text-xs">
              <span className="text-[11px] font-mono text-neutral-500">tauri://localhost</span>
            </div>
          </div>

          {/* Window Body */}
          <div className="p-4 sm:p-6 overflow-y-auto">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};
