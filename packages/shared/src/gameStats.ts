// Denormalized game-summary stats written to publicGames/{id} (change:
// fix-public-game-minutes-nan). Kept pure + transport-free.
import type { Task } from './types';

// Sum of every task's `estimatedMinutes`, treating a missing or non-finite value
// (undefined / NaN / Infinity) as 0 and clamping negatives to 0, so the result is
// ALWAYS a finite, non-negative number. A bare
// `tasks.reduce((s, t) => s + t.estimatedMinutes, 0)` yields NaN the instant any
// task omits `estimatedMinutes`, and that NaN is written to publicGames/{id} —
// breaking gallery sort/filter/display. This helper can never return NaN.
export function sumEstimatedMinutes(
  tasks: ReadonlyArray<Pick<Task, 'estimatedMinutes'>>,
): number {
  return tasks.reduce((sum, t) => {
    const m = t?.estimatedMinutes;
    return sum + (Number.isFinite(m) && (m as number) > 0 ? (m as number) : 0);
  }, 0);
}
