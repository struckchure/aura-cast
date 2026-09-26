// Bridge to MainActivity.kt (only present in the Android app). Android permission
// prompts and the system-audio consent screen live in Kotlin, not Rust.

type Kind = 'mic' | 'system';

interface NativeBridge {
  requestMicrophone(): void;
  startSystemAudio(): void;
  stopSystemAudio(): void;
}

declare global {
  interface Window {
    AuraCastAndroid?: NativeBridge;
    __auracastAndroid?: {resolve(kind: Kind, ok: boolean): void};
  }
}

const pending: Partial<Record<Kind, (ok: boolean) => void>> = {};

function ask(kind: Kind, call: (bridge: NativeBridge) => void): Promise<boolean> {
  const bridge = window.AuraCastAndroid;
  if (!bridge) return Promise.resolve(true);
  window.__auracastAndroid ??= {
    resolve(k, ok) {
      pending[k]?.(ok);
      delete pending[k];
    },
  };
  return new Promise((resolve) => {
    // A newer request supersedes one the user never answered
    pending[kind]?.(false);
    pending[kind] = resolve;
    call(bridge);
  });
}

export const android = {
  isAndroid: () => !!window.AuraCastAndroid,
  /** Asks for the microphone permission if it has not been granted yet. */
  requestMicrophone: () => ask('mic', (b) => b.requestMicrophone()),
  /** Shows Android's "start recording or casting" consent and starts capture. */
  startSystemAudio: () => ask('system', (b) => b.startSystemAudio()),
  stopSystemAudio: () => window.AuraCastAndroid?.stopSystemAudio(),
};
