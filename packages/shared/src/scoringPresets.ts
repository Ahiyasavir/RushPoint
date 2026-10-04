// ─── Scoring Presets — shared between creator preview and server execution ────
//
// Three fully-automatic presets the creator picks once per game.
// No human score input — all formulas run on time + task metadata only.
//
// Used in TWO places:
//   1. Creator web (preview): show the formula to the creator before launch.
//   2. Cloud Functions (finalizeRun): compute the real score for each team.
//
// Keep this file free of Firebase/Node imports so it can run in any context.

import type { Game, RunTeam, RunStageRecord, ScoringPreset, Task } from './types';

// ─── Preset A — Time Only ────────────────────────────────────────────────────
// Rank by total race duration. No points at all.

export function scoreTimeOnly(
  _team: Pick<RunTeam, 'startedAt' | 'finishedAt'>,
): number {
  // Score is zero; ranking done by durationSeconds in finalizeRun.
  return 0;
}

export function durationSeconds(startedAt?: string, finishedAt?: string): number {
  if (!startedAt || !finishedAt) return Infinity;
  return Math.max(0, (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
}


// ─── Preset B — Fixed Points + Speed ─────────────────────────────────────────
// Each completed task awards its fixed pointValue. Speed is rewarded at RANKING time, as a
// percentage of those points measured against the field (fieldPaceRatios / pacePct below —
// change: scoring-v2). The old flat "+10 per minute under the expected route, up to +200" bonus
// is retired: it was decided by the author's time estimates, so a wrong estimate handed every
// team the full +200 or nobody anything.

/**
 * One task's resolved expected route-minutes, guarded exactly as the old reduce:
 * `expectedDurationMinutes ?? estimatedMinutes`, treated as 0 when non-finite or
 * not greater than 0. This is the exact value stamped onto a terminal
 * RunTaskRecord at completion (fix-fixed-points-speed-template-drift).
 */
export function resolveExpectedMinutes(
  t: Pick<Task, 'expectedDurationMinutes' | 'estimatedMinutes'>,
): number {
  const m = t.expectedDurationMinutes ?? t.estimatedMinutes;
  return Number.isFinite(m) && (m as number) > 0 ? (m as number) : 0;
}

/**
 * Route expected-total minutes for a team, summed from the STAMP the server wrote on each
 * COMPLETED record — never re-derived from the live template. A record missing the stamp
 * (pre-change / legacy) falls back to that task's resolved template value (matched by taskId), so
 * old runs keep scoring and nothing throws; a record whose template task is gone contributes 0.
 *
 * scoring-v2: SKIPPED records no longer count. A mission that was closed, expired, unreachable,
 * lost to an exclusive group or left over in a satisfied stage cost the team no time, so counting
 * its minutes measured a team that played LESS against a LONGER route — and paid it a bigger
 * speed bonus for it.
 */
export function teamExpectedRouteMinutes(
  stages: RunStageRecord[],
  game: Pick<Game, 'stages'>,
): number {
  const templateById = new Map<string, Task>();
  for (const stage of game.stages) {
    for (const t of stage.tasks) templateById.set(t.id, t);
  }
  let total = 0;
  for (const stageRec of stages) {
    for (const taskRec of stageRec.tasks) {
      if (taskRec.status !== 'completed') continue;
      const stamp = taskRec.expectedDurationMinutesAtCompletion;
      if (Number.isFinite(stamp) && (stamp as number) >= 0) {
        total += stamp as number;
        continue;
      }
      const templateTask = templateById.get(taskRec.taskId);
      total += templateTask ? resolveExpectedMinutes(templateTask) : 0;
    }
  }
  return total;
}

/**
 * Σ earnedScore over completed and skipped records (a skip consolation is a skipped record's
 * earnedScore). A non-finite record counts as 0 — NaN ?? 0 is NaN, and one poisoned record must
 * not NaN the team total and the whole board with it.
 */
export function sumEarnedPoints(stages: RunStageRecord[]): number {
  let total = 0;
  for (const stageRec of stages) {
    for (const taskRec of stageRec.tasks) {
      if (taskRec.status === 'completed' || taskRec.status === 'skipped') {
        const e = taskRec.earnedScore;
        total += Number.isFinite(e) ? (e as number) : 0;
      }
    }
  }
  return total;
}

/** The mission points of a fixed_points_speed team. Speed is a ranking-time percentage
 *  (scoring-v2), so this is exactly the points sum. */
export function scoreFixedPointsSpeed(stages: RunStageRecord[]): number {
  return sumEarnedPoints(stages);
}

// Awarded score for a single task under this preset
export function taskScoreFixed(task: Pick<{ pointValue: number }, 'pointValue'>): number {
  // Guard malformed/legacy data: a non-numeric pointValue would return NaN, which
  // poisons the team's total; a NEGATIVE pointValue would SUBTRACT from the total
  // (wave-i B1 / wave-j J4). Clamp to >= 0 — mirrors taskScoreSmart's difficulty
  // clamp — so no per-task record can ever push a team's earned score down.
  return Number.isFinite(task.pointValue) ? Math.max(0, task.pointValue) : 0;
}


// ─── Preset C — Smart Weighted (Sigmoid) ─────────────────────────────────────
// Each task earns 100 × (difficulty/10) × multiplier(actualMinutes / estimatedMinutes).
// Faster than the estimate earns more; slower earns less.
//
// scoring-v2: the multiplier is BOUNDED to 0.7 … 1.3 and pays exactly 1.0 on target. It used to
// range 0.2 … 1.5 — a 7.5× swing decided by the author's estimate — so a 2-minute guess on a
// mission that really takes 15 (walking included: startedAt is stamped at assignment) paid every
// team a fifth of the mission. Kahoot's rule is the model: a correct answer is never worth much
// less than its value, speed only scales it. Who was FASTER than whom is rewarded at ranking time,
// against the field, where a wrong estimate cancels out (fieldPaceRatios).

export const SMART_MULT_MIN = 0.7;
export const SMART_MULT_MAX = 1.3;
const SMART_MULT_STEEPNESS = 2.5;

export function sigmoidMultiplier(x: number): number {
  return SMART_MULT_MIN + (SMART_MULT_MAX - SMART_MULT_MIN) / (1 + Math.exp(SMART_MULT_STEEPNESS * (x - 1)));
}

export function taskScoreSmart(
  difficulty: number,
  actualMinutes: number,
  estimatedMinutes: number,
): number {
  // Guard malformed/legacy data: any non-numeric input would return NaN and
  // corrupt the team total plus the Z-score for every other finisher. Difficulty
  // is documented 1–10; clamp to >= 0 so a malformed NEGATIVE difficulty can't
  // yield a negative task score (which would silently subtract from the total).
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return 0;
  const d = Number.isFinite(difficulty) ? Math.max(0, difficulty) : 0;
  const x = (Number.isFinite(actualMinutes) ? actualMinutes : 0) / estimatedMinutes;
  return Math.round(100 * (d / 10) * sigmoidMultiplier(x));
}

export function scoreSmartWeighted(stages: RunStageRecord[]): number {
  return sumEarnedPoints(stages);
}


// ─── Shared final score formula (scoring-v2) ─────────────────────────────────
// Every bonus is a PERCENTAGE of the mission points the team earned, never a flat amount. A flat
// +500 for finishing outweighed every mission of a game whose missions are worth 10 points each,
// and the ±200-per-standard-deviation speed term jumped the board the same way. Flat ADJUSTMENTS
// (hints, staff ±, discovery, zone capture, power-ups) still ride bonusPenalty and are applied
// once, LAST, so a 20-point fine is exactly 20 points and never changes a bonus.

export const COMPLETION_BONUS_PCT = 0.10;

export function completionBonus(points: number, allStagesDone: boolean): number {
  if (!allStagesDone || !Number.isFinite(points) || points <= 0) return 0;
  return Math.round(points * COMPLETION_BONUS_PCT);
}

export function allStagesCompleted(stages: Pick<RunStageRecord, 'status'>[]): boolean {
  return stages.length > 0 && stages.every((s) => s.status === 'completed');
}

// bonusPenalty is subtracted after all other scoring:
export function applyPenalties(score: number, bonusPenalty: number): number {
  return Math.max(0, score - bonusPenalty);
}

export function composeLeaderboardScore(args: {
  points: number;
  allStagesDone: boolean;
  /** A fraction from pacePct (−COMPLETION_BONUS_PCT … +PACE_MAX_PCT); 0 for an unfinished team. */
  pacePct: number;
  bonusPenalty: number;
}): number {
  const points = Number.isFinite(args.points) ? Math.max(0, args.points) : 0;
  const pct = Number.isFinite(args.pacePct) ? args.pacePct : 0;
  const penalty = Number.isFinite(args.bonusPenalty) ? args.bonusPenalty : 0;
  const pace = Math.round(points * pct);
  return Math.max(0, points + completionBonus(points, args.allStagesDone) + pace - penalty);
}


// ─── Field-relative pace (scoring-v2) ────────────────────────────────────────
// Orienteering's lesson: the reference time comes from the FIELD, not from the course setter, so
// a badly set estimate cannot decide the result. A finished team's pace is its adjusted duration
// over the expected minutes of the missions it actually COMPLETED (so teams that played different
// subsets stay comparable), relative to the MEDIAN pace of every finisher (robust to one team that
// got lost). If every estimate is wrong by the same factor, every pace is wrong by it too and the
// ratio is untouched.

export const PACE_WEIGHT = 0.5;
export const PACE_MAX_PCT = 0.15;
/** A lone finisher is measured against the author's estimate only when its real time is within
 *  this factor of it either way; outside, the estimate is judged unreliable and nothing is paid. */
export const LONE_FINISHER_PLAUSIBLE_RATIO = 3;

export interface PaceInput {
  /** Adjusted race duration in minutes (paused tasks and staff holds already excluded). */
  durationMin: number;
  /** teamExpectedRouteMinutes: the expected minutes of the missions the team completed. */
  expectedMin: number;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Each finisher's pace relative to the field (1 = the median, < 1 = faster), or null when there is
 * nothing trustworthy to compare against. Paced (duration ÷ expected) among the finishers that have
 * expected minutes; raw duration only when NONE has, so a game with no estimates is still a fair race. Total: never throws, never returns a non-finite number.
 */
export function fieldPaceRatios(finishers: PaceInput[]): (number | null)[] {
  const ok = (v: number) => Number.isFinite(v) && v >= 0;
  const valid = finishers.map((f) => ok(f.durationMin) && ok(f.expectedMin));
  // Paced whenever ANY finisher has expected minutes; a finisher WITHOUT them (every mission skipped,
  // say) then gets no pace term rather than dragging the whole field onto raw durations — where it
  // would also be the fastest "racer" and skew the median for everyone else.
  const paced = finishers.some((f, i) => valid[i] && f.expectedMin > 0);
  const usable = valid.map((v, i) => v && (!paced || finishers[i].expectedMin > 0));
  const field = finishers.filter((_, i) => usable[i]);
  if (field.length === 0) return finishers.map(() => null);
  const value = (f: PaceInput) => (paced ? f.durationMin / f.expectedMin : f.durationMin);

  if (field.length === 1) {
    // No field to compare against: trust the author's estimate only when it is plausible.
    return finishers.map((f, i) => {
      if (!usable[i] || !paced) return null;
      const q = value(f);
      return q >= 1 / LONE_FINISHER_PLAUSIBLE_RATIO && q <= LONE_FINISHER_PLAUSIBLE_RATIO ? q : null;
    });
  }
  const ref = medianOf(field.map(value));
  if (!(ref > 0) || !Number.isFinite(ref)) return finishers.map(() => null);
  return finishers.map((f, i) => (usable[i] ? value(f) / ref : null));
}

/** A pace ratio as a bonus fraction: half the relative difference, capped at +PACE_MAX_PCT on the
 *  fast side and at −COMPLETION_BONUS_PCT on the slow side — slowness can eat the bonus for finishing
 *  but never more, so FINISHING never scores below an unfinished team with the same mission points.
 *  20% faster than the field median ⇒ +10%. Null / non-finite ⇒ 0. */
export function pacePct(r: number | null | undefined): number {
  if (typeof r !== 'number' || !Number.isFinite(r)) return 0;
  const pct = PACE_WEIGHT * (1 - r);
  return Math.max(-COMPLETION_BONUS_PCT, Math.min(PACE_MAX_PCT, pct)) || 0;
}


// ─── Optional transit/sprint penalties ───────────────────────────────────────
// Enabled per-game via Game.scoringOptions. Both are opt-in, not on by default.

/** Exponential late-arrival penalty. cap = 500 pts. */
export function transitPenalty(actualMinutes: number, targetMinutes: number): number {
  const late = actualMinutes - targetMinutes;
  if (late <= 0) return 0;
  return Math.min(500, Math.round(50 * (Math.exp(0.2 * late) - 1)));
}

/** Exponential sprint penalty for timed stages. cap = 300 pts. */
export function sprintPenalty(secondsLate: number): number {
  if (secondsLate <= 0) return 0;
  return Math.min(300, Math.round(10 * (Math.exp(0.05 * secondsLate) - 1)));
}


// ─── Preset label helpers (for creator UI) ───────────────────────────────────

export const PRESET_LABELS: Record<ScoringPreset, { en: string; description: string }> = {
  time_only: {
    en: 'Speed Race',
    description: 'Ranked purely by total race time. No points, fastest team wins.',
  },
  fixed_points_speed: {
    en: 'Points + Speed Bonus',
    description: 'Each task earns its fixed point value. Finishing faster than the other teams adds up to +15%; finishing everything adds 10%.',
  },
  smart_weighted: {
    en: 'Smart Score',
    description: 'Score based on task difficulty, with speed moving it by up to 30% either way. Harder tasks are worth more.',
  },
};

export const DEFAULT_SCORING_PRESET: ScoringPreset = 'fixed_points_speed';


// ─── Skip award per preset ────────────────────────────────────────────────────
// When a task/stage is skipped (admin action), award a fair substitute score.

export function skipAward(
  preset: ScoringPreset,
  task: { pointValue: number; difficulty: number; estimatedMinutes: number },
): number {
  switch (preset) {
    case 'time_only':
      return 0;
    case 'fixed_points_speed':
      // Guard a missing/non-finite AND negative pointValue (legacy/hand-written
      // task), matching taskScoreFixed — otherwise a skipped task could award NaN
      // or a negative value and poison the whole leaderboard (nightly hardening / J4).
      return Number.isFinite(task.pointValue) ? Math.max(0, task.pointValue) : 0;
    case 'smart_weighted':
      // On-target score (x=1): exactly 100 × difficulty/10
      return taskScoreSmart(task.difficulty, task.estimatedMinutes, task.estimatedMinutes);
  }
}
