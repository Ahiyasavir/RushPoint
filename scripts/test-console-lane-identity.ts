// Issue 52, second half (7.10 re-check in a real browser): the console's live map still threw away
// the organizer's zoom when a team JOINED. `PanelLanes` keyed each lane by its contents
// (`lane.join('|')`), so a panel appearing or leaving in a lane (a team joins → "start teams"
// shows up) gave the lane a new key and React REMOUNTED every panel in it: a fresh map, framed
// again, and the zoom, a half-typed chat reply or an open popup were gone. Measured: the map's DOM
// element was replaced and the spread between two teams went from 427 px (zoomed in) back to 140.
// The rule: a lane is keyed by its POSITION; a panel inside it by its id.
//   npx tsx scripts/test-console-lane-identity.ts
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../apps/creator-web/src/pages/RunConsolePage.tsx', import.meta.url), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const start = src.indexOf('function PanelLanes(');
const body = start >= 0 ? src.slice(start, src.indexOf('\n}\n', start)) : '';
check('PanelLanes exists', body.length > 0);
const laneKey = /layout\.columns\.map\(\(lane, i\) => \(\s*<div key=\{([^}]*)\}/.exec(body);
check('a lane has a key', !!laneKey, laneKey ? `key={${laneKey[1]}}` : 'not found');
check('the lane key does NOT depend on which panels it holds',
  !!laneKey && !/lane/.test(laneKey[1]), laneKey ? `key={${laneKey[1]}}` : '');
check('a panel inside a lane is keyed by its id', /lane\.map\(\(panel\) => \(\s*<div\s+key=\{panel\}/.test(body));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-console-lane-identity)`);
process.exit(failures === 0 ? 0 : 1);
