// Stage winnability (change: stage-winnability).
//
// `Stage.requiredTaskCount` says "complete N of these M tasks", but exclusive
// groups mean a single team can never complete all M: each group yields exactly
// one completion. Six tasks in three groups of two yield THREE, which is the bug
// a product owner hit (the Builder offered "6 of 6" on exactly that shape).
//
// These tests pin the ONE function every surface reads — the authoring control,
// the launch guard, the server save validation and the live pause guard — so the
// rule cannot be re-derived (weakly) in four places again, which is how the bug
// got in.
import { describe, it, expect } from 'vitest';
import {
  maxCompletableTasks, maxAttainableCompletions, requiredTaskCountProblem,
  type ExclusionStage,
} from './mutualExclusion';

const stage = (ids: string[], groups?: { id: string; taskIds: string[] }[]): ExclusionStage => ({
  tasks: ids.map((id) => ({ id })),
  ...(groups ? { exclusiveGroups: groups } : {}),
});

describe('maxCompletableTasks — the static (Builder time) ceiling', () => {
  it('is the task count when no exclusive group is authored', () => {
    expect(maxCompletableTasks(stage(['a', 'b', 'c', 'd', 'e', 'f']))).toBe(6);
  });

  it('THE REPORTED CASE: six tasks in three groups of two yield three', () => {
    const s = stage(['a1', 'a2', 'b1', 'b2', 'c1', 'c2'], [
      { id: 'g-a', taskIds: ['a1', 'a2'] },
      { id: 'g-b', taskIds: ['b1', 'b2'] },
      { id: 'g-c', taskIds: ['c1', 'c2'] },
    ]);
    expect(maxCompletableTasks(s)).toBe(3);
  });

  it('mixes grouped and ungrouped tasks: five tasks with one pair grouped yield four', () => {
    expect(maxCompletableTasks(
      stage(['a', 'b', 'c', 'd', 'e'], [{ id: 'g', taskIds: ['a', 'b'] }]),
    )).toBe(4);
  });

  it('treats a group naming a single task as inert, so that task still counts', () => {
    expect(maxCompletableTasks(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['a'] }]))).toBe(3);
  });

  it('ignores an empty group', () => {
    expect(maxCompletableTasks(stage(['a', 'b'], [{ id: 'g', taskIds: [] }]))).toBe(2);
  });

  it('counts a task listed in TWO groups once, toward the first group that names it', () => {
    // g1 claims [a,b]; g2's remaining member is only `c`, so g2 is inert (<2) and
    // `c` stays ungrouped. 3 tasks - 2 grouped + 1 group = 2.
    const s = stage(['a', 'b', 'c'], [
      { id: 'g1', taskIds: ['a', 'b'] },
      { id: 'g2', taskIds: ['b', 'c'] },
    ]);
    expect(maxCompletableTasks(s)).toBe(2);
  });

  it('ignores group members that are not tasks of this stage', () => {
    expect(maxCompletableTasks(
      stage(['a', 'b'], [{ id: 'g', taskIds: ['a', 'from-another-stage'] }]),
    )).toBe(2);
  });

  it('is zero for a stage with no tasks', () => {
    expect(maxCompletableTasks(stage([]))).toBe(0);
    expect(maxCompletableTasks(stage([], [{ id: 'g', taskIds: ['ghost'] }]))).toBe(0);
  });

  it('keeps maxAttainableCompletions as an exact alias, so no existing caller moves', () => {
    const s = stage(['a', 'b', 'c', 'd'], [{ id: 'g', taskIds: ['a', 'b'] }]);
    expect(maxAttainableCompletions(s)).toBe(maxCompletableTasks(s));
  });
});

describe('maxCompletableTasks — the runtime (availability) form', () => {
  const unavailable = (...ids: string[]) => ({ isAvailable: (id: string) => !ids.includes(id) });

  it('still counts a group when only ONE of its alternatives is unavailable', () => {
    const s = stage(['a1', 'a2', 'b'], [{ id: 'g', taskIds: ['a1', 'a2'] }]);
    expect(maxCompletableTasks(s, unavailable('a1'))).toBe(2); // the group (via a2) + b
  });

  it('drops a group only when EVERY alternative is unavailable', () => {
    const s = stage(['a1', 'a2', 'b'], [{ id: 'g', taskIds: ['a1', 'a2'] }]);
    expect(maxCompletableTasks(s, unavailable('a1', 'a2'))).toBe(1); // b only
  });

  it('drops an unavailable ungrouped task', () => {
    expect(maxCompletableTasks(stage(['a', 'b', 'c']), unavailable('b'))).toBe(2);
  });

  it('is the static ceiling when everything is available', () => {
    const s = stage(['a1', 'a2', 'b'], [{ id: 'g', taskIds: ['a1', 'a2'] }]);
    expect(maxCompletableTasks(s, { isAvailable: () => true })).toBe(maxCompletableTasks(s));
  });
});

// The exact predicate the SERVER rejects on (functions/src/games/index.ts
// stagesProblems, shared by updateGame AND importGameFile) and that the Builder's
// launch readiness reports. Tested here rather than in `functions` so the client
// and the server provably run the same code, not two copies of the same idea.
describe('requiredTaskCountProblem — the save-blocking rule', () => {
  const threePairs = (requiredTaskCount?: number): ExclusionStage => ({
    tasks: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((id) => ({ id })),
    exclusiveGroups: [
      { id: 'g-a', taskIds: ['a1', 'a2'] },
      { id: 'g-b', taskIds: ['b1', 'b2'] },
      { id: 'g-c', taskIds: ['c1', 'c2'] },
    ],
    ...(requiredTaskCount === undefined ? {} : { requiredTaskCount }),
  });

  it('rejects the reported stage and names the count and the maximum', () => {
    const problem = requiredTaskCountProblem(threePairs(6));
    expect(problem).toContain('6');
    expect(problem).toContain('3');
  });

  it('prefixes the caller supplied label so the creator knows WHICH stage', () => {
    expect(requiredTaskCountProblem(threePairs(6), 'Stage "The Old City"'))
      .toMatch(/^Stage "The Old City": /);
  });

  it('accepts a count that fits under the ceiling', () => {
    expect(requiredTaskCountProblem(threePairs(3))).toBeNull();
    expect(requiredTaskCountProblem(threePairs(1))).toBeNull();
  });

  it('accepts an UNSET count, which means every task and always terminates', () => {
    expect(requiredTaskCountProblem(threePairs())).toBeNull();
  });

  it('accepts a full count on a stage with no groups', () => {
    expect(requiredTaskCountProblem({ ...stage(['a', 'b', 'c']), requiredTaskCount: 3 })).toBeNull();
  });

  it('ignores a non-finite count rather than blocking a save on it', () => {
    // Shape validation owns that case (gameFile.hardening); this rule must not
    // turn a malformed number into a second, differently worded refusal.
    for (const bad of [Infinity, -Infinity, NaN, undefined, null, '3']) {
      expect(requiredTaskCountProblem({ ...threePairs(), requiredTaskCount: bad as never })).toBeNull();
    }
  });
});
