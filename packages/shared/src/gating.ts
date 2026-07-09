// Unlockable tasks (change: unlockable-tasks). A task may carry an optional
// `unlockAfterTaskIds` — ids of OTHER tasks in the SAME stage that must ALL be
// completed before it becomes available (AND semantics). The decision lives HERE
// as a pure predicate shared by the routing candidate filters, the
// completeTaskForTeam anti-cheat guard, and the play-web locked-task rendering,
// so the three can never drift. Absent/empty gate ⇒ always unlocked (full
// backward compatibility). NOT a secret — the locked-task UI names its
// prerequisites, so the field passes through the participant sanitizer.

/** A thing that may carry a same-stage prerequisite gate (a Task). */
export interface UnlockGate {
  unlockAfterTaskIds?: string[];
}

/**
 * Whether a gated task is unlocked given the team's completed task ids. An
 * absent / empty / malformed (non-array) gate is always unlocked. Otherwise
 * EVERY listed prerequisite must be completed. An unknown id can never be
 * completed, so it never silently unlocks — save-time validation
 * (validateUnlockGraph) rejects unknown ids so they don't reach a live run.
 */
export function isUnlocked(gate: UnlockGate | null | undefined, completedTaskIds: string[]): boolean {
  const prereqs = gate?.unlockAfterTaskIds;
  if (!Array.isArray(prereqs) || prereqs.length === 0) return true;
  return prereqs.every((id) => completedTaskIds.includes(id));
}

/** Minimal task shape validateUnlockGraph needs (id + optional gate). */
export interface UnlockGraphTask extends UnlockGate {
  id: string;
}

export interface UnlockGraphReport {
  /** Save-blocking problems: self-reference, unknown/cross-stage id, cycle. */
  errors: string[];
  /** Builder-only, non-blocking: e.g. requiredTaskCount exceeds reachable tasks. */
  warnings: string[];
}

/**
 * Validate the prerequisite graph of ONE stage. Errors (save-blocking):
 * - a task referencing itself;
 * - a prerequisite id not found among this stage's tasks (covers cross-stage
 *   references and typos alike);
 * - a cycle (iterative DFS) — a cycle-free directed graph always has a source,
 *   so at least one task has no prerequisites and the stage stays routable.
 * Warnings (non-blocking): `requiredTaskCount` greater than the number of
 * REACHABLE tasks (tasks whose entire prerequisite chain can actually complete).
 */
export function validateUnlockGraph(stage: {
  tasks: UnlockGraphTask[];
  requiredTaskCount?: number;
}): UnlockGraphReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tasks = Array.isArray(stage.tasks) ? stage.tasks : [];
  const ids = new Set(tasks.map((t) => t.id));

  const gateOf = (t: UnlockGraphTask): string[] =>
    Array.isArray(t.unlockAfterTaskIds) ? t.unlockAfterTaskIds : [];

  // Self-reference + unknown / cross-stage ids.
  for (const t of tasks) {
    for (const dep of gateOf(t)) {
      if (dep === t.id) {
        errors.push(`Task "${t.id}" cannot require itself`);
      } else if (!ids.has(dep)) {
        errors.push(`Task "${t.id}" requires unknown task "${dep}" (must be another task in the same stage)`);
      }
    }
  }

  // Cycle detection — iterative DFS with WHITE/GRAY/BLACK coloring over the
  // same-stage dependency graph (edges task → prerequisite; unknown ids skipped,
  // they are already errors above).
  const color = new Map<string, 0 | 1 | 2>(); // 0 white, 1 gray, 2 black
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const cyclic = new Set<string>();
  for (const start of tasks) {
    if ((color.get(start.id) ?? 0) !== 0) continue;
    const stack: { id: string; nextDep: number }[] = [{ id: start.id, nextDep: 0 }];
    color.set(start.id, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = gateOf(byId.get(frame.id)!).filter((d) => d !== frame.id && ids.has(d));
      if (frame.nextDep < deps.length) {
        const dep = deps[frame.nextDep++];
        const c = color.get(dep) ?? 0;
        if (c === 1) {
          // Back edge → cycle through `dep`; report once per involved node set.
          cyclic.add(dep);
        } else if (c === 0) {
          color.set(dep, 1);
          stack.push({ id: dep, nextDep: 0 });
        }
      } else {
        color.set(frame.id, 2);
        stack.pop();
      }
    }
  }
  for (const id of cyclic) {
    errors.push(`Prerequisite cycle detected through task "${id}" — tasks cannot unlock each other in a loop`);
  }

  // Reachability fixpoint: a task is reachable when every prerequisite is a
  // known same-stage id AND itself reachable. Cycles / unknown ids block their
  // dependents. In a valid DAG every task is reachable.
  const reachable = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) {
      if (reachable.has(t.id)) continue;
      const deps = gateOf(t);
      if (deps.every((d) => d !== t.id && ids.has(d) && reachable.has(d))) {
        reachable.add(t.id);
        grew = true;
      }
    }
  }

  const required = stage.requiredTaskCount;
  if (typeof required === 'number' && Number.isFinite(required) && required > reachable.size) {
    warnings.push(
      `requiredTaskCount (${required}) exceeds the number of completable tasks (${reachable.size}) — teams could never finish this stage`,
    );
  }

  return { errors, warnings };
}
