// Pure-logic tests for platform-benchmark (mergeBenchmark + benchmarkIndicator).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  mergeBenchmark, benchmarkIndicator, benchmarkIndicatorFor, median,
  MIN_BENCHMARK_DURATION_SAMPLES,
} from '@rushpoint/shared';

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


// ── A run that completed NOTHING of a type has no duration to report ─────────
//
// Found on 2026-09-02 by reading production: benchmarks/smart_station held
// count 23, medianMsRolling 0, completionRateRolling 0 — twenty-three finished
// runs had each folded in "the median duration of a smart_station is zero
// milliseconds", because `median([])` returns 0 and foldPlatformBenchmark passed
// that straight in. Every published median is therefore biased toward zero in
// proportion to how often its type goes uncompleted, and since runAnalytics
// feeds these to `benchmarkIndicator`, a low platform median makes real teams
// read as SLOWER than the platform. The aggregate was telling creators their
// players were slow because nobody had finished the task.
//
// A completion rate of 0 IS a measurement and must still be folded. The absent
// duration must not be.
{
  const seeded = mergeBenchmark(null, { medianMs: 1000, completionRate: 1 });
  const after = mergeBenchmark(seeded, { medianMs: null, completionRate: 0 });
  ok(after.medianMsRolling === 1000,
    `a run with no completions leaves the median alone (got ${after.medianMsRolling})`);
  ok(after.completionRateRolling === 0.5,
    `…but its completion rate still counts (got ${after.completionRateRolling})`);
  ok(after.count === 2, `run count advances (got ${after.count})`);
  ok(after.durationCount === 1, `duration count does NOT (got ${after.durationCount})`);

  // And the next real duration must weight against durationCount, not count —
  // otherwise the skipped samples still dilute it.
  const after2 = mergeBenchmark(after, { medianMs: 3000, completionRate: 1 });
  ok(after2.medianMsRolling === 2000,
    `the next real duration averages over real ones only (got ${after2.medianMsRolling})`);
}
{
  // Initialising from nothing with no duration: the aggregate exists, has a rate,
  // and has no median yet — never a median of zero.
  const init = mergeBenchmark(null, { medianMs: null, completionRate: 0 });
  ok(init.count === 1 && init.durationCount === 0,
    `init with no duration: count 1, durationCount 0 (got ${init.count}/${init.durationCount})`);
  ok(init.medianMsRolling === 0, 'median stays 0 as the "no data yet" value');
  ok(benchmarkIndicator(5000, init.medianMsRolling) === 'unknown',
    'and a zero median reads as unknown rather than making everyone slow');
}
{
  // Legacy documents have no durationCount. Treat it as count so an existing
  // aggregate keeps its current weighting rather than being restated.
  const legacy = { count: 4, medianMsRolling: 800, completionRateRolling: 0.5 };
  const next = mergeBenchmark(legacy, { medianMs: 1300, completionRate: 0.5 });
  ok(next.durationCount === 5, `legacy durationCount backfills from count (got ${next.durationCount})`);
  ok(next.medianMsRolling === 900, `legacy weighting preserved (got ${next.medianMsRolling})`);
}

// ── A statistic must know whether it means anything yet ─────────────────────
//
// Read from production 2026-09-02: 44 finished runs have contributed to this
// aggregate, and TWENTY-EIGHT of them belong to one uid — the operator's own
// creator account, plus four from the seeded demo game. The published medians
// (0.1 to 1.1 minutes per task) are one person clicking through his own content
// to check it works, not players playing.
//
// No code defect produced that; it is what a pre-launch product's data looks
// like. The defect is that `benchmarkIndicator` cannot tell. It receives a
// median and nothing else, so it is structurally incapable of knowing whether
// the number behind it came from four hundred runs or from four — and it will
// happily label a real team "slower than the platform" against a founder's
// speed-run. A statistic that cannot report its own denominator should not be
// published, which is this repo's own standing lesson applied to itself.
{
  const thin = { count: 3, durationCount: 3, medianMsRolling: 6000, completionRateRolling: 0.5 };
  ok(benchmarkIndicatorFor(60000, thin) === 'unknown',
    'a thin aggregate reports unknown rather than "slower"');

  const enough = { count: 40, durationCount: 30, medianMsRolling: 60000, completionRateRolling: 0.5 };
  ok(benchmarkIndicatorFor(60000, enough) === 'on_par', 'a real sample still compares');
  ok(benchmarkIndicatorFor(30000, enough) === 'faster', '…and still says faster');
  ok(benchmarkIndicatorFor(120000, enough) === 'slower', '…and still says slower');

  // It is the DURATION count that matters, not the run count: runs that measured
  // nothing were the thing that corrupted the median in the first place.
  const manyRunsFewMeasures = { count: 40, durationCount: 2, medianMsRolling: 60000, completionRateRolling: 0.1 };
  ok(benchmarkIndicatorFor(60000, manyRunsFewMeasures) === 'unknown',
    'forty runs that measured twice is still unknown');

  // Legacy documents have no durationCount and fall back to count, exactly as
  // mergeBenchmark does, so an existing healthy aggregate is not silenced.
  const legacy = { count: 40, medianMsRolling: 60000, completionRateRolling: 0.5 };
  ok(benchmarkIndicatorFor(60000, legacy) === 'on_par', 'legacy aggregate falls back to count');

  ok(benchmarkIndicatorFor(60000, null) === 'unknown', 'no aggregate at all is unknown');
  ok(MIN_BENCHMARK_DURATION_SAMPLES >= 10, 'the floor is declared and not trivially small');
}

console.log(failed === 0
  ? `\n✅ ALL BENCHMARK TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
