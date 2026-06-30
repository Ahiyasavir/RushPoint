// Boundary-input coverage for the pure scoring entry points (change:
// callable-test-coverage). These functions are server-secret-free pure math used
// by finalizeRun / refreshLeaderboard; they had no co-located test. Each case pins
// an edge: non-positive deltas, caps, single-finisher, zero variance, tie-breaks.
import { describe, expect, test } from 'vitest';
import {
  applyZScoreBonus,
  compareForRanking,
  completionBonus,
  computeSprintPenalty,
  computeTieMetrics,
  computeTimeBonus,
  computeTransitPenalty,
  TIME_BONUS_CAP,
} from './calculateScore';

describe('computeTransitPenalty', () => {
  test('on-time or early → 0 (no negative penalty)', () => {
    expect(computeTransitPenalty(10, 10)).toBe(0);
    expect(computeTransitPenalty(5, 10)).toBe(0);
  });
  test('late grows and is capped at 500', () => {
    expect(computeTransitPenalty(11, 10)).toBeGreaterThan(0);
    expect(computeTransitPenalty(1000, 0)).toBe(500);
  });
});

describe('computeSprintPenalty', () => {
  test('0 or negative seconds late → 0', () => {
    expect(computeSprintPenalty(0)).toBe(0);
    expect(computeSprintPenalty(-5)).toBe(0);
  });
  test('capped at 300', () => {
    expect(computeSprintPenalty(100000)).toBe(300);
  });
});

describe('computeTimeBonus', () => {
  test('non-positive expected/actual → 0 (guards divide/garbage)', () => {
    expect(computeTimeBonus(0, 10)).toBe(0);
    expect(computeTimeBonus(10, 0)).toBe(0);
    expect(computeTimeBonus(-1, 10)).toBe(0);
  });
  test('delayed (actual ≥ expected) → 0, never negative', () => {
    expect(computeTimeBonus(10, 12)).toBe(0);
    expect(computeTimeBonus(10, 10)).toBe(0);
  });
  test('beating the target awards perMinute·Δ, capped', () => {
    expect(computeTimeBonus(20, 15)).toBe(50); // 5 min * 10
    expect(computeTimeBonus(10_000, 0 + 1)).toBe(TIME_BONUS_CAP);
  });
});

describe('applyZScoreBonus', () => {
  test('fewer than 2 finishers → raw score unchanged', () => {
    expect(applyZScoreBonus(1000, 30, [30])).toBe(1000);
  });
  test('zero variance (all equal) → raw score unchanged', () => {
    expect(applyZScoreBonus(1000, 30, [30, 30, 30])).toBe(1000);
  });
  test('faster than average → bonus; result never below 0', () => {
    expect(applyZScoreBonus(1000, 10, [10, 30])).toBeGreaterThan(1000);
    expect(applyZScoreBonus(0, 100, [10, 20])).toBeGreaterThanOrEqual(0);
  });
});

describe('completionBonus', () => {
  test('all terminal (completed/skipped) → 500', () => {
    expect(completionBonus([{ status: 'completed' }, { status: 'skipped' }])).toBe(500);
  });
  test('any non-terminal slot → 0', () => {
    expect(completionBonus([{ status: 'completed' }, { status: 'in_progress' }])).toBe(0);
  });
});

describe('computeTieMetrics + compareForRanking', () => {
  test('garbage timestamps contribute 0, penalties floored at 0', () => {
    const m = computeTieMetrics([{ type: 'green', startedAt: 'nope', completedAt: null }], -5);
    expect(m.fieldTaskMs).toBe(0);
    expect(m.penalties).toBe(0);
  });
  test('higher finalScore ranks first regardless of metrics', () => {
    const hi = { finalScore: 100, metrics: { penalties: 99, fieldTaskMs: 9, transitMs: 9 } };
    const lo = { finalScore: 50, metrics: { penalties: 0, fieldTaskMs: 0, transitMs: 0 } };
    expect(compareForRanking(hi, lo)).toBeLessThan(0); // hi sorts before lo
  });
  test('equal score → fewer penalties wins, then field time, then transit', () => {
    const a = { finalScore: 100, metrics: { penalties: 0, fieldTaskMs: 10, transitMs: 5 } };
    const b = { finalScore: 100, metrics: { penalties: 1, fieldTaskMs: 0, transitMs: 0 } };
    expect(compareForRanking(a, b)).toBeLessThan(0); // a has fewer penalties
    const c = { finalScore: 100, metrics: { penalties: 0, fieldTaskMs: 20, transitMs: 0 } };
    expect(compareForRanking(a, c)).toBeLessThan(0); // equal penalties → a's field time lower
  });
});
