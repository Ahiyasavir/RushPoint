// A Firestore listener that comes back after an error (issue 27, 2026-10-06).
//
// Firestore TEARS DOWN a listener on its first error (`unavailable`, a token refresh, a
// permission blip) and never calls it again. LiveOps subscribed to the announcements and the
// flash missions with an error handler of `() => undefined` and re-subscribed only when its
// deps changed, which they never do mid-run: one blip and the phone heard no broadcast and no
// flash mission for the rest of the race, with nothing on screen and nothing in any log. That is
// the shape of "I don't see the flash mission on my phone". ChatPanel solved it for one listener
// (fix-play-chat-listener-resubscribe); this is that same answer, once, for every listener the
// player depends on.
//
// Rules: always finite (2 s, doubling, capped at 30 s), never two live listeners at once (the old
// one is released before the next starts), a healthy snapshot resets the delay, and every failure
// is SAID in the console so the next report can be diagnosed.

export const LISTEN_RETRY_FIRST_MS = 2_000;
export const LISTEN_RETRY_MAX_MS = 30_000;

/** The delay before the next attempt, after one that waited `prevMs`. Total: junk restarts at the first step. */
export function nextListenRetryMs(prevMs: number | null | undefined): number {
  if (typeof prevMs !== 'number' || !Number.isFinite(prevMs) || prevMs < LISTEN_RETRY_FIRST_MS) return LISTEN_RETRY_FIRST_MS;
  return Math.min(prevMs * 2, LISTEN_RETRY_MAX_MS);
}

export interface ListenHandle {
  /** Call from the snapshot callback: the listener is healthy, so the next failure waits the first step again. */
  healthy: () => void;
  /** Pass as onSnapshot's error callback. */
  failed: (err: unknown) => void;
}

/**
 * Start `subscribe` now and again after every failure. `subscribe` receives the handle to wire
 * into its onSnapshot and returns that listener's unsubscribe. Returns the cleanup for an effect.
 */
export function listenWithRetry(
  label: string,
  subscribe: (h: ListenHandle) => () => void,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: (id) => window.clearTimeout(id as number),
  },
): () => void {
  let unsub: (() => void) | undefined;
  let retry: unknown;
  let delay: number | null = null;
  let stopped = false;

  const start = () => {
    if (stopped) return;
    let thisAttemptFailed = false;
    const handle: ListenHandle = {
      healthy: () => { delay = null; },
      failed: (err) => {
        // A listener reports at most once; a late second error from a torn-down one is ignored.
        if (stopped || thisAttemptFailed) return;
        thisAttemptFailed = true;
        delay = nextListenRetryMs(delay);
        const code = (err as { code?: unknown } | null)?.code;
        console.warn(`[rp:listen] ${label} stopped (${typeof code === 'string' ? code : 'error'}), retrying in ${delay / 1000}s`, err);
        try { unsub?.(); } catch { /* already gone */ }
        unsub = undefined;
        retry = timers.set(start, delay);
      },
    };
    try {
      unsub = subscribe(handle);
    } catch (err) {
      handle.failed(err);
    }
  };
  start();

  return () => {
    stopped = true;
    if (retry !== undefined) timers.clear(retry);
    try { unsub?.(); } catch { /* already gone */ }
  };
}
