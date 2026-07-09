// Platform benchmark (change: platform-benchmark). Pure rolling-aggregate update
// + indicator, shared by the finalizeRun contribution and the analytics column.
// The aggregate is anonymized — counts + rolling stats only, never per-run ids.
// No Firestore, no DOM.

export interface BenchmarkAggregate {
  count: number;                  // finished runs contributed
  medianMsRolling: number;        // rolling mean of per-run median completion times (ms)
  completionRateRolling: number;  // rolling mean of per-run completion rates (0..1)
}

export interface BenchmarkSample {
  medianMs: number;
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
  if (!prev || !(prev.count > 0)) {
    return { count: 1, medianMsRolling: sample.medianMs, completionRateRolling: sample.completionRate };
  }
  const count = prev.count + 1;
  return {
    count,
    medianMsRolling: (prev.medianMsRolling * prev.count + sample.medianMs) / count,
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
