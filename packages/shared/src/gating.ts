// Unlockable tasks (change: unlockable-tasks). A task may carry an optional
// `unlockAfterTaskIds` — ids of OTHER tasks in the SAME stage that must ALL be
// completed before it becomes available (AND semantics). The decision lives HERE
// as a pure predicate shared by the routing candidate filters, the
// completeTaskForTeam anti-cheat guard, and the play-web locked-task rendering,
// so the three can never drift. Absent/empty gate ⇒ always unlocked (full
// backward compatibility). NOT a secret — the locked-task UI names its
// prerequisites, so the field passes through the participant sanitizer.

import { isReleased, isExpired, type ReleaseGate, type ExpiryGate } from './schedule';
import { effectiveExclusiveGroups, blockedTaskIds, type ExclusiveGroupLike } from './mutualExclusion';
import { isTaskAssignable, type TaskStatusOverrides } from './liveTaskStatus';
import type { StationStatus } from './types';

/** A thing that may carry a same-stage prerequisite gate (a Task). */
export interface UnlockGate {
  unlockAfterTaskIds?: string[];
}

/**
 * Whether a gated task is unlocked given the ids that SATISFY a gate for this team: completed
 * tasks plus tasks an operator skipped (see `gateSatisfiedTaskIds`, change: skip-keeps-the-stage).
 * Pass that list, never a bare "completed" filter: an organizer skipping the head of a chain must
 * open the rest of it. An absent / empty / malformed (non-array) gate is always unlocked. Otherwise
 * EVERY listed prerequisite must be satisfied. An unknown id can never be satisfied, so it never
 * silently unlocks — save-time validation (validateUnlockGraph) rejects unknown ids so they don't
 * reach a live run.
 */
export function isUnlocked(gate: UnlockGate | null | undefined, satisfiedTaskIds: string[]): boolean {
  const prereqs = gate?.unlockAfterTaskIds;
  if (!Array.isArray(prereqs) || prereqs.length === 0) return true;
  return prereqs.every((id) => satisfiedTaskIds.includes(id));
}

/**
 * Does this task record satisfy the unlock gate of a task that waits for it?
 * (change: skip-keeps-the-stage)
 *
 * Completed: yes. Skipped: ONLY when an operator skipped that one mission (`skipCause:
 * 'operator'`). Production run oNaUvNrCWRia4Y1b9xOO (2026-09-22) is why: one organizer skip of the
 * head of a three-task chain retired the other two and ended the team's stage, because a skipped
 * prerequisite read as dead. An exclusive-group loss, an expiry, an automatic retirement or a
 * leftover keeps closing its dependents, and so does a legacy skip with no recorded cause: records
 * written before this field existed keep exactly the meaning they had. Total.
 */
export function satisfiesGate(rec: { status?: unknown; skipCause?: unknown } | null | undefined): boolean {
  if (!rec || typeof rec !== 'object') return false;
  // `removed` (change: run-gate-integrity): the creator deleted the mission from the game while the
  // run was live. A mission that is no longer part of the game cannot hold the ones behind it shut.
  return rec.status === 'completed'
    || (rec.status === 'skipped' && (rec.skipCause === 'operator' || rec.skipCause === 'removed'));
}

/**
 * Every task id, across a team's stages, whose record satisfies a gate. Total.
 *
 * With `gameStages` (change: run-gate-integrity) it ALSO returns every template mission that this
 * team has no record for at all: a mission benched before launch (buildInitialStages leaves it out)
 * or added to the template after launch. Neither takes part in this run, so neither can ever be
 * completed, and a gate on one would otherwise keep its dependents locked for the rest of the event
 * while nothing retires them. Every routing filter, the completion guard and the participant lock
 * signal read this ONE list, so they agree with `stageRetirements` about what is open.
 */
export function gateSatisfiedTaskIds(
  stages: readonly { tasks?: readonly ({ taskId?: unknown; status?: unknown; skipCause?: unknown } | null | undefined)[] }[] | null | undefined,
  gameStages?: readonly { tasks?: readonly ({ id?: unknown } | null | undefined)[] }[] | null,
): string[] {
  if (!Array.isArray(stages)) return [];
  const out: string[] = [];
  const recorded = new Set<string>();
  for (const s of stages) {
    const tasks = Array.isArray(s?.tasks) ? s.tasks : [];
    for (const t of tasks) {
      if (!t || typeof t.taskId !== 'string') continue;
      recorded.add(t.taskId);
      if (satisfiesGate(t)) out.push(t.taskId);
    }
  }
  if (Array.isArray(gameStages)) {
    for (const gs of gameStages) {
      const tasks = Array.isArray(gs?.tasks) ? gs.tasks : [];
      for (const t of tasks) {
        const id = t?.id;
        if (typeof id === 'string' && id && !recorded.has(id)) out.push(id);
      }
    }
  }
  return out;
}

/** A team's per-task record, as much of it as the run-graph helpers read. */
export interface RunGateRecord {
  taskId?: unknown;
  status?: unknown;
  skipCause?: unknown;
}

/**
 * The stage's unlock graph AS THIS TEAM'S RUN PLAYS IT (change: run-gate-integrity).
 *
 * The template and the team's records are two different lists, and every planner that treated the
 * template as the run got a benched or freshly added mission wrong: it counted toward what the stage
 * can yield, kept groups alive, and — worst — as a prerequisite it stayed "unassigned, still
 * reachable" forever, so the missions behind it were never handed out and never retired.
 *
 * The result holds, in template order, every template task this team HAS a record for, with its
 * gate stripped of ids that are template tasks of this stage without a record (they are satisfied,
 * see gateSatisfiedTaskIds); then every record whose mission is no longer in the template, as a bare
 * `{ id }` (so a planner can still name and skip it). Ids that are not template tasks of this stage
 * at all stay in the gate: those are structural errors validation rejects, and they stay dead.
 * Pure and total; the input objects are never mutated.
 */
export function runStageTasks<T extends UnlockGraphTask>(
  templateTasks: readonly T[] | null | undefined,
  records: readonly (RunGateRecord | null | undefined)[] | null | undefined,
): (T | UnlockGraphTask)[] {
  const tpl = (Array.isArray(templateTasks) ? templateTasks : []).filter((t): t is T => !!t && typeof t.id === 'string' && !!t.id);
  const recIds = new Set<string>();
  for (const r of Array.isArray(records) ? records : []) {
    if (r && typeof r.taskId === 'string' && r.taskId) recIds.add(r.taskId);
  }
  const unplayed = new Set(tpl.filter((t) => !recIds.has(t.id)).map((t) => t.id));
  const out: (T | UnlockGraphTask)[] = [];
  for (const t of tpl) {
    if (!recIds.has(t.id)) continue;
    const gate = t.unlockAfterTaskIds;
    if (Array.isArray(gate) && gate.some((id) => unplayed.has(id))) {
      const kept = gate.filter((id) => !unplayed.has(id));
      out.push({ ...t, unlockAfterTaskIds: kept.length > 0 ? kept : undefined });
    } else {
      out.push(t);
    }
  }
  const tplIds = new Set(tpl.map((t) => t.id));
  for (const id of recIds) if (!tplIds.has(id)) out.push({ id });
  return out;
}

/** Why `stageRetirements` retires a still-unassigned record. */
export type RetirementCause = 'expired' | 'removed' | 'unreachable' | 'exclusive';

/**
 * The still-UNASSIGNED records of one stage that this team can never play, and why
 * (change: run-gate-integrity). The SINGLE rule applyStageCompletion applies and the routing heal
 * tests for, so the two cannot disagree about whether a team is stranded.
 *
 *  - `removed`: the mission is no longer in the template (deleted, or moved to another stage, while
 *    the run was live). Routing builds its candidates from the template, so it is never handed out.
 *  - `expired`: its time window closed before this team ever took it. Routing already refuses to
 *    hand it out; until now nothing marked it, so a stage that needed it never ended.
 *  - `unreachable`: gated behind a mission this team can never satisfy, on the run graph above,
 *    with the two retirements before it applied (an expired prerequisite still closes what waits
 *    for it; a removed one does not, it is gone from the game).
 *
 * A record the team holds (`assigned`) is never returned: a team standing at a stop is never
 * stranded by a retirement. `templateTasks` null/undefined means "the template no longer has this
 * stage": every unassigned record is then `removed`. Pure and total, never throws, idempotent once
 * applied.
 */
export function stageRetirements(args: {
  templateTasks: readonly (UnlockGraphTask & ExpiryGate)[] | null | undefined;
  records: readonly (RunGateRecord | null | undefined)[] | null | undefined;
  launchedAt: string | number | null | undefined;
  nowMs: number;
  /**
   * The stage's exclusive groups. An open record whose alternative is already COMPLETED is retired
   * as `exclusive`: completeTaskForTeam would refuse it, and routing does not look at groups, so
   * it would be handed out and then be impossible to finish. completeTaskForTeam retires those
   * siblings itself at the moment of completion; this catches every record reopened AFTER that
   * (send-team-back, an operator skip reopened by a stage rewind).
   */
  exclusiveGroups?: ExclusiveGroupLike[];
}): { taskId: string; cause: RetirementCause }[] {
  const records = (Array.isArray(args?.records) ? args.records : [])
    .filter((r): r is RunGateRecord & { taskId: string } => !!r && typeof r.taskId === 'string' && !!r.taskId);
  const tpl = Array.isArray(args?.templateTasks) ? args.templateTasks.filter((t) => !!t && typeof t.id === 'string') : [];
  const tplById = new Map(tpl.map((t) => [t.id, t]));
  const status: Record<string, TaskProgressStatus> = {};
  const cause: Record<string, unknown> = {};
  for (const r of records) {
    status[r.taskId] = (['unassigned', 'assigned', 'completed', 'skipped'] as const).includes(r.status as TaskProgressStatus)
      ? r.status as TaskProgressStatus
      : 'unassigned';
    cause[r.taskId] = r.skipCause;
  }
  const out: { taskId: string; cause: RetirementCause }[] = [];
  const blocked = new Set(blockedTaskIds(
    { tasks: tpl.map((t) => ({ id: t.id, hidden: (t as { hidden?: boolean }).hidden })), exclusiveGroups: args.exclusiveGroups },
    records.filter((r) => status[r.taskId] === 'completed').map((r) => r.taskId),
  ));
  for (const r of records) {
    if (status[r.taskId] !== 'unassigned') continue;
    const t = tplById.get(r.taskId);
    let why: RetirementCause | null = null;
    if (!t) why = 'removed';
    else if (blocked.has(r.taskId)) why = 'exclusive';
    else if (isExpired(t, args.launchedAt, args.nowMs)) why = 'expired';
    if (why) {
      out.push({ taskId: r.taskId, cause: why });
      status[r.taskId] = 'skipped';
      cause[r.taskId] = why;
    }
  }
  const graph = runStageTasks(tpl, records);
  for (const id of unreachableTaskIds(graph, status, cause)) out.push({ taskId: id, cause: 'unreachable' });
  // Stage order: the order the records are stored in.
  const order = records.map((r) => r.taskId);
  return out.sort((a, b) => order.indexOf(a.taskId) - order.indexOf(b.taskId));
}

/**
 * wave-f (next-task-regression, Bug A). Given the UNASSIGNED, not-yet-completed
 * tasks of a team's active stage, return the ids that are GENUINELY gated — a
 * task routing cannot hand out yet because it is either release-scheduled and not
 * yet released, or unlock-gated with an unmet prerequisite. A task that is merely
 * "unassigned because routing has not picked it yet" is NOT locked and is absent
 * from the result.
 *
 * This is the server-authoritative signal getMyTeamState ships to the play client
 * so it can distinguish "locked" from "awaiting routing" WITHOUT the client
 * re-shipping non-assigned task content (wave D omits it from the payload). It
 * mirrors the `allLocked` arm of the routing candidate filter
 * (classifyNoAssignment / assignTask) — station-cap ("stationsFull") and expiry
 * are transient/swept states, deliberately NOT treated as locked here.
 *
 * Pure: no I/O, so it is unit-tested (scripts/test-locked-task-ids.ts) without the
 * emulator. `runStartedAt` is the run's launchedAt; `nowMs` the server clock.
 */
export function lockedTaskIds(
  candidates: (UnlockGate & ReleaseGate & { id: string; status?: StationStatus })[],
  completedTaskIds: string[],
  runStartedAt: string | number | null | undefined,
  nowMs: number,
  // change: run-gate-integrity. A mission the organizers PAUSED is held back exactly like a gated
  // one — routing will not hand it out until it is resumed. Left out of this list it read as
  // "awaiting routing", so a team whose only remaining mission was paused watched a spinner that
  // could never resolve instead of the "locked for now" card. Optional: absent = template status.
  taskStatusOverrides?: TaskStatusOverrides,
): string[] {
  return candidates
    .filter((t) => !isReleased(t, runStartedAt, nowMs) || !isUnlocked(t, completedTaskIds)
      || !isTaskAssignable(t, taskStatusOverrides))
    .map((t) => t.id);
}

/** Minimal task shape validateUnlockGraph needs (id + optional gate). */
export interface UnlockGraphTask extends UnlockGate {
  id: string;
}

/**
 * Builder-time starvation warning (WO-6 / sim-01 defect #2). In a partial stage
 * (`requiredTaskCount` set below the task count) routing gives locationless tasks
 * a transit cost of 0, so they are picked first over any located station — a
 * physical stop can end up NEVER visited by any team. This pure predicate flags
 * that risky mix so the Builder can warn the creator; it does NOT change routing.
 * True only when the stage is partial AND mixes at least one locationless task
 * with at least one located (pinned) task.
 */
export function partialStageStarvationWarning(stage: {
  requiredTaskCount?: number;
  tasks: { locationless?: boolean }[];
}): boolean {
  const tasks = Array.isArray(stage.tasks) ? stage.tasks : [];
  const req = stage.requiredTaskCount;
  if (typeof req !== 'number' || req >= tasks.length) return false;
  const locationless = tasks.filter((t) => t?.locationless === true).length;
  const located = tasks.length - locationless;
  return locationless > 0 && located > 0;
}

/**
 * Strip prerequisite ids that are NOT ids of this stage's own tasks (and a task's
 * reference to itself), returning the repaired task array.
 *
 * WHY THIS EXISTS. `unlockAfterTaskIds` is stage-scoped, and validateUnlockGraph
 * turns a dangling id into a save-blocking ERROR — which the Builder's autosave
 * surfaces as "stage X requires more missions than it can yield" and then refuses
 * every subsequent save of the whole game. The creator cannot act on that: the
 * prerequisite selector only lists missions of the SAME stage, so an id pointing
 * at a mission that is no longer there is invisible AND unremovable. A dangling
 * id is the one kind of unlock-graph corruption with no door out, so it is
 * REPAIRED rather than reported. A self-reference goes with it (the selector never
 * offers a mission itself, so that id is unreachable too); a CYCLE is deliberately
 * left to validation — every mission in a cycle is on screen and can be unchecked.
 *
 * Pure and total: a non-array gate is left exactly as it is (validation still
 * judges it), an emptied gate becomes `undefined` rather than `[]` so it reads as
 * "no gate" everywhere, and a task that needed no repair is returned BY REFERENCE
 * so a caller can detect "nothing changed" with `===`.
 */
export function pruneDanglingPrerequisites<T extends UnlockGraphTask>(
  tasks: readonly T[] | null | undefined,
): T[] {
  const list = Array.isArray(tasks) ? tasks : [];
  const known = new Set(list.map((t) => t?.id).filter((id): id is string => !!id));
  return list.map((t) => {
    const gate = t?.unlockAfterTaskIds;
    if (!Array.isArray(gate)) return t;
    const kept = gate.filter((id) => id !== t.id && known.has(id));
    if (kept.length === gate.length) return t;
    return { ...t, unlockAfterTaskIds: kept.length > 0 ? kept : undefined };
  });
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


// ─── Unreachable tasks (change: unreachable-task-strand) ─────────────────────
// validateUnlockGraph proves every task is reachable in the TEMPLATE. It cannot
// prove it in a RUN, because a prerequisite can become permanently unattainable
// for one team: the losing member of an exclusive group is marked `skipped` the
// moment its alternative is completed (functions/src/runs/index.ts), and an
// expiry sweep skips a task mid-flight. A task gated on one of those stays
// `unassigned` forever — routing filters it out as locked, nothing ever grades
// it, so applyStageCompletion's `allTerminal` arm never fires and the team is
// stuck in that stage for the rest of the event.
//
// The truth here is a fact about the RUN, not about the template, so it is
// resolved at run time (unreachableTaskIds) and only WARNED about at authoring
// time (exclusiveUnlockRisks): "this task unlocks after one of two alternatives"
// is legitimate branching content, and refusing to save it would forbid a design
// that now plays correctly.

/** A team's per-task progress, as stored on its RunTaskRecord. */
export type TaskProgressStatus = 'unassigned' | 'assigned' | 'completed' | 'skipped';

/**
 * The still-unassigned tasks of ONE stage that THIS team can never complete,
 * in stage order. A task is dead when any prerequisite is dead: already skipped,
 * itself dead, or structurally impossible (an unknown/cross-stage id, a
 * self-reference, a cycle — all of which validateUnlockGraph rejects at save
 * time, so they are belt-and-braces here rather than the expected input).
 *
 * Computed as a LEAST fixpoint over "can still be completed", seeded with the
 * tasks that are `completed` (already done) or `assigned` (in the team's hands,
 * so they may still complete). That seeding is what makes two guarantees hold:
 *
 *  - TERMINATION on a cyclic or self-referential graph: every pass either adds at
 *    least one task to the alive set or ends the loop, and the set is bounded by
 *    the task count, so a cycle simply never enters it (and is reported dead).
 *  - NO FALSE SKIP: a task is returned only when a prerequisite is provably
 *    unattainable. A task the team has completed or is holding is never returned
 *    at all, so nothing already started can be retired under it.
 *
 * Idempotent: applying the result (marking those tasks skipped) makes a second
 * call return nothing.
 */
export function unreachableTaskIds(
  tasks: UnlockGraphTask[],
  statusByTaskId: Record<string, TaskProgressStatus | undefined>,
  // Why each skipped record was skipped (change: skip-keeps-the-stage). Optional so every existing
  // caller keeps its exact behaviour: a skip with no recorded cause is dead, as it always was.
  skipCauseByTaskId?: Record<string, unknown>,
): string[] {
  const list = (Array.isArray(tasks) ? tasks : []).filter((t): t is UnlockGraphTask => !!t?.id);
  const ids = new Set(list.map((t) => t.id));
  const statusOf = (id: string): TaskProgressStatus => statusByTaskId?.[id] ?? 'unassigned';

  // Seed: what the team holds now, plus everything that SATISFIES a gate (completed, or skipped by
  // an operator). An operator skip of a chain's head therefore leaves the chain reachable.
  const alive = new Set<string>();
  for (const t of list) {
    const s = statusOf(t.id);
    if (s === 'assigned' || satisfiesGate({ status: s, skipCause: skipCauseByTaskId?.[t.id] })) alive.add(t.id);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of list) {
      if (alive.has(t.id) || statusOf(t.id) !== 'unassigned') continue;
      const deps = Array.isArray(t.unlockAfterTaskIds) ? t.unlockAfterTaskIds : [];
      if (deps.every((d) => d !== t.id && ids.has(d) && alive.has(d))) {
        alive.add(t.id);
        grew = true;
      }
    }
  }
  return list.filter((t) => statusOf(t.id) === 'unassigned' && !alive.has(t.id)).map((t) => t.id);
}

/** One authoring-time risk: `taskId` dies whenever the team picks past `prerequisiteId`. */
export interface ExclusiveUnlockRisk {
  /** The task that can end up unplayable. */
  taskId: string;
  /** The exclusive-group member it needs (possibly through a chain of gates). */
  prerequisiteId: string;
  /** The authored group that prerequisite belongs to. */
  groupId: string;
  /** The other members of that group whose choice kills `taskId`. May be empty. */
  alternativeIds: string[];
}

/**
 * Builder-time warning: the tasks of a stage that SOME choice of exclusive-group
 * members leaves unplayable. Advisory, never save-blocking — the shape is a
 * legitimate branch ("do the museum follow-up only if you chose the museum") and
 * the run-time rule above now retires the dead branch cleanly instead of
 * stranding the team. What the creator needs is to KNOW, so a task they expected
 * everyone to play is not quietly reachable by half the field.
 *
 * The "search over which member the team picked" collapses to a closure: if the
 * prerequisite chain of a task contains ANY member of an effective group, then
 * choosing a different member of that group retires the chain, so the task dies.
 * No enumeration of choices is needed. The closure walk carries a visited set, so
 * a cyclic or self-referential graph terminates (those are already save-blocking
 * errors from validateUnlockGraph).
 */
export function exclusiveUnlockRisks(stage: {
  tasks: UnlockGraphTask[];
  exclusiveGroups?: ExclusiveGroupLike[];
}): ExclusiveUnlockRisk[] {
  const list = (Array.isArray(stage?.tasks) ? stage.tasks : []).filter((t): t is UnlockGraphTask => !!t?.id);
  const groups = effectiveExclusiveGroups({ tasks: list, exclusiveGroups: stage?.exclusiveGroups });
  if (groups.length === 0) return [];

  // Effective groups carry no id (they are normalized member lists), so recover
  // the authored id from the first member — a member belongs to exactly one
  // effective group, and the FIRST authored group that names it is the one that
  // claimed it.
  const authored = Array.isArray(stage?.exclusiveGroups) ? stage.exclusiveGroups : [];
  const groupIdOf = new Map<string, string>();
  const memberGroup = new Map<string, string[]>();
  for (const members of groups) {
    const owner = authored.find((g) => Array.isArray(g?.taskIds) && members.every((m) => g.taskIds.includes(m)))
      ?? authored.find((g) => Array.isArray(g?.taskIds) && g.taskIds.includes(members[0]));
    for (const m of members) {
      groupIdOf.set(m, owner?.id ?? '');
      memberGroup.set(m, members);
    }
  }

  const byId = new Map(list.map((t) => [t.id, t]));
  const order = list.map((t) => t.id);
  const risks: ExclusiveUnlockRisk[] = [];

  for (const t of list) {
    // Transitive prerequisite closure of t. `seen` bounds the walk, so a cycle
    // or a self-reference terminates instead of recursing forever.
    const closure = new Set<string>();
    const queue = [...(Array.isArray(t.unlockAfterTaskIds) ? t.unlockAfterTaskIds : [])];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (closure.has(id) || !byId.has(id)) continue;
      closure.add(id);
      const next = byId.get(id)?.unlockAfterTaskIds;
      if (Array.isArray(next)) queue.push(...next);
    }
    const prerequisiteId = order.find((id) => id !== t.id && closure.has(id) && memberGroup.has(id));
    if (!prerequisiteId) continue;
    const members = memberGroup.get(prerequisiteId) ?? [];
    risks.push({
      taskId: t.id,
      prerequisiteId,
      groupId: groupIdOf.get(prerequisiteId) ?? '',
      alternativeIds: members.filter((m) => m !== prerequisiteId && m !== t.id),
    });
  }
  return risks;
}
