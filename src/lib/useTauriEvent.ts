import {useEffect, useRef} from 'react';
import type {UnlistenFn} from '@tauri-apps/api/event';

/**
 * Subscribe to a Tauri event for the lifetime of the component.
 * `subscribe` is one of the `events.*` helpers from ./api.
 */
export function useTauriEvent<T>(
  subscribe: (cb: (payload: T) => void) => Promise<UnlistenFn>,
  handler: (payload: T) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    subscribe((payload) => handlerRef.current(payload)).then((fn) => {
      // The component may unmount before `listen` resolves
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [subscribe]);
}
