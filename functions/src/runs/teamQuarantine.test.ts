import { describe, expect, test } from 'vitest';
import { parseTeamsQuarantining } from './index';

// A minimal doc that parseRunTeam accepts.
function goodTeam(id: string): Record<string, unknown> {
  return {
    id,
    runId: 'run-1',
    gameId: 'game-1',
    ownerUid: 'owner-1',
    displayName: `Team ${id}`,
    registrationData: {},
    status: 'registered',
    stages: [],
    score: 0,
    bonusPenalty: 0,
    launched: false,
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
}

// Structural stand-in for a Firestore QueryDocumentSnapshot: id + data().
function snap(id: string, data: unknown) {
  return { id, data: () => data };
}

describe('parseTeamsQuarantining — one bad row cannot abort scoring', () => {
  test('drops a single unparseable team and keeps the valid ones', () => {
    const bad = { ...goodTeam('bad'), registrationData: 'not-an-object' }; // parseRunTeam throws
    const docs = [snap('a', goodTeam('a')), snap('bad', bad), snap('b', goodTeam('b'))];
    const teams = parseTeamsQuarantining(docs);
    expect(teams.map((t) => t.id)).toEqual(['a', 'b']);
  });

  test('never throws, even when every row is poisoned', () => {
    const docs = [snap('x', { nope: true }), snap('y', 42), snap('z', null)];
    expect(() => parseTeamsQuarantining(docs)).not.toThrow();
    expect(parseTeamsQuarantining(docs)).toEqual([]);
  });

  test('an all-good batch is returned unchanged', () => {
    const docs = [snap('a', goodTeam('a')), snap('b', goodTeam('b'))];
    expect(parseTeamsQuarantining(docs).map((t) => t.id)).toEqual(['a', 'b']);
  });
});
