// Pure-logic tests — the sealed hidden-mission SEARCH AREA
// (change: hidden-mission-search-area).
//
// A hidden-location ("treasure hunt") task used to ship the player NOTHING
// locational at all, so the map was blank for the one mission type that is
// entirely about walking somewhere. It now ships a coarse search CIRCLE, and the
// whole safety of that decision rests on three arithmetic properties, all pinned
// here:
//
//   1. CONTAINMENT   — the real spot is always inside the circle, at any latitude.
//                      (Otherwise the circle is a lie that sends players away.)
//   2. DETERMINISM   — the circle is a pure function of the input, so polling
//                      getMyTeamState 1000 times learns exactly what one read
//                      learns. Random jitter would average down to the exact spot.
//   3. NON-INVERSION — two distinct spots in one cell produce the SAME circle, so
//                      the circle cannot be turned back into a point.
//
// The client half (which circles the map may draw) is asserted in the same file
// because the guarantee spans the wire: a total, never-throwing selector that
// drops anything malformed rather than drawing a continent-sized circle.
//
//   npx tsx scripts/test-hidden-search-area.ts
import {
  hiddenSearchArea,
  HIDDEN_SEARCH_CELL_DEG,
  HIDDEN_SEARCH_RADIUS_M,
} from '../packages/shared/src/hiddenSearchArea';
import { haversineKm } from '../packages/shared/src/geo';
import {
  selectSearchAreas,
  SEARCH_AREA_MIN_RADIUS_M,
  SEARCH_AREA_MAX_RADIUS_M,
} from '../apps/play-web/src/lib/searchAreas';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
function noThrow(label: string, fn: () => unknown): unknown {
  try {
    const v = fn();
    ok(label, true);
    return v;
  } catch (e) {
    failures++;
    console.error(`  ✗ ${label} — threw ${String(e)}`);
    return undefined;
  }
}

/** Deterministic LCG so the sweep is reproducible across machines and runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─── 1. The derivation ───────────────────────────────────────────────────────
console.log('\nhiddenSearchArea — the server-side derivation');

const placed = { hideLocation: true, coordinates: { lat: 31.7767, lng: 35.2345 } };

{
  const a = hiddenSearchArea(placed);
  ok('a placed hidden task yields an area', !!a);
  ok('the centre is NOT the authored latitude', a!.lat !== placed.coordinates.lat);
  ok('the centre is NOT the authored longitude', a!.lng !== placed.coordinates.lng);
  eq('the radius is the documented constant', a!.radiusMeters, HIDDEN_SEARCH_RADIUS_M);
  // On the grid: (value - halfCell) is an integer multiple of the cell.
  const half = HIDDEN_SEARCH_CELL_DEG / 2;
  const onGrid = (v: number) => {
    const k = (v - half) / HIDDEN_SEARCH_CELL_DEG;
    return Math.abs(k - Math.round(k)) < 1e-6;
  };
  ok('the centre latitude sits on the global grid', onGrid(a!.lat));
  ok('the centre longitude sits on the global grid', onGrid(a!.lng));
}

{
  // CONTAINMENT — the property the whole feature rests on.
  const rnd = lcg(20260723);
  let worst = 0;
  let breaches = 0;
  for (let i = 0; i < 2000; i++) {
    const lat = -80 + rnd() * 160;
    const lng = -179 + rnd() * 358;
    const a = hiddenSearchArea({ hideLocation: true, coordinates: { lat, lng } });
    if (!a) { breaches++; continue; }
    const d = haversineKm({ lat: a.lat, lng: a.lng }, { lat, lng }) * 1000;
    if (d > worst) worst = d;
    if (d > a.radiusMeters) breaches++;
  }
  eq('2000 seeded coordinates: zero containment breaches', breaches, 0);
  ok(`worst observed offset ${worst.toFixed(1)}m is within the ${HIDDEN_SEARCH_RADIUS_M}m radius`,
    worst <= HIDDEN_SEARCH_RADIUS_M);
}

{
  // DETERMINISM — the anti-averaging property.
  const first = JSON.stringify(hiddenSearchArea(placed));
  let stable = true;
  for (let i = 0; i < 50; i++) {
    if (JSON.stringify(hiddenSearchArea(placed)) !== first) stable = false;
  }
  ok('50 repeated derivations are byte-identical', stable);
}

{
  // NON-INVERSION — two distinct points in one cell collapse to one circle.
  const p1 = hiddenSearchArea({ hideLocation: true, coordinates: { lat: 31.7761, lng: 35.2341 } });
  const p2 = hiddenSearchArea({ hideLocation: true, coordinates: { lat: 31.7769, lng: 35.2349 } });
  ok('two distinct spots in one cell derive the identical area',
    JSON.stringify(p1) === JSON.stringify(p2));
}

{
  // The radius must not encode latitude.
  const radii = [-85, -45, 0, 31.7, 60, 85].map(
    (lat) => hiddenSearchArea({ hideLocation: true, coordinates: { lat, lng: 10 } })?.radiusMeters,
  );
  ok('the radius is constant across latitudes', new Set(radii).size === 1);
}

console.log('\nhiddenSearchArea — nothing is derived from an unusable location');
const NO_AREA: Array<[string, unknown]> = [
  ['a nullish task', null],
  ['an undefined task', undefined],
  ['a locationless task', { hideLocation: true, locationless: true, coordinates: { lat: 31.7, lng: 35.2 } }],
  ['absent coordinates', { hideLocation: true }],
  ['null coordinates', { hideLocation: true, coordinates: null }],
  ['NaN latitude', { hideLocation: true, coordinates: { lat: Number.NaN, lng: 35.2 } }],
  ['Infinite longitude', { hideLocation: true, coordinates: { lat: 31.7, lng: Number.POSITIVE_INFINITY } }],
  ['string coordinates', { hideLocation: true, coordinates: { lat: '31.7', lng: '35.2' } }],
  ['out-of-range latitude', { hideLocation: true, coordinates: { lat: 91, lng: 35.2 } }],
  ['out-of-range longitude', { hideLocation: true, coordinates: { lat: 31.7, lng: -181 } }],
  ['the null-island placeholder', { hideLocation: true, coordinates: { lat: 0, lng: 0 } }],
];
for (const [label, task] of NO_AREA) {
  const v = noThrow(`${label} does not throw`, () => hiddenSearchArea(task as never));
  ok(`${label} yields no area`, v === undefined);
}

console.log('\nhiddenSearchArea — which coordinate it reads');
{
  const withStation = hiddenSearchArea({
    hideLocation: true,
    coordinates: { lat: 31.7767, lng: 35.2345 },
    smart: { stationCoords: { lat: 32.0853, lng: 34.7818 } },
  });
  const stationOnly = hiddenSearchArea({
    hideLocation: true,
    coordinates: { lat: 32.0853, lng: 34.7818 },
  });
  ok('an injected station coordinate wins over the template coordinate',
    JSON.stringify(withStation) === JSON.stringify(stationOnly));

  const garbageStation = hiddenSearchArea({
    hideLocation: true,
    coordinates: { lat: 31.7767, lng: 35.2345 },
    smart: { stationCoords: { lat: Number.NaN, lng: 0 } },
  });
  ok('a garbage station coordinate falls back to the template coordinate',
    JSON.stringify(garbageStation) === JSON.stringify(hiddenSearchArea(placed)));
}
{
  // The function is about COORDINATES, not policy. Only the sanitizer decides who
  // gets one (pinned in functions/src/runs/sanitizeTask.test.ts).
  const notHidden = hiddenSearchArea({ coordinates: { lat: 31.7767, lng: 35.2345 } });
  ok('a non-hidden task still derives an area when asked directly', !!notHidden);
}

// ─── 2. The client selector ──────────────────────────────────────────────────
console.log('\nselectSearchAreas — total, never throws, drops anything malformed');

const sealed = (id: string, area: unknown) => ({ id, arrivalPending: true, searchArea: area });
const good = { lat: 31.774, lng: 35.234, radiusMeters: 320 };

for (const [label, input] of [
  ['undefined', undefined],
  ['null', null],
  ['a non-array', { length: 2 }],
  ['a string', 'nope'],
  ['a number', 7],
  ['an array of null / number / string', [null, 0, 'x', undefined]],
] as Array<[string, unknown]>) {
  const v = noThrow(`${label} does not throw`, () => selectSearchAreas(input as never));
  ok(`${label} yields no circles`, Array.isArray(v) && (v as unknown[]).length === 0);
}

{
  const out = selectSearchAreas([sealed('t1', good)] as never);
  eq('a sealed task with a valid area yields one circle', out.length, 1);
  eq('the circle keeps the task id', out[0].id, 't1');
  eq('the circle keeps the latitude', out[0].lat, good.lat);
  eq('the circle keeps the longitude', out[0].lng, good.lng);
  eq('the circle keeps the radius', out[0].radiusMeters, 320);
}

{
  const revealed = { id: 't2', arrivalPending: false, searchArea: good };
  const noFlag = { id: 't3', searchArea: good };
  eq('a revealed task contributes no circle', selectSearchAreas([revealed] as never).length, 0);
  eq('a task with no sealed flag contributes no circle', selectSearchAreas([noFlag] as never).length, 0);
  eq('a sealed task with no area contributes no circle',
    selectSearchAreas([{ id: 't4', arrivalPending: true }] as never).length, 0);
}

for (const [label, area] of [
  ['a NaN latitude', { lat: Number.NaN, lng: 35.2, radiusMeters: 320 }],
  ['an out-of-range longitude', { lat: 31.7, lng: 181, radiusMeters: 320 }],
  ['the null-island centre', { lat: 0, lng: 0, radiusMeters: 320 }],
  ['a NaN radius', { lat: 31.7, lng: 35.2, radiusMeters: Number.NaN }],
  ['a zero radius', { lat: 31.7, lng: 35.2, radiusMeters: 0 }],
  ['a negative radius', { lat: 31.7, lng: 35.2, radiusMeters: -50 }],
  ['a string radius', { lat: 31.7, lng: 35.2, radiusMeters: '320' }],
  ['a missing radius', { lat: 31.7, lng: 35.2 }],
  ['a non-object area', 'area'],
] as Array<[string, unknown]>) {
  eq(`${label} is dropped`, selectSearchAreas([sealed('t', area)] as never).length, 0);
}

{
  const huge = selectSearchAreas([sealed('t', { ...good, radiusMeters: 9_999_999 })] as never);
  eq('an absurd radius is clamped to the maximum', huge[0]?.radiusMeters, SEARCH_AREA_MAX_RADIUS_M);
  const tiny = selectSearchAreas([sealed('t', { ...good, radiusMeters: 1 })] as never);
  eq('a sub-minimum radius is clamped to the minimum', tiny[0]?.radiusMeters, SEARCH_AREA_MIN_RADIUS_M);
}

{
  const dup = selectSearchAreas([
    sealed('a', good),
    sealed('b', { ...good, lat: 31.778 }),
    sealed('a', { ...good, lat: 31.999 }),
  ] as never);
  eq('duplicate ids collapse to one circle', dup.length, 2);
  eq('the first occurrence wins', dup[0].lat, good.lat);
  eq('input order is preserved', dup.map((c) => c.id).join(','), 'a,b');
}

{
  const input = [sealed('a', good)];
  const before = JSON.stringify(input);
  selectSearchAreas(input as never);
  eq('the selector does not mutate its input', JSON.stringify(input), before);
}

console.log(failures === 0 ? '\n✅ hidden-search-area: all assertions passed\n'
  : `\n❌ hidden-search-area: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
