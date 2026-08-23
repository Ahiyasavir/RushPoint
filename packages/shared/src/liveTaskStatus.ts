// Live task availability (change: live-task-pause).
//
// `Task.status` (StationStatus) is documented on the type itself as an "operator
// override", and routing has always ENFORCED it — assignNextTask.ts filters
// paused/closed tasks out of assignment, out of recommendations and out of the
// "why nothing was assigned" pool. Nothing ever WROTE it, so a stop that dies
// mid event (shop closed, street blocked, host gone, weather) could not be taken
// out of play: the organizer could only keep routing teams to a dead stop, or end
// the run.
//
// This module is the one decision both sides read: the server enforces it and the
// run console displays exactly what the server will do. It is PURE — no I/O, no
// Date, no Firebase, no React — so it is verified in the no emulator lane.
//
// Scope: the override is RUN scoped and lives on the run document
// (`Run.taskStatusOverrides`), NOT on the game template. The shop is closed today,
// not forever, and the template is replayed by later runs, duplicated, exported and
// published to the gallery. The template `Task.status` stays supported as a
// fallback so anything that ever does set it keeps working.
//
// A team already HOLDING the task is never affected: this decision is consulted at
// assignment time only, never on the completion path, so a team standing at the
// station finishes and scores it. Stranding them would recreate the stuck player
// bug class this repo has already paid for twice.

import type { StationStatus } from './types';
import { maxCompletableTasks, type ExclusiveGroupLike } from './mutualExclusion';

/** The closed set of live availabilities, in operator order. */
export const LIVE_TASK_STATUSES = ['active', 'paused', 'closed'] as const;

/** Per run availability overrides, keyed by task id. */
export type TaskStatusOverrides = Record<string, StationStatus>;

export function isStationStatus(value: unknown): value is StationStatus {
  return typeof value === 'string' && (LIVE_TASK_STATUSES as readonly string[]).includes(value);
}

/** The minimum a caller must know about a task for this decision. */
export interface TaskStatusView {
  id: string;
  status?: StationStatus;
}

/** The minimum a caller must know about the stage that owns the task. */
export interface StageStatusView {
  tasks: TaskStatusView[];
  /** Complete only N of M tasks. Absent = every task is required. */
  requiredTaskCount?: number;
  /**
   * Mutually exclusive alternatives (change: stage-winnability). A group yields
   * ONE completion however many members it has, so it must be read here too:
   * counting raw active tasks both over-warns (pausing a spare alternative) and
   * under-warns (an authored count already above what the stage can yield).
   */
  exclusiveGroups?: ExclusiveGroupLike[];
}

function overrideFor(taskId: string, overrides: unknown): StationStatus | undefined {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return undefined;
  const v = (overrides as Record<string, unknown>)[taskId];
  return isStationStatus(v) ? v : undefined;
}

/**
 * The availability that actually applies: run override, else the template status,
 * else active.
 *
 * TOTAL, and it fails OPEN. An absent, empty, malformed or unrecognized value at
 * either level resolves to the next level down (and ultimately to `active`) rather
 * than throwing or leaving the task unroutable. Failing closed here would turn one
 * bad map entry into an unwinnable game, which is strictly worse than an operator
 * having to click pause again.
 */
export function effectiveTaskStatus(task: TaskStatusView, overrides?: TaskStatusOverrides): StationStatus {
  const id = task && typeof task.id === 'string' ? task.id : '';
  const fromRun = id ? overrideFor(id, overrides) : undefined;
  if (fromRun) return fromRun;
  return isStationStatus(task?.status) ? task.status : 'active';
}

/** True when routing may hand this task out. The single rule behind all three filters. */
export function isTaskAssignable(task: TaskStatusView, overrides?: TaskStatusOverrides): boolean {
  return effectiveTaskStatus(task, overrides) === 'active';
}

export type TaskStatusChangeRejection = 'unknownStatus' | 'emptyStage' | 'taskNotInStage';

export interface TaskStatusChangePlan {
  ok: true;
  from: StationStatus;
  to: StationStatus;
  /** The task already has this availability. Still written (idempotent), never warned about. */
  noop: boolean;
  /** Always true: taking a task out of play never revokes it from a team holding it. */
  holdersKeepTask: true;
  /** How many teams hold the task right now (reported so the operator is told what is unaffected). */
  teamsHolding: number;
  /** Tasks of this stage that would still be assignable after the change. */
  availableAfter: number;
  /** What the stage needs to complete: requiredTaskCount clamped to the task count. */
  requiredCount: number;
  /** availableAfter < requiredCount — the change would dead end the stage. */
  stageUnwinnable: boolean;
}

export type TaskStatusChangeResult =
  | TaskStatusChangePlan
  | { ok: false; reason: TaskStatusChangeRejection };

export interface TaskStatusChangeInput {
  taskId: string;
  /** The stage that owns the task. */
  stage: StageStatusView;
  /** The run's overrides BEFORE this change. */
  overrides?: TaskStatusOverrides;
  /** Requested availability. Anything outside the closed set is rejected. */
  next: StationStatus;
  /** Teams currently holding the task. Malformed values count as none. */
  teamsHolding?: number;
}

/**
 * Decide one availability change, including whether it would leave the owning
 * stage unable to yield the number of tasks it requires.
 *
 * The unwinnable rule matches `applyStageCompletion` exactly (functions/src/runs/
 * helpers.ts): a stage is done at `min(requiredTaskCount ?? tasks.length, tasks.length)`
 * completions, so that same clamped number is what must remain available. It is the
 * same quantity the Builder already reports as `stageUnwinnable` at authoring time;
 * this applies the rule at pause time instead of inventing a second one.
 *
 * Restoring a task to `active` can only ADD availability, so it is never flagged.
 */
export function planTaskStatusChange(input: TaskStatusChangeInput): TaskStatusChangeResult {
  if (!isStationStatus(input?.next)) return { ok: false, reason: 'unknownStatus' };

  const tasks = Array.isArray(input.stage?.tasks) ? input.stage.tasks : [];
  if (tasks.length === 0) return { ok: false, reason: 'emptyStage' };

  const target = tasks.find((t) => t && t.id === input.taskId);
  if (!target) return { ok: false, reason: 'taskNotInStage' };

  const overrides = input.overrides;
  const from = effectiveTaskStatus(target, overrides);
  const to = input.next;

  // Both numbers go through the ONE winnability rule (change: stage-winnability),
  // so a group of alternatives counts as a single completion on each side.
  const stageShape = { tasks, exclusiveGroups: input.stage?.exclusiveGroups };
  const ceiling = maxCompletableTasks(stageShape);
  const availableAfter = maxCompletableTasks(stageShape, {
    isAvailable: (id) =>
      (id === input.taskId ? to : effectiveTaskStatus(tasks.find((t) => t.id === id)!, overrides)) === 'active',
  });

  const requiredRaw = input.stage?.requiredTaskCount;
  const requiredCount = Math.min(
    typeof requiredRaw === 'number' && Number.isFinite(requiredRaw) && requiredRaw > 0
      ? Math.floor(requiredRaw)
      : tasks.length,
    // Never compare against more than the stage can EVER yield: an authored count
    // above the ceiling is its own (Builder + server enforced) problem, and letting
    // it through here would flag every pause on such a stage as the cause.
    ceiling,
  );

  const holdingRaw = input.teamsHolding;
  const teamsHolding =
    typeof holdingRaw === 'number' && Number.isFinite(holdingRaw) && holdingRaw > 0
      ? Math.floor(holdingRaw)
      : 0;

  const noop = from === to;

  return {
    ok: true,
    from,
    to,
    noop,
    holdersKeepTask: true,
    teamsHolding,
    availableAfter,
    requiredCount,
    stageUnwinnable: !noop && to !== 'active' && availableAfter < requiredCount,
  };
}
