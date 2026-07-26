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
  if (code === 'not-found') {
    // On the FIRST load a `not-found` is usually transient: the team doc is still
    // being created right after joinRun, or a run read raced finalize/prune. Give
    // it the same first-load retry grace every other transient code gets and only
    // declare the game gone once the budget is spent. After state has loaded at
    // least once, a `not-found` really means the run/team is gone.
    if (hasState) return 'game-gone';
    return firstLoadFails >= FIRST_LOAD_MAX_FAILS ? 'game-gone' : 'reconnect';
  }
  if (code === 'unauthenticated' && hasState) {
    // Mid-game `unauthenticated` is almost always a transient Firebase ID-token
    // refresh window, not a terminal state: the SDK is briefly between tokens and
    // the next poll succeeds once it re-mints. Once state has loaded at least once,
    // treat it like any other transient code — keep the live board and reconnect
    // instead of bouncing an actively-playing participant to the recovery card. On
    // the FIRST load (!hasState) it stays fatal via isFatalSyncError below.
    return 'reconnect';
  }
  if (isFatalSyncError(code)) return 'sync-failed';
  // Transient / non-fatal: keep reconnecting while we have state, or until the
  // first-load retry budget is spent.
  if (hasState) return 'reconnect';
  return firstLoadFails >= FIRST_LOAD_MAX_FAILS ? 'sync-failed' : 'reconnect';
}
