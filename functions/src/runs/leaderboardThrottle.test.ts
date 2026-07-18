import { describe, it, expect } from 'vitest';
import {
  shouldRefreshLeaderboard,
  leaderboardRefreshFields,
  LEADERBOARD_REFRESH_MIN_MS,
} from './leaderboardThrottle';

const NOW = Date.parse('2026-07-09T16:00:00.000Z');

describe('shouldRefreshLeaderboard', () => {
  it('refreshes when there is no previous snapshot timestamp', () => {
    expect(shouldRefreshLeaderboard(undefined, NOW)).toBe(true);
  });

  it('refreshes when the previous timestamp is unparsable garbage', () => {
    expect(shouldRefreshLeaderboard('not-a-date', NOW)).toBe(true);
  });

  it('skips when the snapshot is fresher than the minimum interval', () => {
    const fresh = new Date(NOW - LEADERBOARD_REFRESH_MIN_MS + 1).toISOString();
    expect(shouldRefreshLeaderboard(fresh, NOW)).toBe(false);
  });

  it('refreshes when the snapshot is older than the minimum interval', () => {
    const stale = new Date(NOW - LEADERBOARD_REFRESH_MIN_MS - 1).toISOString();
    expect(shouldRefreshLeaderboard(stale, NOW)).toBe(true);
  });

  it('refreshes at exactly the minimum interval boundary', () => {
    const boundary = new Date(NOW - LEADERBOARD_REFRESH_MIN_MS).toISOString();
    expect(shouldRefreshLeaderboard(boundary, NOW)).toBe(true);
  });

  it('honors a custom interval', () => {
    const fiveSecAgo = new Date(NOW - 5_000).toISOString();
    expect(shouldRefreshLeaderboard(fiveSecAgo, NOW, 10_000)).toBe(false);
    expect(shouldRefreshLeaderboard(fiveSecAgo, NOW, 5_000)).toBe(true);
  });

  it('refreshes when the snapshot timestamp is in the future (clock skew)', () => {
    // A future updatedAt should not wedge refreshes forever; treat skew as stale.
    const future = new Date(NOW + 60_000).toISOString();
    expect(shouldRefreshLeaderboard(future, NOW)).toBe(true);
  });
});

describe('leaderboardRefreshFields', () => {
  const NOW_ISO = '2026-07-10T00:00:00.000Z';

  it('writes only rankings + timestamps — never the organizer-controlled flags', () => {
    const fields = leaderboardRefreshFields([{ teamId: 'a', rank: 1 }], NOW_ISO);
    // Exactly these three keys, so a concurrent publish/freeze can never be clobbered.
    expect(Object.keys(fields).sort()).toEqual([
      'leaderboard.rankings',
      'leaderboard.updatedAt',
      'updatedAt',
    ]);
    expect(fields).not.toHaveProperty('leaderboard.published');
    expect(fields).not.toHaveProperty('leaderboard.frozen');
    // Must NOT be a full-object overwrite of the leaderboard map.
    expect(fields).not.toHaveProperty('leaderboard');
  });

  it('carries the rankings payload through and stamps both timestamps', () => {
    const rankings = [{ teamId: 'x', rank: 1 }];
    const fields = leaderboardRefreshFields(rankings, '2026-07-10T01:02:03.000Z');
    expect(fields['leaderboard.rankings']).toBe(rankings);
    expect(fields['leaderboard.updatedAt']).toBe('2026-07-10T01:02:03.000Z');
    expect(fields['updatedAt']).toBe('2026-07-10T01:02:03.000Z');
  });
});
