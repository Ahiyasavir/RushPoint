// Activation funnel + platform summary (change: admin-engagement-and-outreach).
//
// The dashboard's first version answered "who are my users". The question actually worth
// answering is "where do they stop", because the live data already shows the answer:
// creators who build a game and never launch a run. These are the pure rules behind that.
import { describe, it, expect } from 'vitest';
import {
  activationStage,
  summarizePlatform,
  type AdminUserSummary,
} from './adminUserActivity';

const user = (over: Partial<AdminUserSummary> = {}): AdminUserSummary => ({
  uid: 'u1', email: 'a@b.com', displayName: null, createdAt: null, lastSignInAt: null,
  gamesCreatedCount: 0, games: [], runsLaunchedCount: 0, runs: [],
  lastActiveAt: null, engagementMs: 0, participantsReached: 0,
  note: '', noteUpdatedAt: null,
  emailed: false, emailedAt: null,
  ...over,
});

const run = (status: string, participants = 0) => ({
  id: 'r' + Math.random(), gameId: 'g', gameTitle: 'G', status,
  createdAt: '2026-01-01T00:00:00.000Z', finishedAt: null, participantCount: participants,
});

describe('activationStage', () => {
  it('a fresh account that built nothing is signed_up', () => {
    expect(activationStage(user())).toBe('signed_up');
  });

  it('a game with no run is built_game — the drop off this dashboard exists to surface', () => {
    expect(activationStage(user({ gamesCreatedCount: 1 }))).toBe('built_game');
  });

  it('a launched run that never finished is launched_run', () => {
    expect(activationStage(user({ gamesCreatedCount: 1, runsLaunchedCount: 1, runs: [run('active')] })))
      .toBe('launched_run');
  });

  it('a finished run is completed_run, the fully activated state', () => {
    expect(activationStage(user({ gamesCreatedCount: 1, runsLaunchedCount: 1, runs: [run('finished')] })))
      .toBe('completed_run');
  });

  it('one finished run among many unfinished still counts as completed', () => {
    expect(activationStage(user({
      gamesCreatedCount: 2, runsLaunchedCount: 3, runs: [run('active'), run('finished'), run('lobby')],
    }))).toBe('completed_run');
  });

  it('a run without a game (data drift) still reports launched, never crashes', () => {
    expect(activationStage(user({ runsLaunchedCount: 1, runs: [run('active')] }))).toBe('launched_run');
  });
});

describe('summarizePlatform', () => {
  it('an empty platform reports zeros, not NaN, and a zero activation rate', () => {
    const s = summarizePlatform([]);
    expect(s.totalCreators).toBe(0);
    expect(s.activationRate).toBe(0);
    expect(Number.isFinite(s.activationRate)).toBe(true);
  });

  it('counts creators, games, runs and participants reached', () => {
    const s = summarizePlatform([
      user({ uid: 'a', gamesCreatedCount: 2, runsLaunchedCount: 1, runs: [run('finished', 5)], participantsReached: 5 }),
      user({ uid: 'b', gamesCreatedCount: 1, runsLaunchedCount: 2, runs: [run('active', 3), run('finished', 4)], participantsReached: 7 }),
    ]);
    expect(s.totalCreators).toBe(2);
    expect(s.totalGames).toBe(3);
    expect(s.totalRuns).toBe(3);
    expect(s.totalParticipants).toBe(12);
  });

  it('buckets every creator into exactly one funnel stage', () => {
    const s = summarizePlatform([
      user({ uid: 'a' }),
      user({ uid: 'b', gamesCreatedCount: 1 }),
      user({ uid: 'c', gamesCreatedCount: 1 }),
      user({ uid: 'd', gamesCreatedCount: 1, runsLaunchedCount: 1, runs: [run('finished')] }),
    ]);
    expect(s.funnel).toEqual({ signed_up: 1, built_game: 2, launched_run: 0, completed_run: 1 });
    const summed = Object.values(s.funnel).reduce((a, b) => a + b, 0);
    expect(summed).toBe(s.totalCreators);
  });

  it('activation rate is the share who ever launched a run, rounded to a percent', () => {
    const s = summarizePlatform([
      user({ uid: 'a', gamesCreatedCount: 1 }),
      user({ uid: 'b', gamesCreatedCount: 1, runsLaunchedCount: 1, runs: [run('active')] }),
      user({ uid: 'c', gamesCreatedCount: 1, runsLaunchedCount: 1, runs: [run('finished')] }),
      user({ uid: 'd' }),
    ]);
    expect(s.activationRate).toBe(50);
  });

  it('sums engagement across creators', () => {
    const s = summarizePlatform([
      user({ uid: 'a', engagementMs: 3600_000 }),
      user({ uid: 'b', engagementMs: 1800_000 }),
    ]);
    expect(s.totalEngagementMs).toBe(5400_000);
  });

  it('is total against corrupt rows rather than throwing', () => {
    const s = summarizePlatform([
      user({ uid: 'a', engagementMs: undefined as never, gamesCreatedCount: undefined as never }),
    ]);
    expect(Number.isFinite(s.totalEngagementMs)).toBe(true);
    expect(Number.isFinite(s.totalGames)).toBe(true);
  });
});
