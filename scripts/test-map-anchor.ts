// Pure-logic tests — the Builder map picker's OPENING view
// (change: location-picker-game-anchor).
//
// LocationPicker used to decide its opening view from the edited task's own
// coordinates and nothing else, so a mission with no pin — i.e. every mission a
// creator adds — opened at zoom 8 over central Israel, and the neighbourhood had
// to be re-found by hand once per mission. The fix is to open on the coordinates
// the surrounding GAME already holds. creator-web has no component test runner,
// so the verdict lives in a pure module and is asserted here.
//
// Three things are worth pinning:
//
//   1. The "~100 m" promise is DERIVED, not a magic zoom constant. Web-Mercator
//      metres-per-pixel depends on latitude and on the container size, so a
//      hardcoded 17 would be right only at the one latitude and one map height it
//      was eyeballed on. The assertions convert the returned zoom BACK to metres
//      and check the span, which is the property the design actually claims.
//   2. Totality. A non-finite number reaching MapLibre's camera is unrecoverable,
//      and this input comes from stored game data of any age. Every malformed
//      shape must degrade to today's default view, never to a throw and never to
//      a NaN.
//   3. The (0,0) sentinel. It is INSIDE the valid lat/lng range, so a check built
//      on isValidCoord alone would anchor every brand-new game to the Gulf of
//      Guinea — a wrong place is worse than the country view it replaced.
//
//   npx tsx scripts/test-map-anchor.ts
import {
  resolveInitialView,
  neighbourhoodZoom,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  ANCHOR_RADIUS_METERS,
  MIN_ANCHOR_ZOOM,
  MAX_ANCHOR_ZOOM,
  type InitialView,
} from '../apps/creator-web/src/lib/mapAnchor';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
function near(label: string, actual: number, expected: number, tol: number): void {
  ok(`${label} (got ${actual}, want ${expected} ±${tol})`, Math.abs(actual - expected) <= tol);
}

// The same Web-Mercator resolution the module derives its zoom from, restated
// here independently: a test that imported the module's own arithmetic would
// agree with any bug in it.
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
/** How many metres the shorter side of a `px`-tall viewport covers at `zoom`. */
function spanMeters(lat: number, zoom: number, px: number): number {
  return metersPerPixel(lat, zoom) * px;
}

const JERUSALEM = { lat: 31.7767, lng: 35.2345 };
const PX = 200; // the picker's shorter side at h-44/h-52 (176–208px)

function asBounds(v: InitialView): Extract<InitialView, { kind: 'bounds' }> {
  if (v.kind !== 'bounds') throw new Error(`expected a bounds view, got ${v.kind}`);
  return v;
}

console.log('\nresolveInitialView — the edited mission already has a pin');
{
  // Today's behaviour, unchanged: its own pin wins over anything the game holds,
  // so a placed mission cannot regress however the anchors are computed.
  const v = resolveInitialView({
    self: JERUSALEM,
    anchors: [{ lat: 32.0853, lng: 34.7818 }], // Tel Aviv, 55km away
    viewportPx: PX,
  });
  eq('is a point view', v.kind, 'point');
  if (v.kind === 'point') {
    eq('centred on its own pin, [lng, lat]', JSON.stringify(v.center), JSON.stringify([35.2345, 31.7767]));
    eq('at the established zoom 14', v.zoom, 14);
  }
}

console.log('\nresolveInitialView — one placed mission elsewhere in the game');
{
  const v = resolveInitialView({ self: null, anchors: [JERUSALEM], viewportPx: PX });
  const b = asBounds(v);
  const [[west, south], [east, north]] = b.bounds;
  ok('the anchor is inside the bounds',
    west <= JERUSALEM.lng && JERUSALEM.lng <= east && south <= JERUSALEM.lat && JERUSALEM.lat <= north);
  // The point of the change: a single anchor must land at neighbourhood scale,
  // which is what maxZoom decides once fitBounds collapses on a degenerate box.
  const span = spanMeters(JERUSALEM.lat, b.maxZoom, PX);
  ok(`opens on at least the promised ${2 * ANCHOR_RADIUS_METERS}m (span ${Math.round(span)}m)`,
    span >= 2 * ANCHOR_RADIUS_METERS - 1);
  ok(`and not a whole town (span ${Math.round(span)}m < ${6 * ANCHOR_RADIUS_METERS}m)`,
    span < 6 * ANCHOR_RADIUS_METERS);
  ok('padding cannot invert the shortest container', b.padding >= 0 && b.padding * 2 < 176);
}

console.log('\nresolveInitialView — missions a kilometre apart');
{
  // ~1km north and ~1km east of Jerusalem's centre.
  const a = { lat: 31.7767, lng: 35.2345 };
  const c = { lat: 31.7857, lng: 35.2450 };
  const b = asBounds(resolveInitialView({ self: null, anchors: [a, c], viewportPx: PX }));
  const [[west, south], [east, north]] = b.bounds;
  ok('both anchors are inside the bounds',
    west <= a.lng && a.lng <= east && west <= c.lng && c.lng <= east &&
    south <= a.lat && a.lat <= north && south <= c.lat && c.lat <= north);
  ok('the box is the real spread, not a point', east > west && north > south);
  // maxZoom is a CEILING: a spread wider than the neighbourhood scale is fitted
  // by the bounds, so nothing is cropped.
  ok('the spread exceeds the neighbourhood clamp, so fitBounds governs',
    spanMeters(a.lat, b.maxZoom, PX) < 1000);
}

console.log('\nresolveInitialView — missions metres apart');
{
  const a = { lat: 31.7767, lng: 35.2345 };
  const c = { lat: 31.77671, lng: 35.23451 }; // ~1.3m away
  const b = asBounds(resolveInitialView({ self: null, anchors: [a, c], viewportPx: PX }));
  const span = spanMeters(a.lat, b.maxZoom, PX);
  ok(`clamped to the neighbourhood scale, not rooftop (span ${Math.round(span)}m)`,
    span >= 2 * ANCHOR_RADIUS_METERS - 1);
  eq('never past the hard zoom ceiling', b.maxZoom <= MAX_ANCHOR_ZOOM, true);
}

console.log('\nresolveInitialView — nothing usable to anchor on');
{
  const expectDefault = (label: string, v: InitialView) => {
    eq(`${label}: is a point view`, v.kind, 'point');
    if (v.kind === 'point') {
      eq(`${label}: at DEFAULT_CENTER`, JSON.stringify(v.center), JSON.stringify(DEFAULT_CENTER));
      eq(`${label}: at DEFAULT_ZOOM`, v.zoom, DEFAULT_ZOOM);
    }
  };
  expectDefault('no anchors at all', resolveInitialView({ self: null, anchors: [], viewportPx: PX }));
  expectDefault('anchors undefined', resolveInitialView({ self: null, viewportPx: PX }));
  // (0,0) is the codebase's "unplaced" placeholder and sits inside the valid
  // range — the whole reason isValidCoord alone is not enough.
  expectDefault('only the (0,0) sentinel',
    resolveInitialView({ self: null, anchors: [{ lat: 0, lng: 0 }], viewportPx: PX }));
  expectDefault('NaN coordinates',
    resolveInitialView({ self: null, anchors: [{ lat: NaN, lng: 35 }], viewportPx: PX }));
  expectDefault('out of range coordinates',
    resolveInitialView({ self: null, anchors: [{ lat: 931, lng: 1200 }], viewportPx: PX }));
  expectDefault('missing fields',
    resolveInitialView({ self: null, anchors: [{} as never], viewportPx: PX }));
  expectDefault('null entries',
    resolveInitialView({ self: null, anchors: [null as never, undefined as never], viewportPx: PX }));
  expectDefault('a non-array anchors value',
    resolveInitialView({ self: null, anchors: 'nope' as never, viewportPx: PX }));
  expectDefault('self carrying the (0,0) sentinel and no anchors',
    resolveInitialView({ self: { lat: 0, lng: 0 }, anchors: [], viewportPx: PX }));
  expectDefault('called with nothing at all', resolveInitialView());
  expectDefault('called with garbage', resolveInitialView(null as never));
}

console.log('\nresolveInitialView — a mix of placed and unplaced missions');
{
  const b = asBounds(resolveInitialView({
    self: null,
    anchors: [
      { lat: 0, lng: 0 },              // the unplaced sentinel
      JERUSALEM,                        // real
      { lat: NaN, lng: NaN } as never,  // garbage
      { lat: 31.7800, lng: 35.2400 },   // real
    ],
    viewportPx: PX,
  }));
  const [[west, south], [east, north]] = b.bounds;
  // If (0,0) had been counted the box would reach the equator and the prime meridian.
  ok('the sentinel does not stretch the box to (0,0)', south > 31 && west > 35);
  ok('both real anchors are inside', west <= 35.2345 && east >= 35.24 && south <= 31.7767 && north >= 31.78);
}

console.log('\nneighbourhoodZoom — the derivation, directly');
{
  // The design's worked example: Jerusalem, 200px, 100m radius ⇒ ≈17.0.
  near('Jerusalem at 200px is ≈17', neighbourhoodZoom(31.7767, 200), 17.0, 0.15);
  // Latitude matters: a higher latitude has smaller metres-per-pixel at the same
  // zoom, so the same 200m span needs a LOWER zoom.
  ok('a higher latitude yields a lower zoom',
    neighbourhoodZoom(60, 200) < neighbourhoodZoom(31.7767, 200));
  // A taller container shows more ground at the same zoom, so it can zoom in more.
  ok('a taller container yields a higher zoom',
    neighbourhoodZoom(31.7767, 600) > neighbourhoodZoom(31.7767, 200));
  // The promise holds across sizes and latitudes, which a constant could not do.
  for (const lat of [0, 31.7767, 45, 60]) {
    for (const px of [176, 208, 400, 900]) {
      const span = spanMeters(lat, neighbourhoodZoom(lat, px), px);
      ok(`lat ${lat} @ ${px}px spans ≥ ${2 * ANCHOR_RADIUS_METERS}m (${Math.round(span)}m)`,
        span >= 2 * ANCHOR_RADIUS_METERS - 1);
    }
  }
}

console.log('\nneighbourhoodZoom — degenerate measurements never reach the camera');
{
  for (const [label, lat, px] of [
    ['a container reporting 0px', 31.7767, 0],
    ['a negative size', 31.7767, -50],
    ['a NaN size', 31.7767, NaN],
    ['a NaN latitude', NaN, 200],
    ['the north pole', 90, 200],
    ['nothing at all', undefined, undefined],
  ] as [string, number | undefined, number | undefined][]) {
    const z = neighbourhoodZoom(lat as never, px as never);
    ok(`${label}: finite`, Number.isFinite(z));
    ok(`${label}: inside [${MIN_ANCHOR_ZOOM}, ${MAX_ANCHOR_ZOOM}]`, z >= MIN_ANCHOR_ZOOM && z <= MAX_ANCHOR_ZOOM);
  }
}

console.log('\nresolveInitialView — purity and finiteness');
{
  const input = { self: null, anchors: [JERUSALEM, { lat: 31.78, lng: 35.24 }], viewportPx: PX };
  const before = JSON.stringify(input);
  const a = resolveInitialView(input);
  const b = resolveInitialView(input);
  eq('two calls on the same input are equal', JSON.stringify(a), JSON.stringify(b));
  eq('the input is not mutated', JSON.stringify(input), before);
  // Everything a camera could be handed, across every branch.
  const views: InitialView[] = [
    a,
    resolveInitialView({ self: JERUSALEM, viewportPx: PX }),
    resolveInitialView({ self: null, anchors: [], viewportPx: 0 }),
    resolveInitialView({ self: null, anchors: [JERUSALEM], viewportPx: NaN }),
  ];
  for (const v of views) {
    const nums = v.kind === 'point' ? [...v.center, v.zoom] : [...v.bounds.flat(), v.maxZoom, v.padding];
    ok(`every number in a ${v.kind} view is finite`, nums.every((n) => Number.isFinite(n)));
  }
}

console.log(failures === 0 ? '\n✅ map-anchor: all assertions passed\n'
  : `\n❌ map-anchor: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
