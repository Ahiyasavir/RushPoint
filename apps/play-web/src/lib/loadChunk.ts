// A dynamic import inside an EVENT HANDLER (change: handler-chunk-resilience).
//
// `lazyWithRetry` protects the route-level chunks, for the reason recorded there:
// a redeploy renames every hashed chunk, and a tab holding the old service-worker
// shell still asks for the old name, so the import 404s. That hazard is not
// specific to routes. Four share handlers and the Excel export do the same thing
// from a click:
//
//     const { sharePodium } = await import('../lib/podiumCard');
//
// with no catch. The rejection propagates into `useAsyncAction.run`, which
// re-throws by design (so real errors are never swallowed), and there is no
// handler above it — so it lands as an unhandled promise rejection and the button
// does **nothing at all**. It is the same dead-button failure the share ladder
// was just fixed for, arriving down a different path, and it fires precisely when
// a deploy happens during a live run.
//
// The route helper's answer is to reload the page. That is right for a route and
// wrong here: reloading because someone tapped "share" throws away whatever else
// they were doing, and these actions are optional extras — nobody's run depends
// on the podium card rendering. So a handler chunk fails SOFTLY: `loadChunk`
// resolves null, and the caller reports its ordinary failure, which for the share
// surfaces means the visible "couldn't share, link copied" notice.
//
// Loud enough to notice, cheap enough to ignore, and never a dead tap.

/**
 * Await a dynamic import, resolving null instead of rejecting.
 *
 * Retries ONCE before giving up: a chunk fetch fails for a momentary blip far
 * more often than it fails for good (the same observation that made
 * `lazyWithRetry`'s guard a timestamp rather than a one-shot flag), and a second
 * attempt costs one round trip against a button the player has already given up
 * on otherwise.
 */
export async function loadChunk<T>(factory: () => Promise<T>): Promise<T | null> {
  try {
    return await factory();
  } catch {
    try {
      return await factory();
    } catch {
      // A stale hash will never resolve in this tab. The caller degrades.
      return null;
    }
  }
}
