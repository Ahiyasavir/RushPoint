// WO-3 (hidden-location distance leak) + WO-5 layer-1 (bad-coordinate safety):
// the pure routing seam must (a) never let a hidden task's priority encode
// distance, and (b) never throw LocationError on a malformed teamLocation.
// transitMinutes is internal, so we probe it through the exported priorityScore.
import { describe, expect, test } from 'vitest';
import type { Task, GeoPoint } from '@rushpoint/shared';
import { priorityScore } from './assignNextTask';

// A real located task at a fixed spot; hidden vs visible is toggled per test.
function located(id: string, hideLocation: boolean): Task {
  return {
    id, title: id, type: 'field',
    coordinates: { lat: 31.78, lng: 35.21 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
    hideLocation,
  } as Task;
}

// Three team locations at very different distances from the task's coordinates.
const near: GeoPoint = { lat: 31.781, lng: 35.211 };   // ~150m
const mid: GeoPoint = { lat: 31.85, lng: 35.30 };       // ~12km
const far: GeoPoint = { lat: 32.60, lng: 35.90 };       // ~110km

describe('WO-3 — hidden task priority carries no distance signal', () => {
  test('a hideLocation task has invariant priority across three team locations', () => {
    const t = located('secret', true);
    const p1 = priorityScore(t, near, 0, {});
    const p2 = priorityScore(t, mid, 0, {});
    const p3 = priorityScore(t, far, 0, {});
    expect(p2).toBeCloseTo(p1, 9);
    expect(p3).toBeCloseTo(p1, 9);
  });

  test('positive control — a VISIBLE located task has location-varying priority', () => {
    const t = located('open', false);
    const p1 = priorityScore(t, near, 0, {});
    const p3 = priorityScore(t, far, 0, {});
    // The far team pays a much larger transit penalty → strictly lower priority.
    expect(p1).toBeGreaterThan(p3);
  });
});

describe('WO-5 layer 1 — a malformed teamLocation never throws', () => {
  const badLocations: GeoPoint[] = [
    { lat: 999, lng: 181 },
    { lat: Number.NaN, lng: Number.NaN },
    { lat: 'abc' as unknown as number, lng: 'def' as unknown as number },
  ];

  test('priorityScore returns a finite number for a visible located task', () => {
    const t = located('open', false);
    for (const loc of badLocations) {
      const p = priorityScore(t, loc, 0, {});
      expect(Number.isFinite(p)).toBe(true);
    }
  });

  test('priorityScore returns a finite number for a hidden task too', () => {
    const t = located('secret', true);
    for (const loc of badLocations) {
      const p = priorityScore(t, loc, 0, {});
      expect(Number.isFinite(p)).toBe(true);
    }
  });
});
