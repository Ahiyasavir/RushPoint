import { lazy, type ComponentType } from 'react';

/**
 * `React.lazy` + a stale service-worker shell is a trap: the cached index.html can
 * reference a hashed chunk that no longer exists on the server after a redeploy,
 * the dynamic import rejects, and `<Suspense>` hangs on the spinner forever —
 * which looks exactly like a dead-end to a live player. `NavMap` (opened by every
 * active player), the promo/board/recap overlays and the QR scanner are all lazy
 * chunks, so every one of them needs this guard, not just StaffConsole.
 *
 * On the first failure for a given `key` we reload ONCE (guarded per tab via
 * sessionStorage) to pick up a fresh shell. The returned promise never resolves,
 * so the reload takes over instead of a spinner or a flash of error. If the import
 * fails AGAIN after the reload (a real error, not a stale chunk), we rethrow so the
 * ErrorBoundary shows something honest rather than reload-looping.
 *
 * (Extracted from App.tsx so PlayScreen/TaskRunner can share the exact helper —
 * previously only StaffConsole was protected.)
 */
export function lazyWithRetry<P extends object>(
  key: string,
  factory: () => Promise<{ default: ComponentType<P> }>,
) {
  return lazy<ComponentType<P>>(() =>
    factory().then((mod) => {
      // Import succeeded: clear any prior stale-chunk reload flag so a LATER
      // redeploy in the same session gets its own one automatic reload instead
      // of rethrowing to the ErrorBoundary (the self-heal must be per-redeploy,
      // not one-shot per session).
      try { sessionStorage.removeItem(`rushpoint.chunkReload.${key}`); } catch { /* storage blocked — no-op */ }
      return mod;
    }).catch((err) => {
      const flag = `rushpoint.chunkReload.${key}`;
      // The guard is a TIMESTAMP, not a one-shot flag. A one-shot flag conflates
      // "we just reloaded and it failed again, so this is real" with "this route
      // hit one flaky moment an hour ago", and the second reading permanently
      // pinned a healthy route to the crash screen for the rest of the session —
      // a lazy chunk fails for a blip far more often than it fails for good. A
      // reload-and-fail lands within a second or two, so anything inside the
      // cooldown is a genuine error worth rethrowing, and anything outside it
      // gets its own fresh self-heal.
      const COOLDOWN_MS = 60_000;
      let recentlyReloaded = true;
      try {
        const at = Number(sessionStorage.getItem(flag));
        recentlyReloaded = Number.isFinite(at) && at > 0 && Date.now() - at < COOLDOWN_MS;
        if (!recentlyReloaded) sessionStorage.setItem(flag, String(Date.now()));
      } catch { /* private mode — fall through and rethrow */ }
      if (!recentlyReloaded) {
        window.location.reload();
        return new Promise<{ default: ComponentType<P> }>(() => { /* never resolves; the reload takes over */ });
      }
      throw err;
    }),
  );
}
