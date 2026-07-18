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
