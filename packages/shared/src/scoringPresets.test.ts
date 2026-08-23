// Defense-in-depth for applyZScoreBonus: a non-finite duration in the cohort
// (Infinity from an unstarted-but-finished team) makes mu=Infinity, variance=NaN,
// sigma=NaN. The old `sigma === 0` guard did NOT catch NaN, so the function
// returned NaN and poisoned every finisher's score. Pure logic — no emulator.
import { describe, test, expect } from 'vitest';
import { applyZScoreBonus } from './scoringPresets';

describe('applyZScoreBonus — non-finite sigma never poisons the score', () => {
  test('an Infinity in the cohort returns the raw score (finite)', () => {
    // mu = Infinity, variance = NaN, sigma = NaN → must fall back to raw.
    const result = applyZScoreBonus(500, Infinity, [Infinity, 10]);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(500);
  });

  test('sigma === 0 (all equal) still returns the raw score', () => {
    expect(applyZScoreBonus(500, 10, [10, 10])).toBe(500);
  });

  test('a normal spread returns a finite adjusted score (regression guard)', () => {
    const result = applyZScoreBonus(300, 5, [5, 15]);
    expect(Number.isFinite(result)).toBe(true);
    // team is faster than mean (mu=10) → bonus, score > raw.
    expect(result).toBeGreaterThan(300);
  });
});
