// Guards the server-side completability check wired into updateGame/launchRun
// (a direct callable invocation must not be able to persist/launch a task that
// no participant could ever complete — the Wizard's client-side guard is
// bypassable). See packages/shared/src/taskCompletability.ts.
import { describe, test, expect } from 'vitest';
import { isTaskCompletable, taskCompletabilityError } from '@rushpoint/shared';
import type { Task } from '@rushpoint/shared';

function baseTask(overrides: Partial<Task>): Task {
  return {
    id: 't1', title: 'Task', type: 'field',
    ...overrides,
  } as Task;
}

describe('isTaskCompletable', () => {
  test('quiz with no answers and no orderItems is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'quiz' }))).toBe(false);
  });
  test('quiz with only whitespace answers is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'quiz', answers: ['  ', ''] }))).toBe(false);
  });
  test('quiz with a real answer IS completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'quiz', answers: ['Jerusalem'] }))).toBe(true);
  });
  test('quiz with valid orderItems IS completable (ordering variant)', () => {
    expect(isTaskCompletable(baseTask({
      type: 'quiz', orderItems: ['a', 'b', 'c'],
    }))).toBe(true);
  });

  test('numeric with no numericAnswer is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'numeric' }))).toBe(false);
  });
  test('numeric with NaN numericAnswer is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'numeric', numericAnswer: NaN }))).toBe(false);
  });
  test('numeric with a finite numericAnswer IS completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'numeric', numericAnswer: 42 }))).toBe(true);
  });

  test('smart_station with no secretCode is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'smart_station' }))).toBe(false);
  });
  test('smart_station with a blank secretCode is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'smart_station', smart: { secretCode: '   ' } as never }))).toBe(false);
  });
  test('smart_station with a secretCode IS completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'smart_station', smart: { secretCode: 'ABC123' } as never }))).toBe(true);
  });

  test('sequence with no steps is NOT completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'sequence' }))).toBe(false);
  });
  test('sequence with steps IS completable', () => {
    expect(isTaskCompletable(baseTask({ type: 'sequence', steps: [{ id: 's1', prompt: 'go' } as never] }))).toBe(true);
  });

  test('field / self_report / photo / geofence / survey always completable', () => {
    for (const type of ['field', 'self_report', 'photo', 'geofence', 'survey'] as const) {
      expect(isTaskCompletable(baseTask({ type }))).toBe(true);
    }
  });
});

describe('taskCompletabilityError', () => {
  test('null when completable', () => {
    expect(taskCompletabilityError(baseTask({ type: 'field' }))).toBeNull();
  });
  test('a descriptive message referencing the task title when not completable', () => {
    const msg = taskCompletabilityError(baseTask({ type: 'quiz', title: 'Riddle' }));
    expect(msg).toContain('Riddle');
  });
});
