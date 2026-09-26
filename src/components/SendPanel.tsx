import {useEffect, useState} from 'react';
import {Copy, Mic, Monitor, Radio, RefreshCw, Square, Users, Waves} from 'lucide-react';
import {api, errorMessage, events, type AudioSource, type SenderStats, type SendingInfo} from '../lib/api';
import {android} from '../lib/android';
import {useTauriEvent} from '../lib/useTauriEvent';
import {LevelMeter} from './LevelMeter';

interface Props {
  initialSending: SendingInfo | null;
  os: string;
  onError: (message: string) => void;
}

const KIND_ICON = {microphone: Mic, system: Monitor, test: Waves};

export function SendPanel({initialSending, os, onError}: Props) {
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sending, setSending] = useState<SendingInfo | null>(initialSending);
  const [stats, setStats] = useState<SenderStats | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSources = async () => {
    try {
      const list = await api.listAudioSources();
      setSources(list);
      setSourceId((current) =>
        current && list.some((s) => s.id === current) ? current : (list.find((s) => s.isDefault) ?? list[0])?.id ?? null,
      );
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  useTauriEvent(events.onSenderStats, setStats);

  const selected = sources.find((s) => s.id === sourceId);

  const start = async () => {
    setBusy(true);
    try {
      // Android permissions and the system-audio consent screen are handled natively
      if (android.isAndroid() && selected?.kind === 'microphone' && !(await android.requestMicrophone())) {
        onError('AuraCast needs microphone access to broadcast your microphone. You can allow it in Settings > Apps > AuraCast.');
        return;
      }
      if (android.isAndroid() && selected?.kind === 'system' && !(await android.startSystemAudio())) {
        onError('Sharing this phone\u2019s audio was not allowed.');
        return;
      }
      setSending(await api.startSending(sourceId));
    } catch (err) {
      if (selected?.kind === 'system') android.stopSystemAudio();
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      android.stopSystemAudio();
      await api.stopSending();
      setSending(null);
      setStats(null);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shareAddress = sending?.localIp ? `${sending.localIp}:${sending.port}` : null;
  const listeners = stats?.listeners ?? [];

  if (sending) {
    return (
      <section className="space-y-4">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-amber-200">Broadcasting</p>
              <p className="truncate text-sm text-neutral-400">{sending.source}</p>
            </div>
          </div>
          <div className="mt-4">
            <LevelMeter level={stats?.level ?? 0} />
          </div>
          <button
            onClick={stop}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 px-4 py-3 font-semibold text-neutral-900 transition hover:bg-white disabled:opacity-50"
          >
            <Square className="h-4 w-4" /> Stop broadcasting
          </button>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-300">
            <Users className="h-4 w-4" /> {listeners.length === 1 ? '1 device listening' : `${listeners.length} devices listening`}
          </div>
          {listeners.length > 0 ? (
            <ul className="mt-3 space-y-1 font-mono text-sm text-neutral-400">
              {listeners.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">
              On another device on this network, open AuraCast, go to <b className="text-neutral-300">Listen</b> and pick this device.
            </p>
          )}
          {shareAddress && (
            <div className="mt-4 border-t border-neutral-800 pt-4">
              <p className="text-xs text-neutral-500">If it does not show up automatically, connect by address:</p>
              <button
                onClick={() => navigator.clipboard?.writeText(shareAddress)}
                className="mt-2 flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-200 hover:bg-neutral-700"
                title="Copy address"
              >
                {shareAddress} <Copy className="h-3.5 w-3.5 text-neutral-500" />
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const hasSystemAudio = sources.some((s) => s.kind === 'system');
  const hint =
    selected?.kind === 'system'
      ? os === 'macos'
        ? 'macOS asks for permission to record system audio the first time. Everything playing on this Mac is shared; AuraCast\u2019s own sound is left out.'
        : os === 'android'
          ? 'Android asks you to confirm before sharing starts. Some apps (and calls) do not allow their audio to be shared.'
          : null
      : !hasSystemAudio && os === 'macos'
        ? 'Sharing system audio needs macOS 14.2 or later. On older versions, install a loopback driver such as BlackHole, set it as your sound output, and pick it here.'
        : null;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">What to send</h2>
          <button onClick={loadSources} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" title="Refresh devices">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {sources.map((s) => {
            const Icon = KIND_ICON[s.kind];
            const selected = s.id === sourceId;
            return (
              <button
                key={s.id}
                onClick={() => setSourceId(s.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  selected ? 'border-amber-500/60 bg-amber-500/10' : 'border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/50'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-amber-400' : 'text-neutral-500'}`} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.isDefault && <span className="text-xs text-neutral-500">Default</span>}
              </button>
            );
          })}
          {sources.length === 0 && <p className="text-sm text-neutral-500">No audio inputs found.</p>}
        </div>
        {hint && <p className="mt-3 text-xs leading-relaxed text-neutral-500">{hint}</p>}
      </div>

      <button
        onClick={start}
        disabled={busy || !sourceId}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3.5 font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:opacity-50"
      >
        <Radio className="h-5 w-5" /> {busy ? 'Starting…' : 'Start broadcasting'}
      </button>
    </section>
  );
}
