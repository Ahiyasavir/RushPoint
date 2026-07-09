import { useEffect } from 'react';
import { Platform } from 'react-native';

// Minimal subset of the Screen Wake Lock API (not in the RN/Expo web typings).
interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', cb: () => void) => void;
}
interface WakeLockNavigator {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

/**
 * Keeps the device screen awake while the team is racing. The dashboard is a
 * live scoreboard teams glance at for hours — without this the phone dims and
 * locks, the geo pings stop, and they miss flash missions / SOS state.
 *
 * Uses the Screen Wake Lock API (Expo web — the demo target). The lock is
 * dropped by the browser whenever the tab is hidden, so we re-acquire it on
 * `visibilitychange` when the tab comes back. On native, `expo-keep-awake`'s
 * `useKeepAwake()` is the production equivalent (no-op here — see note below).
 *
 * @param active when false the lock is released (e.g. once the race is over).
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'web') return;

    const nav = (globalThis as unknown as { navigator?: WakeLockNavigator }).navigator;
    const doc = (globalThis as unknown as { document?: Document }).document;
    if (!nav?.wakeLock || !doc) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        sentinel = await nav.wakeLock!.request('screen');
        // The browser auto-releases on tab hide; clear our handle so the
        // visibility handler knows to re-acquire.
        sentinel.addEventListener('release', () => { sentinel = null; });
      } catch {
        // Permission denied / unsupported / not visible — non-fatal.
      }
    };

    const onVisibility = () => {
      if (doc.visibilityState === 'visible' && !sentinel && !cancelled) void acquire();
    };

    void acquire();
    doc.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      doc.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
