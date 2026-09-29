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
