// Pure array/stage reorder helpers for native drag-and-drop in the Builder
// (changes: v2.1-builder-shell-redesign, wave-a builder task DnD).
// DOM-free so the whole surface is covered by the fast test lane
// (scripts/test-builder-redesign.ts + scripts/test-builder-dnd.ts).

/**
 * Custom drag MIME type for a Builder TASK drag. Published by TaskCanvas on
 * dragstart and sniffed by StageRail (via `dataTransfer.types`) so a task drag
 * and a stage-reorder drag can never be confused for one another.
 */
export const TASK_DND_MIME = 'application/x-rushpoint-task';

/** Moves the item at `from` to index `to`, returning a new array. Out-of-range or
 *  no-op moves return the original array unchanged. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The minimal shape the stage helpers need — structurally satisfied by the real
 *  `Stage` from @rushpoint/shared without importing it (keeps this file DOM- and
 *  dependency-free for the test lane). */
export interface ReorderStage {
  id: string;
  tasks: { id: string }[];
  requiredTaskCount?: number;
}

/**
 * Normalizes a stage's `requiredTaskCount` against its actual task count.
 *
 * `undefined` is the canonical "every task is required" value, so anything that
 * is not a usable partial count collapses to it: a count that meets or exceeds
 * the task count (which would otherwise render an option the select doesn't
 * offer), a count below 1, and non-finite values. A stage whose required count
 * exceeds its task count is UNWINNABLE, so this must run after every mutation
 * that changes a stage's task list (delete, drag-out, drag-in).
 */
export function clampRequiredTaskCount(req: number | undefined, taskCount: number): number | undefined {
  if (typeof req !== 'number' || !Number.isFinite(req)) return undefined;
  const n = Math.floor(req);
  if (n < 1 || n >= taskCount) return undefined;
  return n;
}

/**
 * Moves one task within a stage or across stages, re-clamping the source AND
 * destination `requiredTaskCount`.
 *
 * - `toIndex` omitted ⇒ append to the destination's end (the cross-stage drop
 *   target in StageRail has no meaningful insertion index).
 * - A stage may never be emptied, so moving a stage's LAST task out is refused.
 * - Unknown ids and true no-ops return the ORIGINAL array by reference, so a
 *   caller can cheaply skip the state update.
 * - Stages untouched by the move keep their object identity.
 */
export function moveTaskBetweenStages<S extends ReorderStage>(
  stages: S[],
  fromStageId: string,
  taskId: string,
  toStageId: string,
  toIndex?: number,
): S[] {
  const fromIdx = stages.findIndex((s) => s.id === fromStageId);
  const toStageIdx = stages.findIndex((s) => s.id === toStageId);
  if (fromIdx < 0 || toStageIdx < 0) return stages;

  const source = stages[fromIdx];
  const taskIdx = source.tasks.findIndex((t) => t.id === taskId);
  if (taskIdx < 0) return stages;

  // ── Same stage: a plain reorder; the task count (and therefore the required
  //    count) is unchanged. ──
  if (fromIdx === toStageIdx) {
    const target = clampIndex(toIndex ?? source.tasks.length - 1, source.tasks.length - 1);
    const tasks = moveItem(source.tasks, taskIdx, target);
    if (tasks === source.tasks) return stages;
    const next = stages.slice();
    next[fromIdx] = { ...source, tasks } as S;
    return next;
  }

  // ── Cross stage: never leave a stage with zero tasks. ──
  if (source.tasks.length <= 1) return stages;

  const dest = stages[toStageIdx];
  const moved = source.tasks[taskIdx];

  const sourceTasks = source.tasks.filter((_, i) => i !== taskIdx);
  const destTasks = dest.tasks.slice();
  destTasks.splice(clampIndex(toIndex ?? destTasks.length, destTasks.length), 0, moved);

  const next = stages.slice();
  next[fromIdx] = {
    ...source,
    tasks: sourceTasks,
    requiredTaskCount: clampRequiredTaskCount(source.requiredTaskCount, sourceTasks.length),
  } as S;
  next[toStageIdx] = {
    ...dest,
    tasks: destTasks,
    requiredTaskCount: clampRequiredTaskCount(dest.requiredTaskCount, destTasks.length),
  } as S;
  return next;
}

function clampIndex(i: number, max: number): number {
  if (!Number.isFinite(i)) return max;
  return Math.min(Math.max(0, Math.floor(i)), max);
}
