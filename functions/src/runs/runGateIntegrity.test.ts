// run-gate-integrity: one regression per way a team could be left in a stage it can
// never finish, or handed a mission it can then not complete. Every case here was
// reproduced against the code before this change. Pure: no Firestore.
import { describe, test, expect } from 'vitest';
import {
  stageRetirements, runStageTasks, gateSatisfiedTaskIds, lockedTaskIds, scheduleRefusal,
  planTeamRewind, planTaskSkip, satisfiesGate, sendBackTargets,
  type Game, type RunStageRecord, type RunTaskRecord,
} from '@rushpoint/shared';
import { applyStageCompletion } from './helpers';
import { applyTaskClosure, applySkipStage, heldTaskIdOf, advanceTeamStateOnPoll, healStrandedStage, stampOperatorPause } from './index';

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
    // The stage total is the sum of its records, including the 10 already earned on 'a'.
    expect(stages[0].earnedScore).toBe(stages[0].tasks.reduce((n, t) => n + (t.earnedScore ?? 0), 0));
    expect(stages[0].earnedScore).toBeGreaterThanOrEqual(15);
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

describe('the send-back picker', () => {
  test('does not offer a mission the organizers closed', () => {
    const out = sendBackTargets(
      [stage('s1', 'active', [rec('a', 'completed'), rec('c', 'skipped', { skipCause: 'operator', closedByOrganizer: true }), rec('d', 'skipped', { skipCause: 'operator' })])],
      [{ id: 's1', title: 'S1', tasks: [{ id: 'a' }, { id: 'c' }, { id: 'd' }] }],
    );
    expect(out[0].missions.map((m) => [m.taskId, m.selectable])).toEqual([['a', true], ['c', false], ['d', true]]);
  });
});

describe('a photo waiting for review when the window closes', () => {
  const g = game([{ id: 's1', isFinal: true, tasks: [{ id: 'p', expiresAfterMinutes: 10 }, { id: 'q' }] }]);
  const team = (pending: boolean) => ({
    id: 't', status: 'active', launched: true,
    stages: [stage('s1', 'active', [rec('p', 'assigned', { startedAt: at(1) }), rec('q')])],
    activeTaskId: 'p',
    ...(pending ? { taskSubmissions: { p: { status: 'pending' } } } : {}),
  }) as unknown as Parameters<typeof advanceTeamStateOnPoll>[0]['team'];
  const poll = async (t: ReturnType<typeof team>) => advanceTeamStateOnPoll({
    team: t, game: g, launchedAt: LAUNCH, nowMs: L + 30 * 60_000, isController: false,
    persist: async () => undefined, release: async () => undefined, onPersistError: () => undefined,
  });

  test('is not swept: it was sent in time, the reviewers decide', async () => {
    const t = team(true);
    await poll(t);
    expect(t.stages[0].tasks[0].status).toBe('assigned');
  });

  test('without a pending submission, the closed window still sweeps the mission', async () => {
    const t = team(false);
    await poll(t);
    expect(t.stages[0].tasks[0]).toMatchObject({ status: 'skipped', skipCause: 'expired' });
  });

  test('a team on a staff hold is not swept at all', async () => {
    const t = { ...team(false), held: true } as ReturnType<typeof team>;
    await poll(t);
    expect(t.stages[0].tasks[0].status).toBe('assigned');
  });
});

describe('a held mission whose attempt cap is used up', () => {
  test('is retired with no points and the team is free to be routed on', () => {
    const g = game([{ id: 's1', isFinal: true, tasks: [{ id: 'q' }, { id: 'r' }] }]);
    Object.assign(g.stages[0].tasks[0], { type: 'quiz', smart: { attemptLimit: 2 } });
    const stages = [stage('s1', 'active', [rec('q', 'assigned'), rec('r')])];
    const out = healStrandedStage(stages, g, LAUNCH, at(5), { q: 2 });
    expect(out).toEqual({ changed: true, heldAssignedTaskIds: ['q'] });
    expect(stages[0].tasks[0]).toMatchObject({ status: 'skipped', skipCause: 'attempts', earnedScore: 0 });
    expect(heldTaskIdOf(stages)).toBeNull();
  });

  test('a type whose door never enforces the cap (a field check-in) is not retired by it', () => {
    const g = game([{ id: 's1', isFinal: true, tasks: [{ id: 'q' }] }]);
    Object.assign(g.stages[0].tasks[0], { type: 'field', smart: { attemptLimit: 1 } });
    const stages = [stage('s1', 'active', [rec('q', 'assigned')])];
    expect(healStrandedStage(stages, g, LAUNCH, at(5), { q: 5 }).changed).toBe(false);
  });

  test('one attempt short of the cap keeps the mission', () => {
    const g = game([{ id: 's1', isFinal: true, tasks: [{ id: 'q' }] }]);
    Object.assign(g.stages[0].tasks[0], { type: 'quiz', smart: { attemptLimit: 2 } });
    const stages = [stage('s1', 'active', [rec('q', 'assigned')])];
    expect(healStrandedStage(stages, g, LAUNCH, at(5), { q: 1 }).changed).toBe(false);
  });
});

describe('an organizer takes a clock-pausing mission the team is on', () => {
  // A "lunch break" mission pauses the race clock. Closing or skipping it moves the team on — it
  // must not also hand the whole break back to the clock. (A team that walks away from it itself
  // still gets nothing excluded: only the operator paths stamp it.)
  const g = game([{ id: 's1', tasks: [{ id: 'lunch', pausesTimer: true } as T, { id: 'b' }] }, { id: 's2', isFinal: true, tasks: [{ id: 'z' }] }]);

  test('a closure stamps the time the team spent on it as excluded', () => {
    const stages = [stage('s1', 'active', [rec('lunch', 'assigned', { startedAt: at(10) }), rec('b')]), stage('s2', 'locked', [rec('z')])];
    applyTaskClosure(stages, g, 'lunch', LAUNCH, at(40));
    expect(stages[0].tasks[0]).toMatchObject({ status: 'skipped', excludedMs: 30 * 60_000 });
  });

  test('a closure of a paused mission nobody started excludes nothing', () => {
    const stages = [stage('s1', 'active', [rec('lunch'), rec('b', 'assigned', { startedAt: at(1) })]), stage('s2', 'locked', [rec('z')])];
    applyTaskClosure(stages, g, 'lunch', LAUNCH, at(40));
    expect(stages[0].tasks[0].excludedMs).toBeUndefined();
  });

  test('skipping the stage stamps it too', () => {
    const stages = [stage('s1', 'active', [rec('lunch', 'assigned', { startedAt: at(10) }), rec('b')]), stage('s2', 'locked', [rec('z')])];
    applySkipStage(stages, 0, g, LAUNCH, at(25), 'op');
    expect(stages[0].tasks[0].excludedMs).toBe(15 * 60_000);
  });

  test('skipping just that mission stamps it (stampOperatorPause)', () => {
    const r = rec('lunch', 'assigned', { startedAt: at(10) });
    stampOperatorPause(r, { pausesTimer: true }, at(20));
    expect(r.excludedMs).toBe(10 * 60_000);
    const plain = rec('b', 'assigned', { startedAt: at(10) });
    stampOperatorPause(plain, { pausesTimer: false }, at(20));
    expect(plain.excludedMs).toBeUndefined();
  });
});
