// Classify a team-state (getMyTeamState) poll failure
// (change: fix-play-offline-continuity). A FATAL failure replaces the play screen
// with the recoverable error screen (the run was deleted, the team pruned, auth
// lost). Everything else — a network drop, `unavailable`, `internal`,
// `deadline-exceeded` — is transient: keep the last-known state on screen and show
// a non-blocking "reconnecting" indicator until the next poll succeeds.
//
// Pure + dependency-free so it is unit-tested without React (scripts/test-sync-error.ts).
export function isFatalSyncError(code: string | undefined): boolean {
  return /not-found|permission-denied|unauthenticated/.test(code ?? '');
}

// First-load retry grace (change: fix-play-first-load-retry-grace). The FIRST
// getMyTeamState can fail on a single transient tunnel blip (a redeploying ngrok
// origin, a cold function) before there is any state to keep. Blanking to the hard
// "sync failed" screen on that first miss is wrong: the in-game path already
// degrades to "reconnecting", so give the first load the same grace and only give
// up after FIRST_LOAD_MAX_FAILS consecutive transient misses. Fatal codes still
// surface immediately.
export const FIRST_LOAD_MAX_FAILS = 4;
export type SyncVerdict = 'reconnect' | 'game-gone' | 'sync-failed';

// Decide what a poll failure should do, given the error code, whether we already
// have team state on screen, and how many times the FIRST load has failed so far.
// Pure + dependency-free (scripts/test-sync-error.ts).
export function syncErrorVerdict(
  code: string | undefined,
  hasState: boolean,
  firstLoadFails: number,
): SyncVerdict {
  if (code === 'not-found') return 'game-gone';
  if (isFatalSyncError(code)) return 'sync-failed';
  // Transient / non-fatal: keep reconnecting while we have state, or until the
  // first-load retry budget is spent.
  if (hasState) return 'reconnect';
  return firstLoadFails >= FIRST_LOAD_MAX_FAILS ? 'sync-failed' : 'reconnect';
}
