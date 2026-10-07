// When the phone shows the final screen, and why (overnight 2026-09-29, found by playing).
//
// 'finished': the team completed every stage. 'runEnded': the organizer ended the run while the team
// was still playing ("סיום ריצה" never touches team documents, so the phone must read `run.status`,
// which getMyTeamState already carries). null: keep playing. Unknown ⇒ keep playing (fail open: a
// wrong "the game is over" would stop a team mid-race). Pure and total.
export type FinalReason = 'finished' | 'runEnded' | null;

export function finalScreenReason(
  team: { status?: unknown } | null | undefined,
  run: { status?: unknown } | null | undefined,
): FinalReason {
  if (team?.status === 'finished') return 'finished';
  if (run?.status === 'finished') return 'runEnded';
  return null;
}

/**
 * Should the phone keep its GPS watch running? Only while location matters AND the race is not
 * over. The final screen renders INSIDE PlayScreen, so without this the watch outlived the race
 * (7.10 QA, "end the run mid-game, GPS stops"): no ping reached the server, but the phone kept
 * the GPS on, and its location indicator, for as long as the final screen stayed open.
 */
export function shouldWatchGps(locationRelevant: boolean, reason: FinalReason): boolean {
  return locationRelevant === true && reason == null;
}
