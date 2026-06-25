// Unit test for the performance-budget contract (packages/shared/src/perfBudget.ts).
// This is the deterministic half of the "fast & smooth" guarantee: it pins the
// HARD 2.5s page-load ceiling and the budget predicates so a regression to the
// numbers (or the comparison logic) fails the gate. The *measured* half — real
// LCP/INP and real gzipped bundle sizes — is enforced via the preview tools and
// the build manifest (see the v2.1 blueprint todos). Run: npx tsx scripts/test-perf-budget.ts
import {
  TIMING_BUDGET_MS,
  BUNDLE_BUDGET_KB,
  CLS_BUDGET,
  isWithinTimingBudget,
  isWithinBundleBudget,
  isWithinClsBudget,
} from '../packages/shared/src/perfBudget';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 1. The hard requirement is encoded: no page over 2.5s ─────────────────────
check('LCP page-load ceiling is exactly 2500ms (the hard requirement)', TIMING_BUDGET_MS.lcp === 2500);
check('a 2.4s load is within budget', isWithinTimingBudget('lcp', 2400));
check('a 2.5s load is within budget (boundary inclusive)', isWithinTimingBudget('lcp', 2500));
check('a 2.6s load BUSTS the budget', !isWithinTimingBudget('lcp', 2600));

// ── 2. Timing predicate guards: negatives / NaN / Infinity are never "within" ─
check('negative timing is rejected', !isWithinTimingBudget('inp', -1));
check('NaN timing is rejected', !isWithinTimingBudget('inp', NaN));
check('Infinity timing is rejected', !isWithinTimingBudget('lcp', Infinity));

// ── 3. Smoothness budgets reflect Core Web Vitals "good" thresholds ───────────
check('INP responsiveness budget ≤ 200ms (no jank)', TIMING_BUDGET_MS.inp <= 200);
check('CLS budget ≤ 0.1 (no layout jump)', CLS_BUDGET <= 0.1);
check('long-task threshold is 50ms', TIMING_BUDGET_MS.longTask === 50);
check('frame budget fits 60fps (≤16.7ms)', TIMING_BUDGET_MS.frame <= 16.7);
check('a 0.05 layout shift is within budget', isWithinClsBudget(0.05));
check('a 0.2 layout shift busts the budget', !isWithinClsBudget(0.2));

// ── 4. Budget invariants — internally consistent, can't silently drift ────────
check('FCP ≤ LCP (paint precedes largest paint)', TIMING_BUDGET_MS.fcp <= TIMING_BUDGET_MS.lcp);
check('route transition ≤ LCP (in-app nav beats a cold load)', TIMING_BUDGET_MS.routeTransition <= TIMING_BUDGET_MS.lcp);
check('initial JS budget ≤ total initial transfer', BUNDLE_BUDGET_KB.initialJs <= BUNDLE_BUDGET_KB.initialTransfer);
check('all timing budgets are positive', Object.values(TIMING_BUDGET_MS).every((v) => v > 0));
check('all bundle budgets are positive', Object.values(BUNDLE_BUDGET_KB).every((v) => v > 0));

// ── 5. Bundle predicate: an over-budget initial chunk fails the gate ──────────
check('a 180KB initial JS bundle is within budget', isWithinBundleBudget('initialJs', 180));
check('a 220KB initial JS bundle busts the budget', !isWithinBundleBudget('initialJs', 220));
check('a 140KB lazy chunk is within budget', isWithinBundleBudget('lazyChunk', 140));

console.log(`\n${failures === 0 ? 'ALL PERF-BUDGET TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
