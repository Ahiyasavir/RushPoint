import { useEffect, useRef } from 'react';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n';
import { useGameStore } from '../store/gameStore';

/**
 * Surfaces connectivity changes as non-blocking toasts (web).
 * Firestore's offline cache keeps the UI working; this just tells the user
 * their progress is saved locally and will sync when the connection returns.
 * No-op where window connectivity events are unavailable (some native runtimes).
 */
export function useOfflineToast(): void {
  const { show } = useToast();
  const { t } = useTranslation();
  const setOnline = useGameStore((s) => s.setOnline);

  // Hold the latest show/t/setOnline so the listeners stay stable across re-renders.
  const ref = useRef({ show, t, setOnline });
  ref.current = { show, t, setOnline };

  useEffect(() => {
    const w = globalThis as unknown as {
      addEventListener?: (e: string, cb: () => void) => void;
      removeEventListener?: (e: string, cb: () => void) => void;
    };
    if (typeof w.addEventListener !== 'function') return;

    const onOffline = () => {
      ref.current.setOnline(false);
      ref.current.show(ref.current.t('offline.lost'), 'info');
    };
    const onOnline = () => {
      ref.current.setOnline(true);
      ref.current.show(ref.current.t('offline.restored'), 'success');
    };

    w.addEventListener('offline', onOffline);
    w.addEventListener('online', onOnline);
    return () => {
      w.removeEventListener?.('offline', onOffline);
      w.removeEventListener?.('online', onOnline);
    };
  }, []);
}
