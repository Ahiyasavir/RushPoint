// Pure-logic tests for buildCompletedPins() — the SAFE channel that lets the play
// map plot the trail of missions a team has ALREADY COMPLETED (change:
// hidden-mission-map). Run by scripts/run-unit-tests.mjs via `npm test`. No emulator.
//
// The security-critical invariant under test: this helper can ONLY emit a pin for
// a task whose team-record status === 'completed'. A hidden-not-yet-arrived task,
// an unassigned task, or the active sealed target must be structurally incapable
// of appearing — its coordinates never reach the wire through this channel.
import { buildCompletedPins } from '../functions/src/runs/completedPins';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const C = (lat: number, lng: number) => ({ lat, lng });

// A rich game: two located tasks, one hidden located task, one locationless task,
// and one with an unset (0,0) coord.
const gameTasks = [
  { id: 't-done',    title: 'Done Spot',   coordinates: C(31.77, 35.21) },
  { id: 't-hidden',  title: 'Hidden Spot', coordinates: C(31.78, 35.22), locationless: false },
  { id: 't-active',  title: 'Active Spot', coordinates: C(31.79, 35.23) },
  { id: 't-unassigned', title: 'Later Spot', coordinates: C(31.80, 35.24) },
  { id: 't-nowhere', title: 'General',     coordinates: C(0, 0), locationless: true },
  { id: 't-zero',    title: 'Zero',        coordinates: C(0, 0) },
  { id: 't-station', title: 'Station',     coordinates: C(0, 0), smart: { stationCoords: C(31.81, 35.25) } },
];

// The team: t-done + t-hidden + t-station completed; t-active assigned (sealed
// hidden target, say); t-unassigned still unassigned; t-nowhere completed locationless.
const teamStages = [
  { tasks: [
    { taskId: 't-done',       status: 'completed' },
    { taskId: 't-active',     status: 'assigned' },
    { taskId: 't-unassigned', status: 'unassigned' },
  ] },
  { tasks: [
    { taskId: 't-hidden',  status: 'completed' },
    { taskId: 't-nowhere', status: 'completed' },
    { taskId: 't-station', status: 'completed' },
    { taskId: 't-zero',    status: 'completed' },
  ] },
];

const pins = buildCompletedPins(teamStages, gameTasks);
const ids = pins.map((p) => p.id).sort();

// Only completed, plottable tasks appear.
ok(ids.join() === ['t-done', 't-hidden', 't-station'].sort().join(),
  `only completed+plottable tasks pinned (got ${ids.join()})`);

// The assigned SEALED active target is EXCLUDED — its coords never leave via this channel.
ok(!ids.includes('t-active'), 'assigned sealed active target is EXCLUDED');
// An unassigned task is EXCLUDED.
ok(!ids.includes('t-unassigned'), 'unassigned task is EXCLUDED');
// A completed LOCATIONLESS task is omitted (nothing to pin).
ok(!ids.includes('t-nowhere'), 'completed locationless task is omitted');
// A completed task at the (0,0) unset sentinel is omitted.
ok(!ids.includes('t-zero'), 'completed (0,0) task is omitted');

// coords + title come from the GAME task (not the team record).
const done = pins.find((p) => p.id === 't-done')!;
ok(done.coordinates.lat === 31.77 && done.coordinates.lng === 35.21, 'coords sourced from game task');
ok(done.title === 'Done Spot', 'title sourced from game task');

// A smart station's stationCoords win over the (0,0) top-level coordinate.
const station = pins.find((p) => p.id === 't-station')!;
ok(station.coordinates.lat === 31.81 && station.coordinates.lng === 35.25,
  'smart stationCoords used for the pin');

// A HIDDEN task that has NOT been arrived at (status 'assigned', not 'completed')
// must never pin, even though its coords exist in the game — the definitive
// wave-D leak check for this channel.
{
  const p = buildCompletedPins(
    [{ tasks: [{ taskId: 't-hidden', status: 'assigned' }] }],
    gameTasks,
  );
  ok(p.length === 0, 'hidden task not-yet-completed → no pin (leak-safe)');
}

// Empty / undefined inputs → empty result, never a throw.
ok(buildCompletedPins([], gameTasks).length === 0, 'no completed records → empty');
ok(buildCompletedPins(undefined, undefined).length === 0, 'undefined inputs → empty (no throw)');

// A completed task whose game task no longer exists is skipped.
ok(buildCompletedPins([{ tasks: [{ taskId: 'ghost', status: 'completed' }] }], gameTasks).length === 0,
  'completed record with no matching game task → skipped');

console.log(failed === 0
  ? `\n✅ ALL COMPLETED-PINS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
