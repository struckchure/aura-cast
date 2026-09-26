import {useCallback, useEffect, useState} from 'react';
import {AlertTriangle, Check, Headphones, Pencil, Radio, X} from 'lucide-react';
import {api, errorMessage, events, isTauri, type DeviceInfo, type Peer} from './lib/api';
import {useTauriEvent} from './lib/useTauriEvent';
import {ListenPanel} from './components/ListenPanel';
import {SendPanel} from './components/SendPanel';

type Tab = 'listen' | 'send';

const NAME_KEY = 'auracast.deviceName';
const TAB_KEY = 'auracast.tab';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the setting just won't persist
  }
}

function DeviceName({name, onRename}: {name: string; onRename: (name: string) => Promise<void>}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="group flex min-w-0 items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200"
        title="Rename this device"
      >
        <span className="truncate">{name}</span>
        <Pencil className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" />
      </button>
    );
  }

  const save = async () => {
    await onRename(draft);
    setEditing(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        className="w-44 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        aria-label="Device name"
      />
      <button type="submit" className="rounded-md p-1 text-emerald-400 hover:bg-neutral-800" title="Save">
        <Check className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800" title="Cancel">
        <X className="h-4 w-4" />
      </button>
    </form>
  );
}

export default function App() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [tab, setTab] = useState<Tab>(() => (readStorage(TAB_KEY) === 'send' ? 'send' : 'listen'));
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const info = await api.getDeviceInfo();
        const savedName = readStorage(NAME_KEY);
        if (savedName && savedName !== info.name) {
          info.name = await api.setDeviceName(savedName);
        }
        setDevice(info);
        setPeers(await api.getPeers());
      } catch (err) {
        showError(errorMessage(err));
      }
    })();
  }, [showError]);

  useTauriEvent(events.onPeers, setPeers);
  useTauriEvent(events.onStreamError, showError);

  const rename = async (name: string) => {
    try {
      const saved = await api.setDeviceName(name);
      writeStorage(NAME_KEY, saved);
      setDevice((d) => (d ? {...d, name: saved} : d));
    } catch (err) {
      showError(errorMessage(err));
    }
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    writeStorage(TAB_KEY, next);
  };

  if (!isTauri()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <Radio className="h-10 w-10 text-amber-400" />
        <h1 className="mt-4 text-2xl font-bold">AuraCast</h1>
        <p className="mt-2 text-neutral-400">
          Streaming needs direct access to audio devices and the network, so it only works in the AuraCast desktop and Android apps, not in a
          browser.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <main className="mx-auto max-w-xl px-4 py-6">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
            <Radio className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight">AuraCast</h1>
            {device && <DeviceName name={device.name} onRename={rename} />}
          </div>
          {device?.localIp && <span className="hidden font-mono text-xs text-neutral-500 sm:block">{device.localIp}</span>}
        </header>

        <nav className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-neutral-900 p-1" role="tablist">
          {(
            [
              {id: 'listen', label: 'Listen', icon: Headphones},
              {id: 'send', label: 'Send', icon: Radio},
            ] as const
          ).map(({id, label, icon: Icon}) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => selectTab(id)}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === id ? 'bg-neutral-800 text-neutral-100 shadow' : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100" title="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="mt-4">
          {!device ? (
            <p className="py-10 text-center text-sm text-neutral-500">Starting…</p>
          ) : (
            // Both panels stay mounted so switching tabs keeps their live state
            <>
              <div hidden={tab !== 'listen'}>
                <ListenPanel
                  peers={peers}
                  discoveryError={device.discoveryError}
                  initialListeningTo={device.listeningTo}
                  initialVolume={device.volume}
                  initialLatencyMs={device.latencyMs}
                  initialOutputDevice={device.outputDevice}
                  onError={showError}
                />
              </div>
              <div hidden={tab !== 'send'}>
                <SendPanel initialSending={device.sending} os={device.os} onError={showError} />
              </div>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-neutral-600">
          Devices must be on the same Wi-Fi or local network. A device can send and listen at the same time.
        </p>
      </main>
    </div>
  );
}
