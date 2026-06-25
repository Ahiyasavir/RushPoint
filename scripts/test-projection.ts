// Unit test for the static-map projection (the "You Are Here" overlay math) and
// the generic bounds-fitting used by every map view. No hardcoded event geography
// — points are passed in, mirroring the v2 model (geography lives in the game
// template, not in geo.ts). Run: npx tsx scripts/test-projection.ts
import {
  fitBoundsView,
  projectToPixel,
  type GeoPoint,
} from '../packages/shared/src/geo';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const W = 640, H = 420;

// A generic ~3 km route climbing NE (lng↑, lat↑), Jerusalem-area scale.
const ROUTE: GeoPoint[] = [
  { lat: 31.7926, lng: 35.1656 }, // start (SW)
  { lat: 31.7975, lng: 35.1721 },
  { lat: 31.8011, lng: 35.1798 }, // midpoint
  { lat: 31.8052, lng: 35.1875 },
  { lat: 31.8089, lng: 35.1938 }, // finish (NE)
];
const START = ROUTE[0];
const FINISH = ROUTE[ROUTE.length - 1];

const view = fitBoundsView(W, H, ROUTE);

// 1. View frames a ~3 km route at a sane city-scale zoom.
check('zoom is in a sane range for a ~3km route', view.zoom > 11 && view.zoom < 17, `zoom=${view.zoom.toFixed(2)}`);
// 1b. Tile-size convention guard: MapTiler tiles are 512px. A regression to the
//     256px convention would push the fit-zoom ~1 level higher, rendering 2× too
//     zoomed-in and cropping the route. The < 14.5 bound separates the two.
check('fit zoom matches MapTiler 512px tile convention (not 256px)', view.zoom < 14.5, `zoom=${view.zoom.toFixed(2)}`);
check('center near the route midpoint', Math.abs(view.centerLat - 31.8008) < 0.02 && Math.abs(view.centerLng - 35.1797) < 0.02,
  `center=${view.centerLat.toFixed(4)},${view.centerLng.toFixed(4)}`);

// 2. Every route point projects INSIDE the image frame (with padding).
let allIn = true;
for (const p of ROUTE) {
  const pr = projectToPixel(p.lat, p.lng, W, H, view);
  if (!pr.inBounds) allIn = false;
}
check('all route points fall inside the framed image', allIn);

// 3. Start projects left-of-center & lower; finish right-of-center & higher
//    (the route climbs NE: lng increases, lat increases → screen x↑, y↓).
const start = projectToPixel(START.lat, START.lng, W, H, view);
const finish = projectToPixel(FINISH.lat, FINISH.lng, W, H, view);
check('start is left of finish (west)', start.leftPct < finish.leftPct, `start.x=${start.leftPct.toFixed(1)} finish.x=${finish.leftPct.toFixed(1)}`);
check('start is below finish on screen (south → larger topPct)', start.topPct > finish.topPct, `start.y=${start.topPct.toFixed(1)} finish.y=${finish.topPct.toFixed(1)}`);

// 4. Center of the view maps to ~50%/50%.
const mid = projectToPixel(view.centerLat, view.centerLng, W, H, view);
check('view center maps to image center (~50%,50%)', Math.abs(mid.leftPct - 50) < 0.5 && Math.abs(mid.topPct - 50) < 0.5,
  `center=${mid.leftPct.toFixed(2)},${mid.topPct.toFixed(2)}`);

// 5. A point far outside the area is flagged out-of-bounds (no misleading dot).
const farAway = projectToPixel(32.08, 34.78, W, H, view); // Tel Aviv
check('far-away point is out of bounds', !farAway.inBounds, `tlv=${farAway.leftPct.toFixed(0)},${farAway.topPct.toFixed(0)}`);

// 6. Empty input degrades gracefully (no throw, world view).
{
  let threw = false;
  let v;
  try { v = fitBoundsView(W, H, []); } catch { threw = true; }
  check('empty points → no throw, world-scale view', !threw && v?.zoom === 2, `zoom=${v?.zoom}`);
}

console.log(`\n${failures === 0 ? 'ALL PROJECTION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
