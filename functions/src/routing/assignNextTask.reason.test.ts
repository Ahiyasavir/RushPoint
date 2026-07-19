import { describe, it, expect } from 'vitest';
import { classifyNoAssignment } from './assignNextTask';
import type { Task } from '@rushpoint/shared';

// Minimal Task factory — only the fields classifyNoAssignment reads. Completion is
// modelled via the completedTaskIds arg (as in real routing), NOT task.status.
function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    type: 'field',
    ...over,
  } as Task;
}

const NOW = Date.now();

describe('classifyNoAssignment', () => {
  it("returns 'stationsFull' when every eligible task is at its cap", () => {
    const tasks = [
      task({ id: 'a', maxConcurrentTeams: 1 }),
      task({ id: 'b', maxConcurrentTeams: 2 }),
    ];
    const counts = { a: 1, b: 2 };
    expect(classifyNoAssignment(tasks, [], counts, undefined, NOW)).toBe('stationsFull');
  });

  it("returns 'allLocked' when only unlock-gated tasks remain", () => {
    // b unlocks only after 'x' is completed; nothing is completed → locked.
    const tasks = [task({ id: 'b', unlockAfterTaskIds: ['x'] })];
    expect(classifyNoAssignment(tasks, [], {}, undefined, NOW)).toBe('allLocked');
  });

  it("returns 'none' when there are no unassigned tasks at all", () => {
    // 'a' completed (excluded via completedTaskIds), 'b' closed.
    const tasks = [task({ id: 'a' }), task({ id: 'b', status: 'closed' })];
    expect(classifyNoAssignment(tasks, ['a'], {}, undefined, NOW)).toBe('none');
  });

  it('prefers stationsFull over allLocked when both are present', () => {
    const tasks = [
      task({ id: 'a', maxConcurrentTeams: 1 }), // full → cap-blocked
      task({ id: 'b', unlockAfterTaskIds: ['x'] }), // locked
    ];
    expect(classifyNoAssignment(tasks, [], { a: 1 }, undefined, NOW)).toBe('stationsFull');
  });
});
