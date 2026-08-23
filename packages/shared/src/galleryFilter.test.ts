// RED-phase tests for the gallery FACET filter helper (change: gallery-facet-filters).
//
// `applyGalleryFacets` is the pure, in-memory second-pass filter the gallery
// callables run AFTER the tags DB query and popularity ranking, BEFORE slicing to
// the requested page. Firestore permits only one array-contains per query, so tags
// stays the sole DB filter and everything else (mode / type / difficulty / hasLocation)
// plus optional re-sorting is applied here.
//
// Contract under test:
//  • TOTAL and never throws — malformed/missing fields are tolerated;
//  • a POSITIVE filter EXCLUDES an item missing the faceted field;
//  • empty facets = IDENTITY (same items, input order preserved, no re-sort);
//  • difficulty is AT-LEAST (>=);
//  • hasLocation uses a usable approxLocation (finite lat/lng, not the 0,0 null-island).

import { describe, test, expect } from 'vitest';
import { applyGalleryFacets } from './galleryFilter';
import type { PublicGame, PublicTask } from './types';

function game(over: Partial<PublicGame> = {}): PublicGame {
  return {
    id: 'g',
    ownerUid: 'o',
    title: 'Game',
    mode: 'team',
    scoringPreset: 'time_only',
    tags: [],
    playCount: 0,
    stageCount: 1,
    taskCount: 1,
    estimatedTotalMinutes: 30,
    popularity: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function ptask(over: Partial<PublicTask> = {}): PublicTask {
  return {
    id: 't',
    sourceGameId: 'g',
    ownerUid: 'o',
    title: 'Task',
    type: 'field',
    difficulty: 1,
    estimatedMinutes: 5,
    pointValue: 10,
    copyCount: 0,
    popularity: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('applyGalleryFacets — games', () => {
  test('mode filters to the requested mode', () => {
    const items = [
      game({ id: 'a', mode: 'team' }),
      game({ id: 'b', mode: 'individual' }),
      game({ id: 'c', mode: 'team' }),
    ];
    const out = applyGalleryFacets(items, { mode: 'team' }, 'game');
    expect(out.map((g) => g.id)).toEqual(['a', 'c']);
  });

  test('an item missing the faceted field is excluded by a positive filter', () => {
    const items = [game({ id: 'a', mode: 'team' }), game({ id: 'b', mode: undefined as never })];
    const out = applyGalleryFacets(items, { mode: 'team' }, 'game');
    expect(out.map((g) => g.id)).toEqual(['a']);
  });

  test('sort=popular orders by popularity desc', () => {
    const items = [
      game({ id: 'a', popularity: 1 }),
      game({ id: 'b', popularity: 9 }),
      game({ id: 'c', popularity: 5 }),
    ];
    const out = applyGalleryFacets(items, { sort: 'popular' }, 'game');
    expect(out.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  test('sort=plays orders by playCount desc', () => {
    const items = [
      game({ id: 'a', playCount: 3 }),
      game({ id: 'b', playCount: 30 }),
      game({ id: 'c', playCount: 10 }),
    ];
    const out = applyGalleryFacets(items, { sort: 'plays' }, 'game');
    expect(out.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  test('sort=newest orders by createdAt/updatedAt desc', () => {
    const items = [
      game({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
      game({ id: 'b', createdAt: '2026-03-01T00:00:00.000Z' }),
      game({ id: 'c', createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const out = applyGalleryFacets(items, { sort: 'newest' }, 'game');
    expect(out.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  test('empty facets = identity (input order preserved, no re-sort)', () => {
    const items = [
      game({ id: 'a', popularity: 1 }),
      game({ id: 'b', popularity: 9 }),
      game({ id: 'c', popularity: 5 }),
    ];
    const out = applyGalleryFacets(items, {}, 'game');
    expect(out.map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyGalleryFacets — tasks', () => {
  test('type filters to the requested task type', () => {
    const items = [
      ptask({ id: 'a', type: 'quiz' }),
      ptask({ id: 'b', type: 'field' }),
      ptask({ id: 'c', type: 'quiz' }),
    ];
    const out = applyGalleryFacets(items, { type: 'quiz' }, 'task');
    expect(out.map((t) => t.id)).toEqual(['a', 'c']);
  });

  test('difficulty is AT-LEAST (>=)', () => {
    const items = [
      ptask({ id: 'a', difficulty: 1 }),
      ptask({ id: 'b', difficulty: 3 }),
      ptask({ id: 'c', difficulty: 5 }),
    ];
    const out = applyGalleryFacets(items, { difficulty: 3 }, 'task');
    expect(out.map((t) => t.id)).toEqual(['b', 'c']);
  });

  test('hasLocation=true keeps only usable approxLocation (finite, not 0,0)', () => {
    const items = [
      ptask({ id: 'a', approxLocation: { lat: 31.7, lng: 35.2 } }),
      ptask({ id: 'b', approxLocation: undefined }),
      ptask({ id: 'c', approxLocation: { lat: 0, lng: 0 } }),
      ptask({ id: 'd', approxLocation: { lat: NaN, lng: 5 } as never }),
    ];
    const out = applyGalleryFacets(items, { hasLocation: true }, 'task');
    expect(out.map((t) => t.id)).toEqual(['a']);
  });

  test('hasLocation=false keeps only tasks without a usable location', () => {
    const items = [
      ptask({ id: 'a', approxLocation: { lat: 31.7, lng: 35.2 } }),
      ptask({ id: 'b', approxLocation: undefined }),
    ];
    const out = applyGalleryFacets(items, { hasLocation: false }, 'task');
    expect(out.map((t) => t.id)).toEqual(['b']);
  });

  test('sort=copies orders by copyCount desc', () => {
    const items = [
      ptask({ id: 'a', copyCount: 2 }),
      ptask({ id: 'b', copyCount: 20 }),
      ptask({ id: 'c', copyCount: 7 }),
    ];
    const out = applyGalleryFacets(items, { sort: 'copies' }, 'task');
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('applyGalleryFacets — total & robust', () => {
  test('empty array in, empty array out', () => {
    expect(applyGalleryFacets([], { mode: 'team' }, 'game')).toEqual([]);
    expect(applyGalleryFacets([], { type: 'quiz' }, 'task')).toEqual([]);
  });

  test('never throws on malformed items or facets', () => {
    const junk = [null, undefined, {}, { mode: 'team' }, 42, 'x'] as never[];
    expect(() => applyGalleryFacets(junk, { mode: 'team', sort: 'popular' }, 'game')).not.toThrow();
    expect(() =>
      applyGalleryFacets(junk, { type: 'quiz', difficulty: 2, hasLocation: true, sort: 'newest' }, 'task'),
    ).not.toThrow();
  });

  test('sort is stable for equal keys', () => {
    const items = [
      game({ id: 'a', popularity: 5 }),
      game({ id: 'b', popularity: 5 }),
      game({ id: 'c', popularity: 5 }),
    ];
    const out = applyGalleryFacets(items, { sort: 'popular' }, 'game');
    expect(out.map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });
});
