// Live-stream freshness — the pure "is the Run Console board stale" verdict
// (change: run-console-live-stream-resilience).
//
// The teams poll is the console's single live picture: the teams table, every
// score, the attention verdict and the "what needs you now" chips all read it. A
// rejected poll (token refresh, network blip, cold start) must never freeze that
// board silently. The page keeps the last-known rows on a failed poll and asks
// this module whether to show a stale indicator. Kept pure (no React, no `window`,
// no throw) so the decision is unit-testable — creator-web has no component test
// runner (CLAUDE.md).

/** The teams poll cadence. Unchanged by this lane; exported so the stale
 *  tolerance derives from it in one place. */
export const TEAMS_POLL_INTERVAL_MS = 5000;

/** Show the board as stale once the last good sync is older than roughly two
 *  missed polls. */
export const TEAMS_STALE_AFTER_MS = TEAMS_POLL_INTERVAL_MS * 2;

/**
 * True when the board should be shown as stale: an explicit poll-error flag, OR
 * the last good sync is older than the tolerance.
 *
 * Total and never-throwing:
 * - `hadError === true` ⇒ stale (a real failure wins over any clock reasoning).
 * - Else stale iff both `lastSyncAt` and `now` are finite and
 *   `now - lastSyncAt > staleAfterMs`.
 * - `lastSyncAt === null` with no error ⇒ NOT stale (the initial-load spinner
 *   owns first paint; a never-synced board is not "gone stale").
 * - A non-finite `now` or `lastSyncAt` cannot yield an age, so with no error it is
 *   treated as fresh rather than throwing or rendering a garbage age.
 */
export function isTeamsStale(
  lastSyncAt: number | null,
  now: number,
  hadError: boolean,
  staleAfterMs: number = TEAMS_STALE_AFTER_MS,
): boolean {
  if (hadError) return true;
  if (lastSyncAt === null) return false;
  if (!Number.isFinite(lastSyncAt) || !Number.isFinite(now) || !Number.isFinite(staleAfterMs)) {
    return false;
  }
  return now - lastSyncAt > staleAfterMs;
}

/**
 * Whole seconds since the last good sync, floored and clamped to `>= 0`; `null`
 * when never synced. Total: any non-finite input yields `null` instead of a
 * garbage age, and it never throws.
 */
export function secondsSinceSync(lastSyncAt: number | null, now: number): number | null {
  if (lastSyncAt === null) return null;
  if (!Number.isFinite(lastSyncAt) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - lastSyncAt) / 1000));
}
