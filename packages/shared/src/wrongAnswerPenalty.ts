// Wrong-answer cost (change: wrong-answer-cost) — the single pure decision point
// for "what does THIS wrong answer cost this team?".
//
// The problem it solves: before this change the `if (!correct)` branch of
// submitTaskAnswer charged nothing at all, so on a 4 choice quiz tapping every
// option was strictly optimal play and the team that actually knew the answer
// scored the same as the team that guessed.
//
// Shared by THREE consumers so the charge, the participant display and the
// creator preview can never drift:
//   1. submitTaskAnswer  — the real charge (bonusPenalty + retry cooldown).
//   2. getMyTeamState    — the display-only `answerCost` object on the active task.
//   3. creator-web       — the Builder's level selector copy.
//
// Design in one paragraph: each level grants N FREE attempts (a first wrong
// answer is usually a typo, not a guess), then the charge rises LINEARLY with
// each further wrong answer, and the CUMULATIVE points one task may ever take
// off one team is CAPPED. A retry COOLDOWN rides alongside and is the primary
// penalty: it is preset-agnostic, it cannot produce a negative score, it is
// self-balancing (guesses convert into lost race time), and unlike points it
// keeps biting after the point cap is spent. Under `time_only` — a preset where
// nobody has any points — the cooldown is the ENTIRE penalty.
//
// Keep this file free of Firebase/Node imports so it runs in any context.
import type { ScoringPreset, WrongAnswerLevel } from './types';

export interface WrongAnswerTuning {
  /** Wrong answers that cost nothing at all (typo forgiveness). */
  freeAttempts: number;
  /** Points charged for the k-th CHARGED wrong answer = pointStep × k. */
  pointStep: number;
  /** Hard ceiling on the CUMULATIVE points one task can take off one team. */
  maxPoints: number;
  /** Retry lockout for the k-th charged wrong answer = cooldownStep × k. */
  cooldownStep: number;
  /** Hard ceiling on a single retry lockout. */
  maxCooldownSeconds: number;
}

// The whole model, in one table.
//
//   standard: 1 free, then 10 / 20 / 30 points (cumulative 10 / 30 / 60 = cap)
//             with 15 / 30 / 45 s waits, the wait rising to a 90 s ceiling.
//   gentle:   a bar mitzvah hunt. Two free tries, small charges, short waits.
//   strict:   a competitive gibush. The first answer is the answer.
export const WRONG_ANSWER_LEVELS: Record<WrongAnswerLevel, WrongAnswerTuning> = {
  off:      { freeAttempts: Infinity, pointStep: 0,  maxPoints: 0,   cooldownStep: 0,  maxCooldownSeconds: 0 },
  gentle:   { freeAttempts: 2,        pointStep: 5,  maxPoints: 20,  cooldownStep: 10, maxCooldownSeconds: 30 },
  standard: { freeAttempts: 1,        pointStep: 10, maxPoints: 60,  cooldownStep: 15, maxCooldownSeconds: 90 },
  strict:   { freeAttempts: 0,        pointStep: 15, maxPoints: 150, cooldownStep: 30, maxCooldownSeconds: 180 },
};

export const WRONG_ANSWER_LEVEL_ORDER: WrongAnswerLevel[] = ['off', 'gentle', 'standard', 'strict'];

/**
 * The level a NEW game is seeded with. Deliberately NOT the fallback for a
 * missing value: an absent level resolves to `off` so no pre-existing game and
 * no run in flight ever changes its rules underneath the players.
 */
export const DEFAULT_WRONG_ANSWER_LEVEL: WrongAnswerLevel = 'standard';

function isLevel(v: unknown): v is WrongAnswerLevel {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(WRONG_ANSWER_LEVELS, v);
}

/**
 * Resolve the strictness for one task: the task's own override, else the game's
 * default, else `off`. A malformed value falls back to `off` — a garbage field
 * must never produce a surprise charge.
 */
export function resolveWrongAnswerLevel(
  game?: { scoringOptions?: { wrongAnswerPenalty?: WrongAnswerLevel } } | null,
  task?: { wrongAnswerPenalty?: WrongAnswerLevel } | null,
): WrongAnswerLevel {
  if (isLevel(task?.wrongAnswerPenalty)) return task!.wrongAnswerPenalty!;
  if (isLevel(game?.scoringOptions?.wrongAnswerPenalty)) return game!.scoringOptions!.wrongAnswerPenalty!;
  return 'off';
}

/**
 * Does this scoring preset have points at all? `time_only` ranks purely on
 * elapsed duration and awards every team a score of 0, so a point penalty there
 * writes to a field the ranking never reads. Under that preset the cooldown IS
 * the penalty, denominated in the only currency the preset has: time.
 */
export function presetHasPoints(preset: ScoringPreset): boolean {
  return preset !== 'time_only';
}

export interface WrongAnswerCost {
  /** Points to ADD to team.bonusPenalty (already capped). Always ≥ 0, always finite. */
  points: number;
  /** Retry lockout in seconds (already capped). Always ≥ 0, always finite. */
  cooldownSeconds: number;
  /** 1-based index among CHARGED attempts; 0 while still inside the free allowance. */
  chargedIndex: number;
}

const FREE: WrongAnswerCost = { points: 0, cooldownSeconds: 0, chargedIndex: 0 };

function finite(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * The cost of ONE wrong answer.
 *
 * @param level               resolved strictness (see resolveWrongAnswerLevel)
 * @param preset              the game's scoring preset (gates the point component)
 * @param attemptIndex        1-based index of THIS wrong attempt on this task
 *                            (i.e. the team's previous wrong count + 1)
 * @param alreadyChargedPoints points already taken off this team FOR THIS TASK
 *
 * Every input is guarded for finiteness the way taskScoreSmart is: a poisoned
 * value yields a zero cost, never a NaN that would propagate into bonusPenalty
 * and NaN the whole leaderboard.
 */
export function wrongAnswerCost(
  level: WrongAnswerLevel,
  preset: ScoringPreset,
  attemptIndex: number,
  alreadyChargedPoints: number,
): WrongAnswerCost {
  const tuning = WRONG_ANSWER_LEVELS[isLevel(level) ? level : 'off'];
  const idx = Math.floor(finite(attemptIndex, 0));
  if (idx < 1) return FREE;

  // k = this attempt's index among the CHARGED ones.
  const k = idx - tuning.freeAttempts;
  if (!Number.isFinite(k) || k < 1) return FREE;

  // Points: linear step, then clamped by what is LEFT under the cumulative cap.
  // Clamping the remaining headroom (rather than the step) means the last charge
  // lands exactly on the cap instead of overshooting it.
  const charged = Math.max(0, finite(alreadyChargedPoints, 0));
  const headroom = Math.max(0, tuning.maxPoints - charged);
  const points = presetHasPoints(preset)
    ? Math.max(0, Math.min(tuning.pointStep * k, headroom))
    : 0;

  const cooldownSeconds = Math.max(0, Math.min(tuning.cooldownStep * k, tuning.maxCooldownSeconds));

  return { points, cooldownSeconds, chargedIndex: k };
}

/**
 * Seconds left on a retry lockout, rounded UP so the UI never shows 0 while the
 * server would still refuse. Missing / non-finite / past values are 0 — the gate
 * fails OPEN, because a bug here must never lock a team out of their own game.
 */
export function cooldownRemainingSeconds(cooldownUntilMs: number | undefined | null, nowMs: number): number {
  const until = finite(cooldownUntilMs, 0);
  const now = finite(nowMs, 0);
  if (until <= now) return 0;
  return Math.ceil((until - now) / 1000);
}

/**
 * Stable hash of a submitted answer, used ONLY to recognise a duplicate
 * submission (a network retry, a double tap, an offline replay) so it is not
 * charged twice. Deliberately NOT cryptographic and deliberately NOT reversible
 * enough to be worth storing raw player text: djb2 over the normalized answer,
 * emitted as base36.
 *
 * Normalization matches the answer matcher's own leniency (trim + lower case) so
 * "  42 " and "42" are the same attempt. An ordering arrangement hashes over a
 * separator that cannot occur in a joined plain string, so ['a','b'] and 'ab'
 * can never collide into a false replay.
 */
export function hashAnswerForReplay(answer: string | string[]): string {
  const normalized = Array.isArray(answer)
    ? ` [${answer.map((s) => String(s).trim().toLowerCase()).join(' ')}]`
    : String(answer).trim().toLowerCase();
  // TWO independent 32-bit rolls concatenated (~64 bits). A single 32-bit hash
  // collides often enough across a few hundred answers to matter here, and a
  // collision has a real consequence: a DIFFERENT wrong answer would be mistaken
  // for a replay and go uncharged. Two rolls make that vanishingly unlikely.
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = (((h1 << 5) + h1) ^ c) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

export interface AnswerCostDisplay {
  level: WrongAnswerLevel;
  /** Wrong answers still forgiven on this task. */
  freeAttemptsLeft: number;
  /** What the NEXT wrong answer would cost in points (0 under time_only / off). */
  nextPoints: number;
  /** What the NEXT wrong answer would cost in seconds of lockout. */
  nextCooldownSeconds: number;
  /** Epoch ms the current lockout expires; 0 when the team may answer now. */
  cooldownUntil: number;
  /** Points already taken off this team for this task. */
  charged: number;
}

/**
 * The display-only object shipped to the participant on their active graded task
 * (and reused by the play UI after a charge). Derived entirely from the level
 * table and the team's OWN progress, so it carries no fragment of an answer key.
 *
 * The participant is told the rule BEFORE they answer: a cost nobody was warned
 * about is not a game mechanic.
 */
export function answerCostDisplay(
  level: WrongAnswerLevel,
  preset: ScoringPreset,
  attemptsUsed: number,
  charged: number,
  cooldownUntil: number,
): AnswerCostDisplay {
  const lv = isLevel(level) ? level : 'off';
  const tuning = WRONG_ANSWER_LEVELS[lv];
  const used = Math.max(0, Math.floor(finite(attemptsUsed, 0)));
  const chargedSoFar = Math.max(0, finite(charged, 0));
  const next = wrongAnswerCost(lv, preset, used + 1, chargedSoFar);
  return {
    level: lv,
    freeAttemptsLeft: Number.isFinite(tuning.freeAttempts)
      ? Math.max(0, tuning.freeAttempts - used)
      : 0,
    nextPoints: next.points,
    nextCooldownSeconds: next.cooldownSeconds,
    cooldownUntil: Math.max(0, finite(cooldownUntil, 0)),
    charged: chargedSoFar,
  };
}
