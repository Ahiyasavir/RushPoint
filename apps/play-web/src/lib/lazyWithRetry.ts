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
    factory().catch((err) => {
      const flag = `rushpoint.chunkReload.${key}`;
      let already = true;
      try {
        already = sessionStorage.getItem(flag) === '1';
        if (!already) sessionStorage.setItem(flag, '1');
      } catch { /* private mode — fall through and rethrow */ }
      if (!already) {
        window.location.reload();
        return new Promise<{ default: ComponentType<P> }>(() => { /* never resolves; the reload takes over */ });
      }
      throw err;
    }),
  );
}
