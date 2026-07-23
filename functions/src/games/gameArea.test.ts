// Pure-logic tests for the derived public game area (change: surface-invisible-fields).
//
// The gallery map plots `publicGames` by `approxLocation` and nothing ever wrote one —
// so the games map was permanently blank. Derivation fills that absence, but it writes
// into a WORLD-READABLE document, so the location contract of publicTaskLocation.ts
// applies verbatim: hidden-location tasks disclose nothing, the output is a ~1 km grid
// cell, and the function is deterministic so repeated publishes cannot be averaged into
// a finer point.
import { describe, it, expect } from 'vitest';
import { approximatePublicPoint } from '@rushpoint/shared';
import { deriveGameArea, resolveGameArea } from './gameArea';

type T = Record<string, unknown>;
const task = (over: T = {}): T => ({
  id: 't', title: 'T', type: 'field', coordinates: { lat: 31.7767, lng: 35.2345 }, ...over,
});
const stage = (tasks: T[]): T => ({ id: 's', order: 0, title: 'S', tasks });

describe('deriveGameArea', () => {
  it('returns undefined for a game with no stages or no tasks', () => {
    expect(deriveGameArea([] as never)).toBeUndefined();
    expect(deriveGameArea([stage([])] as never)).toBeUndefined();
    expect(deriveGameArea(undefined as never)).toBeUndefined();
  });

  it('derives a single placed task as exactly its own public cell', () => {
    const t = task({ coordinates: { lat: 31.7767, lng: 35.2345 } });
    expect(deriveGameArea([stage([t])] as never))
      .toEqual(approximatePublicPoint({ lat: 31.7767, lng: 35.2345 }));
  });

  it('derives the coarsened mean of several tasks, and the result is itself on the grid', () => {
    const got = deriveGameArea([stage([
      task({ id: 'a', coordinates: { lat: 31.70, lng: 35.20 } }),
      task({ id: 'b', coordinates: { lat: 31.80, lng: 35.30 } }),
    ])] as never)!;
    expect(got).toBeDefined();
    // Idempotent under the public grid snap — a derived area is a cell centre like any
    // other published point, never a sharper average of them.
    expect(approximatePublicPoint(got)).toEqual(got);
    expect(got.lat).toBeGreaterThan(31.7);
    expect(got.lat).toBeLessThan(31.8);
  });

  it('excludes hideLocation tasks — the location is the puzzle', () => {
    expect(deriveGameArea([stage([
      task({ id: 'a', hideLocation: true }),
      task({ id: 'b', hideLocation: true, coordinates: { lat: 32.1, lng: 34.8 } }),
    ])] as never)).toBeUndefined();
  });

  it('derives a mixed game from its visible task alone', () => {
    const visible = { lat: 31.7767, lng: 35.2345 };
    expect(deriveGameArea([stage([
      task({ id: 'a', coordinates: visible }),
      task({ id: 'b', hideLocation: true, coordinates: { lat: 29.55, lng: 34.95 } }),
    ])] as never)).toEqual(approximatePublicPoint(visible));
  });

  it('excludes locationless, unplaced and invalid tasks', () => {
    expect(deriveGameArea([stage([
      task({ id: 'a', locationless: true }),
      task({ id: 'b', coordinates: { lat: 0, lng: 0 } }),
      task({ id: 'c', coordinates: { lat: 999, lng: 35 } }),
      task({ id: 'd', coordinates: { lat: Number.NaN, lng: 35 } }),
      task({ id: 'e', coordinates: undefined }),
    ])] as never)).toBeUndefined();
  });

  it('spans stages', () => {
    const got = deriveGameArea([
      stage([task({ id: 'a', locationless: true })]),
      { ...stage([task({ id: 'b', coordinates: { lat: 31.7767, lng: 35.2345 } })]), order: 1 },
    ] as never);
    expect(got).toEqual(approximatePublicPoint({ lat: 31.7767, lng: 35.2345 }));
  });

  it('is pure: repeated calls agree and the input is not mutated', () => {
    const stages = [stage([task({ id: 'a' }), task({ id: 'b', coordinates: { lat: 31.9, lng: 35.4 } })])];
    const before = JSON.stringify(stages);
    expect(deriveGameArea(stages as never)).toEqual(deriveGameArea(stages as never));
    expect(JSON.stringify(stages)).toBe(before);
  });
});

describe('resolveGameArea', () => {
  const stages = [stage([task({ coordinates: { lat: 31.7767, lng: 35.2345 } })])] as never;

  it('returns an authored area verbatim, label included', () => {
    const authored = { lat: 32.0853, lng: 34.7818, label: 'Tel Aviv' };
    expect(resolveGameArea(authored, stages)).toEqual(authored);
  });

  it('falls back to the derived area when none is authored', () => {
    expect(resolveGameArea(undefined, stages)).toEqual(deriveGameArea(stages));
  });

  it('falls back when the authored area is unusable', () => {
    const derived = deriveGameArea(stages);
    expect(resolveGameArea({ lat: 0, lng: 0 } as never, stages)).toEqual(derived);
    expect(resolveGameArea({ lat: 999, lng: 1 } as never, stages)).toEqual(derived);
    expect(resolveGameArea({ label: 'no coords' } as never, stages)).toEqual(derived);
  });

  it('returns undefined when nothing is authored and nothing can be derived', () => {
    expect(resolveGameArea(undefined, [stage([task({ hideLocation: true })])] as never)).toBeUndefined();
  });
});
