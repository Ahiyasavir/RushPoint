import { describe, expect, test } from 'vitest';
import { teamHoldsTask } from './index';

// Holding the mission (deploy check 2026-10-23): every participant door refuses a mission the team
// was never handed. The rule is pure on the stored team document.
type Status = 'unassigned' | 'assigned' | 'completed' | 'skipped';
function team(recs: Array<[string, Status]>, activeTaskId: string | null = null) {
  return {
    activeTaskId,
    stages: [{ stageId: 's1', status: 'active', tasks: recs.map(([taskId, status], i) => ({ taskId, taskIndex: i, status })) }],
  } as unknown as Parameters<typeof teamHoldsTask>[0];
}

describe('teamHoldsTask', () => {
  test('the assigned mission is held', () => {
    expect(teamHoldsTask(team([['a', 'assigned'], ['b', 'unassigned']], 'a'), 'a')).toBe(true);
  });

  test('a mission routing never handed this team is not held (the production probe)', () => {
    expect(teamHoldsTask(team([['a', 'assigned'], ['b', 'unassigned']], 'a'), 'b')).toBe(false);
    expect(teamHoldsTask(team([['a', 'unassigned'], ['b', 'unassigned']], null), 'a')).toBe(false);
  });

  test('activeTaskId alone is enough (the two are written together)', () => {
    expect(teamHoldsTask(team([['a', 'unassigned']], 'a'), 'a')).toBe(true);
  });

  test('a terminal record passes, so a duplicate submission stays the idempotent no-op', () => {
    expect(teamHoldsTask(team([['a', 'completed']]), 'a')).toBe(true);
    expect(teamHoldsTask(team([['a', 'skipped']]), 'a')).toBe(true);
  });

  test('an unknown task passes here; completion already treats it as a no-op', () => {
    expect(teamHoldsTask(team([['a', 'assigned']], 'a'), 'nope')).toBe(true);
  });

  test('a team document with no stages does not throw', () => {
    expect(teamHoldsTask({ activeTaskId: null } as never, 'a')).toBe(true);
  });
});
