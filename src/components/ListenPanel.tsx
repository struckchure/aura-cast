import {useEffect, useState, type FormEvent} from 'react';
import {Laptop, Link2, Smartphone, Speaker, Volume2, WifiOff, X} from 'lucide-react';
import {api, errorMessage, events, type OutputDevice, type Peer, type ReceiverState, type ReceiverStats} from '../lib/api';
import {useTauriEvent} from '../lib/useTauriEvent';
import {LevelMeter} from './LevelMeter';

interface Props {
  peers: Peer[];
  discoveryError: string | null;
  initialListeningTo: string | null;
  initialVolume: number;
  initialLatencyMs: number;
  initialOutputDevice: string | null;
  onError: (message: string) => void;
}

const STATE_LABEL: Record<ReceiverState, {text: string; className: string}> = {
  connecting: {text: 'Connecting…', className: 'bg-neutral-700 text-neutral-200'},
  buffering: {text: 'Buffering…', className: 'bg-amber-500/20 text-amber-300'},
  playing: {text: 'Playing', className: 'bg-emerald-500/20 text-emerald-300'},
  'no-signal': {text: 'No signal', className: 'bg-red-500/20 text-red-300'},
};

const LATENCY_PRESETS = [
  {ms: 50, label: 'Low delay'},
  {ms: 100, label: 'Balanced'},
  {ms: 250, label: 'Stable'},
  {ms: 500, label: 'Weak Wi-Fi'},
];

function PeerIcon({os}: {os: string}) {
  const Icon = os === 'android' || os === 'ios' ? Smartphone : Laptop;
  return <Icon className="h-5 w-5 text-neutral-400" />;
}

export function ListenPanel(props: Props) {
  const {peers, discoveryError, onError} = props;
  const [listeningTo, setListeningTo] = useState<string | null>(props.initialListeningTo);
  const [stats, setStats] = useState<ReceiverStats | null>(null);
  const [volume, setVolume] = useState(props.initialVolume);
  const [latencyMs, setLatencyMs] = useState(props.initialLatencyMs);
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [outputDevice, setOutputDevice] = useState<string | null>(props.initialOutputDevice);
  const [manualAddress, setManualAddress] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listOutputDevices().then(setOutputs).catch((err) => onError(errorMessage(err)));
  }, []);

  useTauriEvent(events.onReceiverStats, (s) => {
    // Ignore a late event from a stream we already left
    if (listeningTo) setStats(s);
  });

  const connect = async (address: string) => {
    setBusy(address);
    try {
      const resolved = await api.connect(address);
      setStats(null);
      setListeningTo(resolved);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    try {
      await api.disconnect();
    } catch (err) {
      onError(errorMessage(err));
    }
    setListeningTo(null);
    setStats(null);
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    api.setVolume(v).catch((err) => onError(errorMessage(err)));
  };

  const changeLatency = (ms: number) => {
    setLatencyMs(ms);
    api.setLatency(ms).catch((err) => onError(errorMessage(err)));
  };

  const changeOutput = async (name: string) => {
    const value = name || null;
    setOutputDevice(value);
    try {
      await api.setOutputDevice(value);
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (manualAddress.trim()) connect(manualAddress.trim());
  };

  if (listeningTo) {
    const peer = peers.find((p) => p.address === listeningTo);
    const state = STATE_LABEL[stats?.state ?? 'connecting'];
    const lossPct = stats && stats.packetsReceived > 0 ? (stats.packetsLost / (stats.packetsReceived + stats.packetsLost)) * 100 : 0;

    return (
      <section className="space-y-4">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <div className="flex items-start gap-3">
            <Speaker className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{peer?.name ?? listeningTo}</p>
              {peer && <p className="font-mono text-xs text-neutral-500">{listeningTo}</p>}
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${state.className}`}>{state.text}</span>
          </div>

          <div className="mt-4">
            <LevelMeter level={stats?.level ?? 0} active={stats?.state === 'playing'} />
          </div>

          {stats?.state === 'no-signal' && (
            <p className="mt-3 text-sm text-neutral-400">
              Nothing is arriving from this device. Check that it is still broadcasting and on the same network.
            </p>
          )}

          <label className="mt-5 flex items-center gap-3">
            <Volume2 className="h-4 w-4 shrink-0 text-neutral-500" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="w-full"
              aria-label="Volume"
            />
            <span className="w-10 text-right font-mono text-sm text-neutral-400">{Math.round(volume * 100)}</span>
          </label>

          <button
            onClick={disconnect}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-800 px-4 py-3 font-semibold text-neutral-100 transition hover:bg-neutral-700"
          >
            <X className="h-4 w-4" /> Disconnect
          </button>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h3 className="text-sm font-semibold text-neutral-300">Buffering</h3>
          <p className="mt-1 text-xs text-neutral-500">More buffering means fewer dropouts on busy Wi-Fi, but more delay.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {LATENCY_PRESETS.map((p) => (
              <button
                key={p.ms}
                onClick={() => changeLatency(p.ms)}
                className={`rounded-lg border px-2 py-2 text-sm transition ${
                  latencyMs === p.ms ? 'border-amber-500/60 bg-amber-500/10 text-amber-200' : 'border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                {p.label}
                <span className="block font-mono text-xs opacity-70">{p.ms} ms</span>
              </button>
            ))}
          </div>

          {outputs.length > 1 && (
            <label className="mt-5 block">
              <span className="text-sm font-semibold text-neutral-300">Play through</span>
              <select
                value={outputDevice ?? ''}
                onChange={(e) => changeOutput(e.target.value)}
                className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              >
                <option value="">System default</option>
                {outputs.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {stats && (
            <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-neutral-800 pt-4 text-center">
              <div>
                <dt className="text-xs text-neutral-500">Buffered</dt>
                <dd className="font-mono text-sm">{Math.round(stats.bufferedMs)} ms</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Packet loss</dt>
                <dd className="font-mono text-sm">{lossPct.toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Dropouts</dt>
                <dd className="font-mono text-sm">{stats.underruns}</dd>
              </div>
            </dl>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="font-semibold">Devices broadcasting nearby</h2>
        {discoveryError ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-amber-300">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            Automatic discovery is unavailable ({discoveryError}). You can still connect by address below.
          </p>
        ) : peers.length === 0 ? (
          <div className="mt-3 text-sm text-neutral-500">
            <p>Looking for devices…</p>
            <p className="mt-2">
              On another device on this Wi-Fi, open AuraCast, go to <b className="text-neutral-300">Send</b> and start broadcasting.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {peers.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => connect(p.address)}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 px-4 py-3 text-left transition hover:border-amber-500/60 hover:bg-amber-500/5 disabled:opacity-50"
                >
                  <PeerIcon os={p.os} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block font-mono text-xs text-neutral-500">{p.address}</span>
                  </span>
                  <span className="text-sm font-semibold text-amber-400">{busy === p.address ? 'Connecting…' : 'Listen'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submitManual} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <label htmlFor="manual-address" className="flex items-center gap-2 text-sm font-semibold text-neutral-300">
          <Link2 className="h-4 w-4" /> Connect by address
        </label>
        <div className="mt-3 flex gap-2">
          <input
            id="manual-address"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="192.168.1.20:47800"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm placeholder:text-neutral-600"
          />
          <button
            type="submit"
            disabled={busy !== null || !manualAddress.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
          >
            Connect
          </button>
        </div>
      </form>
    </section>
  );
}
