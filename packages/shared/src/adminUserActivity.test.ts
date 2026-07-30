// Admin platform-user activity rollup (change: admin-user-activity-dashboard).
//
// Pure so the "how do we define games-created / runs-launched / last-active" rule is
// unit-tested independent of Firestore/Auth I/O. See design.md §D1/§D3.
import { describe, it, expect } from 'vitest';
import { buildAdminUserSummary, type AdminAuthUserFacts, type AdminUserGameFacts, type AdminUserRunFacts } from './adminUserActivity';

const authUser = (over: Partial<AdminAuthUserFacts> = {}): AdminAuthUserFacts => ({
  uid: 'creator-1',
  email: 'creator@example.com',
  displayName: 'Creator One',
  createdAt: null,
  lastSignInAt: null,
  ...over,
});

const game = (over: Partial<AdminUserGameFacts> = {}): AdminUserGameFacts => ({
  id: 'game-1',
  title: 'Old City Treasure Hunt',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: undefined,
  ...over,
});

const run = (over: Partial<AdminUserRunFacts> = {}): AdminUserRunFacts => ({
  id: 'run-1',
  gameId: 'game-1',
  gameTitle: 'Old City Treasure Hunt',
  status: 'finished',
  createdAt: '2026-01-02T00:00:00.000Z',
  finishedAt: '2026-01-02T02:00:00.000Z',
  participantCount: 4,
  ...over,
});

describe('buildAdminUserSummary', () => {
  it('counts and lists the games and runs it is given', () => {
    const s = buildAdminUserSummary(authUser(), [game(), game({ id: 'game-2' })], [run()]);
    expect(s.gamesCreatedCount).toBe(2);
    expect(s.games.map((g) => g.id)).toEqual(['game-1', 'game-2']);
    expect(s.runsLaunchedCount).toBe(1);
    expect(s.runs.map((r) => r.id)).toEqual(['run-1']);
  });

  it('lastActiveAt is the max of sign-in, game, and run timestamps', () => {
    const s = buildAdminUserSummary(
      authUser({ lastSignInAt: '2026-01-01T00:00:00.000Z' }),
      [game({ updatedAt: '2026-03-01T00:00:00.000Z' })],
      [run({ finishedAt: '2026-02-01T00:00:00.000Z' })],
    );
    expect(s.lastActiveAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('falls back to a run createdAt when it has not finished', () => {
    const s = buildAdminUserSummary(
      authUser({ lastSignInAt: '2026-01-01T00:00:00.000Z' }),
      [],
      [run({ finishedAt: undefined, createdAt: '2026-05-01T00:00:00.000Z', status: 'active' })],
    );
    expect(s.lastActiveAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('sign-in-only: no games and no runs falls back to lastSignInAt', () => {
    const s = buildAdminUserSummary(authUser({ lastSignInAt: '2026-01-05T00:00:00.000Z' }), [], []);
    expect(s.lastActiveAt).toBe('2026-01-05T00:00:00.000Z');
    expect(s.gamesCreatedCount).toBe(0);
    expect(s.runsLaunchedCount).toBe(0);
  });

  it('activity-only: no lastSignInAt is derived purely from games/runs', () => {
    const s = buildAdminUserSummary(
      authUser({ lastSignInAt: null }),
      [game({ updatedAt: '2026-04-01T00:00:00.000Z' })],
      [],
    );
    expect(s.lastActiveAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('a fully empty user never throws and has a null lastActiveAt', () => {
    const s = buildAdminUserSummary(authUser({ lastSignInAt: null, createdAt: null }), [], []);
    expect(s.lastActiveAt).toBeNull();
  });

  it('a soft-deleted game is still counted, flagged deleted', () => {
    const s = buildAdminUserSummary(authUser(), [game({ deletedAt: '2026-06-01T00:00:00.000Z' })], []);
    expect(s.gamesCreatedCount).toBe(1);
    expect(s.games[0].deleted).toBe(true);
  });

  it('a game with no deletedAt is flagged not deleted', () => {
    const s = buildAdminUserSummary(authUser(), [game()], []);
    expect(s.games[0].deleted).toBe(false);
  });

  it('carries the raw auth identity fields through untouched', () => {
    const s = buildAdminUserSummary(authUser({ uid: 'x', email: 'x@y.com', displayName: 'X' }), [], []);
    expect(s.uid).toBe('x');
    expect(s.email).toBe('x@y.com');
    expect(s.displayName).toBe('X');
  });
});
