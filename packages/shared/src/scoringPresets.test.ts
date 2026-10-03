// Defense-in-depth for the field-relative pace (scoring-v2, the successor of applyZScoreBonus): a
// non-finite duration in the field (Infinity from an unstarted-but-finished team) must never reach
// the reference or poison another finisher's ratio. Pure logic — no emulator.
import { describe, test, expect } from 'vitest';
import { fieldPaceRatios, pacePct } from './scoringPresets';

describe('fieldPaceRatios — a non-finite finisher never poisons the field', () => {
  test('an Infinity in the field is left out, the rest are compared among themselves', () => {
    const r = fieldPaceRatios([
      { durationMin: Infinity, expectedMin: 10 },
      { durationMin: 10, expectedMin: 10 },
      { durationMin: 20, expectedMin: 10 },
    ]);
    expect(r[0]).toBeNull();
    expect(r.slice(1).every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    expect(pacePct(r[1])).toBeGreaterThan(0);
    expect(pacePct(r[2])).toBeLessThan(0);
  });

  test('all equal ⇒ everyone on the median, no bonus', () => {
    expect(fieldPaceRatios([{ durationMin: 10, expectedMin: 5 }, { durationMin: 10, expectedMin: 5 }]).map(pacePct)).toEqual([0, 0]);
  });

  test('a normal spread rewards the faster team (regression guard)', () => {
    const [fast, slow] = fieldPaceRatios([{ durationMin: 5, expectedMin: 10 }, { durationMin: 15, expectedMin: 10 }]);
    expect(pacePct(fast)).toBeGreaterThan(0);
    expect(pacePct(slow)).toBeLessThan(0);
  });
});
