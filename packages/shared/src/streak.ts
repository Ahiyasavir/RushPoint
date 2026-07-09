// Streak & momentum counter (change: streak-momentum). Pure logic shared by the
// play-web streak chip. A streak is the trailing run of consecutive completed
// tasks with no skip and no long idle gap between them. No Firestore, no DOM.

export interface StreakTaskState {
  status: string;                       // 'completed' | 'skipped' | other (ignored)
  completedAt?: string | number | null; // ISO string or epoch ms
}

export type StreakMilestone = 3 | 5 | 10 | null;
const MILESTONES = [3, 5, 10] as const;

const DEFAULT_MEDIAN_MS = 5 * 60_000; // 5 min fallback when we have no history
const DEFAULT_BREAK_MULTIPLIER = 2;

function toMs(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Median task duration (ms) from a list of completed-task durations. */
export function computeMedianTaskMs(durationsMs: number[], fallbackMs = DEFAULT_MEDIAN_MS): number {
  const vals = durationsMs.filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (vals.length === 0) return fallbackMs;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
}

/**
 * Count the trailing run of consecutive completed tasks. A skip resets it to 0;
 * a gap between consecutive completions (or, if `now` is given, since the last
 * completion) greater than `breakMultiplier × medianMs` restarts counting.
 */
export function computeStreak(
  states: StreakTaskState[],
  opts: { now?: string | number; medianMs?: number; breakMultiplier?: number } = {},
): { streak: number; milestone: StreakMilestone } {
  const medianMs = opts.medianMs ?? DEFAULT_MEDIAN_MS;
  const breakMs = medianMs * (opts.breakMultiplier ?? DEFAULT_BREAK_MULTIPLIER);

  let streak = 0;
  let lastAt: number | null = null;

  for (const s of states) {
    if (s.status === 'skipped') {
      streak = 0;
      lastAt = null;
      continue;
    }
    if (s.status !== 'completed') continue; // pending / in-progress are neutral

    const at = toMs(s.completedAt);
    if (lastAt != null && at != null && at - lastAt > breakMs) {
      streak = 1; // gap broke the run — restart from this completion
    } else {
      streak += 1;
    }
    lastAt = at ?? lastAt;
  }

  // Momentum decay: if the most recent completion is older than the break
  // window relative to `now`, the streak has gone cold.
  const nowMs = toMs(opts.now ?? null);
  if (nowMs != null && lastAt != null && nowMs - lastAt > breakMs) {
    streak = 0;
  }

  const milestone = (MILESTONES as readonly number[]).includes(streak)
    ? (streak as StreakMilestone)
    : null;
  return { streak, milestone };
}
