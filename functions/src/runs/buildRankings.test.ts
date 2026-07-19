// Regression test for the family-playtest crash (change: fix-nonfinite-callable-payload).
// A team that JOINED but was never STARTED has no `startedAt`, so
// durationSeconds(undefined, now) === Infinity. That Infinity used to flow into
// every leaderboard entry's durationSeconds/totalMinutes, poisoning run.leaderboard
// and crashing getMyTeamState / refreshLeaderboard at JSON-encode. buildRankings must
// never emit a non-finite duration. No emulator (buildRankings is pure).
import { describe, test, expect } from 'vitest';
import { buildRankings } from './index';
import type { Game, RunTeam } from '@rushpoint/shared';

const now = new Date(1_700_000_003_600_000).toISOString();

function game(preset: Game['scoringPreset']): Game {
  return {
    id: 'g', title: 'G', mode: 'individual', scoringPreset: preset,
    stages: [{
      id: 's0', order: 0, title: 'S0',
      tasks: [{ id: 's0t0', title: 'T', type: 'field', coordinates: { lat: 0, lng: 0 },
        difficulty: 3, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 }],
    }],
  } as unknown as Game;
}

const startedFinished = (id: string): RunTeam => ({
  id, displayName: id, status: 'finished',
  startedAt: new Date(1_700_000_000_000).toISOString(),
  finishedAt: new Date(1_700_000_001_800_000).toISOString(),
  score: 0, bonusPenalty: 0,
  stages: [{ stageId: 's0', status: 'completed', tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed', earnedScore: 50 }] }],
} as unknown as RunTeam);

// The bug trigger: joined but never started → no startedAt.
const joinedNotStarted = (id: string): RunTeam => ({
  id, displayName: id, status: 'active',
  startedAt: undefined, finishedAt: undefined,
  score: 0, bonusPenalty: 0,
  stages: [{ stageId: 's0', status: 'active', tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'assigned' }] }],
} as unknown as RunTeam);

describe('buildRankings — no non-finite duration (playtest regression)', () => {
  const presets: Game['scoringPreset'][] = ['time_only', 'fixed_points_speed', 'smart_weighted'];

  for (const preset of presets) {
    test(`[${preset}] an unstarted team never yields Infinity duration`, () => {
      const board = buildRankings(game(preset), [startedFinished('a'), joinedNotStarted('b')], now);
      for (const entry of board) {
        // Optional fields: absent is fine; present must be finite.
        if (entry.durationSeconds !== undefined) expect(Number.isFinite(entry.durationSeconds)).toBe(true);
        if (entry.totalMinutes !== undefined) expect(Number.isFinite(entry.totalMinutes)).toBe(true);
      }
    });

    test(`[${preset}] the whole board JSON-encodes without throwing`, () => {
      const board = buildRankings(game(preset), [startedFinished('a'), joinedNotStarted('b')], now);
      expect(() => JSON.stringify(board)).not.toThrow();
    });
  }

  test('an all-unstarted run still produces an encodable board', () => {
    const board = buildRankings(game('fixed_points_speed'), [joinedNotStarted('a'), joinedNotStarted('b')], now);
    expect(() => JSON.stringify(board)).not.toThrow();
    expect(board).toHaveLength(2);
  });
});

// A team that FINISHED but has no `startedAt` (finishedAt set, startedAt undefined)
// passes parseRunTeam quarantine (it requires neither field) and reaches buildRankings
// with durationMin = Infinity/60 = Infinity. It also passes the `t.finishedAt`-only
// Z-cohort filter, so mu/sigma go non-finite and EVERY finisher's score becomes NaN.
// The cohort must exclude non-finite durations so scores stay finite and the sort stays
// deterministic (NaN comparators are non-deterministic).
const finishedNoStart = (id: string): RunTeam => ({
  id, displayName: id, status: 'finished',
  startedAt: undefined,
  finishedAt: new Date(1_700_000_001_800_000).toISOString(),
  score: 0, bonusPenalty: 0,
  stages: [{ stageId: 's0', status: 'completed', tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed', earnedScore: 50 }] }],
} as unknown as RunTeam);

describe('buildRankings — Z-cohort excludes non-finite durations', () => {
  test('every entry score stays finite when a finished team has no startedAt', () => {
    const board = buildRankings(
      game('smart_weighted'),
      [startedFinished('a'), startedFinished('b'), finishedNoStart('c')],
      now,
    );
    expect(board).toHaveLength(3);
    for (const entry of board) {
      expect(Number.isFinite(entry.score)).toBe(true);
    }
  });

  test('board JSON-encodes and the sort is order-stable across reversed input', () => {
    const teams = [startedFinished('a'), startedFinished('b'), finishedNoStart('c')];
    const first = buildRankings(game('smart_weighted'), teams, now);
    const second = buildRankings(game('smart_weighted'), [...teams].reverse(), now);
    expect(() => JSON.stringify(first)).not.toThrow();
    expect(first.map((r) => r.teamId)).toEqual(second.map((r) => r.teamId));
  });
});

// WO Fix 3: the time_only sort branch had no terminal teamId tie-break, so two
// teams that tie on both duration and completedStages kept their (unordered
// Firestore) input order — the live/public board could churn between refreshes.
// Add a deterministic teamId fallback to the time_only branch.
describe('buildRankings — time_only deterministic tie-break', () => {
  test('unfinished tied teams sort by teamId regardless of input order', () => {
    const a = joinedNotStarted('a');
    const b = joinedNotStarted('b');
    expect(buildRankings(game('time_only'), [b, a], now).map((r) => r.teamId)).toEqual(['a', 'b']);
    expect(buildRankings(game('time_only'), [a, b], now).map((r) => r.teamId)).toEqual(['a', 'b']);
  });

  test('two consecutive builds are order-stable', () => {
    const a = joinedNotStarted('a');
    const b = joinedNotStarted('b');
    const first = buildRankings(game('time_only'), [a, b], now).map((r) => r.teamId);
    const second = buildRankings(game('time_only'), [b, a], now).map((r) => r.teamId);
    expect(first).toEqual(second);
  });

  test('finished teams tied on duration and completedStages break by teamId', () => {
    // Two finished teams with equal durationSeconds and equal completedStages.
    const a = startedFinished('a');
    const b = startedFinished('b');
    expect(buildRankings(game('time_only'), [b, a], now).map((r) => r.teamId)).toEqual(['a', 'b']);
    expect(buildRankings(game('time_only'), [a, b], now).map((r) => r.teamId)).toEqual(['a', 'b']);
  });
});
