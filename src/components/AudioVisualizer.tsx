import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../services/audioEngine';
import { Activity, BarChart3, Disc3 } from 'lucide-react';

interface Props {
  className?: string;
  height?: number;
}

export const AudioVisualizer: React.FC<Props> = ({ className = '', height = 140 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visualMode, setVisualMode] = useState<'bars' | 'wave' | 'circle'>('bars');
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let peakCaps: number[] = new Array(64).fill(0);

    const render = () => {
      const analyser = audioEngine.getAnalyser();
      const isPlaying = audioEngine.isPlaying();

      const width = canvas.width;
      const ch = canvas.height;

      ctx.clearRect(0, 0, width, ch);

      // Ambient background grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      for (let y = 20; y < ch; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      if (!analyser || !isPlaying) {
        // Idle animation: subtle gentle breathing waveform
        const t = performance.now() * 0.002;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
        ctx.lineWidth = 1.5;

        for (let x = 0; x < width; x += 4) {
          const normX = x / width;
          const envelope = Math.sin(normX * Math.PI); // tapering ends
          const y = ch / 2 + Math.sin(normX * 8 + t) * 8 * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      if (visualMode === 'bars') {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        const barCount = 48;
        const barWidth = Math.max(3, (width - (barCount * 3)) / barCount);
        let x = 4;

        for (let i = 0; i < barCount; i++) {
          const index = Math.floor((i / barCount) * (bufferLength * 0.75));
          const val = dataArray[index] || 0;
          const percent = val / 255;
          const barHeight = Math.max(3, percent * (ch - 24));

          // Peak cap calculation
          if (barHeight > peakCaps[i]) {
            peakCaps[i] = barHeight;
          } else {
            peakCaps[i] = Math.max(0, peakCaps[i] - 1.2);
          }

          // Gradient bar
          const gradient = ctx.createLinearGradient(0, ch - barHeight, 0, ch);
          gradient.addColorStop(0, '#f59e0b'); // Amber 500
          gradient.addColorStop(0.7, '#d97706'); // Amber 600
          gradient.addColorStop(1, '#78350f'); // Deep amber

          ctx.fillStyle = gradient;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, ch - barHeight - 4, barWidth, barHeight, [2, 2, 0, 0]);
          } else {
            ctx.rect(x, ch - barHeight - 4, barWidth, barHeight);
          }
          ctx.fill();

          // Peak needle dot
          if (peakCaps[i] > 6) {
            ctx.fillStyle = '#fde68a';
            ctx.fillRect(x, ch - peakCaps[i] - 7, barWidth, 2);
          }

          x += barWidth + 3;
        }
      } else if (visualMode === 'wave') {
        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f59e0b';
        ctx.shadowColor = 'rgba(245, 158, 11, 0.4)';
        ctx.shadowBlur = 8;

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * ch) / 2;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);

          x += sliceWidth;
        }

        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        // Circle radar mode
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        const centerX = width / 2;
        const centerY = ch / 2;
        const radius = Math.min(centerX, centerY) * 0.55;

        ctx.save();
        ctx.translate(centerX, centerY);

        const segments = 40;
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const val = dataArray[i * 2] || 0;
          const len = (val / 255) * (radius * 0.85);

          const x1 = Math.cos(angle) * radius;
          const y1 = Math.sin(angle) * radius;
          const x2 = Math.cos(angle) * (radius + len);
          const y2 = Math.sin(angle) * (radius + len);

          ctx.strokeStyle = val > 160 ? '#fde68a' : '#f59e0b';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Inner glowing core
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [visualMode]);

  return (
    <div className={`relative bg-neutral-900/90 rounded-xl border border-neutral-800 p-3 overflow-hidden ${className}`}>
      {/* Visualizer header & mode switcher */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="font-semibold text-neutral-200">DSP Spectrum Output</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-amber-400/90">24-bit / 48kHz</span>
        </div>

        <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800/80">
          <button
            onClick={() => setVisualMode('bars')}
            title="Frequency Bars"
            className={`p-1 rounded text-xs transition-colors ${visualMode === 'bars' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setVisualMode('wave')}
            title="Oscilloscope Waveform"
            className={`p-1 rounded text-xs transition-colors ${visualMode === 'wave' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            <Activity className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setVisualMode('circle')}
            title="Circular Radar"
            className={`p-1 rounded text-xs transition-colors ${visualMode === 'circle' ? 'bg-neutral-800 text-amber-400' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            <Disc3 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={680}
        height={height}
        className="w-full h-auto block rounded-lg bg-neutral-950/70"
      />
    </div>
  );
};
