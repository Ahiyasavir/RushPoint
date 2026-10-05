// Defense-in-depth for finalSpeedBonus (change: fair-final-score; it replaced the Z-score whose
// same guard lived here): a non-finite duration in the cohort, Infinity from an
// unstarted-but-finished team, must never poison a finisher's bonus.
import { describe, test, expect } from 'vitest';
import { finalSpeedBonus } from './scoringPresets';

describe('finalSpeedBonus — a non-finite duration never poisons the score', () => {
  test('an Infinity in the cohort is ignored', () => {
    expect(finalSpeedBonus(100, 10, [10, 20, 30, 40, Infinity])).toBe(10);
  });
  test('a team whose own duration is not finite gets nothing', () => {
    expect(finalSpeedBonus(100, Infinity, [10, 20, 30, 40])).toBe(0);
  });
  test('NaN points give 0, not NaN', () => {
    expect(finalSpeedBonus(Number.NaN, 10, [10, 20, 30, 40])).toBe(0);
  });
});
