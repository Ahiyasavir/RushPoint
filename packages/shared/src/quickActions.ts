// The Run Console's quick-actions bar (change: quick-dial-and-actions, D4).
//
// A closed catalogue. The console maps each id to a handler it ALREADY has, so a quick action is
// only a shortcut, never new behaviour. The saved choice is read totally: an id removed from the
// catalogue later is dropped on read, so retiring an action can never break a saved bar.

export type QuickActionId =
  | 'broadcast' | 'startTeams' | 'refreshStandings' | 'photoQueue' | 'adjustScore' | 'findTeam' | 'callContact';

export interface QuickActionDef {
  /** Opens a team picker first. */
  needsTeam: boolean;
}

export const QUICK_ACTIONS: Record<QuickActionId, QuickActionDef> = {
  broadcast: { needsTeam: false },
  startTeams: { needsTeam: false },
  refreshStandings: { needsTeam: false },
  photoQueue: { needsTeam: false },
  adjustScore: { needsTeam: true },
  findTeam: { needsTeam: true },
  callContact: { needsTeam: false },
};

export const QUICK_ACTION_IDS = Object.keys(QUICK_ACTIONS) as QuickActionId[];
export const MAX_QUICK_ACTIONS = 6;
export const DEFAULT_QUICK_ACTIONS: QuickActionId[] = ['broadcast', 'photoQueue', 'adjustScore', 'findTeam'];

/** The organizer's saved bar, or the default when nothing valid was ever saved. */
export function readQuickActions(prefs: { quickActions?: unknown } | null | undefined): QuickActionId[] {
  const saved = prefs && typeof prefs === 'object' ? prefs.quickActions : undefined;
  if (!Array.isArray(saved)) return [...DEFAULT_QUICK_ACTIONS];
  const out: QuickActionId[] = [];
  for (const id of saved) {
    if (typeof id === 'string' && (QUICK_ACTION_IDS as string[]).includes(id) && !out.includes(id as QuickActionId)) {
      out.push(id as QuickActionId);
    }
    if (out.length === MAX_QUICK_ACTIONS) break;
  }
  return out;
}
