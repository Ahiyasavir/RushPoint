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

/** Move one id a step up (-1) or down (+1). Total: an id not in the list, or a step past either
 *  end, returns the list unchanged. The customiser uses buttons, not a drag, on purpose: a drag is
 *  fiddly on a phone and invisible to a screen reader. */
export function moveQuickAction<T extends string>(list: readonly T[], id: string, dir: -1 | 1): T[] {
  const out = [...list];
  const i = out.indexOf(id as T);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// ─── The staff app's bar (quick-dial-and-actions 2.6) ──────────────────────────
//
// Shortcuts to the staff console's OWN sections, so a marshal reaches the photo queue or the team
// list in one tap on a long scroll. Each needs the capability its section needs (a section the code
// does not allow is not rendered, so a shortcut to it would jump nowhere). Saved per device.

export type StaffQuickActionId = 'alerts' | 'review' | 'teams' | 'chat' | 'map' | 'staffChannel' | 'broadcast';

export const STAFF_QUICK_ACTIONS: Record<StaffQuickActionId, { section: string; capability: string | null }> = {
  alerts: { section: 'staff-alerts', capability: 'safety' },
  review: { section: 'staff-review', capability: 'review' },
  teams: { section: 'staff-teams', capability: null },
  chat: { section: 'staff-chat', capability: 'chat' },
  map: { section: 'staff-map', capability: 'locations' },
  staffChannel: { section: 'staff-channel', capability: 'staffChannel' },
  broadcast: { section: 'staff-broadcast', capability: 'broadcast' },
};
export const STAFF_QUICK_ACTION_IDS = Object.keys(STAFF_QUICK_ACTIONS) as StaffQuickActionId[];
export const STAFF_DEFAULT_QUICK_ACTIONS: StaffQuickActionId[] = ['alerts', 'review', 'teams', 'chat'];

/** The marshal's saved bar (per device), filtered by what their code allows RIGHT NOW. */
export function readStaffQuickActions(saved: unknown, can: (capability: string) => boolean): StaffQuickActionId[] {
  const source = Array.isArray(saved) ? saved : STAFF_DEFAULT_QUICK_ACTIONS;
  const out: StaffQuickActionId[] = [];
  for (const id of source) {
    if (typeof id !== 'string' || !(STAFF_QUICK_ACTION_IDS as string[]).includes(id) || out.includes(id as StaffQuickActionId)) continue;
    const cap = STAFF_QUICK_ACTIONS[id as StaffQuickActionId].capability;
    if (cap && !can(cap)) continue;
    out.push(id as StaffQuickActionId);
    if (out.length === MAX_QUICK_ACTIONS) break;
  }
  return out;
}

/**
 * How many things wait behind each staff quick-bar chip (overnight 2026-09-29): a marshal should see
 * "3 SOS" at the top of the screen, the way the console's "now" list shows it, not find out by
 * scrolling. An SOS is always urgent; submissions are urgent once one has waited past the review
 * alarm's threshold (the caller passes that count from `reviewWaitAlarm`). Junk counts read as zero:
 * the quiet direction, since the sections themselves still show everything.
 */
export function staffQuickBadges(input: { alerts: number; pendingReviews: number; overdueReviews: number }):
  Partial<Record<StaffQuickActionId, { count: number; urgent: boolean }>> {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const out: Partial<Record<StaffQuickActionId, { count: number; urgent: boolean }>> = {};
  const alerts = n(input?.alerts);
  const reviews = n(input?.pendingReviews);
  if (alerts > 0) out.alerts = { count: alerts, urgent: true };
  if (reviews > 0) out.review = { count: reviews, urgent: n(input?.overdueReviews) > 0 };
  return out;
}
