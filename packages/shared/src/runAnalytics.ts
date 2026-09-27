// Run analytics & heatmap (change: run-analytics-heatmap). Pure post-run
// aggregator shared by the getRunAnalytics callable and the creator Analytics
// tab. Deterministic regardless of team order; retention-safe (a pruned team
// just contributes nothing). No Firestore, no DOM.
import type { RunTeam } from './types';
import {
  median, benchmarkIndicator, benchmarkIndicatorFor,
  type BenchmarkIndicator, type BenchmarkAggregate,
} from './benchmark';

export interface TaskAnalytics {
  taskId: string;
  type: string;
  attempts: number;        // teams that had this task in their route
  completions: number;     // teams that completed it
  skips: number;           // teams that skipped it
  completionRate: number;  // completions / attempts (0 when no attempts)
  medianMs: number;        // median completion time (0 when none completed)
  p90Ms: number;           // 90th-percentile completion time
  hintCount: number;       // teams that revealed the paid hint
}

export interface RunAnalytics {
  teamCount: number;
  overallCompletionRate: number;
  tasks: TaskAnalytics[];
}

type AnalyticsTask = { id: string; type: string };

/** 90th percentile (nearest-rank) of a numeric list (0 for empty). */
function p90(values: number[]): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const rank = Math.ceil(0.9 * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}

/**
 * Aggregate per-task completion / timing / hint / skip stats across all teams.
 * `gameTasks` is the flat list of the game's tasks (id + type), which fixes the
 * output order so the result is deterministic regardless of team ordering.
 */
export function computeRunAnalytics(teams: RunTeam[], gameTasks: AnalyticsTask[]): RunAnalytics {
  const tasks: TaskAnalytics[] = gameTasks.map((gt) => {
    let attempts = 0, completions = 0, skips = 0, hintCount = 0;
    const durations: number[] = [];
    for (const team of teams) {
      let had = false, completed = false;
      for (const stage of team.stages ?? []) {
        for (const rec of stage.tasks ?? []) {
          if (rec.taskId !== gt.id) continue;
          had = true;
          if (rec.status === 'completed') {
            completed = true;
            if (rec.actualMinutes != null) durations.push(rec.actualMinutes * 60_000);
          } else if (rec.status === 'skipped') {
            skips += 1;
          }
        }
      }
      if (had) attempts += 1;
      if (completed) completions += 1;
      if ((team.taskHintsUsed ?? []).includes(gt.id)) hintCount += 1;
    }
    return {
      taskId: gt.id,
      type: gt.type,
      attempts,
      completions,
      skips,
      completionRate: attempts > 0 ? completions / attempts : 0,
      medianMs: median(durations),
      p90Ms: p90(durations),
      hintCount,
    };
  });

  const totalAttempts = tasks.reduce((s, t) => s + t.attempts, 0);
  const totalCompletions = tasks.reduce((s, t) => s + t.completions, 0);

  return {
    teamCount: teams.length,
    overallCompletionRate: totalAttempts > 0 ? totalCompletions / totalAttempts : 0,
    tasks,
  };
}

/**
 * Compare a task's median time to the platform median for its type.
 *
 * NOT YET WIRED TO ANY SCREEN, which is worth knowing before it is: the
 * aggregate it would read is currently 44 runs, 28 of them from one account, so
 * `benchmarkIndicatorFor` is the entry point to use when this is surfaced — it
 * refuses to compare against a sample too thin to mean anything, which the bare
 * median cannot do.
 *
 * This overload is kept for the median-only case and is deliberately the weaker
 * of the two.
 */
export function compareToPlatformMedian(taskMedianMs: number, platformMedianMs: number | null | undefined): BenchmarkIndicator {
  return benchmarkIndicator(taskMedianMs, platformMedianMs ?? 0);
}

/**
 * The comparison to reach for: it consults the aggregate's sample size, so a
 * platform benchmark built from a founder testing his own game reports
 * `unknown` rather than calling real teams slow.
 */
export function compareToPlatformBenchmark(
  taskMedianMs: number,
  aggregate: BenchmarkAggregate | null | undefined,
): BenchmarkIndicator {
  return benchmarkIndicatorFor(taskMedianMs, aggregate);
}
