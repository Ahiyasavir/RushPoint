import { lazy, type ComponentType } from 'react';

/**
 * `React.lazy` + a hashed chunk name is a trap on EVERY rebuild, not just a
 * service-worker one: the tab is holding an entry bundle that names
 * `TrashPage-<oldhash>.js`, a deploy (or a local `creator:build`) replaces it with
 * `TrashPage-<newhash>.js`, and the old name 404s. The dynamic import rejects and
 * the creator gets the ErrorBoundary crash screen on a perfectly healthy app —
 * observed live: "Failed to fetch dynamically imported module …/TrashPage-*.js"
 * right after a rebuild, on a session that had simply been left open.
 *
 * creator-web has NINE lazy routes and had no guard at all, while play-web has
 * carried `lazyWithRetry` for exactly this since the participant side hit it. This
 * is that helper, kept deliberately identical in behaviour so the two apps fail the
 * same way; it is duplicated rather than shared because neither app imports the
 * other's lib and `packages/shared` is framework-free (no React dependency).
 *
 * On the first failure for a given `key` we reload ONCE (guarded per tab via
 * sessionStorage) to pick up a fresh index.html. The returned promise never
 * resolves, so the reload takes over instead of a spinner or a flash of error. If
 * the import fails AGAIN after the reload it is a real error, not a stale chunk, so
 * we rethrow and let the ErrorBoundary say something honest rather than
 * reload-looping the creator forever.
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
