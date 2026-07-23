// Live task availability (change: live-task-pause) — the PURE decision.
//
// `Task.status` (StationStatus) was already enforced by routing in three places
// and written by nothing, so a stop that dies mid event could not be taken out
// of play. These tests pin the decision that the new callable and the run
// console both read: how an availability resolves, which changes are legal, what
// happens to a team already holding the task, and whether the change would leave
// its stage unable to yield the number of tasks it requires.
import { describe, it, expect } from 'vitest';
import {
  LIVE_TASK_STATUSES,
  isStationStatus,
  effectiveTaskStatus,
  isTaskAssignable,
  planTaskStatusChange,
} from './liveTaskStatus';
import type { StationStatus } from './types';

type T = { id: string; status?: StationStatus };

const task = (id: string, status?: StationStatus): T => ({ id, ...(status ? { status } : {}) });

/** A stage of `n` tasks named t1..tn. */
const stageOf = (n: number, requiredTaskCount?: number) => ({
  tasks: Array.from({ length: n }, (_, i) => task(`t${i + 1}`)),
  ...(requiredTaskCount === undefined ? {} : { requiredTaskCount }),
});

const plan = (input: Parameters<typeof planTaskStatusChange>[0]) => planTaskStatusChange(input);

describe('LIVE_TASK_STATUSES / isStationStatus', () => {
  it('is exactly the three supported values', () => {
    expect([...LIVE_TASK_STATUSES]).toEqual(['active', 'paused', 'closed']);
  });

  it('accepts only those three', () => {
    for (const s of LIVE_TASK_STATUSES) expect(isStationStatus(s)).toBe(true);
    for (const bad of [undefined, null, '', 'PAUSED', 'disabled', 42, {}, []]) {
      expect(isStationStatus(bad)).toBe(false);
    }
  });
});

describe('effectiveTaskStatus — resolution order and totality', () => {
  it('prefers the run override over the template status', () => {
    expect(effectiveTaskStatus(task('a', 'active'), { a: 'paused' })).toBe('paused');
    expect(effectiveTaskStatus(task('a', 'closed'), { a: 'active' })).toBe('active');
  });

  it('falls back to the template status when there is no override', () => {
    expect(effectiveTaskStatus(task('a', 'closed'), {})).toBe('closed');
    expect(effectiveTaskStatus(task('a', 'paused'), undefined)).toBe('paused');
  });

  it('defaults to active when neither is set', () => {
    expect(effectiveTaskStatus(task('a'), {})).toBe('active');
    expect(effectiveTaskStatus(task('a'), undefined)).toBe('active');
  });

  it('ignores an override belonging to a different task', () => {
    expect(effectiveTaskStatus(task('a'), { b: 'paused' })).toBe('active');
  });

  it('fails OPEN on a malformed value at either level, never throwing', () => {
    const bad = ['', 'PAUSED', 'disabled', 42, null, undefined, {}, []];
    for (const v of bad) {
      expect(effectiveTaskStatus(task('a'), { a: v } as never)).toBe('active');
      expect(effectiveTaskStatus({ id: 'a', status: v } as never, {})).toBe('active');
    }
    // A malformed override must not shadow a VALID template status either: the
    // task stays routable rather than becoming permanently dead.
    expect(effectiveTaskStatus(task('a', 'closed'), { a: 'nope' } as never)).toBe('closed');
  });

  it('survives a malformed override map', () => {
    for (const m of [null, 'x', 42, []]) {
      expect(effectiveTaskStatus(task('a'), m as never)).toBe('active');
    }
  });
});

describe('isTaskAssignable', () => {
  it('is true only for an effective active status', () => {
    expect(isTaskAssignable(task('a'), {})).toBe(true);
    expect(isTaskAssignable(task('a', 'paused'), {})).toBe(false);
    expect(isTaskAssignable(task('a', 'closed'), {})).toBe(false);
    expect(isTaskAssignable(task('a', 'paused'), { a: 'active' })).toBe(true);
    expect(isTaskAssignable(task('a'), { a: 'closed' })).toBe(false);
  });
});

describe('planTaskStatusChange — transitions', () => {
  const base = { taskId: 't1', stage: stageOf(4, 1), overrides: {}, teamsHolding: 0 };

  it('permits active -> paused -> active', () => {
    const paused = plan({ ...base, next: 'paused' });
    expect(paused).toMatchObject({ ok: true, from: 'active', to: 'paused', noop: false });
    const back = plan({ ...base, overrides: { t1: 'paused' }, next: 'active' });
    expect(back).toMatchObject({ ok: true, from: 'paused', to: 'active', noop: false });
  });

  it('permits active -> closed and closed -> active (a closed stop can reopen)', () => {
    expect(plan({ ...base, next: 'closed' })).toMatchObject({ ok: true, from: 'active', to: 'closed' });
    expect(plan({ ...base, overrides: { t1: 'closed' }, next: 'active' }))
      .toMatchObject({ ok: true, from: 'closed', to: 'active' });
  });

  it('permits paused -> closed and closed -> paused', () => {
    expect(plan({ ...base, overrides: { t1: 'paused' }, next: 'closed' }))
      .toMatchObject({ ok: true, from: 'paused', to: 'closed' });
    expect(plan({ ...base, overrides: { t1: 'closed' }, next: 'paused' }))
      .toMatchObject({ ok: true, from: 'closed', to: 'paused' });
  });

  it('reports a no-op and never calls it unwinnable', () => {
    const r = plan({ ...base, stage: stageOf(2), overrides: { t1: 'paused' }, next: 'paused' });
    expect(r).toMatchObject({ ok: true, noop: true, stageUnwinnable: false });
  });

  it('rejects a status value that is not one of the three', () => {
    for (const bad of [undefined, null, '', 'PAUSED', 'disabled', 42, {}]) {
      expect(plan({ ...base, next: bad as never })).toEqual({ ok: false, reason: 'unknownStatus' });
    }
  });
});

describe('planTaskStatusChange — a task a team already holds', () => {
  it('never revokes: holders keep the task and the count is reported', () => {
    const r = plan({ taskId: 't1', stage: stageOf(4, 1), overrides: {}, teamsHolding: 3, next: 'paused' });
    expect(r).toMatchObject({ ok: true, holdersKeepTask: true, teamsHolding: 3 });
  });

  it('treats a missing or malformed holder count as zero rather than throwing', () => {
    for (const v of [undefined, null, -1, NaN, 'two']) {
      expect(plan({ taskId: 't1', stage: stageOf(2, 1), overrides: {}, teamsHolding: v as never, next: 'paused' }))
        .toMatchObject({ ok: true, teamsHolding: 0 });
    }
  });
});

describe('planTaskStatusChange — partial completion stages', () => {
  it('stays satisfiable: 4 tasks, 2 required, pause one', () => {
    expect(plan({ taskId: 't1', stage: stageOf(4, 2), overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toMatchObject({ ok: true, availableAfter: 3, requiredCount: 2, stageUnwinnable: false });
  });

  it('becomes unsatisfiable: 4 tasks, 3 required, two already paused, pause a third', () => {
    expect(plan({
      taskId: 't3', stage: stageOf(4, 3), overrides: { t1: 'paused', t2: 'closed' },
      teamsHolding: 0, next: 'paused',
    })).toMatchObject({ ok: true, availableAfter: 1, requiredCount: 3, stageUnwinnable: true });
  });

  it('lands exactly on the boundary without warning', () => {
    expect(plan({
      taskId: 't3', stage: stageOf(4, 2), overrides: { t1: 'paused' },
      teamsHolding: 0, next: 'paused',
    })).toMatchObject({ availableAfter: 2, requiredCount: 2, stageUnwinnable: false });
  });

  it('requires every task when requiredTaskCount is absent', () => {
    expect(plan({ taskId: 't1', stage: stageOf(3), overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toMatchObject({ availableAfter: 2, requiredCount: 3, stageUnwinnable: true });
  });

  it('clamps a requiredTaskCount above the task count, like applyStageCompletion', () => {
    expect(plan({ taskId: 't1', stage: stageOf(2, 9), overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toMatchObject({ availableAfter: 1, requiredCount: 2, stageUnwinnable: true });
  });

  it('honours a template status when computing what is left', () => {
    const stage = { tasks: [task('t1'), task('t2', 'closed'), task('t3')], requiredTaskCount: 2 };
    expect(plan({ taskId: 't1', stage, overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toMatchObject({ availableAfter: 1, requiredCount: 2, stageUnwinnable: true });
  });

  it('never refuses a resume, even from a fully paused stage', () => {
    expect(plan({
      taskId: 't1', stage: stageOf(3), overrides: { t1: 'paused', t2: 'paused', t3: 'closed' },
      teamsHolding: 0, next: 'active',
    })).toMatchObject({ ok: true, availableAfter: 1, stageUnwinnable: false });
  });
});

describe('planTaskStatusChange — degenerate inputs', () => {
  it('rejects an empty stage', () => {
    expect(plan({ taskId: 't1', stage: { tasks: [] }, overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toEqual({ ok: false, reason: 'emptyStage' });
    expect(plan({ taskId: 't1', stage: { tasks: undefined as never }, overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toEqual({ ok: false, reason: 'emptyStage' });
  });

  it('rejects a task that is not in the stage', () => {
    expect(plan({ taskId: 'nope', stage: stageOf(3, 1), overrides: {}, teamsHolding: 0, next: 'paused' }))
      .toEqual({ ok: false, reason: 'taskNotInStage' });
  });

  it('is total over malformed overrides and statuses', () => {
    const overrideValues = [undefined, null, '', 'nope', 42, 'paused'];
    const templateValues = [undefined, null, '', 'nope', 42, 'closed'];
    for (const o of overrideValues) {
      for (const tv of templateValues) {
        const stage = { tasks: [{ id: 't1', status: tv } as never, task('t2')], requiredTaskCount: 1 };
        const r = plan({ taskId: 't1', stage, overrides: { t1: o } as never, teamsHolding: 0, next: 'closed' });
        expect(typeof r).toBe('object');
        expect(r).not.toBeNull();
      }
    }
  });
});

// Stage winnability (change: stage-winnability). The unwinnable rule has to use
// the SAME ceiling the Builder and the server use: a stage of alternatives can
// never yield one completion per task, so counting raw active tasks both
// over-warns (pausing a spare alternative) and under-warns (an authored count
// above the ceiling). Groups are consulted here for the first time.
describe('planTaskStatusChange — exclusive groups shrink what the stage can yield', () => {
  const grouped = (requiredTaskCount?: number) => ({
    tasks: [task('a1'), task('a2'), task('b1'), task('b2')],
    exclusiveGroups: [
      { id: 'g-a', taskIds: ['a1', 'a2'] },
      { id: 'g-b', taskIds: ['b1', 'b2'] },
    ],
    ...(requiredTaskCount === undefined ? {} : { requiredTaskCount }),
  });

  it('does NOT flag pausing one alternative of a pair — the other still plays', () => {
    const r = plan({ taskId: 'a1', stage: grouped(2), overrides: {}, teamsHolding: 0, next: 'paused' });
    expect(r).toMatchObject({ ok: true, stageUnwinnable: false });
  });

  it('DOES flag pausing the last alternative of a pair', () => {
    const r = plan({
      taskId: 'a2', stage: grouped(2), overrides: { a1: 'paused' }, teamsHolding: 0, next: 'paused',
    });
    expect(r).toMatchObject({ ok: true, stageUnwinnable: true });
  });

  it('never compares against a required count above the stage ceiling', () => {
    // Two groups of two: the ceiling is 2, so an authored 4 is capped at 2 and a
    // single pause of a spare alternative is still winnable.
    const r = plan({ taskId: 'a1', stage: grouped(4), overrides: {}, teamsHolding: 0, next: 'paused' });
    expect(r.ok && r.requiredCount).toBe(2);
    expect(r).toMatchObject({ stageUnwinnable: false });
  });

  it('reports availableAfter as completions, not raw active tasks', () => {
    const r = plan({ taskId: 'a1', stage: grouped(2), overrides: {}, teamsHolding: 0, next: 'paused' });
    expect(r.ok && r.availableAfter).toBe(2); // one per group, not 3 raw active tasks
  });
});
