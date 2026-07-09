// Pure-logic tests for run-analytics-heatmap (computeRunAnalytics).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { computeRunAnalytics, compareToPlatformMedian } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const rec = (taskId: string, status: string, actualMinutes?: number) => ({ taskId, taskIndex: 0, status, actualMinutes });
const team = (id: string, recs: ReturnType<typeof rec>[], hints: string[] = []) => ({
  id, displayName: id, stages: [{ tasks: recs }], taskHintsUsed: hints,
});

const gameTasks = [{ id: 't1', type: 'field' }, { id: 't2', type: 'quiz' }];

// 3 teams: t1 completed by all (1,2,3 min); t2 completed by 2, skipped by 1; one hint on t1.
const teams = [
  team('A', [rec('t1', 'completed', 1), rec('t2', 'completed', 2)], ['t1']),
  team('B', [rec('t1', 'completed', 2), rec('t2', 'completed', 4)]),
  team('C', [rec('t1', 'completed', 3), rec('t2', 'skipped')]),
] as never[];

const r = computeRunAnalytics(teams, gameTasks);
ok(r.teamCount === 3, 'team count');
const t1 = r.tasks.find((t) => t.taskId === 't1')!;
const t2 = r.tasks.find((t) => t.taskId === 't2')!;
ok(t1.attempts === 3 && t1.completions === 3, 't1 attempts/completions');
ok(t1.completionRate === 1, 't1 completion rate 100%');
ok(t1.medianMs === 2 * 60_000, `t1 median (got ${t1.medianMs})`);
ok(t1.hintCount === 1, 't1 hint count');
ok(t2.completions === 2 && t2.skips === 1, 't2 completions + skips');
ok(Math.abs(t2.completionRate - 2 / 3) < 1e-9, 't2 completion rate 2/3');
ok(r.tasks[0].taskId === 't1' && r.tasks[1].taskId === 't2', 'output order follows gameTasks (deterministic)');

// Order independence: shuffle teams → same result.
const shuffled = computeRunAnalytics([teams[2], teams[0], teams[1]] as never[], gameTasks);
ok(JSON.stringify(shuffled) === JSON.stringify(r), 'deterministic regardless of team order');

// p90 over 1..10 min completions = 9 min.
const many = Array.from({ length: 10 }, (_, i) => team(`T${i}`, [rec('t1', 'completed', i + 1)])) as never[];
const rp = computeRunAnalytics(many, [{ id: 't1', type: 'field' }]);
ok(rp.tasks[0].p90Ms === 9 * 60_000, `p90 nearest-rank (got ${rp.tasks[0].p90Ms})`);

// Prune-safe: a team with cleared stages contributes nothing, no crash.
const pruned = computeRunAnalytics([{ id: 'P', displayName: 'P', stages: [], taskHintsUsed: [] }] as never[], gameTasks);
ok(pruned.tasks[0].attempts === 0 && pruned.tasks[0].completionRate === 0, 'pruned team → 0, no crash');
ok(pruned.overallCompletionRate === 0, 'no attempts → 0 overall');

// Empty.
const empty = computeRunAnalytics([], gameTasks);
ok(empty.teamCount === 0 && empty.tasks.length === 2, 'empty teams → zeroed per-task rows');

// compareToPlatformMedian delegates to the benchmark indicator.
ok(compareToPlatformMedian(80, 100) === 'faster', 'compare → faster');
ok(compareToPlatformMedian(120, 100) === 'slower', 'compare → slower');
ok(compareToPlatformMedian(100, null) === 'unknown', 'no platform median → unknown');

console.log(failed === 0
  ? `\n✅ ALL RUN-ANALYTICS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
