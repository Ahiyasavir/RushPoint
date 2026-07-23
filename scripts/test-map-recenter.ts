// Pure-logic tests — the participant map's "focus back on me" verdict
// (change: play-map-recenter-control).
//
// The control looks logic-free, which is exactly why its logic has to live
// somewhere testable: play-web has NO component test runner, so anything decided
// inline in NavMap.tsx is decided unobserved. Two failure modes are worth a suite:
//
//   1. easeTo(NaN) — MapLibre does not recover from a non-finite camera; a single
//      garbage GPS frame would permanently break the map for a racing player. So
//      the verdict must be TOTAL and must never emit a non-finite number, for any
//      input, including ones that are not objects at all.
//   2. the axis swap — [lng, lat] vs [lat, lng] is the most repeated bug in map
//      code. It is decided ONCE, here, and asserted by value.
//
// Also pinned: (0,0) is the codebase's "unplaced" placeholder and a classic bad
// GPS sentinel, so it is not a fix; and a disabled verdict still carries a usable
// zoom, so a caller reading it blind cannot produce NaN either.
//
//   npx tsx scripts/test-map-recenter.ts
import {
  recenterVerdict,
  RECENTER_ZOOM,
  RECENTER_MIN_ZOOM,
  RECENTER_MAX_ZOOM,
} from '../apps/play-web/src/lib/recenter';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

console.log('\nrecenterVerdict — a usable fix');
{
  const v = recenterVerdict({ lat: 31.7767, lng: 35.2345 });
  eq('is enabled', v.enabled, true);
  eq('reports ok', v.reason, 'ok');
  ok('carries a centre', Array.isArray(v.center) && v.center.length === 2);
  eq('centre[0] is the LONGITUDE (MapLibre order)', v.center![0], 35.2345);
  eq('centre[1] is the LATITUDE', v.center![1], 31.7767);
  eq('uses the default recentre zoom', v.zoom, RECENTER_ZOOM);
}

console.log('\nrecenterVerdict — coordinate range boundaries are still fixes');
for (const [label, me] of [
  ['the north-east corner', { lat: 90, lng: 180 }],
  ['the south-west corner', { lat: -90, lng: -180 }],
  ['a zero latitude with a real longitude', { lat: 0, lng: 35.2 }],
  ['a real latitude with a zero longitude', { lat: 31.7, lng: 0 }],
] as Array<[string, unknown]>) {
  eq(`${label} is enabled`, recenterVerdict(me as never).enabled, true);
}

console.log('\nrecenterVerdict — total: every unusable input yields a safe verdict');
const UNUSABLE: Array<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['an empty object', {}],
  ['a missing longitude', { lat: 31.7 }],
  ['a missing latitude', { lng: 35.2 }],
  ['a NaN latitude', { lat: Number.NaN, lng: 35.2 }],
  ['a NaN longitude', { lat: 31.7, lng: Number.NaN }],
  ['an Infinite latitude', { lat: Number.POSITIVE_INFINITY, lng: 35.2 }],
  ['a -Infinite longitude', { lat: 31.7, lng: Number.NEGATIVE_INFINITY }],
  ['string coordinates', { lat: '31.7', lng: '35.2' }],
  ['boolean coordinates', { lat: true, lng: false }],
  ['null coordinates', { lat: null, lng: null }],
  ['object coordinates', { lat: {}, lng: [] }],
  ['a latitude above range', { lat: 90.0001, lng: 35.2 }],
  ['a latitude below range', { lat: -90.0001, lng: 35.2 }],
  ['a longitude above range', { lat: 31.7, lng: 180.0001 }],
  ['a longitude below range', { lat: 31.7, lng: -180.0001 }],
  ['the null-island placeholder', { lat: 0, lng: 0 }],
  ['a string', 'nope'],
  ['a number', 7],
  ['an array', [31.7, 35.2]],
  ['a boolean', true],
];
for (const [label, me] of UNUSABLE) {
  let v: ReturnType<typeof recenterVerdict> | undefined;
  try {
    v = recenterVerdict(me as never);
    ok(`${label} does not throw`, true);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${label} threw ${String(e)}`);
    continue;
  }
  eq(`${label} is disabled`, v.enabled, false);
  eq(`${label} reports no_fix`, v.reason, 'no_fix');
  eq(`${label} carries no centre`, v.center, null);
  ok(`${label} still carries a finite, in-range zoom`,
    Number.isFinite(v.zoom) && v.zoom >= RECENTER_MIN_ZOOM && v.zoom <= RECENTER_MAX_ZOOM);
}

console.log('\nrecenterVerdict — the zoom argument');
const me = { lat: 31.7767, lng: 35.2345 };
eq('an in-range zoom is honoured', recenterVerdict(me, { zoom: 13 }).zoom, 13);
eq('an over-range zoom clamps to the maximum', recenterVerdict(me, { zoom: 99 }).zoom, RECENTER_MAX_ZOOM);
eq('an under-range zoom clamps to the minimum', recenterVerdict(me, { zoom: 0 }).zoom, RECENTER_MIN_ZOOM);
for (const [label, z] of [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['a string', '14'],
  ['null', null],
  ['an object', {}],
] as Array<[string, unknown]>) {
  eq(`${label} falls back to the default zoom`, recenterVerdict(me, { zoom: z as never }).zoom, RECENTER_ZOOM);
}
eq('an absent options object uses the default zoom', recenterVerdict(me).zoom, RECENTER_ZOOM);

console.log('\nrecenterVerdict — purity');
{
  const input = { lat: 31.7767, lng: 35.2345 };
  const before = JSON.stringify(input);
  const a = recenterVerdict(input);
  const b = recenterVerdict(input);
  eq('two calls on the same input are equal', JSON.stringify(a), JSON.stringify(b));
  eq('the input is not mutated', JSON.stringify(input), before);
  // No clock: shifting Date.now by hours must not move the verdict.
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 3600_000;
  const shifted = recenterVerdict(input);
  Date.now = realNow;
  eq('a six hour clock shift changes nothing', JSON.stringify(shifted), JSON.stringify(a));
}

console.log(failures === 0 ? '\n✅ map-recenter: all assertions passed\n'
  : `\n❌ map-recenter: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
