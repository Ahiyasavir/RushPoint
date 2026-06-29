import { expect, test, describe } from 'vitest';
import type { Task } from '@rushpoint/shared';
import { computeSkillRatio } from './assignNextTask';

// Minimal game task — only the fields computeSkillRatio reads (id, estimatedMinutes).
function task(id: string, estimatedMinutes: number): Task {
  return {
    id,
    title: id,
    type: 'field',
    coordinates: { lat: 31.78, lng: 35.21 },
    difficulty: 3,
    estimatedMinutes,
    pointValue: 100,
    maxConcurrentTeams: 3,
  } as Task;
}

describe('computeSkillRatio — finiteness invariant', () => {
  test('garbage timestamps never poison the ratio with NaN', async () => {
    const gameTasks = [task('a', 10)];
    const completed = [{ taskId: 'a', startedAt: 'not-a-date', completedAt: 'also-bad' }];
    const r = await computeSkillRatio(completed, gameTasks);
    expect(Number.isFinite(r)).toBe(true);
  });

  test('a garbage row does not corrupt a valid row in the same batch', async () => {
    const gameTasks = [task('a', 10), task('b', 10)];
    const completed = [
      { taskId: 'a', actualMinutes: 10 },            // exactly on estimate → 0
      { taskId: 'b', startedAt: 'x', completedAt: 'y' }, // garbage → must be ignored
    ];
    const r = await computeSkillRatio(completed, gameTasks);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(0); // only the valid on-estimate row counts
  });

  test('valid faster-than-estimate timing yields a negative ratio', async () => {
    const gameTasks = [task('a', 10)];
    const completed = [{ taskId: 'a', actualMinutes: 5 }]; // (5-10)/10 = -0.5
    const r = await computeSkillRatio(completed, gameTasks);
    expect(r).toBeCloseTo(-0.5, 5);
  });
});
