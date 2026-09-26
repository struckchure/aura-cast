import React, { useState, useEffect, useRef } from 'react';
import { DiscoveredDevice, ProtocolType } from '../types/audio';
import { tauriBridge } from '../services/tauriBridge';
import {
  Smartphone,
  Laptop,
  Tv,
  Radio,
  Wifi,
  Bluetooth,
  RefreshCw,
  Plus,
  Signal,
  CheckCircle2,
  XCircle,
  BatteryCharging,
  Sliders,
  Sparkles
} from 'lucide-react';

interface Props {
  devices: DiscoveredDevice[];
  onTogglePair: (id: string) => void;
  onAddCustomDevice: (device: DiscoveredDevice) => void;
}

export const DeviceMeshRadar: React.FC<Props> = ({
  devices,
  onTogglePair,
  onAddCustomDevice,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'bluetooth' | 'wifi'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualIp, setManualIp] = useState('192.168.1.');
  const [manualName, setManualName] = useState('');
  const [manualProtocol, setManualProtocol] = useState<ProtocolType>('snapcast');
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const startScan = async () => {
    setIsScanning(true);
    await tauriBridge.invoke('discover_mdns_speakers', { timeout_sec: 2 });
    setTimeout(() => {
      setIsScanning(false);
    }, 1500);
  };

  // Radar Animation
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let sweepAngle = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(cx, cy) - 16;

      ctx.clearRect(0, 0, width, height);

      // Background concentric circles
      [0.25, 0.5, 0.75, 1.0].forEach((ratio, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
        ctx.strokeStyle = i === 3 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Distance markings
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.font = '9px monospace';
        ctx.fillText(`${Math.round(ratio * 30)}m`, cx + 6, cy - radius * ratio + 10);
      });

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.stroke();

      // Radar Sweep Beam
      sweepAngle += 0.025;
      const gradient = ctx.createConicGradient(sweepAngle, cx, cy);
      gradient.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
      gradient.addColorStop(0.12, 'rgba(245, 158, 11, 0.02)');
      gradient.addColorStop(0.2, 'transparent');
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Center host node
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText('THIS DEVICE', cx - 28, cy + 18);

      // Render device blips
      devices.forEach((dev, idx) => {
        const angle = (idx / devices.length) * Math.PI * 2 + 0.4;
        const distRatio = Math.max(0.25, Math.min(0.9, (100 + dev.rssi) / 70));
        const bx = cx + Math.cos(angle) * (radius * distRatio);
        const by = cy + Math.sin(angle) * (radius * distRatio);

        // Blip dot
        ctx.beginPath();
        ctx.arc(bx, by, dev.isConnected ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = dev.isConnected ? '#10b981' : dev.isPaired ? '#f59e0b' : '#64748b';
        ctx.fill();

        // Pulsing ring if connected
        if (dev.isConnected) {
          ctx.beginPath();
          ctx.arc(bx, by, 10 + Math.sin(sweepAngle * 4) * 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = dev.isConnected ? '#34d399' : '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.fillText(dev.name.split(' ')[0], bx + 8, by + 3);
      });

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [devices]);

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim() || !manualIp.trim()) return;

    const newDev: DiscoveredDevice = {
      id: `dev_${Date.now()}`,
      name: manualName.trim(),
      type: 'desktop',
      os: 'Linux',
      protocols: [manualProtocol],
      ipAddress: manualIp.trim(),
      macAddress: 'E4:5F:01:A2:33:91',
      rssi: -45,
      isPaired: true,
      isConnected: true,
      stereoRole: 'stereo',
      volume: 0.8,
      latencyMs: 14.5,
    };

    onAddCustomDevice(newDev);
    setShowAddModal(false);
    setManualName('');
  };

  const filteredDevices = devices.filter((d) => {
    if (filterType === 'bluetooth') return d.protocols.includes('bluetooth');
    if (filterType === 'wifi') return d.protocols.some((p) => p !== 'bluetooth');
    return true;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner & Scan Control */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-neutral-100 flex items-center gap-2">
            Wireless Speaker Discovery Mesh
            <span className="font-mono text-xs text-neutral-500 font-normal">
              (mDNS · Bluetooth LE · SSDP)
            </span>
          </h2>
          <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
            <span>{devices.length} receivers detected nearby</span>
            <span aria-hidden="true">·</span>
            <span>Real-time ping & RSSI signal calibration</span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add by IP / Host
          </button>

          <button
            onClick={startScan}
            disabled={isScanning}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Probing Network...' : 'Scan Nearby'}
          </button>
        </div>
      </div>

      {/* Interactive Radar & Device Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Radar View (5 cols on lg) */}
        <div className="lg:col-span-5 bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 flex flex-col items-center justify-between">
          <div className="w-full flex items-center justify-between text-xs text-neutral-400 mb-2">
            <span className="font-semibold text-neutral-200">Local Proximity Radar</span>
            <span className="font-mono text-emerald-400">360° Omnidirectional</span>
          </div>

          <div className="w-full flex items-center justify-center py-2">
            <canvas
              ref={radarCanvasRef}
              width={340}
              height={300}
              className="w-full max-w-[340px] h-auto block rounded-xl bg-neutral-950/80 border border-neutral-800/80"
            />
          </div>

          <div className="w-full flex items-center justify-between text-[11px] text-neutral-400 pt-2 border-t border-neutral-800/60">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              <span>Streaming</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              <span>Paired</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
              <span>Discovered</span>
            </div>
          </div>
        </div>

        {/* Device List (7 cols on lg) */}
        <div className="lg:col-span-7 bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3">
          {/* Filter Bar */}
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
            <span className="text-xs font-semibold text-neutral-200">Discovered Audio Receivers</span>
            
            <div className="flex items-center gap-1 bg-neutral-950 p-0.5 rounded-lg border border-neutral-800">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  filterType === 'all' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                All ({devices.length})
              </button>
              <button
                onClick={() => setFilterType('bluetooth')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  filterType === 'bluetooth' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Bluetooth
              </button>
              <button
                onClick={() => setFilterType('wifi')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  filterType === 'wifi' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Wi-Fi / AirPlay
              </button>
            </div>
          </div>

          {/* Device Cards */}
          <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1">
            {filteredDevices.map((dev) => {
              const isBT = dev.protocols.includes('bluetooth');
              return (
                <div
                  key={dev.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                    dev.isConnected
                      ? 'bg-neutral-950 border-amber-500/40'
                      : 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${dev.isConnected ? 'bg-amber-500/10 text-amber-400' : 'bg-neutral-800 text-neutral-400'}`}>
                      {dev.type === 'mobile' ? (
                        <Smartphone className="w-5 h-5" />
                      ) : dev.type === 'desktop' ? (
                        <Laptop className="w-5 h-5" />
                      ) : dev.type === 'tv' ? (
                        <Tv className="w-5 h-5" />
                      ) : (
                        <Radio className="w-5 h-5" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-neutral-100">{dev.name}</span>
                        {isBT ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400">
                            <Bluetooth className="w-3 h-3" /> BT
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
                            <Wifi className="w-3 h-3" /> Wi-Fi
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-0.5 font-mono">
                        <span>{dev.ipAddress}</span>
                        <span aria-hidden="true">·</span>
                        <span>{dev.latencyMs}ms delay</span>
                        <span aria-hidden="true">·</span>
                        <span>{dev.rssi} dBm</span>
                      </div>
                    </div>
                  </div>

                  {/* Pair / Connect Button */}
                  <button
                    onClick={() => onTogglePair(dev.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      dev.isConnected
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-rose-950 hover:text-rose-400 hover:border-rose-800'
                        : dev.isPaired
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500 hover:text-neutral-950'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'
                    }`}
                  >
                    {dev.isConnected ? 'Connected' : dev.isPaired ? 'Connect' : 'Pair'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Manual IP / Custom Speaker Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 max-w-md w-full shadow-2xl">
            <h3 className="text-sm font-bold text-neutral-100 mb-1">Add Manual Wireless Speaker</h3>
            <p className="text-xs text-neutral-400 mb-4">
              Enter the local IP address of a Raspberry Pi, DIY Snapcast receiver, or Smart TV on your local network.
            </p>

            <form onSubmit={handleManualAdd} className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">Speaker Name</label>
                <input
                  type="text"
                  placeholder="e.g. Living Room HiFi DAC"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">IP Address</label>
                <input
                  type="text"
                  placeholder="192.168.1.150"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">Protocol</label>
                <select
                  value={manualProtocol}
                  onChange={(e) => setManualProtocol(e.target.value as ProtocolType)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="snapcast">Snapcast (Multi-Room Sync)</option>
                  <option value="airplay">AirPlay 2 (RAOP Lossless)</option>
                  <option value="dlna">DLNA / UPnP Media Renderer</option>
                  <option value="lowlatency">Direct UDP (Low Latency)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-lg"
                >
                  Add Speaker
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
