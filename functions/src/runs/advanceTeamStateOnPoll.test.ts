// Unit tests for advanceTeamStateOnPoll (change: fix-getmyteamstate-hotpath-writes).
// The getMyTeamState hot path must: advance the team in memory ALWAYS, persist
// only for the CONTROLLER, and never throw when a persist write is contended
// (the family-playtest lock-timeout). Injected persist/release spies → no emulator.
import { describe, test, expect, vi } from 'vitest';
import { advanceTeamStateOnPoll } from './index';
import type { Game, RunTeam } from '@rushpoint/shared';

// nowMs well after the release instant below.
const NOW = 1_700_000_600_000;
const past = new Date(NOW - 5 * 60_000).toISOString();

// Two-stage game; stage 1 is released in the PAST → due to unlock once stage 0 done.
function game(): Game {
  return {
    id: 'g', title: 'G', mode: 'individual', scoringPreset: 'fixed_points_speed',
    stages: [
      { id: 's0', order: 0, title: 'S0',
        tasks: [{ id: 's0t0', title: 'T', type: 'field', coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 3 }] },
      { id: 's1', order: 1, title: 'S1', isFinal: true, releaseAt: past,
        tasks: [{ id: 's1t0', title: 'T', type: 'field', coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 3 }] },
    ],
  } as unknown as Game;
}

// Team between stages: stage 0 completed, stage 1 locked, none active → a due unlock.
function betweenStages(): RunTeam {
  return {
    id: 'team1', displayName: 'T', status: 'active',
    startedAt: new Date(NOW - 10 * 60_000).toISOString(),
    stages: [
      { stageId: 's0', status: 'completed', tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed', earnedScore: 50 }] },
      { stageId: 's1', status: 'locked', tasks: [{ taskId: 's1t0', taskIndex: 0, status: 'unassigned' }] },
    ],
    score: 0, bonusPenalty: 0,
  } as unknown as RunTeam;
}

const baseArgs = (team: RunTeam, isController: boolean, persist: any, release: any) => ({
  team, game: game(), launchedAt: new Date(NOW - 30 * 60_000).toISOString(), nowMs: NOW,
  isController, persist, release, onPersistError: vi.fn(),
});

describe('advanceTeamStateOnPoll', () => {
  test('controller + due unlock → persists once AND advances the team', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const team = betweenStages();
    await advanceTeamStateOnPoll(baseArgs(team, true, persist, release));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(team.stages.find((s) => s.stageId === 's1')?.status).toBe('active');
  });

  test('non-controller + due unlock → NEVER persists but still advances the team', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const team = betweenStages();
    await advanceTeamStateOnPoll(baseArgs(team, false, persist, release));
    expect(persist).not.toHaveBeenCalled();
    expect(team.stages.find((s) => s.stageId === 's1')?.status).toBe('active');
  });

  test('a contended (rejecting) persist does NOT throw; team still advances; error is reported', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('10 ABORTED: Transaction lock timeout'));
    const release = vi.fn().mockResolvedValue(undefined);
    const team = betweenStages();
    const args = baseArgs(team, true, persist, release);
    await expect(advanceTeamStateOnPoll(args)).resolves.toBeUndefined();
    expect(args.onPersistError).toHaveBeenCalled();
    expect(team.stages.find((s) => s.stageId === 's1')?.status).toBe('active');
  });

  test('nothing due (a stage already active) → no persist, no release', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const team = {
      id: 'team1', displayName: 'T', status: 'active', startedAt: new Date(NOW).toISOString(),
      stages: [{ stageId: 's0', status: 'active', tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'assigned', startedAt: new Date(NOW).toISOString() }] }],
      score: 0, bonusPenalty: 0,
    } as unknown as RunTeam;
    await advanceTeamStateOnPoll(baseArgs(team, true, persist, release));
    expect(persist).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});
