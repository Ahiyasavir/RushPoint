// Team lifecycle: may this team advance, and does it count in the standings
// (change: team-lifecycle-controls).
//
// Field report 2026-09-27: the organizer asked to take a test team out of a live race ("it should
// not play and not be seen in the table") and nothing could do it short of deleting the team's
// document. Removal is a STATE instead: refused at every progress door, exactly like a staff hold,
// and left out of every standing, with nothing deleted and everything reversible.
//
// Pure and total: the server's gate and ranking both read these, so the two cannot disagree.

export interface LifecycleTeam {
  removed?: boolean;
  removedReason?: string;
  held?: boolean;
  heldReason?: string;
}

export type AdvanceRefusal = { code: 'TEAM_REMOVED' | 'TEAM_HELD'; reason: string };

/**
 * Why this team may not advance right now, or null when it may. Removed outranks held: a removed
 * team that also happens to be on hold must be told it was removed, because resuming the hold
 * would not let it play.
 */
export function teamAdvanceRefusal(team: LifecycleTeam | null | undefined): AdvanceRefusal | null {
  if (!team || typeof team !== 'object') return null;
  if (team.removed === true) {
    return { code: 'TEAM_REMOVED', reason: typeof team.removedReason === 'string' ? team.removedReason : '' };
  }
  if (team.held === true) {
    return { code: 'TEAM_HELD', reason: typeof team.heldReason === 'string' ? team.heldReason : '' };
  }
  return null;
}

/** The teams that count in live, published and final standings: every team but a removed one. */
export function rankableTeams<T>(teams: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(teams)) return [];
  return teams.filter((t): t is T =>
    !!t && typeof t === 'object' && (t as { removed?: unknown }).removed !== true);
}
