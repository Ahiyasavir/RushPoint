import { expect, test, describe, vi } from 'vitest';
import {
  publicTextMatch,
  publicTaskForLibrary,
  needsLegacyCoarseRepair,
  legacyCoarseRepairKeys,
  resolveLegacyCoarseLocations,
  type LegacyGameFetcher,
} from './index';
import { approximatePublicPoint, type PublicTask, type Game } from '@rushpoint/shared';

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

  test('a doc explicitly flagged hideLocation is served EXACT now (gallery-exact-hidden-location)', () => {
    // The gallery pins EVERY located mission — hidden included — at its exact spot,
    // so a game's hidden missions no longer collapse onto one coarse cell. The
    // in-game puzzle is sealed separately by the participant sanitizer.
    const out = publicTaskForLibrary(baseTask({ coordinates: EXACT, hideLocation: true }));
    expect(out.approxLocation).toEqual({ lat: 31.77654, lng: 35.23489 }); // round5 of EXACT
    expect(out.approxLocation).not.toEqual(approximatePublicPoint(EXACT));
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

describe('legacy-coarse repair (change: gallery-map-legacy-coarse-repair)', () => {
  const EXACT = { lat: 31.776543, lng: 35.234891 };
  const COARSE = approximatePublicPoint(EXACT);
  const gameOf = (over: Record<string, unknown> = {}): Game =>
    ({
      id: 'g1',
      ownerUid: 'owner',
      stages: [{ id: 's1', order: 0, title: 'Stage 1', tasks: [{ id: 't1', coordinates: EXACT }] }],
      ...over,
    }) as unknown as Game;

  describe('needsLegacyCoarseRepair', () => {
    test('a doc with `coordinates` never needs it — the existing recompute already handles it', () => {
      expect(needsLegacyCoarseRepair(baseTask({ coordinates: EXACT, approxLocation: COARSE }))).toBe(false);
    });

    test('a doc with no coordinates and a COARSE stored approxLocation needs it', () => {
      expect(needsLegacyCoarseRepair(baseTask({ approxLocation: COARSE }))).toBe(true);
    });

    test('a doc with no coordinates and an already-EXACT stored approxLocation does not need it', () => {
      expect(needsLegacyCoarseRepair(baseTask({ approxLocation: { lat: 31.7, lng: 35.2 } }))).toBe(false);
    });

    test('a doc with no coordinates and no approxLocation at all does not need it (nothing to upgrade from)', () => {
      expect(needsLegacyCoarseRepair(baseTask({}))).toBe(false);
    });
  });

  describe('legacyCoarseRepairKeys', () => {
    test('dedupes multiple tasks sharing one sourceGameId into a single key', () => {
      const tasks = [
        baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE }),
        baseTask({ id: 'g1_t2', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE }),
      ];
      expect(legacyCoarseRepairKeys(tasks)).toEqual([{ ownerUid: 'owner', sourceGameId: 'g1' }]);
    });

    test('a doc that does not need repair contributes no key', () => {
      const tasks = [baseTask({ coordinates: EXACT, approxLocation: COARSE })];
      expect(legacyCoarseRepairKeys(tasks)).toEqual([]);
    });
  });

  describe('resolveLegacyCoarseLocations', () => {
    test('a doc with coordinates never triggers a game lookup at all', async () => {
      const getGames: LegacyGameFetcher = vi.fn(async () => new Map());
      const tasks = [baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', coordinates: EXACT, approxLocation: COARSE })];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      expect(getGames).not.toHaveBeenCalled();
      expect(out.size).toBe(0);
    });

    test('a coarse-only legacy doc resolves the EXACT point from its source game template', async () => {
      const getGames: LegacyGameFetcher = vi.fn(async () =>
        new Map([['owner/g1', gameOf()]]),
      );
      const tasks = [baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE })];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      expect(out.get('g1_t1')).toEqual({ lat: 31.77654, lng: 35.23489 });
    });

    test('a hideLocation task in the template is now resolved to its EXACT point (gallery-exact-hidden-location)', async () => {
      const hidden = gameOf({
        stages: [{ id: 's1', order: 0, title: 'Stage 1', tasks: [{ id: 't1', coordinates: EXACT, hideLocation: true }] }],
      });
      const getGames: LegacyGameFetcher = vi.fn(async () => new Map([['owner/g1', hidden]]));
      const tasks = [baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE })];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      // A legacy coarse hidden pin is upgraded to its precise spot on read.
      expect(out.get('g1_t1')).toEqual({ lat: 31.77654, lng: 35.23489 }); // round5 of EXACT
    });

    test('a missing/deleted game falls open to the stored coarse point (no throw, no entry)', async () => {
      const getGames: LegacyGameFetcher = vi.fn(async () => new Map([['owner/g1', undefined]]));
      const tasks = [baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE })];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      expect(out.has('g1_t1')).toBe(false);
    });

    test('a task removed from an otherwise-present game also falls open', async () => {
      const emptyStage = gameOf({ stages: [{ id: 's1', order: 0, title: 'Stage 1', tasks: [] }] });
      const getGames: LegacyGameFetcher = vi.fn(async () => new Map([['owner/g1', emptyStage]]));
      const tasks = [baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE })];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      expect(out.has('g1_t1')).toBe(false);
    });

    test('the fetcher itself throwing falls open for every target, never throws out', async () => {
      const getGames: LegacyGameFetcher = vi.fn(async () => {
        throw new Error('DEADLINE_EXCEEDED');
      });
      const tasks = [baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE })];
      await expect(resolveLegacyCoarseLocations(tasks, getGames)).resolves.toEqual(new Map());
    });

    test('multiple docs sharing one sourceGameId fetch the game exactly ONCE, not per task', async () => {
      const getGames: LegacyGameFetcher = vi.fn(async () =>
        new Map([
          [
            'owner/g1',
            gameOf({
              stages: [
                {
                  id: 's1',
                  order: 0,
                  title: 'Stage 1',
                  tasks: [
                    { id: 't1', coordinates: EXACT },
                    { id: 't2', coordinates: { lat: 31.7, lng: 35.3 } },
                  ],
                },
              ],
            }),
          ],
        ]),
      );
      const tasks = [
        baseTask({ id: 'g1_t1', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE }),
        baseTask({ id: 'g1_t2', sourceGameId: 'g1', ownerUid: 'owner', approxLocation: COARSE }),
      ];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      expect(getGames).toHaveBeenCalledTimes(1);
      expect(out.size).toBe(2);
      expect(out.get('g1_t1')).toEqual({ lat: 31.77654, lng: 35.23489 });
    });

    test('no target docs means no fetch at all', async () => {
      const getGames: LegacyGameFetcher = vi.fn(async () => new Map());
      const tasks = [baseTask({ coordinates: EXACT, approxLocation: COARSE })];
      const out = await resolveLegacyCoarseLocations(tasks, getGames);
      expect(getGames).not.toHaveBeenCalled();
      expect(out.size).toBe(0);
    });
  });
});
