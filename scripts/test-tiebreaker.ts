// Lightweight unit test for the final-standings tie-breaker. No test runner is
// configured for functions, so this is a plain tsx assertion script (matches the
// repo's e2e-verify.mjs style). Run: npx tsx scripts/test-tiebreaker.ts
import {
  computeTieMetrics,
  compareForRanking,
  type RankCandidate,
} from '../functions/src/scoring/calculateScore';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Helper: build slots with green field tasks + gaps for transit.
function slot(index: number, type: string, startedAt?: string, completedAt?: string) {
  return { index, type, status: 'completed', startedAt, completedAt };
}
const ISO = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min, 0)).toISOString();

// ── 1. Equal score → fewer penalties wins ────────────────────────────────────
{
  const a: RankCandidate = { finalScore: 1000, metrics: computeTieMetrics([], 50) };
  const b: RankCandidate = { finalScore: 1000, metrics: computeTieMetrics([], 150) };
  const sorted = [b, a].sort(compareForRanking);
  check('equal score → lower penalty ranks first', sorted[0] === a,
    `a.pen=${a.metrics.penalties} b.pen=${b.metrics.penalties}`);
}

// ── 2. Equal score + equal penalty → faster combined green time wins ──────────
{
  // Team FAST: 3 green tasks, 5 min each = 15 min. Team SLOW: 10 min each = 30 min.
  const fast = [slot(0, 'green', ISO(0), ISO(5)), slot(1, 'green', ISO(5), ISO(10)), slot(2, 'green', ISO(10), ISO(15))];
  const slow = [slot(0, 'green', ISO(0), ISO(10)), slot(1, 'green', ISO(10), ISO(20)), slot(2, 'green', ISO(20), ISO(30))];
  const a: RankCandidate = { finalScore: 800, metrics: computeTieMetrics(fast, 100) };
  const b: RankCandidate = { finalScore: 800, metrics: computeTieMetrics(slow, 100) };
  const sorted = [b, a].sort(compareForRanking);
  check('equal score+penalty → faster green time ranks first', sorted[0] === a,
    `a.field=${a.metrics.fieldTaskMs} b.field=${b.metrics.fieldTaskMs}`);
}

// ── 3. Equal score + penalty + field time → lower transit wins ────────────────
{
  // Same green durations (5 min each) but different gaps between slots.
  const tight = [slot(0, 'green', ISO(0), ISO(5)), slot(1, 'green', ISO(6), ISO(11)), slot(2, 'green', ISO(12), ISO(17))]; // 2 min transit
  const loose = [slot(0, 'green', ISO(0), ISO(5)), slot(1, 'green', ISO(15), ISO(20)), slot(2, 'green', ISO(30), ISO(35))]; // 20 min transit
  const a: RankCandidate = { finalScore: 700, metrics: computeTieMetrics(tight, 0) };
  const b: RankCandidate = { finalScore: 700, metrics: computeTieMetrics(loose, 0) };
  check('field times equal in this case', a.metrics.fieldTaskMs === b.metrics.fieldTaskMs,
    `a=${a.metrics.fieldTaskMs} b=${b.metrics.fieldTaskMs}`);
  const sorted = [b, a].sort(compareForRanking);
  check('equal score+penalty+field → lower transit ranks first', sorted[0] === a,
    `a.transit=${a.metrics.transitMs} b.transit=${b.metrics.transitMs}`);
}

// ── 4. Missing/garbage timestamps don't throw and contribute 0 ────────────────
{
  let threw = false;
  let metrics;
  try {
    metrics = computeTieMetrics(
      [slot(0, 'green', undefined, 'not-a-date'), slot(1, 'green', ISO(5), ISO(2)) /* end < start */],
      -10, // negative penalty clamps to 0
    );
  } catch { threw = true; }
  check('garbage timestamps do not throw', !threw);
  check('  bad timings contribute 0 field time', metrics?.fieldTaskMs === 0, `field=${metrics?.fieldTaskMs}`);
  check('  negative penalty clamps to 0', metrics?.penalties === 0, `pen=${metrics?.penalties}`);
}

// ── 5. Higher score always wins regardless of tie metrics ─────────────────────
{
  const a: RankCandidate = { finalScore: 1200, metrics: computeTieMetrics([], 999) };
  const b: RankCandidate = { finalScore: 1100, metrics: computeTieMetrics([], 0) };
  const sorted = [b, a].sort(compareForRanking);
  check('higher finalScore wins over tie metrics', sorted[0] === a,
    `a=${a.finalScore} b=${b.finalScore}`);
}

console.log(`\n${failures === 0 ? 'ALL TIE-BREAKER TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
