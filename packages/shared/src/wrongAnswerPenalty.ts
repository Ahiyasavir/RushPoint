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
//   1. submitTaskAnswer  — the real charge (bonusPenalty + retry lockout).
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
 * Seconds left until a deadline **on the caller's own clock**, rounded UP so the
 * UI never shows 0 while the server would still refuse. Missing / non-finite /
 * past values are 0 — it fails OPEN, because a bug here must never lock a team
 * out of their own game.
 *
 * ⚠ Both arguments MUST come from the SAME clock. Passing a server instant with a
 * client `now` is the clock-skew bug `retry-lockout-clock-skew` removed. For the
 * "is this team locked out?" decision use `evaluateRetryLockout` below; this is
 * the low-level primitive it and the client countdown are built on.
 */
export function cooldownRemainingSeconds(cooldownUntilMs: number | undefined | null, nowMs: number): number {
  const until = finite(cooldownUntilMs, 0);
  const now = finite(nowMs, 0);
  if (until <= now) return 0;
  return Math.ceil((until - now) / 1000);
}

// ── Retry lockout (change: retry-lockout-clock-skew) ─────────────────────────
//
// `cooldownRemainingSeconds` above is a primitive: "seconds until a deadline on
// THIS clock". It is correct on the server (server instant vs server clock) and
// correct on the client (local deadline vs local clock) — and catastrophic when
// the two are MIXED, which is exactly what shipping an absolute `cooldownUntil`
// to a phone used to do. A phone whose clock ran hours behind froze its own
// answer controls for hours in a game the server would happily have let it play.
//
// `evaluateRetryLockout` is the single decision point that replaces the mixing.
// It answers "is this team locked out, and for how much longer?" from the SERVER
// clock alone, and what travels to the participant is the resulting DURATION.
//
// Three properties are load-bearing:
//   TOTAL      — every stored state, including absent / negative / NaN / Infinity
//                / wrongly-typed, maps to an explicit verdict.
//   FAIL OPEN  — anything undecidable resolves to NOT locked. The cost of failing
//                open is one uncharged retry; the cost of failing closed is a
//                player locked out of a live field game with no recovery.
//   BOUNDED    — the remainder can never exceed the ceiling of the level that
//                created it, and the bound is applied on READ, so a lockout
//                already written with an out-of-range value self-heals.

/** The lockout slice of one `team.answerPenalties[taskId]` row. */
export interface RetryLockoutRecord {
  /** Legacy absolute expiry (server clock). Still written; deprecated for display. */
  cooldownUntil?: number | null;
  /** Server instant of the wrong answer that started the lockout. */
  lastFailureAt?: number | null;
  /** The lockout duration that failure earned, in ms. */
  lockoutMs?: number | null;
  /** Charged-attempt index. Carried for diagnosis; never trusted for the decision. */
  failureCount?: number | null;
  /** Present on the real ledger row; ignored here. */
  charged?: number;
  lastHash?: string;
}

/** The ceiling a lockout may not exceed — owned by the strictness level. */
export interface RetryLockoutPolicy {
  maxCooldownSeconds: number;
}

export interface RetryLockoutVerdict {
  /** True only when time genuinely remains. `remaining === 0` is UNLOCKED. */
  locked: boolean;
  /** Always finite, always ≥ 0, always ≤ the policy ceiling. This is what ships. */
  remainingMs: number;
  /** `ceil(remainingMs / 1000)` — never 0 while the server would still refuse. */
  remainingSeconds: number;
  /** The stored state implied a longer wait than the policy allows and was cut down. */
  clamped: boolean;
  /** Which stored form decided it — makes the migration path assertable. */
  source: 'duration' | 'legacy' | 'none';
}

const NO_LOCKOUT: RetryLockoutVerdict = {
  locked: false, remainingMs: 0, remainingSeconds: 0, clamped: false, source: 'none',
};

/**
 * The lockout ceiling for a strictness level. A garbage level falls back to
 * `off`, whose ceiling is 0 — so a mis-resolved level can never lock anyone.
 */
export function retryLockoutPolicyFor(level: WrongAnswerLevel): RetryLockoutPolicy {
  const tuning = WRONG_ANSWER_LEVELS[isLevel(level) ? level : 'off'];
  return { maxCooldownSeconds: tuning.maxCooldownSeconds };
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Is this team still inside a retry lockout, and for how much longer?
 *
 * @param nowMs   the SERVER clock. Never a client-supplied value.
 * @param record  the stored lockout state (either shape; see D2 of the design).
 * @param policy  the ceiling of the level that created the lockout.
 *
 * Resolution order: the duration form (`lastFailureAt` + `lockoutMs`) wins,
 * because it carries its own bound; otherwise the legacy absolute `cooldownUntil`
 * written before this change; otherwise there is no lockout.
 */
export function evaluateRetryLockout(
  nowMs: number,
  record: RetryLockoutRecord | null | undefined,
  policy: RetryLockoutPolicy,
): RetryLockoutVerdict {
  const now = finiteOrNull(nowMs);
  if (now === null || !record) return NO_LOCKOUT;

  const ceilingMs = Math.max(0, finite(policy?.maxCooldownSeconds, 0)) * 1000;
  if (ceilingMs <= 0) return NO_LOCKOUT; // level `off`: nothing can lock.

  const lastFailureAt = finiteOrNull(record.lastFailureAt);
  const lockoutMs = finiteOrNull(record.lockoutMs);
  const cooldownUntil = finiteOrNull(record.cooldownUntil);

  let end: number;
  let source: RetryLockoutVerdict['source'];
  if (lastFailureAt !== null && lockoutMs !== null && lockoutMs > 0) {
    end = lastFailureAt + lockoutMs;
    source = 'duration';
  } else if (cooldownUntil !== null && cooldownUntil > 0) {
    end = cooldownUntil;
    source = 'legacy';
  } else {
    return NO_LOCKOUT;
  }

  const raw = end - now;
  if (!Number.isFinite(raw) || raw <= 0) {
    return { locked: false, remainingMs: 0, remainingSeconds: 0, clamped: false, source };
  }
  const clamped = raw > ceilingMs;
  const remainingMs = clamped ? ceilingMs : raw;
  return {
    locked: remainingMs > 0,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    clamped,
    source,
  };
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
  /**
   * DEPRECATED for display (change: retry-lockout-clock-skew). An ABSOLUTE server
   * instant; a client that compares it to its own clock counts down wrongly by
   * exactly its clock skew. Kept on the wire only so a play-web PWA still running
   * a bundle cached before this change keeps working. Read `cooldownRemainingMs`.
   */
  cooldownUntil: number;
  /**
   * Milliseconds left on the retry lockout, computed SERVER-side against the
   * server clock at the moment this object was built. 0 when the team may answer
   * now. This is the value the countdown must be seeded from: the client turns it
   * into a deadline on its OWN clock, so skew cancels instead of accumulating.
   */
  cooldownRemainingMs: number;
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
  /**
   * The stored lockout row (either shape), or a bare legacy expiry instant.
   * `nowMs` MUST be the server clock — the remaining duration is computed here so
   * the participant never has to interpret a server instant (retry-lockout-clock-skew).
   */
  lockout: RetryLockoutRecord | number | null | undefined,
  nowMs: number,
): AnswerCostDisplay {
  const lv = isLevel(level) ? level : 'off';
  const tuning = WRONG_ANSWER_LEVELS[lv];
  const used = Math.max(0, Math.floor(finite(attemptsUsed, 0)));
  const chargedSoFar = Math.max(0, finite(charged, 0));
  const next = wrongAnswerCost(lv, preset, used + 1, chargedSoFar);
  const record: RetryLockoutRecord | null =
    typeof lockout === 'number' ? { cooldownUntil: lockout } : (lockout ?? null);
  const verdict = evaluateRetryLockout(nowMs, record, retryLockoutPolicyFor(lv));
  const cooldownUntil = Math.max(0, finite(record?.cooldownUntil, 0));
  return {
    level: lv,
    freeAttemptsLeft: Number.isFinite(tuning.freeAttempts)
      ? Math.max(0, tuning.freeAttempts - used)
      : 0,
    nextPoints: next.points,
    nextCooldownSeconds: next.cooldownSeconds,
    cooldownUntil,
    cooldownRemainingMs: verdict.remainingMs,
    charged: chargedSoFar,
  };
}
