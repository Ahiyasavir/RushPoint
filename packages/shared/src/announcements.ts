// Targeted announcements (change: targeted-announcements). Pure helpers shared by
// the play client and the pure-logic tests — no Firestore, no DOM.
//
// SECURITY NOTE: `announcementVisibleTo` is a CLIENT COURTESY, not access control.
// Firestore rules cannot filter documents within a collection read, so any authed
// run participant can technically read another team's targeted announcement. That
// is acceptable: an announcement is operational copy, never an answer key or a
// scoring internal beyond the `delta` the audit log already records. See the type
// doc on `Announcement.teamId` and the `match /announcements` rules comment.
import type { Announcement } from './types';

/**
 * The single visibility rule both the play client and tests share.
 * A doc is visible to `myTeamId` when it is global (no `teamId`, or an empty
 * string treated as global) or addressed to this exact team.
 */
export function announcementVisibleTo(
  a: Pick<Announcement, 'teamId'>,
  myTeamId: string,
): boolean {
  return !a.teamId || a.teamId === myTeamId;
}

/**
 * Deterministic, sign-aware, bilingual copy for a `kind:'score'` notice.
 * The sign is ALWAYS rendered on the delta ("+50" / "-25"); the reason is
 * optional and appended after a middot separator when present.
 */
// D27 (race 14.10): the staff app sends a PRESET reason as its id (shared/scoreReasons, so the audit
// log stays language neutral), and this notice printed the id: players read "+20 · reasonCreativity".
// The labels match both apps' `t.staff.reason*` copy; `reasonOther` carries no text of its own.
const SCORE_REASON_LABELS: Record<string, { he: string; en: string }> = {
  reasonCreativity: { he: 'בונוס יצירתיות', en: 'Creativity bonus' },
  reasonTeamwork: { he: 'עבודת צוות', en: 'Teamwork' },
  reasonSpeed: { he: 'בונוס מהירות', en: 'Speed bonus' },
  reasonHelpfulness: { he: 'עזרה לקבוצה אחרת', en: 'Helped another team' },
  reasonLate: { he: 'קנס איחור', en: 'Late penalty' },
  reasonRuleBreak: { he: 'הפרת כללים', en: 'Rule violation' },
  reasonStaffCall: { he: 'החלטת צוות', en: 'Staff decision' },
  reasonOther: { he: '', en: '' },
};

export function formatScoreNotice(
  delta: number,
  reason: string | undefined,
  // A free-text reason is already in the marshal's tongue and is shown as typed; a preset id is
  // shown by its label in THIS language (D27).
  lang: 'en' | 'he',
): string {
  const n = Number.isFinite(delta) ? delta : 0;
  const signed = `${n >= 0 ? '+' : '-'}${Math.abs(n)}`;
  const trimmed = reason?.trim();
  if (!trimmed) return signed;
  const preset = Object.prototype.hasOwnProperty.call(SCORE_REASON_LABELS, trimmed) ? SCORE_REASON_LABELS[trimmed] : undefined;
  const shown = preset ? preset[lang] : trimmed;
  return shown ? `${signed} · ${shown}` : signed;
}

/**
 * Is a "the staff sent you to X" notice (`kind: 'forceAssign'`) still about the team's current
 * mission? (overnight 2026-09-29) Every operator route leaves one, and old ones stayed after the team
 * moved on: played at 375x667, three stacked above the mission (two naming a mission no longer
 * current) and pushed its own button out of the sheet. Shown only while X is current; any other
 * notice, a notice with no task id, or an unknown current mission keeps today's behaviour (shown).
 */
export function routeNoticeStillCurrent(
  a: { kind?: string; taskId?: string | null },
  activeTaskId: string | null | undefined,
): boolean {
  if (a?.kind !== 'forceAssign' || typeof a.taskId !== 'string' || !a.taskId) return true;
  if (typeof activeTaskId !== 'string' || !activeTaskId) return true;
  return a.taskId === activeTaskId;
}

/**
 * The id of the newest "the staff sent you to X" notice, or null (overnight 2026-09-29): two routes
 * to the same mission left two identical notices stacked above it. Only the newest is shown.
 */
export function newestRouteNoticeId(
  list: readonly ({ id?: unknown; kind?: string; createdAt?: string } | null | undefined)[] | null | undefined,
): string | null {
  let best: { id: string; at: number } | null = null;
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || a.kind !== 'forceAssign' || typeof a.id !== 'string') continue;
    const at = typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : NaN;
    const t = Number.isFinite(at) ? at : -Infinity;
    if (!best || t >= best.at) best = { id: a.id, at: t };
  }
  return best?.id ?? null;
}
