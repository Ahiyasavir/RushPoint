// Pure-logic tests for streak-momentum (computeStreak + computeMedianTaskMs).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { computeStreak, computeMedianTaskMs, type StreakTaskState } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const t = (n: number) => new Date(2026, 0, 1, 12, n).toISOString(); // 1-min spacing
const c = (at: string): StreakTaskState => ({ status: 'completed', completedAt: at });
const skip: StreakTaskState = { status: 'skipped' };

// ── computeMedianTaskMs ──────────────────────────────────────────────────────
eq(computeMedianTaskMs([]), 5 * 60_000, 'empty → fallback default');
eq(computeMedianTaskMs([], 1234), 1234, 'empty → custom fallback');
eq(computeMedianTaskMs([100, 300, 200]), 200, 'odd median');
eq(computeMedianTaskMs([100, 200, 300, 400]), 250, 'even median averages');
eq(computeMedianTaskMs([0, -5, 100]), 100, 'ignores non-positive');

// ── computeStreak: consecutive ───────────────────────────────────────────────
eq(computeStreak([c(t(0)), c(t(1)), c(t(2))], { medianMs: 60_000 }),
  { streak: 3, milestone: 3 }, '3 in a row → milestone 3');

// ── skip resets ──────────────────────────────────────────────────────────────
eq(computeStreak([c(t(0)), c(t(1)), skip, c(t(3))], { medianMs: 60_000 }),
  { streak: 1, milestone: null }, 'skip resets, then 1');
eq(computeStreak([c(t(0)), skip], { medianMs: 60_000 }),
  { streak: 0, milestone: null }, 'trailing skip → 0');

// ── long gap breaks ──────────────────────────────────────────────────────────
// median 1min, break = 2min. Gap of 10min between #2 and #3 breaks the run.
eq(computeStreak([c(t(0)), c(t(1)), c(t(11))], { medianMs: 60_000 }),
  { streak: 1, milestone: null }, 'gap > 2×median restarts at 1');
eq(computeStreak([c(t(0)), c(t(1)), c(t(2)), c(t(3))], { medianMs: 60_000 }),
  { streak: 4, milestone: null }, 'within-window completions keep counting');

// ── milestones ───────────────────────────────────────────────────────────────
eq(computeStreak([c(t(0)), c(t(1)), c(t(2)), c(t(3)), c(t(4))], { medianMs: 60_000 }).milestone,
  5, 'streak 5 → milestone 5');
const ten = Array.from({ length: 10 }, (_, i) => c(t(i)));
eq(computeStreak(ten, { medianMs: 60_000 }).milestone, 10, 'streak 10 → milestone 10');
eq(computeStreak([c(t(0)), c(t(1))], { medianMs: 60_000 }).milestone, null, 'streak 2 → no milestone');

// ── momentum decay vs now ────────────────────────────────────────────────────
eq(computeStreak([c(t(0)), c(t(1))], { medianMs: 60_000, now: t(30) }),
  { streak: 0, milestone: null }, 'cold streak (now far past) → 0');
eq(computeStreak([c(t(0)), c(t(1))], { medianMs: 60_000, now: t(2) }),
  { streak: 2, milestone: null }, 'fresh streak vs now stays');

// ── empty / missing timestamps ───────────────────────────────────────────────
eq(computeStreak([], {}), { streak: 0, milestone: null }, 'no tasks → 0');
eq(computeStreak([{ status: 'completed' }, { status: 'completed' }], { medianMs: 60_000 }),
  { streak: 2, milestone: null }, 'missing timestamps still count');

console.log(failed === 0
  ? `\n✅ ALL STREAK TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
