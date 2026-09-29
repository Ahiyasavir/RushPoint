// The staff app's "send to a mission" list (change: route-team-to-mission, staff half).
//
// The staff app cannot read the game, so it cannot compute blockers; it lists EVERY mission of the
// run from the outline, marks the two states it can know from the team document alone (done,
// current), and asks the server (forceAssignTask dryRun) about the rest. Pure and total.
import { staffRouteList, staffLetInTarget } from '../apps/play-web/src/lib/staffRouteList';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

const outline = [
  { id: 's1', title: 'One', tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] },
  { id: 's2', title: 'Two', tasks: [{ id: 'd', title: 'D' }] },
];
const team = {
  activeTaskId: 'b',
  stages: [
    { stageId: 's1', status: 'active', tasks: [{ taskId: 'a', status: 'completed' }, { taskId: 'b', status: 'assigned' }, { taskId: 'c', status: 'unassigned' }] },
    { stageId: 's2', status: 'locked', tasks: [{ taskId: 'd', status: 'unassigned' }] },
  ],
};

const list = staffRouteList(outline, team);
const flat = list.flatMap((s) => s.missions);
check('every mission of every stage is listed, in order', flat.map((m) => m.taskId).join() === 'a,b,c,d', flat.map((m) => m.taskId).join());
check('a completed mission is done, not selectable', flat[0].state === 'done' && !flat[0].selectable);
check('the current mission is current, not selectable', flat[1].state === 'current' && !flat[1].selectable);
check('an unassigned mission in the active stage is selectable', flat[2].state === 'open' && flat[2].selectable);
check('a mission in a LATER stage is selectable too (the server names the waiver)', flat[3].state === 'open' && flat[3].selectable);
check('stage titles come from the outline', list[1].title === 'Two');

const skipped = staffRouteList(outline, { stages: [{ stageId: 's1', status: 'active', tasks: [{ taskId: 'a', status: 'skipped' }] }] });
check('a skipped mission counts as done', skipped[0].missions[0].state === 'done');
check('a mission the team has no record of is not offered',
  skipped[0].missions.find((m) => m.taskId === 'b')?.selectable === false);

check('busy = the team holds a mission', staffRouteList.teamBusy(team) === true && staffRouteList.teamBusy({}) === false);

// Total: garbage never throws.
for (const bad of [null, undefined, 7, 'x', [{}], [{ id: 's', tasks: 'nope' }]] as unknown[]) {
  let ok = true;
  try { staffRouteList(bad as never, bad as never); } catch { ok = false; }
  check(`total on ${JSON.stringify(bad)}`, ok);
}

// "Let them in" (located-mission-arrival, staff half): offered only when it would change something.
const locOutline = { arrivalGate: true, stages: [{ id: 's1', title: 'One', tasks: [
  { id: 'loc', title: 'Plaque', spot: { lat: 31.7, lng: 35.2 } },
  { id: 'hid', title: 'Hidden', spot: { lat: 31.7, lng: 35.2, hidden: true } },
  { id: 'free', title: 'Anywhere' },
] }] };
const on = (taskId: string, arrivedAt?: string) => ({
  activeTaskId: taskId,
  stages: [{ stageId: 's1', status: 'active', tasks: [{ taskId, status: 'assigned', ...(arrivedAt ? { arrivedAt } : {}) }] }],
});
check('let in: a located mission not yet arrived at', staffLetInTarget(locOutline, on('loc')) === 'loc');
check('let in: a hidden mission (it has a spot) too', staffLetInTarget(locOutline, on('hid')) === 'hid');
check('let in: not once arrived', staffLetInTarget(locOutline, on('loc', '2026-09-28T10:00:00Z')) === null);
check('let in: not for a mission with no location', staffLetInTarget(locOutline, on('free')) === null);
check('let in: not when the run has no arrival gate', staffLetInTarget({ ...locOutline, arrivalGate: false }, on('loc')) === null);
check('let in: not between missions', staffLetInTarget(locOutline, { stages: [] }) === null);
for (const bad of [null, undefined, 3, {}] as unknown[]) {
  let ok = true;
  try { if (staffLetInTarget(bad as never, bad as never) !== null) ok = false; } catch { ok = false; }
  check(`let in: total and null on ${JSON.stringify(bad)}`, ok);
}

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
