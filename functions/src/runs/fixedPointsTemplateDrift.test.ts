// Regression tests for change: fix-fixed-points-speed-template-drift.
//
// The `fixed_points_speed` speed bonus needs a route "expected total minutes".
// It USED to be reduced over the LIVE game template on every recompute, so a
// creator editing a task's `expectedDurationMinutes` mid-run retroactively
// re-scored teams that had already finished — violating the invariant that a
// finished team's score must be a pure function of the STORED team document.
//
// The fix stamps the resolved expected duration onto each terminal RunTaskRecord
// (`expectedDurationMinutesAtCompletion`) at completion/skip, and sums the stamps
// instead of reducing over the template. These are pure tests (no emulator):
// buildRankings is a pure function of stored state.
//
// scoring-v2: the expected total is now the denominator of the team's PACE (its duration over the
// expected minutes of the missions it completed), and speed is a percentage of the team's points.
// The immutability property this file pins is unchanged.
import { describe, test, expect } from 'vitest';
import { buildRankings } from './index';
import type { Game, RunTeam, RunStageRecord } from '@rushpoint/shared';

const T0 = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const now = iso(T0 + 3_600_000);

// One stage, two tasks. expectedDurationMinutes 10 + 20 = route expected 30 min.
function twoTaskGame(exp0 = 10, exp1 = 20): Game {
  return {
    id: 'g', title: 'G', mode: 'individual', scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 's0', order: 0, title: 'S0',
      tasks: [
        { id: 's0t0', title: 'T0', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: exp0, expectedDurationMinutes: exp0, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 's0t1', title: 'T1', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: exp1, expectedDurationMinutes: exp1, pointValue: 50, maxConcurrentTeams: 3 },
      ],
    }],
  } as unknown as Game;
}

// A finished team that completed both tasks in `durationMin` minutes. `stamps`
// controls whether each record carries expectedDurationMinutesAtCompletion (the
// post-change server behavior) or not (a legacy / pre-change record).
function finishedTeam(id: string, durationMin: number, stamps?: [number, number]): RunTeam {
  const mkTask = (taskId: string, taskIndex: number, stamp?: number) => ({
    taskId, taskIndex, status: 'completed', earnedScore: 50,
    ...(stamp !== undefined ? { expectedDurationMinutesAtCompletion: stamp } : {}),
  });
  return {
    id, displayName: id, status: 'finished',
    startedAt: iso(T0), finishedAt: iso(T0 + durationMin * 60_000),
    score: 0, bonusPenalty: 0,
    stages: [{
      stageId: 's0', status: 'completed',
      tasks: [mkTask('s0t0', 0, stamps?.[0]), mkTask('s0t1', 1, stamps?.[1])],
    }],
  } as unknown as RunTeam;
}

// Route expected 30 (stamped), finished in 27. One finisher ⇒ no field, so the plausible estimate
// is the reference: pace 27/30 = 0.9 ⇒ +5% of 100 points = 5. Completion +10% = 10. Score 115.
describe('fixed_points_speed template drift — a finished team is immutable', () => {
  test('1.1 editing a completed task expected duration does NOT re-score a finished team', () => {
    const team = finishedTeam('a', 27, [10, 20]);
    const s1 = buildRankings(twoTaskGame(10, 20), [team], now)[0].score;
    expect(s1).toBe(115);
    // Mutate the template mid-run: lower s0t0's expected duration 10 → 2. Re-score the SAME
    // stored team doc: the stamps win, nothing moves.
    const s2 = buildRankings(twoTaskGame(2, 20), [team], now)[0].score;
    expect(s2).toBe(s1);
  });

  test('1.2 an unedited run scores the golden number: 100 points + 10% completion + 5% pace', () => {
    expect(buildRankings(twoTaskGame(10, 20), [finishedTeam('a', 27, [10, 20])], now)[0].score).toBe(115);
  });

  test('1.3 a legacy team with NO stamps falls back to the template and does not throw', () => {
    const legacy = finishedTeam('a', 27); // no stamps
    let score = 0;
    expect(() => { score = buildRankings(twoTaskGame(10, 20), [legacy], now)[0].score; }).not.toThrow();
    expect(score).toBe(115);
  });

  test('1.3b a stamped record whose template task was deleted contributes its stamp (no NaN)', () => {
    const team = finishedTeam('a', 27, [10, 20]);
    const gameMissingT0 = {
      ...twoTaskGame(10, 20),
      stages: [{ id: 's0', order: 0, title: 'S0', tasks: [
        { id: 's0t1', title: 'T1', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: 20, expectedDurationMinutes: 20, pointValue: 50, maxConcurrentTeams: 3 },
      ] }],
    } as unknown as Game;
    const score = buildRankings(gameMissingT0, [team], now)[0].score;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(115);
  });

  test('1.3c a LEGACY record whose template task was deleted contributes 0, never NaN', () => {
    const legacy = finishedTeam('a', 27); // no stamps
    const gameMissingT0 = {
      ...twoTaskGame(10, 20),
      stages: [{ id: 's0', order: 0, title: 'S0', tasks: [
        { id: 's0t1', title: 'T1', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: 20, expectedDurationMinutes: 20, pointValue: 50, maxConcurrentTeams: 3 },
      ] }],
    } as unknown as Game;
    // s0t0 gone + no stamp → expected 20, pace 27/20 = 1.35 ⇒ −17.5% capped at −15% ⇒ 100 + 10 − 15.
    const score = buildRankings(gameMissingT0, [legacy], now)[0].score;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(95);
  });

  test('1.4 a mid-run edit cannot move two close finished teams', () => {
    // Field of two, stamped expected 30 each: A in 8 min, B in 9. Median pace 8.5/30, so A is
    // ~6% faster (+3) and B ~6% slower (−3).
    const teams = [finishedTeam('a', 8, [10, 20]), finishedTeam('b', 9, [10, 20])];
    const before = buildRankings(twoTaskGame(10, 20), teams, now);
    const after = buildRankings(twoTaskGame(2, 20), teams, now);
    expect(before.map((r) => [r.teamId, r.score])).toEqual([['a', 113], ['b', 107]]);
    expect(after.map((r) => [r.teamId, r.score])).toEqual(before.map((r) => [r.teamId, r.score]));
  });

  test('1.5 the stored stamp takes precedence over the live template value', () => {
    // Stamps 10 + 20 = 30 win over a template now saying 2 + 2.
    expect(buildRankings(twoTaskGame(2, 2), [finishedTeam('a', 27, [10, 20])], now)[0].score).toBe(115);
  });
});
