// Unit test for the static-map projection (the "You Are Here" overlay math).
// Run: npx tsx scripts/test-projection.ts
import {
  fitRouteView,
  projectToPixel,
  ROUTE_PATH,
  RACE_START,
  RACE_FINISH,
} from '../packages/shared/src/geo';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const W = 640, H = 420;
const view = fitRouteView(W, H);

// 1. View frames the route at a sane Jerusalem-area zoom.
check('zoom is in a sane range for a ~3km route', view.zoom > 11 && view.zoom < 17, `zoom=${view.zoom.toFixed(2)}`);
check('center near the route midpoint', Math.abs(view.centerLat - 31.803) < 0.02 && Math.abs(view.centerLng - 35.176) < 0.02,
  `center=${view.centerLat.toFixed(4)},${view.centerLng.toFixed(4)}`);

// 2. Every route point projects INSIDE the image frame (with padding).
let allIn = true;
for (const p of ROUTE_PATH) {
  const pr = projectToPixel(p.lat, p.lng, W, H, view);
  if (!pr.inBounds) allIn = false;
}
check('all route points fall inside the framed image', allIn);

// 3. Start projects left-of-center & lower; finish right-of-center & higher
//    (the route climbs NE: lng increases, lat increases → screen x↑, y↓).
const start = projectToPixel(RACE_START.lat, RACE_START.lng, W, H, view);
const finish = projectToPixel(RACE_FINISH.lat, RACE_FINISH.lng, W, H, view);
check('start is left of finish (west)', start.leftPct < finish.leftPct, `start.x=${start.leftPct.toFixed(1)} finish.x=${finish.leftPct.toFixed(1)}`);
check('start is below finish on screen (south → larger topPct)', start.topPct > finish.topPct, `start.y=${start.topPct.toFixed(1)} finish.y=${finish.topPct.toFixed(1)}`);

// 4. Center of the view maps to ~50%/50%.
const mid = projectToPixel(view.centerLat, view.centerLng, W, H, view);
check('view center maps to image center (~50%,50%)', Math.abs(mid.leftPct - 50) < 0.5 && Math.abs(mid.topPct - 50) < 0.5,
  `center=${mid.leftPct.toFixed(2)},${mid.topPct.toFixed(2)}`);

// 5. A point far outside the area is flagged out-of-bounds (no misleading dot).
const farAway = projectToPixel(32.08, 34.78, W, H, view); // Tel Aviv
check('far-away point is out of bounds', !farAway.inBounds, `tlv=${farAway.leftPct.toFixed(0)},${farAway.topPct.toFixed(0)}`);

console.log(`\n${failures === 0 ? 'ALL PROJECTION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
