/**
 * Sigmoid-based per-task scoring.
 *
 * M(x) = 0.2 + 1.3 / (1 + e^(3*(x-1)))
 *   x = actualMinutes / targetMinutes
 *   floor ≈ 0.20 (very slow)  peak ≈ 1.43 (very fast)
 *
 * Score = (100 * difficulty) * M(x)
 */
function timeMultiplier(x: number): number {
  return 0.2 + 1.3 / (1 + Math.exp(3 * (x - 1)));
}

export function calculateTaskScore(
  difficulty: number,
  actualMinutes: number,
  targetMinutes: number,
): number {
  const x = targetMinutes > 0 ? actualMinutes / targetMinutes : 1;
  return Math.round(100 * difficulty * timeMultiplier(x));
}
