// Pure-logic tests for run-replay-vod (buildRunTimeline).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { buildRunTimeline } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const iso = (m: number) => new Date(2026, 0, 1, 12, m).toISOString();
const task = (completedAt: string | undefined, earnedScore: number, taskId = 't') => ({
  taskId, taskIndex: 0, status: completedAt ? 'completed' : 'assigned', completedAt, earnedScore,
});

// Two teams interleaved in time.
const teams = [
  { id: 'A', displayName: 'Alpha', startedAt: iso(0), finishedAt: iso(10),
    stages: [{ tasks: [task(iso(2), 10), task(iso(6), 20)] }] },
  { id: 'B', displayName: 'Bravo', startedAt: iso(1), finishedAt: iso(9),
    stages: [{ tasks: [task(iso(4), 15)] }] },
] as never[];

const r = buildRunTimeline(teams);

// Globally time-ordered.
const times = r.events.map((e) => e.t);
const sorted = [...times].sort();
ok(JSON.stringify(times) === JSON.stringify(sorted), 'events are globally time-ordered');

// Event composition: start+task+finish per team.
ok(r.events.filter((e) => e.type === 'start').length === 2, 'two start events');
ok(r.events.filter((e) => e.type === 'finish').length === 2, 'two finish events');
ok(r.events.filter((e) => e.type === 'task').length === 3, 'three task events');

// Cumulative score series correct for Alpha: 0 → 10 → 30 → 30(finish).
const aSeries = r.scoreSeries['A'].map((p) => p.score);
ok(JSON.stringify(aSeries) === JSON.stringify([0, 10, 30, 30]), `Alpha series cumulative (got ${JSON.stringify(aSeries)})`);
const bSeries = r.scoreSeries['B'].map((p) => p.score);
ok(JSON.stringify(bSeries) === JSON.stringify([0, 15, 15]), `Bravo series cumulative (got ${JSON.stringify(bSeries)})`);

// The last task event for Alpha carries the cumulative 30.
const aLastTask = [...r.events].reverse().find((e) => e.teamId === 'A' && e.type === 'task');
ok(aLastTask?.cumulativeScore === 30, 'task event carries cumulative score');

// Pruned team (no startedAt) is omitted without error.
const withPruned = buildRunTimeline([
  ...teams,
  { id: 'C', displayName: 'Pruned', startedAt: undefined, finishedAt: undefined, stages: [] },
] as never[]);
ok(!withPruned.teams.some((t) => t.teamId === 'C'), 'pruned team omitted');
ok(withPruned.scoreSeries['C'] === undefined, 'pruned team has no series');

// Empty run → empty timeline.
const empty = buildRunTimeline([]);
ok(empty.events.length === 0 && empty.teams.length === 0, 'empty run → empty timeline');

// A team that started but never finished still appears (no finish event).
const ongoing = buildRunTimeline([
  { id: 'D', displayName: 'Delta', startedAt: iso(0), finishedAt: undefined, stages: [{ tasks: [task(iso(3), 5)] }] },
] as never[]);
ok(ongoing.events.filter((e) => e.type === 'finish').length === 0, 'ongoing team has no finish event');
ok(ongoing.scoreSeries['D'].at(-1)?.score === 5, 'ongoing team series ends at last task score');

console.log(failed === 0
  ? `\n✅ ALL RUN-REPLAY TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
