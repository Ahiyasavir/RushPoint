// Team-list filtering + triage for the mobile staff console
// (change: staff-console-field-ops).
//
// The console listens to the whole `teams` subcollection, so a run's roster is
// already in memory and bounded by `Run.maxParticipants` — searching is a pure
// client decision, not a query. Keeping it here (rather than inline in the screen)
// is what makes it testable: it runs on EVERY keystroke against live snapshot data
// during an event, so both functions are total by construction. A malformed row
// narrows the list; it never throws and takes the console down mid-run.

/** The only fields these decisions read. Both come from the live team snapshot. */
export interface StaffTeamRow {
  id: string;
  displayName: string;
  score: number;
}

/**
 * Teams whose display name contains `query`, preserving the incoming order (the
 * console sorts by score before filtering, and re-sorting here would make rows
 * jump under a marshal's thumb while they type).
 *
 * Case-insensitive via `toLowerCase`, which is a no-op for Hebrew — Hebrew has no
 * letter case, so a Hebrew query matches on the substring alone. That is the
 * common path in this Hebrew-first product; the folding exists for the Latin team
 * names that appear alongside it.
 */
export function filterTeamsByName<T extends StaffTeamRow>(
  teams: readonly T[] | null | undefined,
  query: string,
): T[] {
  if (!Array.isArray(teams)) return [];
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [...teams];
  return teams.filter((t) => {
    const name = t?.displayName;
    if (typeof name !== 'string') return false;
    return name.toLowerCase().includes(q);
  });
}

/**
 * Whether a team is in a state a marshal should look at: parked on a staff hold,
 * or flagged outside the play area.
 *
 * Both are states someone must actively clear — a held team is waiting on staff by
 * definition, and an out-of-bounds team is blocked from being routed. Anything
 * unknown or malformed is NOT flagged: over-flagging trains marshals to ignore the
 * badge, which is worse than missing one.
 */
export function teamNeedsAttention(
  team: { held?: boolean; outOfBounds?: boolean } | null | undefined,
): boolean {
  if (!team || typeof team !== 'object') return false;
  return team.held === true || team.outOfBounds === true;
}
