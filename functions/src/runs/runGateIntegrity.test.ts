// run-gate-integrity: one regression per way a team could be left in a stage it can
// never finish, or handed a mission it can then not complete. Every case here was
// reproduced against the code before this change. Pure: no Firestore.
import { describe, test, expect } from 'vitest';
import {
  stageRetirements, runStageTasks, gateSatisfiedTaskIds, lockedTaskIds, scheduleRefusal,
  planTeamRewind, planTaskSkip, satisfiesGate,
  type Game, type RunStageRecord, type RunTaskRecord,
} from '@rushpoint/shared';
import { applyStageCompletion } from './helpers';
import { applyTaskClosure, applySkipStage, heldTaskIdOf } from './index';

const LAUNCH = '2026-01-01T10:00:00.000Z';
const L = Date.parse(LAUNCH);
const at = (min: number) => new Date(L + min * 60_000).toISOString();

const rec = (taskId: string, status: RunTaskRecord['status'] = 'unassigned', extra: Partial<RunTaskRecord> = {}): RunTaskRecord =>
  ({ taskId, taskIndex: 0, status, ...extra });
const stage = (stageId: string, status: RunStageRecord['status'], tasks: RunTaskRecord[], requiredTaskCount?: number): RunStageRecord =>
  ({ stageId, order: 0, status, tasks, ...(requiredTaskCount != null ? { requiredTaskCount } : {}) });
type T = { id: string; unlockAfterTaskIds?: string[]; expiresAfterMinutes?: number; expiresAt?: string; releaseAfterMinutes?: number; hidden?: boolean };
const game = (stages: { id: string; tasks: T[]; requiredTaskCount?: number; exclusiveGroups?: { id: string; taskIds: string[] }[]; isFinal?: boolean; order?: number }[]): Game =>
  ({ stages: stages.map((s, i) => ({ order: i, title: s.id, ...s, tasks: s.tasks.map((t) => ({ title: t.id, type: 'field', difficulty: 5, estimatedMinutes: 5, pointValue: 10, ...t })) })) } as unknown as Game);

describe('a mission whose window closed before the team took it', () => {
  test('is retired, so a stage that needs "all" completes instead of waiting forever', () => {
    const g = game([{ id: 's1', isFinal: true, tasks: [{ id: 'a' }, { id: 'b', expiresAfterMinutes: 10 }] }]);
    const stages = [stage('s1', 'active', [rec('a', 'completed'), rec('b')])];
    const res = applyStageCompletion(stages, 0, g, LAUNCH, at(30));
    expect(res.completed).toBe(true);
    expect(stages[0].tasks[1]).toMatchObject({ status: 'skipped', skipCause: 'expired', earnedScore: 0 });
  });

  test('closes what waits for it, like an expiry always did', () => {
    const r = stageRetirements({
      templateTasks: [{ id: 'a', expiresAt: at(5) }, { id: 'b', unlockAfterTaskIds: ['a'] }],
      records: [rec('a'), rec('b')], launchedAt: LAUNCH, nowMs: L + 6 * 60_000,
    });
    expect(r).toEqual([{ taskId: 'a', cause: 'expired' }, { taskId: 'b', cause: 'unreachable' }]);
  });

  test('a mission the team is HOLDING is never retired by this rule', () => {
    const r = stageRetirements({ templateTasks: [{ id: 'a', expiresAfterMinutes: 1 }], records: [rec('a', 'assigned')], launchedAt: LAUNCH, nowMs: L + 60 * 60_000 });
    expect(r).toEqual([]);
  });

  test('not yet expired ⇒ nothing retired', () => {
    expect(stageRetirements({ templateTasks: [{ id: 'a', expiresAfterMinutes: 60 }], records: [rec('a')], launchedAt: LAUNCH, nowMs: L })).toEqual([]);
  });
});

describe('a benched (or added-after-launch) prerequisite', () => {
  const tpl: T[] = [{ id: 'a', hidden: true }, { id: 'b', unlockAfterTaskIds: ['a'] }, { id: 'c' }];
  const stages = () => [stage('s1', 'active', [rec('b'), rec('c')])]; // buildInitialStages left 'a' out

  test('satisfies the gate for routing, the completion guard and the lock signal', () => {
    const g = game([{ id: 's1', tasks: tpl }]);
    const sat = gateSatisfiedTaskIds(stages(), g.stages);
    expect(sat).toContain('a');
    expect(lockedTaskIds([{ id: 'b', unlockAfterTaskIds: ['a'] }], sat, LAUNCH, L)).toEqual([]);
    // Without the game it is the old, stranding answer.
    expect(gateSatisfiedTaskIds(stages())).not.toContain('a');
  });

  test('is stripped from the run graph and never makes its dependents unreachable', () => {
    expect(runStageTasks(tpl, stages()[0].tasks).map((t) => [t.id, t.unlockAfterTaskIds])).toEqual([['b', undefined], ['c', undefined]]);
    expect(stageRetirements({ templateTasks: tpl, records: stages()[0].tasks, launchedAt: LAUNCH, nowMs: L })).toEqual([]);
  });

  test('is not counted toward what a skip or a closure can still yield', () => {
    const plan = planTaskSkip({
      stage: { tasks: runStageTasks(tpl, stages()[0].tasks) },
      statusByTaskId: { b: 'completed', c: 'unassigned' },
    }, 'c');
    expect(plan.remainingTaskIds).toEqual([]);
    expect(plan.stageCompletes).toBe(true);
  });
});

describe('a mission deleted from the template while the run is live', () => {
  test('its unassigned record is retired as removed, and the stage completes', () => {
    const g = game([{ id: 's1', isFinal: true, tasks: [{ id: 'a' }] }]); // 'gone' was deleted
    const stages = [stage('s1', 'active', [rec('a', 'completed'), rec('gone')])];
    expect(applyStageCompletion(stages, 0, g, LAUNCH, at(1)).completed).toBe(true);
    expect(stages[0].tasks[1]).toMatchObject({ status: 'skipped', skipCause: 'removed' });
  });

  test('a removed prerequisite opens what waited for it (it is no longer part of the game)', () => {
    expect(satisfiesGate({ status: 'skipped', skipCause: 'removed' })).toBe(true);
    const r = stageRetirements({ templateTasks: [{ id: 'b', unlockAfterTaskIds: ['gone'] }], records: [rec('gone'), rec('b')], launchedAt: LAUNCH, nowMs: L });
    expect(r).toEqual([{ taskId: 'gone', cause: 'removed' }]);
  });

  test('a whole stage deleted mid-run retires its records instead of freezing the team in it', () => {
    const g = game([{ id: 's2', isFinal: true, tasks: [{ id: 'x' }] }]);
    const stages = [stage('s1', 'active', [rec('a')]), stage('s2', 'locked', [rec('x')])];
    const res = applyStageCompletion(stages, 0, g, LAUNCH, at(1));
    expect(res.completed).toBe(true);
    expect(stages[1].status).toBe('active');
  });

  test('a game with no readable stages retires nothing', () => {
    const stages = [stage('s1', 'active', [rec('a')])];
    expect(applyStageCompletion(stages, 0, { stages: [] } as unknown as Game, LAUNCH, at(1)).completed).toBe(false);
    expect(stages[0].tasks[0].status).toBe('unassigned');
  });
});

describe('an operator override', () => {
  test('a record carrying gateOverride is never refused by its time window', () => {
    const gate = { releaseAfterMinutes: 30, expiresAfterMinutes: 40 };
    expect(scheduleRefusal(gate, LAUNCH, L)).toBe('notReleased');
    expect(scheduleRefusal(gate, LAUNCH, L + 50 * 60_000)).toBe('expired');
    expect(scheduleRefusal(gate, LAUNCH, L + 35 * 60_000)).toBeNull();
    expect(scheduleRefusal(gate, LAUNCH, L + 50 * 60_000, { gateOverride: true })).toBeNull();
    expect(scheduleRefusal(gate, LAUNCH, L, { gateOverride: true })).toBeNull();
  });
});

describe('a closed mission', () => {
  const g = game([{ id: 's1', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { id: 's2', isFinal: true, tasks: [{ id: 'z' }] }]);

  test('a stage rewind keeps it closed (reopening it stranded the team)', () => {
    const stages = [stage('s1', 'completed', [rec('a', 'completed'), rec('b', 'completed'),
      rec('c', 'skipped', { skipCause: 'operator', closedByOrganizer: true })], 2), stage('s2', 'active', [rec('z')])];
    const plan = planTeamRewind({ stages, gameStages: g.stages, target: { kind: 'stage', stageId: 's1' }, teamScore: 20 });
    expect(plan.ok).toBe(true);
    expect(plan.stages[0].tasks[2].status).toBe('skipped');
    expect(plan.reopenedTaskIds).not.toContain('c');
  });

  test('a mission rewind to it is refused', () => {
    const stages = [stage('s1', 'active', [rec('a', 'completed'), rec('c', 'skipped', { skipCause: 'operator', closedByOrganizer: true }), rec('b')])];
    expect(planTeamRewind({ stages, gameStages: g.stages, target: { kind: 'task', taskId: 'c' }, teamScore: 10 }).reason).toBe('taskClosed');
  });

  test('a rewind restores the requirement clamped to the missions this run has', () => {
    const g2 = game([{ id: 's1', isFinal: true, requiredTaskCount: 4, tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', hidden: true }] }]);
    const stages = [stage('s1', 'completed', [rec('a', 'completed'), rec('b', 'skipped', { skipCause: 'operator' }), rec('c', 'completed')], 2)];
    const plan = planTeamRewind({ stages, gameStages: g2.stages, target: { kind: 'stage', stageId: 's1' }, teamScore: 0 });
    expect(plan.stages[0].requiredTaskCount).toBe(3);
  });

  test('a closure is planned on the run graph: a benched mission does not inflate the requirement', () => {
    const g3 = game([{ id: 's1', isFinal: true, tasks: [{ id: 'a' }, { id: 'b' }, { id: 'h', hidden: true }] }]);
    const stages = [stage('s1', 'active', [rec('a'), rec('b')])];
    applyTaskClosure(stages, g3, 'a', LAUNCH, at(1));
    expect(stages[0].requiredTaskCount).toBe(1);
  });
});

describe('skipStage (applySkipStage)', () => {
  const g = game([
    { id: 's1', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }], exclusiveGroups: [{ id: 'x', taskIds: ['a', 'b'] }] },
    { id: 's2', isFinal: true, tasks: [{ id: 'z' }] },
  ]);
  (g as unknown as { scoringPreset: string }).scoringPreset = 'fixed_points_speed';

  test('pays the consolation ONLY for missions still open — never again for one already skipped', () => {
    const stages = [stage('s1', 'active', [
      rec('a', 'completed', { earnedScore: 10 }),
      rec('b', 'skipped', { skipCause: 'exclusive' }),
      rec('c', 'skipped', { skipCause: 'operator', closedByOrganizer: true, earnedScore: 0 }),
      rec('d', 'skipped', { skipCause: 'operator', earnedScore: 5 }),
      rec('e', 'assigned'),
    ]), stage('s2', 'locked', [rec('z')])];
    const out = applySkipStage(stages, 0, g, LAUNCH, at(1), 'op');
    expect(out.skipLedger.map((l) => l.taskId)).toEqual(out.awardTotal > 0 ? ['e'] : []);
    expect(out.heldTaskIds).toEqual(['e']);
    expect(stages[0].tasks.find((t) => t.taskId === 'b')).toMatchObject({ skipCause: 'exclusive' });
    expect(stages[0].tasks.find((t) => t.taskId === 'c')).toMatchObject({ earnedScore: 0, closedByOrganizer: true });
    expect(stages[0].tasks.find((t) => t.taskId === 'd')).toMatchObject({ skipCause: 'operator', earnedScore: 5 });
    expect(stages[1].status).toBe('active');
  });

  test('does not open a next stage before its scheduled release', () => {
    const g2 = game([{ id: 's1', tasks: [{ id: 'a' }] }, { id: 's2', isFinal: true, tasks: [{ id: 'z' }] }]);
    (g2.stages[1] as unknown as { releaseAfterMinutes: number }).releaseAfterMinutes = 60;
    const stages = [stage('s1', 'active', [rec('a')]), stage('s2', 'locked', [rec('z')])];
    applySkipStage(stages, 0, g2, LAUNCH, at(5), 'op');
    expect(stages[0].status).toBe('completed');
    expect(stages[1].status).toBe('locked');
  });
});

describe('activeTaskId follows the record', () => {
  test('heldTaskIdOf names the assigned record of the active stage, or null', () => {
    expect(heldTaskIdOf([stage('s1', 'completed', [rec('a', 'completed')]), stage('s2', 'active', [rec('b'), rec('c', 'assigned')])])).toBe('c');
    expect(heldTaskIdOf([stage('s1', 'active', [rec('a', 'skipped')])])).toBeNull();
  });
});
