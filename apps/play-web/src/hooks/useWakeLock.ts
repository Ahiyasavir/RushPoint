import { useEffect } from 'react';

// Keep the phone screen awake while a participant is actively racing — they're
// navigating with the map open and shouldn't have to keep tapping to wake it.
// Re-acquires the lock when the tab returns to the foreground (the lock is
// released automatically when the page is hidden). No-op where unsupported.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return;

    let sentinel: { release: () => Promise<void> } | null = null;
    let released = false;

    const acquire = async () => {
      try {
        sentinel = await nav.wakeLock!.request('screen');
      } catch {
        // user-agent may reject (low battery, permissions) — non-fatal.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !released) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
