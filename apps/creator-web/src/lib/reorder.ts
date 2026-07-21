// Pure array/stage reorder helpers for native drag-and-drop in the Builder
// (changes: v2.1-builder-shell-redesign, wave-a builder task DnD).
// DOM-free so the whole surface is covered by the fast test lane
// (scripts/test-builder-redesign.ts + scripts/test-builder-dnd.ts).

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
  /** Mutually exclusive task groups, stage scoped (change: builder-dnd-groups).
   *  Structurally identical to `ExclusiveTaskGroup` from @rushpoint/shared; kept
   *  local so this file stays dependency free for the fast test lane. */
  exclusiveGroups?: GroupLike[];
}

/** One authored exclusive group. Mirrors `ExclusiveTaskGroup` / `ExclusiveGroupLike`
 *  from @rushpoint/shared, which stays the single source of truth for the RULES —
 *  these helpers only edit the authored array. */
export interface GroupLike { id: string; taskIds: string[] }

/**
 * Normalizes an authored group array for WRITE: drops ids that are not in the
 * stage, dedupes within a group, drops an id already claimed by an EARLIER group
 * (mirroring effectiveExclusiveGroups' first-group-wins rule), drops groups left
 * with zero members, and returns `undefined` when nothing survives so the stage
 * patch clears the field instead of storing an empty array.
 *
 * A ONE member group is deliberately KEPT: the creator is mid edit and about to
 * add the second member. The model already treats it as inert, and the modal
 * shows it greyed out rather than deleting it out from under them.
 */
export function normalizeGroups(groups: GroupLike[] | undefined, taskIds: string[]): GroupLike[] | undefined {
  if (!Array.isArray(groups) || groups.length === 0) return undefined;
  const known = new Set(taskIds);
  const claimed = new Set<string>();
  const out: GroupLike[] = [];
  for (const g of groups) {
    const members: string[] = [];
    for (const id of Array.isArray(g?.taskIds) ? g.taskIds : []) {
      if (!known.has(id) || claimed.has(id) || members.includes(id)) continue;
      members.push(id);
    }
    if (members.length === 0) continue;
    for (const id of members) claimed.add(id);
    out.push({ id: g.id, taskIds: members });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Puts one task in exactly `groupId`, or in no group when `groupId` is null.
 * It is removed from every OTHER group first, so the "a task belongs to at most
 * one group" invariant holds by construction rather than by validation — which
 * is what lets the editor be a set of radio groups.
 *
 * `create` assigns into a brand new group with that id in the same call (the
 * modal's `＋` column), so creating and assigning is one undo step. Without it,
 * an unknown group id is a no-op. True no-ops return the ORIGINAL reference.
 */
export function setTaskGroup(
  groups: GroupLike[] | undefined,
  taskId: string,
  groupId: string | null,
  create = false,
): GroupLike[] | undefined {
  const cur = Array.isArray(groups) ? groups : [];
  const exists = groupId !== null && cur.some((g) => g.id === groupId);
  if (groupId !== null && !exists && !create) return groups;
  if (groupId !== null && exists && cur.some((g) => g.id === groupId && g.taskIds.includes(taskId))) return groups;
  if (groupId === null && !cur.some((g) => g.taskIds.includes(taskId))) return groups;

  const stripped = cur.map((g) => (g.taskIds.includes(taskId)
    ? { ...g, taskIds: g.taskIds.filter((id) => id !== taskId) }
    : g));
  const next = groupId === null
    ? stripped
    : exists
      ? stripped.map((g) => (g.id === groupId ? { ...g, taskIds: [...g.taskIds, taskId] } : g))
      : [...stripped, { id: groupId, taskIds: [taskId] }];
  const kept = next.filter((g) => g.taskIds.length > 0);
  return kept.length > 0 ? kept : undefined;
}

/**
 * Strips a task id out of every group. Used when a task is deleted AND when it
 * leaves the stage in a cross stage move: groups are stage scoped, so a dangling
 * id is silently inert and would shrink a real group to one member with no trace
 * in the UI. Groups emptied by the strip are removed; a group reduced to one
 * member survives (inert, and visibly so).
 */
export function removeTaskFromGroups(groups: GroupLike[] | undefined, taskId: string): GroupLike[] | undefined {
  if (!Array.isArray(groups) || !groups.some((g) => g.taskIds.includes(taskId))) return groups;
  const next = groups
    .map((g) => (g.taskIds.includes(taskId) ? { ...g, taskIds: g.taskIds.filter((id) => id !== taskId) } : g))
    .filter((g) => g.taskIds.length > 0);
  return next.length > 0 ? next : undefined;
}

/**
 * The index of the EFFECTIVE group containing `taskId`, or -1 when it is
 * ungrouped / in an inert group. Takes the already-computed effective groups
 * (from @rushpoint/shared's `effectiveExclusiveGroups`) rather than a stage, so
 * this file keeps zero dependencies and the badge can never disagree with what
 * the server enforces. The index drives the colour (modulo the palette length)
 * and the letter (which never repeats), and is authored-group ordered, so it is
 * stable when the creator reorders cards.
 */
export function groupIndexOfTask(effectiveGroups: string[][], taskId: string): number {
  return effectiveGroups.findIndex((g) => g.includes(taskId));
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
    // Exclusive groups are STAGE SCOPED: a task that leaves must leave the source
    // stage's groups too, or the id dangles (inert by contract) and silently
    // shrinks a real group to one member with no trace in the UI. The destination
    // is never touched — the task always arrives ungrouped. Only written when the
    // source actually had groups, so a group-free stage never sprouts the key.
    ...(source.exclusiveGroups
      ? { exclusiveGroups: removeTaskFromGroups(source.exclusiveGroups, taskId) }
      : {}),
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
