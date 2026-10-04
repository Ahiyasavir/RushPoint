// Which actions a staff team card offers (scripts/test-staff-team-actions.ts).
//
// Capabilities decide what this marshal MAY do; the team's state decides what can
// still WORK. A finished team is not held or routed: holding it does nothing and
// the server refuses to route it, so those buttons were noise on the card a
// marshal reads under pressure. Releasing a held team always stays available.
// Fails toward SHOWING on junk input: the server re-validates every action.

export interface StaffTeamLike {
  status?: unknown;
  activeTaskId?: unknown;
  held?: unknown;
}

export interface StaffTeamActions {
  score: boolean;
  hold: boolean;
  assign: boolean;
  skip: boolean;
  sendBack: boolean;
}

/**
 * Is there anything behind the card's "פעולות" button (change: staff-team-card-actions)?
 * Score steps, a custom amount and the routing actions wait there; hold and the
 * state-driven safety actions stay on the card. No button when nothing is behind it.
 */
export function hasMoreActions(acts: StaffTeamActions | null | undefined): boolean {
  return !!acts && (acts.score || acts.assign || acts.skip || acts.sendBack);
}

export function staffTeamActions(
  team: StaffTeamLike | null | undefined,
  can: { score: boolean; hold: boolean; route: boolean },
): StaffTeamActions {
  const finished = team?.status === 'finished';
  const held = team?.held === true;
  const hasActive = typeof team?.activeTaskId === 'string' && team.activeTaskId !== '';
  return {
    score: can.score,
    hold: can.hold && (!finished || held),
    assign: can.route && !finished,
    skip: can.route && !finished && hasActive,
    sendBack: can.route,
  };
}
