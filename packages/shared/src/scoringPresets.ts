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

import type { Game, RunTeam, RunStageRecord, ScoringPreset } from './types';

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


// ─── Preset B — Fixed Points + Speed Bonus ───────────────────────────────────
// Each completed task awards its fixed pointValue.
// Teams that finish faster than their personal route target earn a speed bonus.

export const SPEED_BONUS_PER_MINUTE = 10;
export const SPEED_BONUS_CAP        = 200;

export function speedBonus(
  expectedTotalMinutes: number,
  actualTotalMinutes: number,
): number {
  const delta = expectedTotalMinutes - actualTotalMinutes;
  if (delta <= 0) return 0;
  return Math.min(SPEED_BONUS_CAP, Math.round(delta * SPEED_BONUS_PER_MINUTE));
}

export function scoreFixedPointsSpeed(
  stages: RunStageRecord[],
  startedAt: string | undefined,
  finishedAt: string | undefined,
  game: Pick<Game, 'stages'>,
): number {
  let taskPoints = 0;
  for (const stageRec of stages) {
    for (const taskRec of stageRec.tasks) {
      if (taskRec.status === 'completed' || taskRec.status === 'skipped') {
        // NaN ?? 0 === NaN, so a single poisoned per-task record would NaN the
        // whole team total (parseRunTeam validates top-level score, not nested
        // earnedScore). Guard for finiteness, not just null-ish.
        const e = taskRec.earnedScore;
        taskPoints += Number.isFinite(e) ? (e as number) : 0;
      }
    }
  }

  if (!startedAt || !finishedAt) return taskPoints;

  // Build expected total from the game template's expectedDurationMinutes
  const expectedTotal = game.stages.reduce((sum, stage) =>
    sum + stage.tasks.reduce((s, t) => {
      // A task missing BOTH durations yields undefined → NaN → speedBonus returns
      // NaN (delta <= 0 is false for NaN). Mirror the sumEstimatedMinutes guard.
      const m = t.expectedDurationMinutes ?? t.estimatedMinutes;
      return s + (Number.isFinite(m) && m > 0 ? m : 0);
    }, 0), 0);
  const actualTotal = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60_000;

  return taskPoints + speedBonus(expectedTotal, actualTotal);
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
// Each task earns 100 × (difficulty/10) × sigmoid(actualMinutes / estimatedMinutes).
// Faster than the estimate earns more; slower earns less.

export function sigmoidMultiplier(x: number): number {
  return 0.2 + 1.3 / (1 + Math.exp(3 * (x - 1)));
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
  let total = 0;
  for (const stageRec of stages) {
    for (const taskRec of stageRec.tasks) {
      if (taskRec.status === 'completed' || taskRec.status === 'skipped') {
        // Guard non-finite per-task earnedScore (NaN ?? 0 === NaN) — one poisoned
        // record must not NaN the whole team total.
        const e = taskRec.earnedScore;
        total += Number.isFinite(e) ? (e as number) : 0;
      }
    }
  }
  return total;
}


// ─── Shared final score formula ───────────────────────────────────────────────
// Applied on top of any preset when running finalizeRun.

export const COMPLETION_BONUS = 500;

export function applyCompletionBonus(
  rawScore: number,
  stages: Pick<RunStageRecord, 'status'>[],
): number {
  const allDone = stages.every((s) => s.status === 'completed');
  return rawScore + (allDone ? COMPLETION_BONUS : 0);
}

// bonusPenalty is subtracted after all other scoring:
export function applyPenalties(score: number, bonusPenalty: number): number {
  return Math.max(0, score - bonusPenalty);
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


// ─── Z-Score normalization (finalizeRun) ─────────────────────────────────────
// Applied to all finishers when the run ends. Faster than average → bonus.

export function applyZScoreBonus(
  rawScore: number,
  teamDurationMinutes: number,
  allDurationMinutes: number[],
): number {
  if (allDurationMinutes.length < 2) return rawScore;
  const mu = allDurationMinutes.reduce((a, b) => a + b, 0) / allDurationMinutes.length;
  const variance = allDurationMinutes.reduce((s, d) => s + (d - mu) ** 2, 0) / allDurationMinutes.length;
  const sigma = Math.sqrt(variance);
  if (!Number.isFinite(sigma) || sigma === 0) return rawScore;
  const z = (teamDurationMinutes - mu) / sigma;
  return Math.max(0, rawScore + Math.round(-z * 200));
}


// ─── Preset label helpers (for creator UI) ───────────────────────────────────

export const PRESET_LABELS: Record<ScoringPreset, { en: string; description: string }> = {
  time_only: {
    en: 'Speed Race',
    description: 'Ranked purely by total race time. No points, fastest team wins.',
  },
  fixed_points_speed: {
    en: 'Points + Speed Bonus',
    description: 'Each task earns its fixed point value. Complete all stages faster than expected for a bonus (up to +200 pts).',
  },
  smart_weighted: {
    en: 'Smart Score',
    description: 'Score based on task difficulty and how fast each task was completed relative to its estimate. Harder tasks are worth more.',
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
      // On-target sigmoid score (x=1)
      return taskScoreSmart(task.difficulty, task.estimatedMinutes, task.estimatedMinutes);
  }
}
