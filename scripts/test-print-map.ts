// A real street map on the printed host sheet (change: host-sheet-street-map).
//
// The sheet used to draw numbered dots on white, because a live WebGL map often
// prints blank. Plain tile <img>s laid out at fixed positions print like any
// picture, so the layout (zoom, tiles, marker positions) is computed here, pure,
// and the page only places what this returns.
import { mergeMarkers, printMapLayout, printTileUrl, PRINT_MAP_MAX_PX, type PrintMapPoint } from '../apps/creator-web/src/lib/printMap';

let failures = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`); }
};

console.log('\nprint map');

// Three stations across a Jerusalem neighbourhood, a few hundred metres apart.
const pts: PrintMapPoint[] = [
  { number: 1, stage: 1, lat: 31.7767, lng: 35.2345 },
  { number: 2, stage: 1, lat: 31.7790, lng: 35.2300 },
  { number: 3, stage: 2, lat: 31.7745, lng: 35.2290 },
];
const m = printMapLayout(pts);
ok('a layout is returned for real points', m !== null);
if (m) {
  ok(`the frame never exceeds ${PRINT_MAP_MAX_PX}px (${m.widthPx}x${m.heightPx})`, m.widthPx <= PRINT_MAP_MAX_PX && m.heightPx <= PRINT_MAP_MAX_PX && m.widthPx > 0 && m.heightPx > 0);
  ok('a marker per point, numbers kept', m.markers.length === 3 && m.markers.map((k) => k.number).join() === '1,2,3');
  const inside = m.markers.every((k) => k.x > 0 && k.x < 1 && k.y > 0 && k.y < 1);
  ok('every marker lies inside the frame', inside, m.markers);
  ok('street level, not a country view (zoom >= 14)', m.zoom >= 14, m.zoom);
  ok('the largest zoom that fits: one more level would not', printMapLayout(pts, { maxZoom: m.zoom + 1 })?.zoom === m.zoom
    && (() => { const z1 = printMapLayout(pts, { minZoom: m.zoom + 1, maxZoom: m.zoom + 1 }); return z1 === null; })());
  // North up: station 2 is the northernmost, so it has the smallest y.
  const byNum = new Map(m.markers.map((k) => [k.number, k]));
  ok('north is up', byNum.get(2)!.y < byNum.get(1)!.y && byNum.get(2)!.y < byNum.get(3)!.y);
  ok('east is right', byNum.get(1)!.x > byNum.get(3)!.x);
  // Tiles cover the whole frame with no gap: the union of tile rects spans [0,1] on both axes.
  const left = Math.min(...m.tiles.map((t) => t.left));
  const top = Math.min(...m.tiles.map((t) => t.top));
  const right = Math.max(...m.tiles.map((t) => t.left + t.w));
  const bottom = Math.max(...m.tiles.map((t) => t.top + t.h));
  ok('the tiles cover the frame', left <= 0 && top <= 0 && right >= 1 && bottom >= 1, { left, top, right, bottom, n: m.tiles.length });
  const cols = new Set(m.tiles.map((t) => t.left)).size;
  const rows = new Set(m.tiles.map((t) => t.top)).size;
  ok(`the tiles form a full grid (${cols}x${rows} = ${m.tiles.length})`, cols * rows === m.tiles.length);
  ok('every tile is at the chosen zoom', m.tiles.every((t) => t.z === m.zoom));
}

const one = printMapLayout([{ number: 1, stage: 1, lat: 31.77, lng: 35.23 }]);
ok('one station: zoom 16, centred', one !== null && one.zoom === 16 && Math.abs(one.markers[0].x - 0.5) < 1e-9 && Math.abs(one.markers[0].y - 0.5) < 1e-9, one && { z: one.zoom, m: one.markers[0] });
const same = printMapLayout([{ number: 1, stage: 1, lat: 31.77, lng: 35.23 }, { number: 2, stage: 1, lat: 31.77, lng: 35.23 }]);
ok('stations at one spot behave as one', same !== null && same.zoom === 16);

const far = printMapLayout([{ number: 1, stage: 1, lat: 29.55, lng: 34.95 }, { number: 2, stage: 1, lat: 33.0, lng: 35.5 }]);
ok('a country-wide game still fits, at a low zoom', far !== null && far.zoom >= 3 && far.zoom <= 9 && far.markers.every((k) => k.x > 0 && k.x < 1 && k.y > 0 && k.y < 1), far && far.zoom);

ok('no points ⇒ no map', printMapLayout([]) === null);
let threw = false;
try {
  ok('junk points are skipped', printMapLayout([{ number: 1, stage: 1, lat: NaN, lng: 35 }, null as never, { number: 2, stage: 1, lat: 95, lng: 0 }]) === null);
  printMapLayout(null as never); printMapLayout(undefined as never);
} catch { threw = true; }
ok('total on junk', !threw);

// Missions that share a spot (a station with several missions) would hide one
// another's numbers, so markers closer than a marker's own size become one label.
const mk = (number: number, x: number, y: number, stage = 1) => ({ number, stage, x, y });
const merged = mergeMarkers([mk(5, 0.5, 0.5), mk(4, 0.5, 0.5), mk(6, 0.5005, 0.5), mk(1, 0.1, 0.1), mk(9, 0.9, 0.9)], 680, 480);
ok('markers at one spot become one label, numbers in order', merged.some((g) => g.numbers.join() === '4,5,6'), merged);
ok('markers apart stay apart', merged.length === 3 && merged.some((g) => g.numbers.join() === '1') && merged.some((g) => g.numbers.join() === '9'), merged);
ok('no number is lost or doubled', merged.flatMap((g) => g.numbers).sort((a, b) => a - b).join() === '1,4,5,6,9');
ok('merge is total on junk', mergeMarkers(null as never, 0, 0).length === 0);

// Tile URLs.
ok('with a key: MapTiler streets', printTileUrl(15, 19598, 13300, 'KEY') === 'https://api.maptiler.com/maps/streets-v2/256/15/19598/13300.png?key=KEY');
ok('without a key: OpenTopoMap', /^https:\/\/[abc]\.tile\.opentopomap\.org\/15\/19598\/13300\.png$/.test(printTileUrl(15, 19598, 13300, '')));
ok('x wraps around the world', printTileUrl(2, 5, 1, 'K').includes('/2/1/1.png') && printTileUrl(2, -1, 1, 'K').includes('/2/3/1.png'));
ok('a blank key counts as none', printTileUrl(3, 1, 1, '   ').includes('opentopomap'));

console.log(failures === 0 ? '\n✅ print map: ALL PASS' : `\n❌ print map: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
