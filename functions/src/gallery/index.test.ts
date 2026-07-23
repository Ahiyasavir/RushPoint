import { expect, test, describe } from 'vitest';
import { publicTextMatch, publicTaskForLibrary } from './index';
import { approximatePublicPoint, type PublicTask } from '@rushpoint/shared';

const baseTask = (over: Partial<PublicTask> & Record<string, unknown> = {}): PublicTask & Record<string, unknown> => ({
  id: 'g1_t1',
  sourceGameId: 'g1',
  ownerUid: 'owner',
  title: 'Find the fountain',
  type: 'field',
  difficulty: 2,
  estimatedMinutes: 10,
  pointValue: 100,
  copyCount: 0,
  createdAt: '2026-06-22T00:00:00.000Z',
  ...over,
});

describe('publicTextMatch — gallery/library text filter', () => {
  test('matches case-insensitively across the provided fields', () => {
    expect(publicTextMatch(['Old City Hunt', 'a walk through history'], 'city')).toBe(true);
    expect(publicTextMatch(['Old City Hunt', 'a walk through history'], 'HISTORY')).toBe(true);
  });

  test('no match returns false', () => {
    expect(publicTextMatch(['Old City Hunt', 'history'], 'beach')).toBe(false);
  });

  test('a missing/undefined/null field never throws (resilience for malformed docs)', () => {
    expect(publicTextMatch([undefined, 'desc'], 'desc')).toBe(true);
    expect(publicTextMatch([undefined, null], 'anything')).toBe(false);
    expect(publicTextMatch([], 'anything')).toBe(false);
  });

  test('an empty/whitespace query matches everything', () => {
    expect(publicTextMatch([undefined], '   ')).toBe(true);
  });
});

describe('publicTaskForLibrary — read-path exact location (change: gallery-map-serve-exact)', () => {
  const EXACT = { lat: 31.776543, lng: 35.234891 };

  test('a legacy doc whose ONLY location is exact `coordinates` now yields a plottable EXACT approxLocation', () => {
    // The bug the user hit: pre-`task-library-map-view` docs carry `coordinates`
    // and NO `approxLocation`, so the map (which reads only approxLocation) never
    // plotted them. Read-path recompute fixes it with no backfill.
    const out = publicTaskForLibrary(baseTask({ coordinates: EXACT }));
    expect(out.approxLocation).toEqual({ lat: 31.77654, lng: 35.23489 }); // round5 of exact
    expect((out as unknown as Record<string, unknown>).coordinates).toBeUndefined();
  });

  test('a coordinates-bearing doc is served EXACT, not coarsened (ordinary task)', () => {
    const out = publicTaskForLibrary(baseTask({ coordinates: EXACT }));
    expect(out.approxLocation).not.toEqual(approximatePublicPoint(EXACT));
  });

  test('a doc explicitly flagged hideLocation is coarsened to its ~1 km cell', () => {
    // Defense-in-depth: no stored publicTasks doc actually carries this flag today,
    // but if a future projection wrote it the carve-out must still coarsen.
    const out = publicTaskForLibrary(baseTask({ coordinates: EXACT, hideLocation: true }));
    expect(out.approxLocation).toEqual(approximatePublicPoint(EXACT));
  });

  test('a new-style doc with an exact approxLocation and no coordinates is kept verbatim', () => {
    const stored = { lat: 31.7, lng: 35.2 };
    const out = publicTaskForLibrary(baseTask({ approxLocation: stored }));
    expect(out.approxLocation).toEqual(stored);
  });

  test('a locationless doc yields no plottable point (falls back to stored, which is absent)', () => {
    const out = publicTaskForLibrary(baseTask({ coordinates: EXACT, locationless: true }));
    expect(out.approxLocation).toBeUndefined();
  });

  test('the deprecated `coordinates` key is always dropped from the served payload', () => {
    const out = publicTaskForLibrary(baseTask({ coordinates: EXACT, approxLocation: { lat: 1, lng: 2 } }));
    expect((out as unknown as Record<string, unknown>).coordinates).toBeUndefined();
  });
});
