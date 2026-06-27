// TV leaderboard (change: tv-leaderboard). Constant + pure leader-change
// detection shared by the play-web `?tv=` projection screen.

/** Query-param key for the full-screen TV display: `?tv=<accessCode>`. */
export const TV_ROUTE_PARAM = 'tv';

/**
 * True when the leading team changed to a new, real leader between two refreshes.
 * Going from "no leader" (empty board) to a first leader counts; an unchanged
 * leader or a board emptying out does not. Drives the "Now in the lead!" highlight.
 */
export function detectLeaderChange(
  prevTopTeamId: string | null | undefined,
  nextTopTeamId: string | null | undefined,
): boolean {
  if (!nextTopTeamId) return false;
  return prevTopTeamId !== nextTopTeamId;
}
