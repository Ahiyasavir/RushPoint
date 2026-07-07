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
export function formatScoreNotice(
  delta: number,
  reason: string | undefined,
  // `_lang` is accepted for a stable, explicit call-site contract (EN vs HE copy)
  // and future localized separators/labels; the current copy is language-neutral —
  // a signed number plus the caller-supplied reason, which is already in the
  // caller's tongue. Prefixed with `_` so noUnusedParameters stays happy.
  _lang: 'en' | 'he',
): string {
  const n = Number.isFinite(delta) ? delta : 0;
  const signed = `${n >= 0 ? '+' : '-'}${Math.abs(n)}`;
  const trimmed = reason?.trim();
  if (!trimmed) return signed;
  return `${signed} · ${trimmed}`;
}
