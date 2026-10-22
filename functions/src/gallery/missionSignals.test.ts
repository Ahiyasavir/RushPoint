// What creators teach the mission bank (change: composer-v2-learning): the pure half of
// `recordMissionSignals`. The callable itself is covered by scripts/e2e-verify.mjs.
import { describe, expect, test } from 'vitest';
import { MAX_SIGNAL_KEYS, MISSION_STATS_DOC, parseMissionSignals, statsIncrements } from './missionSignals';

describe('parseMissionSignals', () => {
  test('keeps real bank keys, deduplicated', () => {
    expect(parseMissionSignals({ kept: ['four-things', 'four-things', 'agent-in-crowd'], swapped: ['elevator-race'] }))
      .toEqual({ kept: ['four-things', 'agent-in-crowd'], swapped: ['elevator-race'] });
  });

  test('a key both kept and swapped in one call counts as swapped only', () => {
    expect(parseMissionSignals({ kept: ['a-b'], swapped: ['a-b'] })).toEqual({ kept: [], swapped: ['a-b'] });
  });

  test('anything that is not a bank key is dropped, never written as a field path', () => {
    const bad = ['', 'Upper', 'has.dot', 'has space', '__proto__', 'a/b', 'x'.repeat(65), 42, null];
    expect(parseMissionSignals({ kept: bad, swapped: bad })).toBeNull();
  });

  test('nothing to record is null', () => {
    expect(parseMissionSignals({})).toBeNull();
    expect(parseMissionSignals(null)).toBeNull();
    expect(parseMissionSignals({ kept: 'four-things' })).toBeNull();
  });

  test('a call is bounded', () => {
    const many = Array.from({ length: 200 }, (_, i) => `k-${i}`);
    const parsed = parseMissionSignals({ kept: many, swapped: many.slice(0, 5).map((k) => `${k}-s`) });
    expect(parsed).not.toBeNull();
    expect(parsed!.kept.length + parsed!.swapped.length).toBeLessThanOrEqual(MAX_SIGNAL_KEYS);
  });
});

describe('statsIncrements', () => {
  test('one nested object, never a dotted key (set+merge writes dotted keys literally)', () => {
    const inc = (n: number) => ({ inc: n });
    const patch = statsIncrements({ kept: ['four-things'], swapped: ['elevator-race'] }, inc);
    expect(patch).toEqual({
      counts: { 'four-things': { kept: { inc: 1 } }, 'elevator-race': { swapped: { inc: 1 } } },
      updatedAt: expect.any(String),
    });
    expect(Object.keys(patch).every((k) => !k.includes('.'))).toBe(true);
  });

  test('the stats live in one document, so a reader pays one read', () => {
    expect(MISSION_STATS_DOC).toBe('missionStats/all');
  });
});
