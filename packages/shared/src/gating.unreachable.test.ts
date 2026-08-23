// RED first (change: unreachable-task-strand). Two pure decisions, both here:
//
//  (b) RUNTIME — `unreachableTaskIds`: given one stage's unlock graph and ONE
//      team's per-task progress, which still-unassigned tasks can that team never
//      complete? That is the fact `applyStageCompletion` needs so its `allTerminal`
//      arm can fire when a task's prerequisite was skipped (the exclusive-group
//      loser), instead of leaving the team in the stage forever.
//
//  (a) BUILD TIME — `exclusiveUnlockRisks`: which tasks COULD die that way for
//      SOME choice of exclusive-group members, so the Builder can warn while the
//      creator is still authoring. Advisory only: the shape is legitimate
//      branching content, and (b) makes it safe to play.
import { describe, it, expect } from 'vitest';
import { unreachableTaskIds, exclusiveUnlockRisks, type TaskProgressStatus } from './gating';

type Gate = { id: string; unlockAfterTaskIds?: string[] };
const task = (id: string, unlockAfterTaskIds?: string[]): Gate =>
  unlockAfterTaskIds ? { id, unlockAfterTaskIds } : { id };

const status = (m: Record<string, TaskProgressStatus>): Record<string, TaskProgressStatus> => m;

describe('unreachableTaskIds — the runtime reachability decision', () => {
  it('returns nothing for a stage with no unlock gates', () => {
    const tasks = [task('a'), task('b'), task('c')];
    expect(unreachableTaskIds(tasks, status({ a: 'completed', b: 'assigned', c: 'unassigned' }))).toEqual([]);
  });

  it('returns nothing for an empty stage', () => {
    expect(unreachableTaskIds([], status({}))).toEqual([]);
  });

  it('keeps a task gated on a normal still playable task', () => {
    const tasks = [task('a'), task('b', ['a'])];
    expect(unreachableTaskIds(tasks, status({ a: 'unassigned', b: 'unassigned' }))).toEqual([]);
  });

  it('keeps a task gated on the group member that WON (its prerequisite is completed)', () => {
    // a1/a2 are alternatives; the team completed a1, so a2 was retired.
    const tasks = [task('a1'), task('a2'), task('b', ['a1'])];
    expect(unreachableTaskIds(tasks, status({ a1: 'completed', a2: 'skipped', b: 'unassigned' }))).toEqual([]);
  });

  it('marks a task gated on the group member that LOST (its prerequisite is skipped)', () => {
    const tasks = [task('a1'), task('a2'), task('b', ['a1'])];
    expect(unreachableTaskIds(tasks, status({ a1: 'skipped', a2: 'completed', b: 'unassigned' }))).toEqual(['b']);
  });

  it('propagates transitively along a chain a to b to c', () => {
    const tasks = [task('a'), task('b', ['a']), task('c', ['b'])];
    expect(unreachableTaskIds(tasks, status({ a: 'skipped', b: 'unassigned', c: 'unassigned' })))
      .toEqual(['b', 'c']);
  });

  it('kills only the dead branch of a diamond and leaves the live one alone', () => {
    // root completed; left branch skipped, right branch alive. `sink` needs BOTH
    // (AND semantics) so it dies with the left branch; `right` survives.
    const tasks = [
      task('root'), task('left', ['root']), task('right', ['root']), task('sink', ['left', 'right']),
    ];
    expect(unreachableTaskIds(tasks, status({
      root: 'completed', left: 'skipped', right: 'unassigned', sink: 'unassigned',
    }))).toEqual(['sink']);
  });

  it('terminates on a cycle and reports every task in it', () => {
    const tasks = [task('a', ['b']), task('b', ['a'])];
    expect(unreachableTaskIds(tasks, status({ a: 'unassigned', b: 'unassigned' }))).toEqual(['a', 'b']);
  });

  it('terminates on a self reference', () => {
    const tasks = [task('a', ['a']), task('b')];
    expect(unreachableTaskIds(tasks, status({ a: 'unassigned', b: 'unassigned' }))).toEqual(['a']);
  });

  it('treats an unknown or cross stage prerequisite id as unreachable', () => {
    const tasks = [task('a', ['from-another-stage'])];
    expect(unreachableTaskIds(tasks, status({ a: 'unassigned' }))).toEqual(['a']);
  });

  it('never returns a task the team already completed or is holding', () => {
    // Both depend on a skipped prerequisite, yet neither may be retroactively
    // skipped: one is graded, the other is in the team's hands right now.
    const tasks = [task('a'), task('done', ['a']), task('inflight', ['a'])];
    expect(unreachableTaskIds(tasks, status({
      a: 'skipped', done: 'completed', inflight: 'assigned',
    }))).toEqual([]);
  });

  it('keeps dependents of an ASSIGNED task alive, because it may still complete', () => {
    const tasks = [task('a'), task('b', ['a'])];
    expect(unreachableTaskIds(tasks, status({ a: 'assigned', b: 'unassigned' }))).toEqual([]);
  });

  it('never returns an already skipped task (it is terminal, not newly dead)', () => {
    const tasks = [task('a'), task('b', ['a'])];
    expect(unreachableTaskIds(tasks, status({ a: 'skipped', b: 'skipped' }))).toEqual([]);
  });

  it('treats a missing progress entry as unassigned', () => {
    const tasks = [task('a'), task('b', ['a'])];
    expect(unreachableTaskIds(tasks, status({ a: 'skipped' }))).toEqual(['b']);
  });

  it('is independent of requiredTaskCount: reachability is a fact, the stage end is not its call', () => {
    // A stage that already has enough completions still reports its dead task.
    // Whether the stage ENDS is applyStageCompletion's decision (it ends on
    // completedCount >= required first), so this function must not second guess it.
    const tasks = [task('a1'), task('a2'), task('b', ['a1'])];
    expect(unreachableTaskIds(tasks, status({ a1: 'skipped', a2: 'completed', b: 'unassigned' })))
      .toEqual(['b']);
  });

  it('returns ids in stage order and is idempotent', () => {
    const tasks = [task('z', ['a']), task('a'), task('y', ['z'])];
    const first = unreachableTaskIds(tasks, status({ a: 'skipped', z: 'unassigned', y: 'unassigned' }));
    expect(first).toEqual(['z', 'y']);
    // Applying the result (marking them skipped) leaves nothing more to do.
    expect(unreachableTaskIds(tasks, status({ a: 'skipped', z: 'skipped', y: 'skipped' }))).toEqual([]);
  });
});

describe('exclusiveUnlockRisks — the build time warning', () => {
  const stage = (tasks: Gate[], groups?: { id: string; taskIds: string[] }[]) => ({
    tasks, exclusiveGroups: groups,
  });

  it('reports nothing when no task is gated on a group member', () => {
    expect(exclusiveUnlockRisks(stage([task('a1'), task('a2'), task('b')], [
      { id: 'g1', taskIds: ['a1', 'a2'] },
    ]))).toEqual([]);
  });

  it('reports nothing when there are no exclusive groups at all', () => {
    expect(exclusiveUnlockRisks(stage([task('a'), task('b', ['a'])]))).toEqual([]);
  });

  it('names the dying task, the prerequisite and the alternatives that kill it', () => {
    const risks = exclusiveUnlockRisks(stage([task('a1'), task('a2'), task('b', ['a1'])], [
      { id: 'g1', taskIds: ['a1', 'a2'] },
    ]));
    expect(risks).toEqual([{ taskId: 'b', prerequisiteId: 'a1', groupId: 'g1', alternativeIds: ['a2'] }]);
  });

  it('reports a transitive gate: c requires b requires a group member', () => {
    const risks = exclusiveUnlockRisks(stage([task('a1'), task('a2'), task('b', ['a1']), task('c', ['b'])], [
      { id: 'g1', taskIds: ['a1', 'a2'] },
    ]));
    expect(risks.map((r) => r.taskId)).toEqual(['b', 'c']);
    expect(risks[1]).toEqual({ taskId: 'c', prerequisiteId: 'a1', groupId: 'g1', alternativeIds: ['a2'] });
  });

  it('ignores an inert group of one, which locks nothing', () => {
    expect(exclusiveUnlockRisks(stage([task('a1'), task('b', ['a1'])], [
      { id: 'g1', taskIds: ['a1'] },
    ]))).toEqual([]);
  });

  it('terminates on a cycle and on a self reference', () => {
    expect(exclusiveUnlockRisks(stage([task('a', ['b']), task('b', ['a'])], [])).length).toBe(0);
    expect(exclusiveUnlockRisks(stage([task('a', ['a'])], [])).length).toBe(0);
  });

  it('reports a task gated on its OWN alternative, with no surviving alternative to name', () => {
    // b and a1 are alternatives AND b requires a1: dead whatever the team picks,
    // so the group holds no choice that keeps b alive.
    const risks = exclusiveUnlockRisks(stage([task('a1'), task('b', ['a1'])], [
      { id: 'g1', taskIds: ['a1', 'b'] },
    ]));
    expect(risks).toEqual([{ taskId: 'b', prerequisiteId: 'a1', groupId: 'g1', alternativeIds: [] }]);
  });
});
