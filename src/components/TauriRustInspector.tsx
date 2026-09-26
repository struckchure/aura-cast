import React, { useState, useEffect } from 'react';
import { tauriBridge } from '../services/tauriBridge';
import { TauriIPCLog } from '../types/audio';
import {
  Terminal,
  Code2,
  FileCode,
  Copy,
  Check,
  Package,
  Layers,
  Sparkles,
  ExternalLink,
  Cpu,
  Laptop,
  Apple
} from 'lucide-react';

export const TauriRustInspector: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'console' | 'mainRs' | 'cargo' | 'config' | 'guide'>('console');
  const [logs, setLogs] = useState<TauriIPCLog[]>(tauriBridge.getLogs());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const rustCode = tauriBridge.getRustSourceCode();

  useEffect(() => {
    const handleLogs = (newLogs: TauriIPCLog[]) => {
      setLogs([...newLogs]);
    };
    tauriBridge.addListener(handleLogs);
    return () => tauriBridge.removeListener(handleLogs);
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top Banner */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-neutral-100">Tauri v2 Native Subsystem Inspector</h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Inspect real-time IPC message dispatching between React Webview and Rust core, or export production Tauri project code.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex flex-wrap items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
          <button
            onClick={() => setActiveTab('console')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'console' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            IPC Event Stream
          </button>
          <button
            onClick={() => setActiveTab('mainRs')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'mainRs' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            main.rs
          </button>
          <button
            onClick={() => setActiveTab('cargo')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'cargo' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Cargo.toml
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'config' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            tauri.conf.json
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'guide' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            Build CLI
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'console' && (
        <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <span className="text-neutral-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
              Tauri IPC Stream ({logs.length} messages)
            </span>
            <button
              onClick={() => copyToClipboard(JSON.stringify(logs, null, 2), 'logs')}
              className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              {copiedKey === 'logs' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              Copy JSON
            </button>
          </div>

          <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1 divide-y divide-neutral-900">
            {logs.map((log) => (
              <div key={log.id} className="pt-2 flex flex-col gap-1">
                <div className="flex items-center gap-2 text-neutral-500 text-[11px]">
                  <span>[{log.timestamp}]</span>
                  <span className="text-amber-400 font-semibold">invoke:</span>
                  <span className="text-neutral-200 font-bold">{log.command}</span>
                </div>
                {log.args && Object.keys(log.args).length > 0 && (
                  <div className="text-neutral-400 pl-4 text-[11px]">
                    Args: {JSON.stringify(log.args)}
                  </div>
                )}
                {log.response && (
                  <div className="text-emerald-400 pl-4 text-[11px]">
                    Response: {log.response}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'mainRs' && (
        <div className="relative bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs text-neutral-300 overflow-x-auto">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-3">
            <span className="text-neutral-400 font-semibold">src-tauri/src/main.rs (Native Audio Streamer)</span>
            <button
              onClick={() => copyToClipboard(rustCode.mainRs, 'mainRs')}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'mainRs' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copiedKey === 'mainRs' ? 'Copied!' : 'Copy Rust Code'}
            </button>
          </div>
          <pre className="text-[12px] leading-relaxed text-amber-200/90 whitespace-pre">
            {rustCode.mainRs}
          </pre>
        </div>
      )}

      {activeTab === 'cargo' && (
        <div className="relative bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs text-neutral-300 overflow-x-auto">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-3">
            <span className="text-neutral-400 font-semibold">src-tauri/Cargo.toml (Crate Dependencies)</span>
            <button
              onClick={() => copyToClipboard(rustCode.cargoToml, 'cargo')}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'cargo' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copiedKey === 'cargo' ? 'Copied!' : 'Copy Cargo.toml'}
            </button>
          </div>
          <pre className="text-[12px] leading-relaxed text-amber-200/90 whitespace-pre">
            {rustCode.cargoToml}
          </pre>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="relative bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs text-neutral-300 overflow-x-auto">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-3">
            <span className="text-neutral-400 font-semibold">src-tauri/tauri.conf.json (App Permissions & Window)</span>
            <button
              onClick={() => copyToClipboard(rustCode.tauriConf, 'tauriConf')}
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[11px] flex items-center gap-1"
            >
              {copiedKey === 'tauriConf' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copiedKey === 'tauriConf' ? 'Copied!' : 'Copy Config'}
            </button>
          </div>
          <pre className="text-[12px] leading-relaxed text-amber-200/90 whitespace-pre">
            {rustCode.tauriConf}
          </pre>
        </div>
      )}

      {activeTab === 'guide' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 flex flex-col gap-4 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-100">Step-by-Step Native MVP Build Guide (Windows, Mac & Android)</h3>
            <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              Tauri v2 + CPAL Native Engine
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Windows Build */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 flex flex-col gap-2">
              <span className="font-semibold text-neutral-200 text-xs flex items-center gap-1.5">
                <Laptop className="w-3.5 h-3.5 text-blue-400" />
                Windows (.exe / .msi)
              </span>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                Uses Windows WASAPI for bit-perfect low latency audio playback and loopback recording.
              </p>
              <pre className="bg-neutral-900 p-2.5 rounded font-mono text-[11px] text-amber-300 overflow-x-auto whitespace-pre">
{`# 1. Install Tauri CLI
npm install -D @tauri-apps/cli@next

# 2. Build Windows Installer (.msi)
cargo tauri build

# Output:
src-tauri/target/release/
bundle/msi/AuraCast_x64_en-US.msi`}
              </pre>
            </div>

            {/* macOS Build */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 flex flex-col gap-2">
              <span className="font-semibold text-neutral-200 text-xs flex items-center gap-1.5">
                <Apple className="w-3.5 h-3.5 text-neutral-300" />
                macOS (.dmg / .app)
              </span>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                Uses Apple CoreAudio and CoreBluetooth for high-resolution AirPlay RAOP & A2DP.
              </p>
              <pre className="bg-neutral-900 p-2.5 rounded font-mono text-[11px] text-amber-300 overflow-x-auto whitespace-pre">
{`# 1. Build Universal macOS Binary
cargo tauri build --target universal-apple-darwin

# Output:
src-tauri/target/universal-apple-darwin/
bundle/dmg/AuraCast_aarch64_x64.dmg`}
              </pre>
            </div>

            {/* Android Build */}
            <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 flex flex-col gap-2">
              <span className="font-semibold text-neutral-200 text-xs flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-emerald-400" />
                Android (.apk)
              </span>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                Direct installation via PWA or compile standalone native APK via Tauri Android NDK.
              </p>
              <pre className="bg-neutral-900 p-2.5 rounded font-mono text-[11px] text-amber-300 overflow-x-auto whitespace-pre">
{`# 1. Initialize Android target
cargo tauri android init

# 2. Build standalone APK
cargo tauri android build --apk

# Output:
gen/android/app/build/outputs/
apk/release/app-universal-release.apk`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
