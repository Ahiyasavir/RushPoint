// Platform benchmark (change: platform-benchmark). Pure rolling-aggregate update
// + indicator, shared by the finalizeRun contribution and the analytics column.
// The aggregate is anonymized — counts + rolling stats only, never per-run ids.
// No Firestore, no DOM.

export interface BenchmarkAggregate {
  count: number;                  // finished runs contributed
  medianMsRolling: number;        // rolling mean of per-run median completion times (ms)
  completionRateRolling: number;  // rolling mean of per-run completion rates (0..1)
  /**
   * How many of those runs actually SUPPLIED a duration. Absent on every
   * document written before 2026-09-02 and read as `count`, which is what the
   * old code assumed — see mergeBenchmark.
   */
  durationCount?: number;
}

export interface BenchmarkSample {
  /**
   * The run's median completion time for this task type, or NULL when the run
   * completed none of them and therefore measured nothing.
   *
   * The distinction is the whole point. `median([])` returns 0, and folding that
   * in as though it were an observation is what corrupted this aggregate in
   * production: benchmarks/smart_station reached count 23 with a rolling median
   * of ZERO milliseconds, because twenty-three finished runs had each reported
   * that a station takes no time at all. Every type's median was biased toward
   * zero in proportion to how often it went uncompleted — and because
   * runAnalytics feeds these to `benchmarkIndicator`, which calls a task slower
   * when it exceeds the platform median, creators were being told their teams
   * were slow BECAUSE nobody had managed to finish the task.
   */
  medianMs: number | null;
  /** Always a real measurement: a run that completed none of a type scored 0. */
  completionRate: number;
}

export type BenchmarkIndicator = 'faster' | 'slower' | 'on_par' | 'unknown';

const ON_PAR_BAND = 0.1; // ±10% counts as on par

/**
 * Fold a new per-run sample into the rolling aggregate. From null it initializes
 * (count 1). Otherwise the rolling stats are count-weighted running means and the
 * count increments. Pure + associative-enough for an incremental transaction.
 */
export function mergeBenchmark(prev: BenchmarkAggregate | null | undefined, sample: BenchmarkSample): BenchmarkAggregate {
  const hasDuration = typeof sample.medianMs === 'number' && Number.isFinite(sample.medianMs);

  if (!prev || !(prev.count > 0)) {
    return {
      count: 1,
      durationCount: hasDuration ? 1 : 0,
      // 0 is this field's "nothing measured yet" value, and benchmarkIndicator
      // already reads a zero median as `unknown` rather than as very fast.
      medianMsRolling: hasDuration ? (sample.medianMs as number) : 0,
      completionRateRolling: sample.completionRate,
    };
  }

  // Legacy documents carry no durationCount. Reading it as `count` reproduces the
  // weighting they were actually built with, so an existing aggregate is not
  // silently restated — it just stops getting worse.
  const prevDurations = typeof prev.durationCount === 'number' ? prev.durationCount : prev.count;
  const count = prev.count + 1;
  const durationCount = prevDurations + (hasDuration ? 1 : 0);

  return {
    count,
    durationCount,
    // Weighted over runs that MEASURED something, never over runs that merely
    // happened. A run with no completions leaves this exactly as it was.
    medianMsRolling: hasDuration
      ? (prev.medianMsRolling * prevDurations + (sample.medianMs as number)) / durationCount
      : prev.medianMsRolling,
    completionRateRolling: (prev.completionRateRolling * prev.count + sample.completionRate) / count,
  };
}

/**
 * Compare a value (e.g. a task's median completion time, ms) to the platform
 * median. Lower time → 'faster'. Within ±10% → 'on_par'. Missing/zero median →
 * 'unknown'.
 */
export function benchmarkIndicator(value: number, platformMedian: number): BenchmarkIndicator {
  if (!(platformMedian > 0) || !Number.isFinite(value)) return 'unknown';
  const ratio = value / platformMedian;
  if (ratio < 1 - ON_PAR_BAND) return 'faster';
  if (ratio > 1 + ON_PAR_BAND) return 'slower';
  return 'on_par';
}

/** Median of a numeric list (0 for empty). */
export function median(values: number[]): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
