import { describe, it, expect } from 'vitest';
import { reconcileTaskCounts, taskCountsReconciled } from './reconcileTaskCounts';
import type { RunTeam } from '@rushpoint/shared';

// Minimal RunTeam factory — only the fields reconcile reads matter here.
function team(activeTaskId: string | null | undefined): RunTeam {
  return { activeTaskId } as unknown as RunTeam;
}

describe('reconcileTaskCounts', () => {
  it('counts one holder per team that has a non-empty activeTaskId', () => {
    const teams = [team('A'), team('A'), team('B')];
    expect(reconcileTaskCounts(teams)).toEqual({ A: 2, B: 1 });
  });

  it('a team with activeTaskId:null contributes nothing', () => {
    const teams = [team('A'), team(null), team(undefined), team('')];
    expect(reconcileTaskCounts(teams)).toEqual({ A: 1 });
  });

  it('returns an empty map for a fully-finished run (no active tasks)', () => {
    const teams = [team(null), team(undefined)];
    expect(reconcileTaskCounts(teams)).toEqual({});
  });
});

describe('taskCountsReconciled — the leak oracle', () => {
  it('detects an orphaned +1 (stored {A:2} but only 1 team holds A)', () => {
    const teams = [team('A')];
    // The self-heal target differs from the leaked stored value.
    expect(reconcileTaskCounts(teams)).toEqual({ A: 1 });
    expect(taskCountsReconciled({ A: 2 }, teams)).toBe(false);
  });

  it('accepts stored counts that match the live holders exactly', () => {
    const teams = [team('A'), team('A'), team('B')];
    expect(taskCountsReconciled({ A: 2, B: 1 }, teams)).toBe(true);
  });

  it('ignores zero-valued keys on either side (a drained station may keep its key)', () => {
    const teams = [team('A')];
    expect(taskCountsReconciled({ A: 1, B: 0, C: 0 }, teams)).toBe(true);
    expect(taskCountsReconciled({ A: 1 }, teams)).toBe(true);
  });

  it('flags a negative counter as unreconciled', () => {
    const teams = [team(null)];
    expect(taskCountsReconciled({ A: -1 }, teams)).toBe(false);
  });

  it('treats undefined stored counts as an empty map', () => {
    expect(taskCountsReconciled(undefined, [team(null)])).toBe(true);
    expect(taskCountsReconciled(undefined, [team('A')])).toBe(false);
  });
});
