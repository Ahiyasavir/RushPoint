// ─── Penalty helpers ──────────────────────────────────────────────────────────

/**
 * Exponential transit penalty for arriving late at the park gate.
 * 50 * (e^(0.2 * minutesLate) - 1), capped at 500 pts.
 */
export function computeTransitPenalty(actualMinutes: number, targetMinutes: number): number {
  const late = actualMinutes - targetMinutes;
  if (late <= 0) return 0;
  return Math.min(500, Math.round(50 * (Math.exp(0.2 * late) - 1)));
}

/**
 * Exponential sprint penalty for arriving late to the final judge.
 * 10 * (e^(0.05 * secondsLate) - 1), capped at 300 pts.
 */
export function computeSprintPenalty(secondsLate: number): number {
  if (secondsLate <= 0) return 0;
  return Math.min(300, Math.round(10 * (Math.exp(0.05 * secondsLate) - 1)));
}


// ─── Z-Score normalization ────────────────────────────────────────────────────

/**
 * Applies a Z-Score bonus/deduction to a team's raw score based on how their
 * completion time compares to all finishers. Faster than average → bonus;
 * slower → deduction. 1σ difference = ±200 pts.
 */
export function applyZScoreBonus(
  rawScore: number,
  teamDurationMinutes: number,
  allDurationMinutes: number[],
): number {
  if (allDurationMinutes.length < 2) return rawScore;
  const mu = allDurationMinutes.reduce((a, b) => a + b, 0) / allDurationMinutes.length;
  const variance =
    allDurationMinutes.reduce((sum, d) => sum + (d - mu) ** 2, 0) / allDurationMinutes.length;
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return rawScore;
  // Negative z means faster than average → positive bonus
  const z = (teamDurationMinutes - mu) / sigma;
  return Math.max(0, rawScore + Math.round(-z * 200));
}


// ─── Slot completion bonus ────────────────────────────────────────────────────

const COMPLETION_BONUS = 500;

/**
 * Adds a flat completion bonus when all 8 slots are terminal (completed or skipped).
 * The live score accumulates per-slot earnedScore during the event; this bonus is
 * applied on top when the team finishes.
 */
export function completionBonus(
  slots: Array<{ status: string }>,
): number {
  const allDone = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
  return allDone ? COMPLETION_BONUS : 0;
}
