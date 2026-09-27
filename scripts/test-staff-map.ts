// The staff event map (change: staff-event-map). Pure decisions: how old a team's last position
// is, when a dot counts as stale, and which missions go on the map. Total, never a throw.
//   npx tsx scripts/test-staff-map.ts
import { locationAge, missionSpots, STALE_LOCATION_MS } from '../apps/play-web/src/lib/staffMap';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const now = Date.parse('2026-09-27T10:00:00Z');
check('age in whole minutes, fresh', JSON.stringify(locationAge('2026-09-27T09:57:30Z', now)) === JSON.stringify({ minutes: 2, stale: false }));
check('stale after five minutes', locationAge(new Date(now - STALE_LOCATION_MS - 1).toISOString(), now).stale === true
  && locationAge(new Date(now - STALE_LOCATION_MS + 1000).toISOString(), now).stale === false);
check('unknown or unreadable time: stale, minutes null',
  [undefined, null, '', 'soon', 42].every((v) => { const a = locationAge(v as never, now); return a.stale && a.minutes === null; }));
check('a time in the future (a clock ahead) reads as just now', JSON.stringify(locationAge('2026-09-27T10:02:00Z', now)) === JSON.stringify({ minutes: 0, stale: false }));

const outline = { stages: [
  { id: 's1', title: 'A', tasks: [
    { id: 'a', title: 'Gate', spot: { lat: 31.77, lng: 35.23 } },
    { id: 'b', title: 'Secret', spot: { lat: 31.78, lng: 35.22, hidden: true } },
    { id: 'c', title: 'Anywhere' },
    { id: 'd', title: 'Broken', spot: { lat: 999, lng: 35 } },
    { id: 'e', title: 'Null island', spot: { lat: 0, lng: 0 } },
  ] },
  { id: 's2', title: 'B', tasks: [{ id: 'f', title: 'Bridge', spot: { lat: 31.76, lng: 35.21 } }] },
] };
const spots = missionSpots(outline as never);
check('only real spots, in stage order, with stage number and hidden flag',
  JSON.stringify(spots) === JSON.stringify([
    { id: 'a', title: 'Gate', lat: 31.77, lng: 35.23, hidden: false, stage: 1 },
    { id: 'b', title: 'Secret', lat: 31.78, lng: 35.22, hidden: true, stage: 1 },
    { id: 'f', title: 'Bridge', lat: 31.76, lng: 35.21, hidden: false, stage: 2 },
  ]), JSON.stringify(spots));
check('no outline or a malformed one: no spots', missionSpots(null).length === 0 && missionSpots({ stages: 'x' } as never).length === 0);

console.log(`\n${failures === 0 ? 'ALL STAFF-MAP TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
