// Server-side mirror of the creator-web Wizard's `isTaskInteractionValid`
// (apps/creator-web/src/lib/wizardLogic.ts). The Wizard blocks a creator from
// finishing a task that can never be completed, but that's a CLIENT guard —
// a direct `updateGame`/`launchRun` callable invocation bypasses it entirely,
// so a quiz with no accepted answer, a numeric task with no numericAnswer, a
// smart_station with no secretCode, or a sequence with no steps could still be
// persisted and launched. Every participant attempt at such a task would then
// fail forever (matchesTaskAnswer/verifyStationCode/submitSequenceStep all
// reject an empty answer key). Kept pure + dependency-free so both the client
// Wizard and the server validators can share the identical rule (no drift).
import type { Task } from './types';
import { validateOrderItems } from './ordering';

/**
 * True when `task` has an answer key that makes it possible to complete.
 * Other types (field/self_report/photo/geofence/survey) self-validate or have
 * safe defaults and are always completable.
 */
export function isTaskCompletable(task: Pick<Task,
  'type' | 'answers' | 'orderItems' | 'numericAnswer' | 'smart' | 'steps'
>): boolean {
  if (task.type === 'quiz') {
    // Ordering variant (change: quiz-ordering): valid orderItems replace answers.
    if (task.orderItems && task.orderItems.length > 0) {
      return validateOrderItems(task.orderItems) === null;
    }
    return !!task.answers && task.answers.some((a) => a.trim() !== '');
  }
  if (task.type === 'numeric') {
    return task.numericAnswer != null && Number.isFinite(task.numericAnswer);
  }
  if (task.type === 'smart_station') {
    return !!task.smart?.secretCode?.trim();
  }
  if (task.type === 'sequence') {
    return !!task.steps && task.steps.length > 0;
  }
  return true;
}

/** Human-readable reason a task isn't completable (or null when it is), for error messages. */
export function taskCompletabilityError(task: Pick<Task,
  'type' | 'title' | 'id' | 'answers' | 'orderItems' | 'numericAnswer' | 'smart' | 'steps'
>): string | null {
  if (isTaskCompletable(task)) return null;
  const label = `Task "${task.title || task.id}"`;
  switch (task.type) {
    case 'quiz': return `${label}: a quiz needs at least one non-empty accepted answer (or valid ordering items)`;
    case 'numeric': return `${label}: a numeric task needs a numeric answer`;
    case 'smart_station': return `${label}: a station task needs a secret code`;
    case 'sequence': return `${label}: a sequence task needs at least one step`;
    default: return `${label}: is not completable`;
  }
}
