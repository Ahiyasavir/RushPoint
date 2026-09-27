// Points by answer, and by station code (change: answer-scored-question, D1-D3).
//
// Field report 2026-09-25: "if they write X they get a certain number of points, if they write Y
// a different number." The defining example: an operator at a station hands a team a code;
// "זעתר" earns 50, "מרווה" earns 100.
//
// SERVER-SECRET: accepted texts and points never reach a player (the participant sanitizer
// derives only button labels). Pure and total: garbage in is "unmatched", never a throw.

export interface AnswerOutcome {
  /** Stable, for the report and the answer log. */
  id: string;
  /** Button text when the question uses buttons; the name on a station code's QR card. */
  label?: string;
  /** Text matches. For a button outcome with no list, the label itself is accepted. */
  accepts?: string[];
  /** Numeric questions only, inclusive. */
  range?: { min: number; max: number };
  /** Integer >= 0. */
  points: number;
  /** Shown to the team when this outcome is hit. */
  message?: string;
}

export type OutcomeTask = {
  type?: string;
  answerOutcomes?: AnswerOutcome[] | null;
  unmatchedPoints?: number | null;
  answers?: string[];
  numericAnswer?: number | null;
  smart?: { secretCode?: string } | null;
};

export type OutcomeMatch =
  | { outcomeId: string; points: number; message?: string }
  | { unmatched: true };

export const MIN_ANSWER_OUTCOMES = 2;
export const MAX_ANSWER_OUTCOMES = 10;
export const UNMATCHED_OUTCOME_ID = 'unmatched';

/**
 * Outcome matching only (existing single-answer quizzes and single-code stations keep their exact
 * comparison, so no live game is silently re-graded): trim, lower-case, collapse internal
 * whitespace, and strip Hebrew niqqud and cantillation (U+0591-U+05C7) so "זַעְתָּר" is "זעתר".
 */
export function normalizeOutcomeText(raw: string): string {
  return raw.replace(/[֑-ׇ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function acceptsOf(o: AnswerOutcome): string[] {
  const list = Array.isArray(o.accepts) && o.accepts.length > 0 ? o.accepts : o.label ? [o.label] : [];
  return list.filter((a): a is string => typeof a === 'string').map(normalizeOutcomeText).filter(Boolean);
}

const isRange = (r: unknown): r is { min: number; max: number } =>
  !!r && typeof r === 'object' && Number.isFinite((r as { min: number }).min) && Number.isFinite((r as { max: number }).max)
  && (r as { min: number }).min <= (r as { max: number }).max;

export function matchAnswerOutcome(task: OutcomeTask | null | undefined, raw: unknown): OutcomeMatch {
  if (!task || typeof task !== 'object' || typeof raw !== 'string') return { unmatched: true };
  const outcomes = Array.isArray(task.answerOutcomes) ? task.answerOutcomes.filter((o) => o && typeof o === 'object') : [];
  if (outcomes.length === 0) return { unmatched: true };
  if (!raw.trim()) return { unmatched: true };

  const hit = (o: AnswerOutcome): OutcomeMatch => ({
    outcomeId: o.id, points: o.points, ...(typeof o.message === 'string' && o.message ? { message: o.message } : {}),
  });

  if (task.type === 'numeric') {
    const t = raw.trim();
    const n = t === '' ? NaN : Number(t);
    if (Number.isFinite(n)) {
      const o = outcomes.find((x) => isRange(x.range) && n >= x.range.min && n <= x.range.max);
      if (o) return hit(o);
    }
  } else {
    const given = normalizeOutcomeText(raw);
    const o = outcomes.find((x) => acceptsOf(x).includes(given));
    if (o) return hit(o);
  }

  const catchAll = task.unmatchedPoints;
  if (typeof catchAll === 'number' && Number.isInteger(catchAll) && catchAll >= 0) {
    return { outcomeId: UNMATCHED_OUTCOME_ID, points: catchAll };
  }
  return { unmatched: true };
}

export type OutcomesProblem = 'count' | 'points' | 'overlap' | 'empty' | 'exclusive' | 'type' | 'timeOnly';

const OUTCOME_TYPES = new Set(['smart_station', 'quiz', 'numeric']);
const validPoints = (p: unknown) => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 100000;

/** The one validator the Builder, updateGame and importGameFile all read. null = valid. */
export function answerOutcomesProblem(task: OutcomeTask | null | undefined, preset?: string): OutcomesProblem | null {
  if (!task || !Array.isArray(task.answerOutcomes) || task.answerOutcomes.length === 0) return null;
  const outcomes = task.answerOutcomes;
  if (!OUTCOME_TYPES.has(String(task.type))) return 'type';
  if (outcomes.length < MIN_ANSWER_OUTCOMES || outcomes.length > MAX_ANSWER_OUTCOMES) return 'count';
  if (task.type === 'smart_station' && typeof task.smart?.secretCode === 'string' && task.smart.secretCode.trim()) return 'exclusive';
  if (task.type === 'quiz' && Array.isArray(task.answers) && task.answers.some((a) => typeof a === 'string' && a.trim())) return 'exclusive';
  if (task.type === 'numeric' && typeof task.numericAnswer === 'number') return 'exclusive';
  if (task.unmatchedPoints != null && !validPoints(task.unmatchedPoints)) return 'points';

  const seenText = new Set<string>();
  const ranges: { min: number; max: number }[] = [];
  for (const o of outcomes) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id) return 'empty';
    if (!validPoints(o.points)) return 'points';
    if (task.type === 'numeric') {
      if (!isRange(o.range)) return 'empty';
      if (ranges.some((r) => o.range!.min <= r.max && r.min <= o.range!.max)) return 'overlap';
      ranges.push(o.range);
    } else {
      const texts = acceptsOf(o);
      if (texts.length === 0) return 'empty';
      for (const tx of texts) {
        if (seenText.has(tx)) return 'overlap';
        seenText.add(tx);
      }
    }
  }
  if (preset === 'time_only' && (outcomes.some((o) => o.points !== 0) || (task.unmatchedPoints ?? 0) !== 0)) return 'timeOnly';
  return null;
}
