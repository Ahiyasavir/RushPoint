// "עכשיו": everything waiting for the organizer, in one list (change: run-console-simplify).
//
// Field report 2026-09-27: the console was exhausting because every kind of "someone needs you"
// lived in its own panel in its own section. Kitchen displays and dispatch tools solve this with ONE
// queue: urgent first, then oldest, each row with its age and one action. This builds that list from
// the verdicts the console already computes (alerts, the review queue, unread threads, the attention
// classifier, teams waiting to start). Pure, clock injected, total.
import { REVIEW_ALARM_MS } from '@rushpoint/shared';

export type InboxKind = 'sos' | 'outOfBounds' | 'review' | 'flashReview' | 'staffMessage' | 'teamMessage' | 'stuckTeam' | 'waitingToStart';

export interface InboxItem {
  kind: InboxKind;
  key: string;
  teamId?: string;
  teamName?: string;
  /** Mission id for a review. */
  taskId?: string;
  /** Flash mission id + title for a flash review. */
  flashId?: string;
  flashTitle?: string;
  ageMs: number;
  severity: 'urgent' | 'normal';
}

export interface InboxInput {
  nowMs: number;
  alerts?: { id: string; teamId?: string; teamName?: string; createdAt?: string; kind?: 'sos' | 'outOfBounds' }[];
  pending?: { teamId: string; displayName?: string; taskId: string; submittedAt?: string }[];
  /** Flash missions a team sent that wait for approval (claim status 'submitted'). */
  flashPending?: { flashId: string; teamId: string; teamName?: string; title?: string; submittedAt?: string }[];
  unreadChats?: { teamId: string; teamName?: string; lastAt?: string }[];
  staffUnread?: { count: number; lastAt?: string } | null;
  stuck?: { teamId: string; teamName?: string; since?: string }[];
  waiting?: { teamId: string; teamName?: string; joinedAt?: string }[];
}

function age(iso: unknown, nowMs: number): number {
  const at = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && at <= nowMs ? nowMs - at : 0;
}

export function buildInbox(input: InboxInput | null | undefined): InboxItem[] {
  if (!input || typeof input !== 'object' || !Number.isFinite(input.nowMs)) return [];
  const now = input.nowMs;
  const out: InboxItem[] = [];
  const arr = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x.filter(Boolean) : []);

  for (const a of arr(input.alerts)) {
    out.push({ kind: a.kind === 'outOfBounds' ? 'outOfBounds' : 'sos', key: `alert:${a.id}`, teamId: a.teamId, teamName: a.teamName, ageMs: age(a.createdAt, now), severity: 'urgent' });
  }
  for (const p of arr(input.pending)) {
    const ageMs = age(p.submittedAt, now);
    out.push({ kind: 'review', key: `review:${p.teamId}:${p.taskId}`, teamId: p.teamId, teamName: p.displayName, taskId: p.taskId, ageMs, severity: ageMs >= REVIEW_ALARM_MS ? 'urgent' : 'normal' });
  }
  for (const f of arr(input.flashPending)) {
    const ageMs = age(f.submittedAt, now);
    out.push({ kind: 'flashReview', key: `flash:${f.flashId}:${f.teamId}`, teamId: f.teamId, teamName: f.teamName, flashId: f.flashId, flashTitle: f.title, ageMs, severity: ageMs >= REVIEW_ALARM_MS ? 'urgent' : 'normal' });
  }
  if (input.staffUnread && input.staffUnread.count > 0) {
    out.push({ kind: 'staffMessage', key: 'staff', ageMs: age(input.staffUnread.lastAt, now), severity: 'normal' });
  }
  for (const c of arr(input.unreadChats)) {
    out.push({ kind: 'teamMessage', key: `chat:${c.teamId}`, teamId: c.teamId, teamName: c.teamName, ageMs: age(c.lastAt, now), severity: 'normal' });
  }
  for (const s of arr(input.stuck)) {
    out.push({ kind: 'stuckTeam', key: `stuck:${s.teamId}`, teamId: s.teamId, teamName: s.teamName, ageMs: age(s.since, now), severity: 'normal' });
  }
  for (const w of arr(input.waiting)) {
    out.push({ kind: 'waitingToStart', key: `waiting:${w.teamId}`, teamId: w.teamId, teamName: w.teamName, ageMs: age(w.joinedAt, now), severity: 'normal' });
  }
  // Safety first whatever its age (an SOS from 10 s ago outranks a photo waiting 40 s), then any
  // other urgent item, then the rest; oldest first within each; ties keep insertion order.
  const rank = (i: InboxItem) => (i.kind === 'sos' || i.kind === 'outOfBounds' ? 0 : i.severity === 'urgent' ? 1 : 2);
  return out.sort((x, y) => (rank(x) - rank(y)) || (y.ageMs - x.ageMs));
}

/**
 * How often the console's inbox clock ticks, or null for not at all (overnight 2026-09-29). Every
 * second while something can cross the 20 s urgency line (a mission or flash-mission submission
 * waiting), every 15 s while the list only shows ages, never for an empty list. Before this the clock
 * ticked only while a MISSION photo waited, so a waiting flash mission never turned urgent and every
 * age in the list froze.
 */
export function consoleClockMs(input: { pendingReviews: number; pendingFlash: number; inboxItems: number } | null | undefined): number | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  if (!input) return null;
  if (n(input.pendingReviews) > 0 || n(input.pendingFlash) > 0) return 1000;
  if (n(input.inboxItems) > 0) return 15_000;
  return null;
}

export type InboxRowAction = { startTeam: true } | { teamPage: true } | { panel: 'alerts' | 'flashMission' | 'staffChannel' };

/**
 * Where one row of the "now" list takes the organizer (overnight 2026-09-29). An SOS goes to the
 * alerts panel, where its location and the acknowledge button are: the team page says nothing about
 * it, which is where the row used to land. A waiting flash mission goes to the flash panel, the staff
 * channel to its panel, a team waiting to start is started, and everything else opens the team page.
 */
export function inboxRowAction(kind: InboxKind): InboxRowAction {
  switch (kind) {
    case 'sos': return { panel: 'alerts' };
    case 'flashReview': return { panel: 'flashMission' };
    case 'staffMessage': return { panel: 'staffChannel' };
    case 'waitingToStart': return { startTeam: true };
    default: return { teamPage: true };
  }
}
