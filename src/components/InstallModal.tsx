import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { exportTauriProjectZip } from '../services/zipExporter';
import { Download, Smartphone, Laptop, Apple, Check, X, ShieldAlert, FileArchive } from 'lucide-react';

interface Props {
  onOpenInstallerModal?: () => void;
}

export const InstallModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { isInstallable, install, isIOS, isAndroid } = usePWAInstall();
  const [downloadingZip, setDownloadingZip] = useState(false);

  if (!isOpen) return null;

  const handleDownloadAppBundle = async () => {
    setDownloadingZip(true);
    try {
      const zipBlob = await exportTauriProjectZip();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AuraCast-Tauri-v2-Native-Project.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export ZIP', err);
    } finally {
      setTimeout(() => setDownloadingZip(false), 800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 max-w-xl w-full shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-neutral-100">Install AuraCast Audio Speaker</h3>
            <p className="text-xs text-neutral-400">Run natively on Android, Windows, macOS, or iOS</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {/* Option A: Direct Web App / Mobile Installation */}
          <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-amber-400" />
                Mobile Device Installation (Android / iOS)
              </span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                Instant Ready
              </span>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Install AuraCast directly on your Android phone or tablet as a standalone, full-screen audio receiver application:
            </p>
            {isInstallable ? (
              <button
                onClick={install}
                className="w-full mt-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-950/40"
              >
                <Download className="w-4 h-4" />
                Install to Home Screen (Android Native PWA)
              </button>
            ) : isIOS ? (
              <div className="bg-neutral-900 p-2.5 rounded-lg text-xs text-neutral-300">
                Tap Safari's <strong>Share</strong> button, then select <strong>Add to Home Screen</strong>.
              </div>
            ) : (
              <div className="text-[11px] text-neutral-400 bg-neutral-900/60 p-2.5 rounded-lg flex items-center gap-2">
                <span>In Chrome / Edge, tap the <strong>Install</strong> or <strong>Add to Home screen</strong> prompt in the address bar.</span>
              </div>
            )}
          </div>

          {/* Option B: Desktop Builds (Windows & Mac) */}
          <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
                <Laptop className="w-4 h-4 text-blue-400" />
                Desktop Native Build (Windows .MSI / macOS .DMG)
              </span>
              <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium">
                Tauri v2 Rust Core
              </span>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Compile the production binary with the low-latency native audio host (WASAPI for Windows, CoreAudio for macOS, ALSA/BlueZ for Linux).
            </p>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={handleDownloadAppBundle}
                className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors border border-neutral-700"
              >
                <FileArchive className="w-3.5 h-3.5 text-amber-400" />
                {downloadingZip ? 'Generating Project ZIP...' : 'Export Tauri v2 Project (.ZIP)'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC<Props> = ({ onOpenInstallerModal }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  const handleClick = () => {
    if (isInstallable) {
      install();
    } else {
      setShowModal(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-md shadow-amber-950/50 transition-all cursor-pointer"
        title="Install on Android or Desktop"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>

      <InstallModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
};
