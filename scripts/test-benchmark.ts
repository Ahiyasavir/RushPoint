// Pure-logic tests for platform-benchmark (mergeBenchmark + benchmarkIndicator).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { mergeBenchmark, benchmarkIndicator, median } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── mergeBenchmark ───────────────────────────────────────────────────────────
const init = mergeBenchmark(null, { medianMs: 1000, completionRate: 0.8 });
ok(init.count === 1 && init.medianMsRolling === 1000 && init.completionRateRolling === 0.8, 'init from null');
ok(mergeBenchmark(undefined, { medianMs: 5, completionRate: 1 }).count === 1, 'init from undefined');
ok(mergeBenchmark({ count: 0, medianMsRolling: 0, completionRateRolling: 0 }, { medianMs: 2000, completionRate: 0.5 }).count === 1, 'zero-count treated as init');

const after2 = mergeBenchmark(init, { medianMs: 2000, completionRate: 0.6 });
ok(after2.count === 2, 'count increments');
ok(after2.medianMsRolling === 1500, `rolling median mean (got ${after2.medianMsRolling})`);
ok(Math.abs(after2.completionRateRolling - 0.7) < 1e-9, `rolling completion mean (got ${after2.completionRateRolling})`);

const after3 = mergeBenchmark(after2, { medianMs: 3000, completionRate: 0.9 });
ok(after3.count === 3 && after3.medianMsRolling === 2000, 'third sample weighted correctly');

// ── benchmarkIndicator ───────────────────────────────────────────────────────
ok(benchmarkIndicator(100, 100) === 'on_par', 'exact median → on_par');
ok(benchmarkIndicator(105, 100) === 'on_par', '+5% within band → on_par');
ok(benchmarkIndicator(95, 100) === 'on_par', '-5% within band → on_par');
ok(benchmarkIndicator(80, 100) === 'faster', 'well below → faster');
ok(benchmarkIndicator(120, 100) === 'slower', 'well above → slower');
ok(benchmarkIndicator(89, 100) === 'faster', 'just past -10% → faster');
ok(benchmarkIndicator(111, 100) === 'slower', 'just past +10% → slower');
ok(benchmarkIndicator(100, 0) === 'unknown', 'zero median → unknown');
ok(benchmarkIndicator(100, -5) === 'unknown', 'negative median → unknown');
ok(benchmarkIndicator(NaN, 100) === 'unknown', 'NaN value → unknown');

// ── median ───────────────────────────────────────────────────────────────────
ok(median([]) === 0, 'empty → 0');
ok(median([5]) === 5, 'single');
ok(median([3, 1, 2]) === 2, 'odd median');
ok(median([1, 2, 3, 4]) === 2.5, 'even median averages');

console.log(failed === 0
  ? `\n✅ ALL BENCHMARK TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
