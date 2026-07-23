// Mutually exclusive task groups (change: mutually-exclusive-tasks). A Stage may
// declare `exclusiveGroups`: sets of ITS OWN task ids of which a team may complete
// at most ONE. Completing any member locks the rest FOR THAT TEAM — they become
// `skipped` (not failed, no penalty), exactly like the leftovers of a partial stage.
// Lets a creator offer "pick one of these three" variants of one real-world action
// without a team farming every variant for points.
//
// The decision lives HERE as pure helpers shared by the Builder validator/UI, the
// routing candidate filter and the completeTaskForTeam enforcement, so the three can
// never drift (same pattern as gating.ts for unlockable tasks). Every rule of the
// schema's contract is expressed ONCE, in effectiveExclusiveGroups:
//   - scoped to one stage: ids not present in `tasks` are ignored;
//   - a group left with fewer than 2 ids is inert;
//   - a task may appear in at most one group (the FIRST group wins).
// NOT a secret: which tasks are alternatives is player-visible, so nothing here
// needs sanitizing.

/** One authored group (mirrors the `ExclusiveTaskGroup` schema shape). */
export interface ExclusiveGroupLike {
  id: string;
  taskIds: string[];
}

/** Minimal stage shape these helpers need (id-bearing tasks + the groups). */
export interface ExclusionStage {
  tasks: { id: string }[];
  exclusiveGroups?: ExclusiveGroupLike[];
  requiredTaskCount?: number;
}

function stageTaskIds(stage: ExclusionStage): string[] {
  return Array.isArray(stage?.tasks) ? stage.tasks.map((t) => t?.id).filter((id): id is string => !!id) : [];
}

/**
 * The groups that actually have an effect, normalized: only ids present in this
 * stage, deduped, an id already claimed by an EARLIER group dropped, members
 * ordered by stage task order, and groups left with fewer than 2 ids removed.
 * Every other helper is defined on top of this, so "inert" means one thing.
 */
export function effectiveExclusiveGroups(stage: ExclusionStage): string[][] {
  const order = stageTaskIds(stage);
  const known = new Set(order);
  const groups = Array.isArray(stage?.exclusiveGroups) ? stage.exclusiveGroups : [];
  const claimed = new Set<string>();
  const out: string[][] = [];
  for (const g of groups) {
    const ids = Array.isArray(g?.taskIds) ? g.taskIds : [];
    const members: string[] = [];
    for (const id of ids) {
      if (!known.has(id) || claimed.has(id) || members.includes(id)) continue;
      members.push(id);
    }
    if (members.length < 2) continue; // inert — do not claim its ids either
    for (const id of members) claimed.add(id);
    members.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    out.push(members);
  }
  return out;
}

/** The effective group containing `taskId`, or null when it is ungrouped/unknown. */
export function exclusiveGroupOf(stage: ExclusionStage, taskId: string): string[] | null {
  return effectiveExclusiveGroups(stage).find((g) => g.includes(taskId)) ?? null;
}

/**
 * The sibling ids that must be auto-skipped when `completedTaskId` is completed
 * (its group minus itself), in stage task order. `[]` when it is ungrouped — so a
 * caller can apply it unconditionally.
 */
export function resolveExclusions(stage: ExclusionStage, completedTaskId: string): string[] {
  const group = exclusiveGroupOf(stage, completedTaskId);
  if (!group) return [];
  return group.filter((id) => id !== completedTaskId);
}

/**
 * Which task ids are locked for a team that has completed `completedTaskIds`:
 * every sibling of every completed grouped task, minus anything the team already
 * completed itself (a legacy run authored before the groups could have two members
 * completed — that is deterministic here rather than contradictory). Stage order,
 * deduped. Stateless in ordering ⇒ idempotent and replay safe.
 */
export function blockedTaskIds(stage: ExclusionStage, completedTaskIds: string[]): string[] {
  const done = new Set(Array.isArray(completedTaskIds) ? completedTaskIds : []);
  const blocked = new Set<string>();
  for (const group of effectiveExclusiveGroups(stage)) {
    if (!group.some((id) => done.has(id))) continue;
    for (const id of group) if (!done.has(id)) blocked.add(id);
  }
  return stageTaskIds(stage).filter((id) => blocked.has(id));
}

/** Optional runtime narrowing for `maxCompletableTasks`. */
export interface MaxCompletableOptions {
  /**
   * Whether a task can still be handed out right now. Used ONLY by the live
   * pause guard (planTaskStatusChange), never at authoring time: run-scoped
   * availability is deliberately kept off the template, so a Builder-time
   * ceiling that moved because someone paused a stop yesterday would be a number
   * the creator cannot reproduce from what they see. Absent = everything counts.
   */
  isAvailable?: (taskId: string) => boolean;
}

/**
 * The ceiling on how many of this stage's tasks ONE team can ever complete
 * (change: stage-winnability). THE single definition — the Builder's completion
 * control, the Builder's launch readiness, the server's save/import validation
 * and the live pause guard all read THIS. Re-deriving it locally is what let the
 * Builder offer "6 of 6" on a stage of three alternative pairs.
 *
 * Static form: ungrouped tasks + one per effective group. Every awkward shape is
 * already normalized by effectiveExclusiveGroups — an inert (<2 member) group
 * claims nothing so its task counts as ungrouped, ids from other stages are
 * ignored, and a task named by two groups counts once (first group wins).
 *
 * With `opts.isAvailable`, a group contributes 1 only when at least ONE of its
 * alternatives is still available, and an ungrouped task contributes 1 only when
 * it is itself available.
 */
export function maxCompletableTasks(stage: ExclusionStage, opts?: MaxCompletableOptions): number {
  const groups = effectiveExclusiveGroups(stage);
  const grouped = new Set<string>();
  for (const g of groups) for (const id of g) grouped.add(id);

  const available = opts?.isAvailable;
  const ok = (id: string): boolean => (typeof available === 'function' ? available(id) === true : true);

  const ungrouped = stageTaskIds(stage).filter((id) => !grouped.has(id) && ok(id)).length;
  const usableGroups = groups.filter((g) => g.some((id) => ok(id))).length;
  return ungrouped + usableGroups;
}

/**
 * Historical name for the static form of `maxCompletableTasks`. Kept as an exact
 * alias so existing call sites and tests do not move.
 */
export function maxAttainableCompletions(stage: ExclusionStage): number {
  return maxCompletableTasks(stage);
}

/**
 * The save-blocking problem with a stage's `requiredTaskCount`, or null when it
 * is fine. Shared verbatim by the server's `stagesProblems` (which serves BOTH
 * updateGame and importGameFile) and by the Builder's launch readiness, so the
 * client and the server cannot disagree on what is launchable.
 *
 * An UNSET count means "every task" and is never a problem: the stage still ends
 * once no task remains to do (applyStageCompletion's allTerminal arm), which is
 * the normal "pick one of these" shape.
 */
export function requiredTaskCountProblem(stage: ExclusionStage, label?: string): string | null {
  const required = stage?.requiredTaskCount;
  if (typeof required !== 'number' || !Number.isFinite(required)) return null;
  const ceiling = maxCompletableTasks(stage);
  if (required <= ceiling) return null;
  const where = label ? `${label}: ` : '';
  return `${where}requires ${required} task(s) but a team can complete at most ${ceiling} — its alternative (exclusive) groups yield one completion each`;
}

export interface ExclusiveGroupReport {
  /** Structural corruption a creator must fix (a task in two groups, duplicate ids). */
  errors: string[];
  /** Advisory / inert, never blocks a save (unknown ids, tiny groups, count ceiling). */
  warnings: string[];
}

/**
 * Validate ONE stage's exclusive groups. Severity convention mirrors
 * validateUnlockGraph: errors = authoring corruption, warnings = inert or advisory.
 *
 * The requiredTaskCount warning is the important one: an EXPLICIT count above
 * maxAttainableCompletions can never be reached, so the stage ends early via
 * applyStageCompletion's allTerminal test — the team is not stranded (the losers are
 * skipped in the same commit as the completion) but scores less than the creator
 * intended. An UNSET count (= all tasks) is the normal "pick one of these" shape and
 * deliberately does NOT warn.
 */
export function validateExclusiveGroups(stage: ExclusionStage): ExclusiveGroupReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set(stageTaskIds(stage));
  const groups = Array.isArray(stage?.exclusiveGroups) ? stage.exclusiveGroups : [];

  const seenGroupIds = new Set<string>();
  const owner = new Map<string, string>(); // taskId -> first group id that claimed it
  for (const g of groups) {
    const gid = g?.id ?? '';
    if (gid && seenGroupIds.has(gid)) {
      errors.push(`Duplicate exclusive group id "${gid}"`);
    }
    if (gid) seenGroupIds.add(gid);

    const ids = Array.isArray(g?.taskIds) ? g.taskIds : [];
    const seenHere = new Set<string>();
    let effective = 0;
    for (const id of ids) {
      if (seenHere.has(id)) {
        errors.push(`Exclusive group "${gid}" lists task "${id}" twice`);
        continue;
      }
      seenHere.add(id);
      if (!known.has(id)) {
        warnings.push(`Exclusive group "${gid}" references task "${id}", which is not in this stage — it is ignored`);
        continue;
      }
      const prev = owner.get(id);
      if (prev !== undefined) {
        errors.push(`Task "${id}" is in two exclusive groups ("${prev}" and "${gid}") — a task may belong to at most one`);
        continue;
      }
      owner.set(id, gid);
      effective++;
    }
    if (effective < 2) {
      warnings.push(`Exclusive group "${gid}" has fewer than 2 tasks of this stage — it has no effect`);
    }
  }

  const required = stage?.requiredTaskCount;
  if (typeof required === 'number' && Number.isFinite(required)) {
    const ceiling = maxAttainableCompletions(stage);
    if (required > ceiling) {
      warnings.push(
        `requiredTaskCount (${required}) exceeds the ${ceiling} task(s) a team can complete once the exclusive groups lock their alternatives — the stage would end early`,
      );
    }
  }

  return { errors, warnings };
}
