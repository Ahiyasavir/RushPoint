// Skipping ONE mission for ONE team (change: skip-single-task).
//
// The platform's only skip was `skipStage`, which marks EVERY non-completed task
// of the team's active stage as skipped and ends the stage. So an organiser
// removing one unreachable stop also destroyed every other stop that team still
// had to play. This module is the per-task decision that lets the skip stay
// inside the stage.
//
// It is the SINGLE definition of what a single-task skip does, for the same
// reason `maxCompletableTasks` is the single definition of a stage's completion
// ceiling: the callable, its tests and any future surface must not re-derive it.
// Pure and TOTAL — a malformed stage, an unknown task id or a garbage
// `requiredTaskCount` yields a defined plan, never a throw and never a NaN.
//
// The one genuinely load-bearing rule is the requirement drop. `applyStageCompletion`
// (functions/src/runs/helpers.ts) ends a stage on `completedCount >= required ||
// allTerminal`. Skipping one task of a "3 of 3" stage satisfies NEITHER: the team
// completes the other two and then sits in a stage that can never end, for the rest
// of the event. So a skip lowers THAT TEAM's stored requirement to the number of
// completions still attainable — by the smallest amount that keeps the stage
// winnable, and never below zero.

import { maxCompletableTasks, type ExclusiveGroupLike } from './mutualExclusion';

/** The per-task progress statuses a team's stage record can hold. */
export type SkipTaskStatus = 'unassigned' | 'assigned' | 'completed' | 'skipped';

/** The authored stage shape this decision reads (ids + the exclusive groups). */
export interface SkipTaskStage {
  tasks: { id: string }[];
  exclusiveGroups?: ExclusiveGroupLike[];
}

export interface SkipTaskInput {
  /** The GAME stage: task ids in stage order, plus any exclusive groups. */
  stage: SkipTaskStage;
  /** The TEAM's per-task statuses for that stage. A missing id reads as unassigned. */
  statusByTaskId: Record<string, SkipTaskStatus | undefined>;
  /** The TEAM's stored requirement for that stage. Absent means "every task". */
  requiredTaskCount?: number;
}

/** Why a skip cannot be applied. Reported, never thrown. */
export type SkipTaskProblem = 'taskNotInStage' | 'taskAlreadyTerminal';

export interface SkipTaskPlan {
  ok: boolean;
  reason?: SkipTaskProblem;
  taskId: string;
  /** The record was `assigned`, so it holds a station-occupancy slot to release. */
  heldSlot: boolean;
  /** Completions already banked in this stage (a skip never changes this). */
  completedCount: number;
  /** The ceiling on completions this team can still reach once the task is gone. */
  attainableAfter: number;
  /** The team's requirement for this stage AFTER the skip. Always a finite number ≥ 0. */
  requiredTaskCount: number;
  /** True when the skip forced the requirement down to keep the stage winnable. */
  requirementLowered: boolean;
  /** The skip alone ends the stage (satisfied, or nothing playable left). */
  stageCompletes: boolean;
  /** Tasks this team can still play in this stage after the skip, in stage order. */
  remainingTaskIds: string[];
}

function stageTaskIds(stage: SkipTaskStage | undefined): string[] {
  const tasks = Array.isArray(stage?.tasks) ? stage.tasks : [];
  return tasks.map((t) => t?.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * The stored requirement, normalized. A non-number, a NaN or an absent value all
 * mean "every task"; anything else is clamped into [0, taskCount] so a corrupt
 * document can never produce a negative or unreachable requirement.
 */
function normalizeRequired(required: number | undefined, taskCount: number): number {
  if (typeof required !== 'number' || !Number.isFinite(required)) return taskCount;
  return Math.max(0, Math.min(Math.floor(required), taskCount));
}

function isTerminal(status: SkipTaskStatus): boolean {
  return status === 'completed' || status === 'skipped';
}

/**
 * What skipping `taskId` does to this team's stage.
 *
 * The ceiling is computed with `maxCompletableTasks` (a set of mutually exclusive
 * alternatives yields ONE completion), narrowed to the tasks this team has not
 * skipped — a COMPLETED task deliberately still counts as available, so a group
 * that has already yielded its one completion still contributes exactly 1.
 */
export function planTaskSkip(input: SkipTaskInput, taskId: string): SkipTaskPlan {
  const stage = input?.stage;
  const ids = stageTaskIds(stage);
  const byId = input?.statusByTaskId ?? {};
  const statusOf = (id: string): SkipTaskStatus => byId[id] ?? 'unassigned';

  const completedCount = ids.filter((id) => statusOf(id) === 'completed').length;
  const currentRequired = normalizeRequired(input?.requiredTaskCount, ids.length);

  const refuse = (reason: SkipTaskProblem): SkipTaskPlan => ({
    ok: false,
    reason,
    taskId,
    heldSlot: false,
    completedCount,
    // Nothing changed, so the ceiling and the requirement are today's values and
    // the stage is explicitly NOT reported as completing: a refused call must not
    // look like an action to its caller.
    attainableAfter: maxCompletableTasks(
      { tasks: ids.map((id) => ({ id })), exclusiveGroups: stage?.exclusiveGroups },
      { isAvailable: (id) => statusOf(id) !== 'skipped' },
    ),
    requiredTaskCount: currentRequired,
    requirementLowered: false,
    stageCompletes: false,
    remainingTaskIds: ids.filter((id) => !isTerminal(statusOf(id))),
  });

  if (!ids.includes(taskId)) return refuse('taskNotInStage');
  const status = statusOf(taskId);
  if (isTerminal(status)) return refuse('taskAlreadyTerminal');

  // The world AFTER the skip. Built as a new map — the inputs are never touched.
  const statusAfter = (id: string): SkipTaskStatus => (id === taskId ? 'skipped' : statusOf(id));

  const attainableAfter = maxCompletableTasks(
    { tasks: ids.map((id) => ({ id })), exclusiveGroups: stage?.exclusiveGroups },
    { isAvailable: (id) => statusAfter(id) !== 'skipped' },
  );
  const requiredTaskCount = Math.max(0, Math.min(currentRequired, attainableAfter));
  const remainingTaskIds = ids.filter((id) => !isTerminal(statusAfter(id)));

  return {
    ok: true,
    taskId,
    heldSlot: status === 'assigned',
    completedCount,
    attainableAfter,
    requiredTaskCount,
    requirementLowered: requiredTaskCount < currentRequired,
    // Both arms of applyStageCompletion's own test, computed on the same facts so
    // the caller can report the outcome before it writes.
    stageCompletes: completedCount >= requiredTaskCount || remainingTaskIds.length === 0,
    remainingTaskIds,
  };
}
