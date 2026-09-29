// Pure-logic tests for routeBlockers (change: route-team-to-mission).
//
// Field report 2026-09-27: the organizer wants to send a team to ANY mission, and — stated twice,
// with an example — only the conditions that actually block THAT jump may be waived: "if a mission
// opens after X and Y and they already did X, only 'Y not done' is waived; X is left alone".
// The old override was one boolean that waived release time, expiry and prerequisites together.
// routeBlockers is the exact list the organizer sees and confirms, and the server re-checks.
import { routeBlockers, type RouteBlockerInput } from '../packages/shared/src/routeBlockers';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

const NOW = Date.parse('2026-09-28T10:00:00.000Z');
const LAUNCHED = '2026-09-28T09:00:00.000Z';
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, type: 'self_report', coordinates: { lat: 31.78, lng: 35.21 }, maxConcurrentTeams: 3, ...extra,
});

function input(over: Partial<RouteBlockerInput> = {}): RouteBlockerInput {
  return {
    game: {
      stages: [
        { id: 's1', tasks: [task('x'), task('y'), task('z', { unlockAfterTaskIds: ['x', 'y'] }), task('w', { unlockAfterTaskIds: ['y'] })] },
        { id: 's2', tasks: [task('later')] },
      ],
    },
    team: {
      stages: [
        { stageId: 's1', status: 'active', tasks: [
          { taskId: 'x', status: 'completed' },
          { taskId: 'y', status: 'assigned' },
          { taskId: 'z', status: 'unassigned' },
          { taskId: 'w', status: 'unassigned' },
        ] },
        { stageId: 's2', status: 'locked', tasks: [{ taskId: 'later', status: 'unassigned' }] },
      ],
    },
    run: { status: 'live', launchedAt: LAUNCHED, taskCounts: {} },
    taskId: 'z',
    nowMs: NOW,
    ...over,
  } as RouteBlockerInput;
}
const kinds = (bs: { kind: string }[]) => bs.map((b) => b.kind);

console.log('\n— the X/Y example: only the MISSING prerequisite is listed —');
{
  const r = routeBlockers(input());
  eq('Z waits for X and Y; X is done ⇒ only Y is listed', r.waivable, [{ kind: 'prerequisites', missing: ['y'] }]);
  eq('nothing hard', r.hard, []);
}
{
  const r = routeBlockers(input({ taskId: 'x' }));
  eq('a done mission is a HARD blocker (use "send back")', kinds(r.hard), ['alreadyDone']);
}
{
  const r = routeBlockers(input({ taskId: 'y' }));
  eq('the mission it holds now is hard ("already current")', kinds(r.hard), ['alreadyCurrent']);
}
{
  const r = routeBlockers(input({ taskId: 'w' }));
  eq('W waits only for Y', r.waivable, [{ kind: 'prerequisites', missing: ['y'] }]);
}

console.log('\n— another stage, release, expiry, station —');
{
  const r = routeBlockers(input({ taskId: 'later' }));
  eq('a mission in another stage is waivable ("visit")', r.waivable, [{ kind: 'otherStage', stageId: 's2' }]);
}
{
  const base = input();
  (base.game.stages[0].tasks[2] as Record<string, unknown>).unlockAfterTaskIds = [];
  (base.game.stages[0].tasks[2] as Record<string, unknown>).releaseAt = '2026-09-28T11:00:00.000Z';
  eq('not released yet', kinds(routeBlockers(base).waivable), ['notReleased']);
}
{
  const base = input();
  (base.game.stages[0].tasks[2] as Record<string, unknown>).unlockAfterTaskIds = [];
  (base.game.stages[0].tasks[2] as Record<string, unknown>).expiresAfterMinutes = 30;
  eq('expired (30 min after a launch 60 min ago)', kinds(routeBlockers(base).waivable), ['expired']);
}
{
  const base = input({ run: { status: 'live', launchedAt: LAUNCHED, taskCounts: { z: 3 } } });
  eq('station full, with the numbers', routeBlockers(base).waivable,
    [{ kind: 'prerequisites', missing: ['y'] }, { kind: 'stationFull', count: 3, cap: 3 }]);
}
{
  const base = input({ run: { status: 'live', launchedAt: LAUNCHED, taskCounts: { z: 9 } } });
  (base.game.stages[0].tasks[2] as Record<string, unknown>).locationless = true;
  eq('a locationless mission has no station cap', kinds(routeBlockers(base).waivable), ['prerequisites']);
}

console.log('\n— hard blockers —');
eq('a mission closed for the run cannot be forced',
  kinds(routeBlockers(input({ run: { status: 'live', launchedAt: LAUNCHED, taskStatusOverrides: { z: 'closed' } } })).hard), ['missionClosed']);
eq('a paused mission cannot be forced either',
  kinds(routeBlockers(input({ run: { status: 'live', launchedAt: LAUNCHED, taskStatusOverrides: { z: 'paused' } } })).hard), ['missionClosed']);
eq('a paused team', kinds(routeBlockers(input({ team: { ...input().team, held: true } })).hard), ['teamHeld']);
eq('a removed team', kinds(routeBlockers(input({ team: { ...input().team, removed: true } })).hard), ['teamRemoved']);
eq('a finished run', kinds(routeBlockers(input({ run: { status: 'finished', launchedAt: LAUNCHED } })).hard), ['runFinished']);
eq('an unknown mission', kinds(routeBlockers(input({ taskId: 'nope' })).hard), ['unknownTask']);

console.log('\n— total and stable —');
eq('junk in ⇒ unknownTask, never a throw', kinds(routeBlockers(null as never).hard), ['unknownTask']);
eq('no team stages ⇒ still answers', kinds(routeBlockers(input({ team: {} as never })).hard), ['unknownTask']);
{
  const base = input({ taskId: 'later', run: { status: 'live', launchedAt: LAUNCHED, taskCounts: { later: 5 } } });
  (base.game.stages[1].tasks[0] as Record<string, unknown>).releaseAt = '2026-09-28T11:00:00.000Z';
  eq('fixed order: otherStage, notReleased, expired, prerequisites, stationFull',
    kinds(routeBlockers(base).waivable), ['otherStage', 'notReleased', 'stationFull']);
}

console.log('');
if (failures > 0) {
  console.error(`✗ route-blockers: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ route-blockers: all assertions passed\n');
