// Firestore operation accounting + per-run quota projection
// (change: spark-tier-location-load).
//
// Pure and framework-free: this file owns the ARITHMETIC of "what did a run cost, and
// would it fit". Where the numbers come from (an AsyncLocalStorage context wrapped around
// each callable) is functions/src/opCounter.ts's problem, so the accounting stays unit
// testable without a Firestore handle, an emulator or a clock.
//
// WHY READS AND WRITES ARE NEVER MERGED into a single "operations" figure: Spark bills
// them against DIFFERENT daily ceilings (50,000 reads, 20,000 writes). A combined number
// hides which ceiling is the binding one — and for RushPoint it is writes, at less than
// half the read allowance, which is not the intuition a combined figure would give you.

/** The two things Firestore charges for, counted separately on purpose. */
export type OpKind = 'read' | 'write';

export interface OpCounts {
  reads: number;
  writes: number;
}

export interface OpTallies {
  /** Per-callable counts. Always carries BOTH fields, so an absent write reads as 0. */
  byCallable: Record<string, OpCounts>;
  total: OpCounts;
}

/**
 * Bucket for work that happened outside any callable — a Firestore trigger, the pubsub
 * schedule, module boot. Named explicitly rather than left to stringify as "undefined",
 * because an op nobody can attribute still spends quota and must stay visible in the
 * total. A large number here is itself a finding.
 */
export const UNATTRIBUTED = '(unattributed)';

/** Firebase Spark (free) plan daily ceilings. */
export const SPARK_DAILY_QUOTA: OpCounts = { reads: 50_000, writes: 20_000 };

export interface OpTally {
  /** Charge `n` operations of `kind` to `callable` (or the unattributed bucket). */
  record(callable: string | undefined, kind: OpKind, n?: number): void;
  /** A detached copy of the current counts — later recording cannot mutate it. */
  snapshot(): OpTallies;
  /** Drop everything counted so far. */
  reset(): void;
}

/**
 * Build an isolated tally. Exported as a factory rather than a singleton so tests (and
 * two concurrent measurement runs) never share state.
 */
export function createOpTally(): OpTally {
  let byCallable = new Map<string, OpCounts>();

  return {
    record(callable, kind, n = 1) {
      if (!Number.isFinite(n) || n <= 0) return;
      const key = callable && callable.length > 0 ? callable : UNATTRIBUTED;
      const entry = byCallable.get(key) ?? { reads: 0, writes: 0 };
      if (kind === 'read') entry.reads += n;
      else entry.writes += n;
      byCallable.set(key, entry);
    },

    snapshot() {
      const out: Record<string, OpCounts> = {};
      const total: OpCounts = { reads: 0, writes: 0 };
      for (const [key, counts] of byCallable) {
        // Copy, never hand out the live object: a caller holding a snapshot across further
        // recording must see the numbers as they were when they asked.
        out[key] = { reads: counts.reads, writes: counts.writes };
        total.reads += counts.reads;
        total.writes += counts.writes;
      }
      return { byCallable: out, total };
    },

    reset() {
      byCallable = new Map();
    },
  };
}

export interface ProjectedCallableCost {
  callable: string;
  /** What was actually measured. */
  reads: number;
  writes: number;
  /** The same, scaled to the target participant count. */
  projectedReads: number;
  projectedWrites: number;
}

export interface RunCostProjection {
  /** The denominator — how many participants produced the measured numbers. */
  measuredParticipants: number;
  /** What the measurement was scaled up to. */
  targetParticipants: number;
  scaleFactor: number;
  perCallable: ProjectedCallableCost[];
  projected: OpCounts;
  quota: OpCounts;
  fitsReads: boolean;
  fitsWrites: boolean;
  fits: boolean;
  /** Quota minus projected. NEGATIVE when over — the overshoot is the useful number. */
  headroom: OpCounts;
}

/**
 * Scale a measured run to a target participant count and judge it against a daily quota.
 *
 * The result deliberately carries its own INPUTS — the measured participant count, the
 * per-callable measured counts, and the quota it judged against — not just a verdict.
 * CLAUDE.md's lesson from the alt-text check applies directly: a bare "does not fit" is
 * unfalsifiable, while "8 participants measured, 75 writes each, scaled 15x" is a claim
 * a human can check and disagree with.
 *
 * Total by construction: a zero or nonsensical measured count yields a zero projection
 * rather than a division by zero or a NaN that would poison every downstream comparison.
 */
export function projectRunCost(opts: {
  tallies: OpTallies;
  measuredParticipants: number;
  targetParticipants: number;
  quota?: OpCounts;
}): RunCostProjection {
  const quota = opts.quota ?? SPARK_DAILY_QUOTA;
  const measured = Number.isFinite(opts.measuredParticipants) ? opts.measuredParticipants : 0;
  const target = Number.isFinite(opts.targetParticipants) ? opts.targetParticipants : 0;

  // Nothing measured means nothing to scale. Returning 0 keeps the result finite and
  // comparable; the caller can see measuredParticipants === 0 and know why.
  const scaleFactor = measured > 0 ? target / measured : 0;

  const perCallable: ProjectedCallableCost[] = [];
  const projected: OpCounts = { reads: 0, writes: 0 };

  for (const [callable, counts] of Object.entries(opts.tallies?.byCallable ?? {})) {
    const projectedReads = Math.round(counts.reads * scaleFactor);
    const projectedWrites = Math.round(counts.writes * scaleFactor);
    perCallable.push({
      callable,
      reads: counts.reads,
      writes: counts.writes,
      projectedReads,
      projectedWrites,
    });
    projected.reads += projectedReads;
    projected.writes += projectedWrites;
  }

  // Heaviest first: the point of reading this table is to find what to fix next.
  perCallable.sort((a, b) =>
    (b.projectedWrites + b.projectedReads) - (a.projectedWrites + a.projectedReads)
    || a.callable.localeCompare(b.callable));

  const fitsReads = projected.reads <= quota.reads;
  const fitsWrites = projected.writes <= quota.writes;

  return {
    measuredParticipants: measured,
    targetParticipants: target,
    scaleFactor,
    perCallable,
    projected,
    quota,
    fitsReads,
    fitsWrites,
    fits: fitsReads && fitsWrites,
    headroom: {
      reads: quota.reads - projected.reads,
      writes: quota.writes - projected.writes,
    },
  };
}

/**
 * Render a projection as human-readable lines. Kept here (not in a script) so the
 * denominator is printed by the same code that computed it and the two cannot drift.
 */
export function formatRunCostProjection(p: RunCostProjection): string {
  const lines: string[] = [];
  lines.push(
    `Measured ${p.measuredParticipants} participant(s) → projected to ${p.targetParticipants} ` +
    `(x${p.scaleFactor.toFixed(2)})`,
  );
  for (const row of p.perCallable) {
    lines.push(
      `  ${row.callable.padEnd(28)} measured ${row.reads}r/${row.writes}w` +
      `  →  projected ${row.projectedReads}r/${row.projectedWrites}w`,
    );
  }
  lines.push(
    `  TOTAL projected: ${p.projected.reads} reads / ${p.projected.writes} writes` +
    `   quota: ${p.quota.reads} / ${p.quota.writes}`,
  );
  lines.push(
    `  headroom: ${p.headroom.reads} reads / ${p.headroom.writes} writes` +
    `   ⇒ ${p.fits ? 'FITS' : 'DOES NOT FIT'}`,
  );
  return lines.join('\n');
}
