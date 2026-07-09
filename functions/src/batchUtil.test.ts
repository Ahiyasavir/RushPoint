import { expect, test, describe } from 'vitest';
import { chunk } from './batchUtil';

describe('chunk — Firestore batch splitting', () => {
  test('splits into groups no larger than size', () => {
    const r = chunk([1, 2, 3, 4, 5], 2);
    expect(r).toEqual([[1, 2], [3, 4], [5]]);
    expect(r.every((g) => g.length <= 2)).toBe(true);
  });

  test('covers every element exactly once, in order', () => {
    const items = Array.from({ length: 1001 }, (_, i) => i);
    const r = chunk(items, 450);
    expect(r.flat()).toEqual(items);
    expect(r.length).toBe(3); // 450 + 450 + 101
    expect(r.every((g) => g.length <= 450)).toBe(true);
  });

  test('empty input yields no groups', () => {
    expect(chunk([], 450)).toEqual([]);
  });

  test('a size below 1 is rejected (would loop forever)', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
