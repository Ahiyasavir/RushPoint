import { describe, expect, test } from 'vitest';
import { nextBonusPenalty, BONUS_PENALTY_BOUND } from './bonusPenalty';

describe('nextBonusPenalty — accumulated result is validated, not just the input', () => {
  test('a normal delta subtracts and stays finite', () => {
    expect(nextBonusPenalty(0, 50)).toBe(-50);
    expect(nextBonusPenalty(100, -25)).toBe(125);
  });

  test('result is clamped to ±BONUS_PENALTY_BOUND (a single huge delta cannot escape)', () => {
    expect(nextBonusPenalty(0, -1e18)).toBe(BONUS_PENALTY_BOUND);
    expect(nextBonusPenalty(0, 1e18)).toBe(-BONUS_PENALTY_BOUND);
    // Already-clamped previous + another large delta stays bounded.
    expect(nextBonusPenalty(BONUS_PENALTY_BOUND, -1e12)).toBe(BONUS_PENALTY_BOUND);
  });

  test('a non-finite ACCUMULATED result throws invalid-argument (never returns Infinity)', () => {
    // Each input delta is finite, but prev - delta overflows to ±Infinity: the
    // exact two-large-finite-deltas-accumulate case the input finite-check misses.
    const overflow = () => nextBonusPenalty(-Number.MAX_VALUE, Number.MAX_VALUE);
    expect(overflow).toThrow();
    try {
      overflow();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('invalid-argument');
    }
    // NaN prev likewise never slips through as a stored value.
    expect(() => nextBonusPenalty(NaN, 0)).toThrow();
  });

  test('composing two clamped adjustments never yields a non-finite total', () => {
    let p = 0;
    p = nextBonusPenalty(p, -1e308);
    p = nextBonusPenalty(p, -1e308);
    expect(Number.isFinite(p)).toBe(true);
    expect(Math.abs(p)).toBeLessThanOrEqual(BONUS_PENALTY_BOUND);
  });
});
