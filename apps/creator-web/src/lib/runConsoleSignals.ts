// "What needs you right now" (change: run-console-clarity).
//
// The console could answer "what is everyone's score?" and "what panels exist?",
// but not the question an organizer actually holds while standing in a street
// with a phone: *is anything wrong, and where do I go for it?* The urgency it
// already computes was rendered in exactly one place — inside the teams panel —
// so the navigation rail could read "6 teams" while three of them were stuck,
// and a twelve deep photo queue that was BLOCKING players sat entirely off
// screen because the creator happened to be on another section.
//
// This module is the whole verdict: a PURE, TOTAL function over counters the
// page already has. No React, no Firebase, no i18n, no clock. Copy lives in
// i18n.ts and the chrome lives in the page; this decides only what is true and
// how urgent it is.
//
// The design bias is SILENCE, exactly as in teamAttention.ts: the failure mode
// of a triage strip is not a missed signal, it is a strip that is always full,
// because an organizer who sees everything flagged stops reading the flags. So
// a quiet run returns [] and NOTHING renders, and every unknown counter (absent,
// NaN, negative, a field an older backend does not send) resolves to zero.
import { panelPriority, type PanelId, type RunStatus } from './runConsoleLayout';

export type SignalId =
  | 'sos' | 'outOfBounds' | 'photoOverdue' | 'teamsStuck' | 'heldForConsent'
  | 'photoPending' | 'unreadChat' | 'tasksPaused' | 'nobodyJoined' | 'notStarted';

export type SignalSeverity = 'critical' | 'warn' | 'info';

export type RunSignal = {
  id: SignalId;
  severity: SignalSeverity;
  /** The number that justified the signal. Zero for a state, not a count. */
  count: number;
  /**
   * The panel that ANSWERS the signal. Deliberately not a section: where a
   * panel lives is already decided by `panelPlacement`, and naming a section
   * here would be a second source of truth that could disagree with the layout.
   */
  panel: PanelId;
};

/**
 * Everything the strip needs, gathered once by the page from data it already
 * holds. Declared as numbers, but every read goes through `count()` — the page
 * derives several of these from projections an older backend may not send.
 */
export type RunSignalInput = {
  status: RunStatus;
  alertCount: number;
  outOfBoundsCount: number;
  /** Submissions whose team has been standing still past the overdue tier. */
  overduePhotoCount: number;
  pendingPhotoCount: number;
  /** Teams the attention classifier rates `stuck`. */
  stuckTeamCount: number;
  heldForConsentCount: number;
  unreadChatThreads: number;
  pausedTaskCount: number;
  teamCount: number;
  /** Joined but not launched, so their clock has not started. */
  unstartedTeamCount: number;
};

/** Declaration order, and the final tie break so the output is a total order. */
export const SIGNAL_ORDER: SignalId[] = [
  'sos', 'outOfBounds', 'photoOverdue',
  'teamsStuck', 'heldForConsent', 'photoPending', 'unreadChat',
  'tasksPaused', 'nobodyJoined', 'notStarted',
];

/** Keyed by the closed union: a new signal cannot ship unranked. */
export const SIGNAL_SEVERITY: Record<SignalId, SignalSeverity> = {
  // Someone is in trouble or a player is blocked on a human.
  sos: 'critical',
  outOfBounds: 'critical',
  photoOverdue: 'critical',
  // Worth walking over to, but nobody is blocked this second.
  teamsStuck: 'warn',
  heldForConsent: 'warn',
  photoPending: 'warn',
  unreadChat: 'warn',
  // States the organizer chose, or the ordinary shape of a run about to start.
  tasksPaused: 'info',
  nobodyJoined: 'info',
  notStarted: 'info',
};

/** Which panel answers each signal. Total over the union by construction. */
export const SIGNAL_PANEL: Record<SignalId, PanelId> = {
  sos: 'alerts',
  outOfBounds: 'teams',
  photoOverdue: 'photoReview',
  teamsStuck: 'teams',
  heldForConsent: 'teams',
  photoPending: 'photoReview',
  unreadChat: 'chat',
  tasksPaused: 'taskAvailability',
  nobodyJoined: 'joinShare',
  notStarted: 'startTeams',
};

const SEVERITY_RANK: Record<SignalSeverity, number> = { critical: 0, warn: 1, info: 2 };

/**
 * The single gate every counter passes through. Anything that is not a finite,
 * non negative number is ZERO — the quiet direction. A phantom alarm on a live
 * console costs an organizer a walk across a site; a missing one costs nothing
 * that the panel itself does not already show.
 */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function signal(id: SignalId, n: number): RunSignal {
  return { id, severity: SIGNAL_SEVERITY[id], count: n, panel: SIGNAL_PANEL[id] };
}

/**
 * The triage strip for one run state. Empty means "nothing needs you", which is
 * the common case and must render as literally nothing.
 */
export function buildRunSignals(input: RunSignalInput): RunSignal[] {
  // A finished run has no field left to worry about: whatever is still in a
  // queue is bookkeeping, and the reports are where the organizer belongs.
  if (!input || input.status === 'finished') return [];

  const alerts = count(input.alertCount);
  const outOfBounds = count(input.outOfBoundsCount);
  const overduePhotos = count(input.overduePhotoCount);
  const pendingPhotos = count(input.pendingPhotoCount);
  const stuck = count(input.stuckTeamCount);
  const held = count(input.heldForConsentCount);
  const unreadChats = count(input.unreadChatThreads);
  const pausedTasks = count(input.pausedTaskCount);
  const teams = count(input.teamCount);
  const unstarted = count(input.unstartedTeamCount);

  const out: RunSignal[] = [];
  if (alerts > 0) out.push(signal('sos', alerts));
  if (outOfBounds > 0) out.push(signal('outOfBounds', outOfBounds));
  if (overduePhotos > 0) out.push(signal('photoOverdue', overduePhotos));
  if (stuck > 0) out.push(signal('teamsStuck', stuck));
  if (held > 0) out.push(signal('heldForConsent', held));
  // One queue, one chip: an overdue queue already says everything the pending
  // count would, and louder.
  if (pendingPhotos > 0 && overduePhotos === 0) out.push(signal('photoPending', pendingPhotos));
  if (unreadChats > 0) out.push(signal('unreadChat', unreadChats));
  if (pausedTasks > 0) out.push(signal('tasksPaused', pausedTasks));
  // "Nobody joined" and "nobody started" are the same moment told twice.
  if (teams === 0) out.push(signal('nobodyJoined', 0));
  else if (unstarted > 0) out.push(signal('notStarted', unstarted));

  return out.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || panelPriority(a.panel) - panelPriority(b.panel)
    || SIGNAL_ORDER.indexOf(a.id) - SIGNAL_ORDER.indexOf(b.id));
}
