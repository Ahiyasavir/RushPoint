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
// buildRankings and scoreFixedPointsSpeed are pure functions of stored state.
import { describe, test, expect } from 'vitest';
import { buildRankings } from './index';
import { scoreFixedPointsSpeed } from '@rushpoint/shared';
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

// Route expected 30, finished in 27 → delta 3 → bonus 30. taskPoints 100 +
// completion 500 = 630. Single team → no Z-score adjustment (needs ≥2 finishers).
describe('fixed_points_speed template drift — a finished team is immutable', () => {
  test('1.1 editing a completed task expected duration does NOT re-score a finished team', () => {
    const team = finishedTeam('a', 27, [10, 20]);
    const s1 = buildRankings(twoTaskGame(10, 20), [team], now)[0].score;
    expect(s1).toBe(630);

    // Mutate the template mid-run: lower s0t0's expected duration 10 → 2. Under the
    // OLD code this shrank expectedTotal to 22, killed the speed bonus and dropped
    // the score to 600. Re-score the SAME stored team doc.
    const s2 = buildRankings(twoTaskGame(2, 20), [team], now)[0].score;
    expect(s2).toBe(s1); // unchanged — drift gone
  });

  test('1.2 an unedited run scores the golden pre-change number', () => {
    const team = finishedTeam('a', 27, [10, 20]);
    // 100 taskPoints + 30 speed bonus + 500 completion bonus.
    expect(buildRankings(twoTaskGame(10, 20), [team], now)[0].score).toBe(630);
    // And the stamped sum equals the template reduce for the unedited template:
    // scoreFixedPointsSpeed (raw, no completion bonus) = 100 + 30 = 130.
    const raw = scoreFixedPointsSpeed(team.stages, team.startedAt, team.finishedAt, twoTaskGame(10, 20));
    expect(raw).toBe(130);
  });

  test('1.3 a legacy team with NO stamps falls back to the template and does not throw', () => {
    const legacy = finishedTeam('a', 27); // no stamps
    let score = 0;
    expect(() => { score = buildRankings(twoTaskGame(10, 20), [legacy], now)[0].score; }).not.toThrow();
    // Fallback resolves to the same template values → identical pre-change score.
    expect(score).toBe(630);
  });

  test('1.3b a stamped record whose template task was deleted contributes its stamp (no NaN)', () => {
    const team = finishedTeam('a', 27, [10, 20]);
    // Template now only has s0t1; s0t0 was deleted mid-run. The stamped s0t0 (10)
    // must still count → expectedTotal 30, score 630, finite.
    const gameMissingT0 = {
      ...twoTaskGame(10, 20),
      stages: [{ id: 's0', order: 0, title: 'S0', tasks: [
        { id: 's0t1', title: 'T1', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: 20, expectedDurationMinutes: 20, pointValue: 50, maxConcurrentTeams: 3 },
      ] }],
    } as unknown as Game;
    const score = buildRankings(gameMissingT0, [team], now)[0].score;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(630);
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
    // s0t0 gone + no stamp → contributes 0; expectedTotal = 20, actual 27 → no bonus.
    // taskPoints 100 + completion 500 = 600. Finite, no throw.
    const score = buildRankings(gameMissingT0, [legacy], now)[0].score;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(600);
  });

  test('1.4 a mid-run edit near the 200-pt cap cannot flip two close finished teams', () => {
    // Two teams near the cap. Route expected (stamped) 30 for both. Team A finished
    // in 8 min → delta 22 → bonus 200 (capped). Team B in 9 min → delta 21 → 200
    // (also capped) but B is 1 min slower. Compare raw speed-bonus-bearing scores.
    const stages = (durMin: number): [RunStageRecord[], string, string] => {
      const t = finishedTeam('x', durMin, [10, 20]);
      return [t.stages, t.startedAt!, t.finishedAt!];
    };
    const [aStages, aStart, aFin] = stages(8);
    const [bStages, bStart, bFin] = stages(9);
    const edited = twoTaskGame(2, 20); // a mid-run edit that shrank expectedTotal to 22

    // Under the OLD template-reduce, the edited expectedTotal 22 would give A
    // delta 14 → 140 and B delta 13 → 130, still A > B — but a subtler near-cap
    // edit could flip. The point of the fix: the stamped sum ignores the edit, so
    // scores are computed from expectedTotal 30 regardless.
    const aScore = scoreFixedPointsSpeed(aStages, aStart, aFin, edited);
    const bScore = scoreFixedPointsSpeed(bStages, bStart, bFin, edited);
    // Both capped at 200 bonus + 100 taskPoints = 300; A and B tie on score, and
    // crucially neither reads the edited template. A is faster so ranking breaks by
    // duration downstream; the scores themselves are edit-independent.
    expect(aScore).toBe(300);
    expect(bScore).toBe(300);
    // The edit did not change either score vs the unedited template.
    expect(scoreFixedPointsSpeed(aStages, aStart, aFin, twoTaskGame(10, 20))).toBe(aScore);
    expect(scoreFixedPointsSpeed(bStages, bStart, bFin, twoTaskGame(10, 20))).toBe(bScore);
  });

  test('1.5 the stored stamp takes precedence over the live template value', () => {
    // A record stamped 10 but whose template now says 2: the stamp (10) must win.
    const team = finishedTeam('a', 27, [10, 20]);
    const editedGame = twoTaskGame(2, 2); // both template durations lowered
    // Stamps 10 + 20 = 30 → delta 3 → bonus 30 → raw 130 (NOT the template's 4).
    expect(scoreFixedPointsSpeed(team.stages, team.startedAt, team.finishedAt, editedGame)).toBe(130);
  });
});
