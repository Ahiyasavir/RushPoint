// Preset reasons for a manual score adjustment (change: staff-console-field-ops).
//
// `adjustTeamScore` has always accepted a `reason` and always written it into the
// auditLogs record — the staff console just never offered a way to say one, sending
// the literal 'staff' for every award and every fine. That made the audit trail
// technically complete and practically useless: an organizer reviewing a disputed
// score after the event saw a list of deltas with no story attached.
//
// These are IDs, not display strings: the label is resolved through `t.staff.*` so
// Hebrew stays Hebrew (the i18n gate would fail on a hardcoded literal here), while
// the value that reaches the server and the audit log is a stable, language-neutral
// key — a trail written in whatever language the marshal's phone happened to be set
// to would be unreadable to an organizer reviewing it in the other language.
//
// Split by SIGN because the two lists are used at different moments and mixing them
// invites a mis-tap: nobody awards "late penalty" points, and offering it beside
// "creativity bonus" is how a +25 becomes a −25 in the log.

/** Preset reason ids for a POSITIVE adjustment (an award). */
export const BONUS_REASONS = [
  'reasonCreativity',
  'reasonTeamwork',
  'reasonSpeed',
  'reasonHelpfulness',
] as const;

/** Preset reason ids for a NEGATIVE adjustment (a deduction). */
export const PENALTY_REASONS = [
  'reasonLate',
  'reasonRuleBreak',
  'reasonStaffCall',
] as const;

/** The free-text escape hatch, offered alongside both lists. */
export const OTHER_REASON = 'reasonOther' as const;

export type ScoreReasonId =
  | (typeof BONUS_REASONS)[number]
  | (typeof PENALTY_REASONS)[number]
  | typeof OTHER_REASON;

/**
 * Which presets to offer for a given delta. A zero or non-finite delta yields the
 * bonus list rather than throwing — this drives a render, and a picker that
 * disappears mid-typing (while the amount field is momentarily empty) is worse
 * than one showing a harmless default.
 */
export function reasonsForDelta(delta: number): readonly ScoreReasonId[] {
  return Number.isFinite(delta) && delta < 0 ? PENALTY_REASONS : BONUS_REASONS;
}

/**
 * The string actually sent to `adjustTeamScore`.
 *
 * A preset resolves to its stable id; "other" resolves to the marshal's trimmed
 * free text. Returns '' when there is nothing meaningful to record — the callable
 * treats reason as optional, and a reason is a transparency aid, never a
 * precondition for awarding points (a marshal mid-event must never be blocked from
 * fixing a score because a text box is empty).
 */
export function resolveReason(
  selected: ScoreReasonId | null,
  freeText: string,
): string {
  if (selected === OTHER_REASON) return freeText.trim().slice(0, 200);
  return selected ?? '';
}

/**
 * Parse the custom-amount field into a delta.
 *
 * Returns null for anything that is not a usable, non-zero integer — empty, a bare
 * minus sign mid-typing, a decimal, NaN/Infinity, or 0 (a zero adjustment writes an
 * audit row that says nothing happened). The caller disables Confirm on null, so
 * this is the single place the "can this be submitted?" question is answered.
 */
export function parseAdjustAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n === 0) return null;
  // Bounded so a fat-fingered extra digit can't hand a team a five-figure swing.
  // The server clamps the ACCUMULATED penalty independently (nextBonusPenalty);
  // this is the per-action sanity limit a marshal actually needs.
  if (Math.abs(n) > 10_000) return null;
  return n;
}
