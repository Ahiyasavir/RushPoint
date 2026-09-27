// Guard: the locationless map/GPS suppression actually suppresses.
//
// `computeLocationRelevant` decides whether the participant screen runs a GPS
// `watchPosition` and draws the navigation map. It was written to turn both OFF
// for a game with no places in it — no dead map, no location permission prompt,
// and none of the `updateLocation` pings CLAUDE.md calls the highest-frequency
// write in the product.
//
// It stopped working without anyone touching it. The predicate treated a task
// record whose content was missing from the payload as "unknown, assume located":
//
//     if (!content) return true; // fail safe
//
// correct while the client received every active-stage task. Wave D
// (play-task-gating) then made the server ship content only for `assigned` and
// `completed` tasks, so an UNASSIGNED task has no content BY DESIGN. From that
// day on, any stage holding one unassigned task returned TRUE on the first
// iteration — which is essentially every stage of every game. Two correct
// changes cancelled each other and the feature became dead code that still read
// as healthy.
//
// Nothing could catch it: the predicate is total and never throws, both halves
// typecheck, and the failure is a map that appears when it should not — which
// looks like an ordinary map. It was found by playing the seeded all-locationless
// demo and seeing "the map will appear once the mission has a location" above a
// game that has no locations at all.
//
// So the case that matters most here is CASE 1: an active stage with an
// unassigned sibling task, which is what the old code got wrong.
//
//   npx tsx scripts/test-location-relevance.ts
import { computeLocationRelevant } from '../apps/play-web/src/lib/locationRelevance';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}${detail ? ' :: ' + detail : ''}`); }
}

type State = Parameters<typeof computeLocationRelevant>[0];

/** A minimal MyTeamState shaped like what getMyTeamState really returns. */
function state(opts: {
  records: { taskId: string; status: string }[];
  contents?: Record<string, unknown>[];
  pins?: unknown[];
  hotZone?: unknown;
}): State {
  return {
    team: { stages: [{ status: 'active', tasks: opts.records }] },
    run: { hotZone: opts.hotZone },
    activeStageTasks: opts.contents ?? [],
    completedTaskPins: opts.pins ?? [],
  } as unknown as State;
}

const LOCATIONLESS = (id: string) => ({ id, locationless: true });
const LOCATED = (id: string) => ({ id, coordinates: { lat: 31.77, lng: 35.21 } });

// ── CASE 1: the regression itself ────────────────────────────────────────────
// The player is on a locationless mission; a sibling task in the same stage is
// still unassigned, so the server shipped no content for it. That absence used
// to be read as "assume located" and turned the map and GPS on for the whole run.
ok(computeLocationRelevant(
  state({
    records: [{ taskId: 't1', status: 'assigned' }, { taskId: 't2', status: 'unassigned' }],
    contents: [LOCATIONLESS('t1')],
  }), [], false).relevant === false,
  'an unassigned sibling with no content does NOT make a locationless game located');

// The same shape, but the assigned mission really is at a place.
ok(computeLocationRelevant(
  state({
    records: [{ taskId: 't1', status: 'assigned' }, { taskId: 't2', status: 'unassigned' }],
    contents: [LOCATED('t1')],
  }), [], false).relevant === true,
  'the assigned mission having coordinates still turns location on');

// ── CASE 2: the seeded all-locationless demo, end to end ─────────────────────
ok(computeLocationRelevant(
  state({
    records: [
      { taskId: 'a', status: 'completed' },
      { taskId: 'b', status: 'assigned' },
      { taskId: 'c', status: 'unassigned' },
    ],
    contents: [LOCATIONLESS('a'), LOCATIONLESS('b')],
  }), [], false).relevant === false,
  'the all-locationless demo suppresses the map, the prompt and the pings');

// ── CASE 3: everything that must still force location ON ─────────────────────
ok(computeLocationRelevant(state({ records: [] }), [{ id: 'z' }] as never, false).relevant === true,
  'a territory zone forces location on');
ok(computeLocationRelevant(state({ records: [], hotZone: { id: 'h' } }), [], false).relevant === true,
  'an active hot zone forces location on');
ok(computeLocationRelevant(
  state({
    records: [{ taskId: 't1', status: 'assigned' }],
    contents: [{ id: 't1', arrivalPending: true }],
  }), [], false).relevant === true,
  'a sealed hidden mission awaiting a GPS arrival forces location on');
ok(computeLocationRelevant(
  state({ records: [{ taskId: 't1', status: 'assigned' }], contents: [LOCATIONLESS('t1')],
    pins: [{ id: 'done', coordinates: { lat: 1, lng: 2 }, title: 'x' }] }), [], false).relevant === true,
  'a trail of completed pins proves this game has places, even between missions');
ok(computeLocationRelevant(
  state({
    records: [{ taskId: 't1', status: 'assigned' }],
    contents: [{ id: 't1', smart: { stationCoords: { lat: 31.7, lng: 35.2 } } }],
  }), [], false).relevant === true,
  'a smart station’s coordinates count as located');
// A placed-but-unset pin is not a place.
ok(computeLocationRelevant(
  state({
    records: [{ taskId: 't1', status: 'assigned' }],
    contents: [{ id: 't1', coordinates: { lat: 0, lng: 0 } }],
  }), [], false).relevant === false,
  'null-island coordinates are not a location');

// ── CASE 4: stickiness ───────────────────────────────────────────────────────
// Between two missions the payload can hold no un-completed content at all.
// Re-judged fresh that reads as locationless, and the map would disappear and
// come back — a ~224px jump twice per mission.
const betweenMissions = state({
  records: [{ taskId: 't1', status: 'completed' }, { taskId: 't2', status: 'unassigned' }],
  contents: [LOCATED('t1')],
});
ok(computeLocationRelevant(betweenMissions, [], true).relevant === true,
  'a latched verdict survives the gap between two missions');
ok(computeLocationRelevant(state({ records: [], contents: [] }), [], true).relevant === true,
  'the latch holds even when a render sees nothing located at all');
ok(computeLocationRelevant(state({ records: [], contents: [] }), [], false).relevant === false,
  'without the latch, an empty payload is judged on its own merits');

// ── CASE 5: total and fail-safe ──────────────────────────────────────────────
ok(computeLocationRelevant(null, [], false).relevant === true,
  'state not loaded yet keeps the located behaviour');
ok(computeLocationRelevant({} as never, [], false).relevant === false,
  'an empty state object does not throw');
ok(computeLocationRelevant({ get team() { throw new Error('boom'); } } as never, [], false).relevant === true,
  'a throwing payload resolves toward located, never toward a crash');
ok(computeLocationRelevant(state({ records: [] }), undefined as never, false).relevant === false,
  'a missing zones array does not throw');

// ── CASE 6: the latch must never capture the pre-payload default ─────────────
// This is the mistake the FIRST attempt at this fix made, and it silently undid
// the whole change: the very first render happens before `getMyTeamState`
// resolves, the verdict is the safe TRUE, and latching that TRUE pinned every
// game ON forever — reproducing the original bug with brand new code. The suite
// stayed green; it was caught by reloading the running app and seeing the dead
// map still there. That is why `relevant` and `latch` are separate values, and
// why these assertions exist.
ok(computeLocationRelevant(null, [], false).latch === false,
  'the pre-payload default is NOT latched (an absence of data is not a place)');
ok(computeLocationRelevant({} as never, [], false).latch === false,
  'an empty payload is not latched');
ok(computeLocationRelevant({ get team() { throw new Error('boom'); } } as never, [], false).latch === false,
  'a throwing payload is not latched');
ok(computeLocationRelevant(
  state({ records: [{ taskId: 't1', status: 'assigned' }], contents: [LOCATED('t1')] }), [], false).latch === true,
  'an observed location DOES latch');
ok(computeLocationRelevant(
  state({ records: [{ taskId: 't1', status: 'assigned' }], contents: [LOCATIONLESS('t1')] }), [], false).latch === false,
  'an observed locationless game does not latch');

// The real render sequence a player actually produces: one render before the
// payload lands, then the locationless payload. It must end with GPS and map OFF.
{
  let latch = false;
  const first = computeLocationRelevant(null, [], latch);
  latch = first.latch;
  const second = computeLocationRelevant(
    state({
      records: [{ taskId: 't1', status: 'assigned' }, { taskId: 't2', status: 'unassigned' }],
      contents: [LOCATIONLESS('t1')],
    }), [], latch);
  ok(first.relevant === true && second.relevant === false,
    'loading -> locationless payload ends with the map and the GPS watcher OFF');
}

console.log(`\n${failed === 0 ? 'ALL LOCATION RELEVANCE TESTS PASSED' : 'LOCATION RELEVANCE TESTS FAILED'} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
