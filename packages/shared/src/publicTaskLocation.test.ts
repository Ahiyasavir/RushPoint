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
  test('a hideLocation task publishes NO location, even with perfect coordinates', () => {
    // The headline requirement. For these tasks the location IS the puzzle.
    expect(publicTaskLocation(task({ hideLocation: true }))).toBeUndefined();
  });

  test('a hideLocation task publishes no location regardless of its other config', () => {
    expect(publicTaskLocation(task({
      hideLocation: true,
      triggerMode: 'radius',
      locationClue: 'Where the lions guard the gate',
      geofenceRadiusMeters: 40,
    }))).toBeUndefined();
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
