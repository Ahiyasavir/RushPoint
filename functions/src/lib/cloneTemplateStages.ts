// cloneTemplateStages (change: admin-manage-game-templates).
//
// Regenerates every stage/task id when a creator instantiates a game from an
// admin-authored template — matching what GameTemplate.build() used to do for
// the static templates.ts array. Unlike build(), this ALSO rewrites every field
// that references another task's id (unlockAfterTaskIds, exclusiveGroups[].taskIds)
// so the unlock/exclusive-group graph survives instantiation instead of silently
// pointing at ids that no longer exist in the new game.
//
// Two passes are required, not one: a reference field can point at a task that
// hasn't been assigned its new id yet depending on iteration order, so the full
// oldId -> newId map must exist before any reference is rewritten.

import type { Stage } from '@rushpoint/shared';

function generateId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cloneTemplateStages(stages: Stage[]): Stage[] {
  const idMap = new Map<string, string>(); // oldId -> newId, stages AND tasks share one map

  // Pass 1 — assign every stage and task a fresh id, recording the mapping.
  const withFreshIds = stages.map((stage) => {
    const newStageId = generateId();
    idMap.set(stage.id, newStageId);
    const tasks = stage.tasks.map((task) => {
      const newTaskId = generateId();
      idMap.set(task.id, newTaskId);
      return { ...task, id: newTaskId };
    });
    return { ...stage, id: newStageId, tasks };
  });

  // Pass 2 — rewrite every field that REFERENCES an id, now that the full map exists.
  // `?? id` fails open on a reference that resolves to nothing (e.g. an already
  // dangling reference in the source template) rather than throwing.
  return withFreshIds.map((stage) => ({
    ...stage,
    tasks: stage.tasks.map((task) => ({
      ...task,
      unlockAfterTaskIds: task.unlockAfterTaskIds?.map((id) => idMap.get(id) ?? id),
    })),
    exclusiveGroups: stage.exclusiveGroups?.map((group) => ({
      ...group,
      id: generateId(),
      taskIds: group.taskIds.map((id) => idMap.get(id) ?? id),
    })),
  }));
}
