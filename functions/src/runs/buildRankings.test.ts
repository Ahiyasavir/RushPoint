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
