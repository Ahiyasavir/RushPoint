// RED-phase tests for the public task library's location contract
// (change: task-library-map-view).
//
// The thing under test is a SECURITY boundary, not a formatting helper: publicTasks
// is `allow read: if true` in firestore.rules, so whatever these functions decide to
// emit is world-readable forever. The tests are written to fail loudly against the
// two implementations that would "look right" and be wrong — a pass-through that
// returns the authored point, and a random jitter that can be averaged away.

import { describe, test, expect } from 'vitest';
import {
  PUBLIC_LOCATION_CELL_DEG,
  approximatePublicPoint,
  publicTaskLocation,
  isPlottablePublicTask,
  publicTaskMapCoverage,
} from './publicTaskLocation';

const CELL = PUBLIC_LOCATION_CELL_DEG;
const HALF = CELL / 2;

// A deliberately OFF-GRID authored point: 31.77661 is not a cell centre, so a
// pass-through implementation cannot accidentally satisfy the coarsening tests.
const AUTHORED = { lat: 31.77661, lng: 35.23499 };

/** Minimal Task-shaped input for the writer's rule. */
function task(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Task',
    type: 'field',
    coordinates: { ...AUTHORED },
    difficulty: 3,
    estimatedMinutes: 10,
    pointValue: 100,
    ...over,
  } as never;
}

/** Minimal PublicTask-shaped input for the reader's rule. */
function pub(over: Record<string, unknown> = {}) {
  return {
    id: 'g1_t1',
    sourceGameId: 'g1',
    ownerUid: 'u1',
    title: 'Task',
    type: 'field',
    difficulty: 3,
    estimatedMinutes: 10,
    pointValue: 100,
    copyCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as never;
}

describe('approximatePublicPoint — coarsening', () => {
  test('each output axis is within half a cell of its input axis', () => {
    const inputs = [
      { lat: 31.77661, lng: 35.23499 },
      { lat: -33.86881, lng: 151.20929 },   // southern + eastern
      { lat: -34.60372, lng: -58.38159 },   // southern + western (floor vs trunc)
      { lat: 64.14634, lng: -21.94235 },
      { lat: 0.00001, lng: -0.00001 },      // straddling the anchor
    ];
    for (const p of inputs) {
      const out = approximatePublicPoint(p);
      expect(Math.abs(out.lat - p.lat)).toBeLessThanOrEqual(HALF + 1e-9);
      expect(Math.abs(out.lng - p.lng)).toBeLessThanOrEqual(HALF + 1e-9);
    }
  });

  test('output lands on the global grid (a cell centre), not on the input', () => {
    const out = approximatePublicPoint(AUTHORED);
    // (out - half) / cell must be an integer => out is the centre of a grid cell.
    const latIdx = (out.lat - HALF) / CELL;
    const lngIdx = (out.lng - HALF) / CELL;
    expect(Math.abs(latIdx - Math.round(latIdx))).toBeLessThan(1e-6);
    expect(Math.abs(lngIdx - Math.round(lngIdx))).toBeLessThan(1e-6);
    // And it is genuinely coarsened — a pass-through implementation fails here.
    expect(out.lat).not.toBe(AUTHORED.lat);
    expect(out.lng).not.toBe(AUTHORED.lng);
  });

  test('is deterministic — 50 observations carry no more information than 1', () => {
    // This is the anti-averaging property. Random jitter would pass every other
    // test in this file and fail only this one.
    const first = approximatePublicPoint(AUTHORED);
    for (let i = 0; i < 50; i++) {
      const again = approximatePublicPoint({ ...AUTHORED });
      expect(again.lat).toBe(first.lat);
      expect(again.lng).toBe(first.lng);
    }
  });

  test('is not injective — two points in one cell collapse to one pin', () => {
    const a = approximatePublicPoint({ lat: 31.7701, lng: 35.2301 });
    const b = approximatePublicPoint({ lat: 31.7799, lng: 35.2399 });
    expect(a).toEqual(b);
  });

  test('stays a valid coordinate at the range extremes', () => {
    for (const p of [
      { lat: 90, lng: 180 },
      { lat: -90, lng: -180 },
    ]) {
      const out = approximatePublicPoint(p);
      expect(Number.isFinite(out.lat)).toBe(true);
      expect(Number.isFinite(out.lng)).toBe(true);
      expect(out.lat).toBeGreaterThanOrEqual(-90);
      expect(out.lat).toBeLessThanOrEqual(90);
      expect(out.lng).toBeGreaterThanOrEqual(-180);
      expect(out.lng).toBeLessThanOrEqual(180);
    }
  });
});

describe('publicTaskLocation — the writer\'s rule', () => {
  // ── hideLocation (change: hidden-location-map-visibility) ───────────────────
  // A hidden-location task now publishes the SAME ~1 km cell as any other task,
  // so a creator can see their own hunt on their own library map. What is
  // published is a neighbourhood, not a spot, and the secrecy that makes the
  // puzzle a puzzle lives in a different code path entirely — the participant
  // sanitizer, which seals the task until the server confirms arrival and never
  // sends any coordinate, coarse or exact. See sanitizeTask.test.ts for the pair
  // of assertions that hold both halves of that boundary at once.
  test('a hideLocation task publishes the same coarse area as any other task', () => {
    const hidden = publicTaskLocation(task({ hideLocation: true }));
    expect(hidden).toBeDefined();
    expect(hidden).toEqual(approximatePublicPoint(AUTHORED));
    // …and it is an AREA, never the authored point.
    expect(hidden!.lat).not.toBe(AUTHORED.lat);
    expect(hidden!.lng).not.toBe(AUTHORED.lng);
    expect(hidden).toEqual(publicTaskLocation(task()));
  });

  test('a hideLocation task publishes an area regardless of its other config', () => {
    expect(publicTaskLocation(task({
      hideLocation: true,
      triggerMode: 'radius',
      locationClue: 'Where the lions guard the gate',
      geofenceRadiusMeters: 40,
    }))).toEqual(approximatePublicPoint(AUTHORED));
  });

  test('a hideLocation area is deterministic — repeated publishes cannot be averaged', () => {
    const first = publicTaskLocation(task({ hideLocation: true }));
    for (let i = 0; i < 25; i++) {
      expect(publicTaskLocation(task({ hideLocation: true }))).toEqual(first);
    }
  });

  test('a hideLocation task that is locationless still publishes nothing', () => {
    expect(publicTaskLocation(task({ hideLocation: true, locationless: true }))).toBeUndefined();
  });

  test('a hideLocation task with unusable coordinates still publishes nothing', () => {
    expect(publicTaskLocation(task({ hideLocation: true, coordinates: undefined }))).toBeUndefined();
    expect(publicTaskLocation(task({ hideLocation: true, coordinates: { lat: NaN, lng: 35 } }))).toBeUndefined();
    expect(publicTaskLocation(task({ hideLocation: true, coordinates: { lat: 31, lng: Infinity } }))).toBeUndefined();
    expect(publicTaskLocation(task({ hideLocation: true, coordinates: { lat: 91, lng: 35 } }))).toBeUndefined();
    expect(publicTaskLocation(task({ hideLocation: true, coordinates: { lat: '31', lng: '35' } }))).toBeUndefined();
    // null island is the "not placed yet" placeholder, hidden or not.
    expect(publicTaskLocation(task({ hideLocation: true, coordinates: { lat: 0, lng: 0 } }))).toBeUndefined();
  });

  test('an ordinary located task publishes a coarsened point, never the authored one', () => {
    const out = publicTaskLocation(task());
    expect(out).toBeDefined();
    expect(out).toEqual(approximatePublicPoint(AUTHORED));
    expect(out!.lat).not.toBe(AUTHORED.lat);
    expect(out!.lng).not.toBe(AUTHORED.lng);
  });

  test('an unusable coordinate publishes nothing', () => {
    expect(publicTaskLocation(task({ coordinates: undefined }))).toBeUndefined();
    expect(publicTaskLocation(task({ coordinates: { lat: NaN, lng: 35 } }))).toBeUndefined();
    expect(publicTaskLocation(task({ coordinates: { lat: 91, lng: 35 } }))).toBeUndefined();
    expect(publicTaskLocation(task({ coordinates: { lat: 31, lng: 181 } }))).toBeUndefined();
    expect(publicTaskLocation(task({ coordinates: { lat: '31', lng: '35' } }))).toBeUndefined();
  });

  test('null island is not a location — blankTask() ships (0,0) as its placeholder', () => {
    expect(publicTaskLocation(task({ coordinates: { lat: 0, lng: 0 } }))).toBeUndefined();
  });

  test('a locationless task publishes nothing', () => {
    expect(publicTaskLocation(task({ locationless: true }))).toBeUndefined();
  });
});

describe('isPlottablePublicTask — the reader\'s rule', () => {
  test('a valid approxLocation is plottable', () => {
    expect(isPlottablePublicTask(pub({ approxLocation: { lat: 31.775, lng: 35.235 } }))).toBe(true);
  });

  test('no location is not plottable', () => {
    expect(isPlottablePublicTask(pub())).toBe(false);
    expect(isPlottablePublicTask(pub({ approxLocation: undefined }))).toBe(false);
  });

  test('an invalid or null-island approxLocation is not plottable', () => {
    expect(isPlottablePublicTask(pub({ approxLocation: { lat: 0, lng: 0 } }))).toBe(false);
    expect(isPlottablePublicTask(pub({ approxLocation: { lat: NaN, lng: 35 } }))).toBe(false);
    expect(isPlottablePublicTask(pub({ approxLocation: { lat: 200, lng: 35 } }))).toBe(false);
  });

  test('a LEGACY document with exact coordinates and no approxLocation is NOT plottable', () => {
    // The whole point of the change: the map must never fall back onto the field
    // this change exists to stop publishing.
    expect(isPlottablePublicTask(pub({ coordinates: AUTHORED }))).toBe(false);
  });
});

// ─── publicTaskMapCoverage — which map state a result set is in ───────────────
//
// The reported bug was a MISCLASSIFICATION, not a bad pin: a creator saw "none of
// these missions has a published area" over a result list that visibly had located
// missions in it. The classifier exists so that outcome is individually assertable,
// and so it can never disagree with the marker filter — both go through
// isPlottablePublicTask.
describe('publicTaskMapCoverage — the map-state classifier', () => {
  const AREA = { lat: 31.775, lng: 35.235 };
  const withArea = () => pub({ approxLocation: { ...AREA } });
  /** A document written before the privacy change: exact point, no area. */
  const legacy = () => pub({ coordinates: { ...AUTHORED } });
  /** A task the writer emitted no location field for at all (locationless / unplaced). */
  const unplaced = () => pub();
  /**
   * A hideLocation task published under the current rule: it carries an ordinary
   * area, so as far as the map is concerned it is an ordinary plottable result
   * (change: hidden-location-map-visibility).
   */
  const hiddenWithArea = () => pub({ approxLocation: { ...AREA }, hideLocation: true });

  test('an empty result set is "no-results"', () => {
    expect(publicTaskMapCoverage([])).toBe('no-results');
  });

  test('every result located is "all-plottable"', () => {
    expect(publicTaskMapCoverage([withArea(), withArea(), withArea()])).toBe('all-plottable');
  });

  test('a set of LEGACY documents is "none-plottable" — the reported bug', () => {
    // Exact coordinates present, approxLocation absent: the map is empty and the
    // creator must be told why, not just that.
    expect(publicTaskMapCoverage([legacy(), legacy()])).toBe('none-plottable');
  });

  test('no-location results are "none-plottable"', () => {
    expect(publicTaskMapCoverage([unplaced()])).toBe('none-plottable');
    expect(publicTaskMapCoverage([pub({ approxLocation: undefined })])).toBe('none-plottable');
  });

  test('a hidden-location result that carries an area IS plottable', () => {
    // The change: a hidden-location mission is on the creator's map like any
    // other, so a library full of them is "all-plottable", not an empty map.
    expect(isPlottablePublicTask(hiddenWithArea())).toBe(true);
    expect(publicTaskMapCoverage([hiddenWithArea(), hiddenWithArea()])).toBe('all-plottable');
    expect(publicTaskMapCoverage([hiddenWithArea(), unplaced()])).toBe('partial');
  });

  test('malformed areas are "none-plottable" and do not throw', () => {
    expect(publicTaskMapCoverage([
      pub({ approxLocation: { lat: NaN, lng: 35 } }),
      pub({ approxLocation: { lat: 200, lng: 35 } }),
      pub({ approxLocation: { lat: 0, lng: 0 } }),
      pub({ approxLocation: { lat: '31.7', lng: '35.2' } }),
    ])).toBe('none-plottable');
  });

  test('A MIXED set is "partial" — the empty state must NOT apply', () => {
    // The regression this guards: one located mission among many unlocated ones
    // must put a pin on the map and suppress the "nothing here" message entirely.
    expect(publicTaskMapCoverage([legacy(), withArea(), unplaced()])).toBe('partial');
    expect(publicTaskMapCoverage([withArea(), legacy()])).toBe('partial');
  });

  test('missing entries are tolerated and counted as not plottable', () => {
    expect(publicTaskMapCoverage([null, undefined] as never)).toBe('none-plottable');
    expect(publicTaskMapCoverage([null, withArea()] as never)).toBe('partial');
  });

  test('a nullish result set is "no-results"', () => {
    expect(publicTaskMapCoverage(undefined as never)).toBe('no-results');
    expect(publicTaskMapCoverage(null as never)).toBe('no-results');
  });

  test('the classifier agrees with isPlottablePublicTask item by item', () => {
    const items = [withArea(), legacy(), unplaced(), pub({ approxLocation: { lat: 0, lng: 0 } })];
    const plottable = items.filter(isPlottablePublicTask).length;
    expect(plottable).toBe(1);
    expect(publicTaskMapCoverage(items)).toBe('partial');
  });
});
