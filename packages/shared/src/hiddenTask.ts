// Benched missions (change: mission-card-actions).
//
// `Task.hidden` means "this mission is authored and kept, and takes no part in the
// game until the creator un-benches it". The Builder needed it because the only
// answer it had for "not this one, not this time" was DELETE — and a creator who
// deletes a mission they spent ten minutes writing, to try the game without it,
// does not get it back.
//
// ─── The one rule ───────────────────────────────────────────────────────────
//
// ABSENT MEANS PLAYABLE. Every predicate here is total and answers "hidden" only
// for a literal `true`. A malformed task, a null, a `"true"` string, a number —
// all playable. This matters more than it looks: the field is new, so almost every
// stored mission in existence lacks it, and a reader that treated "not false" or a
// loose truthy as benched would silently empty a live game's stages. The failure
// mode of this module must always be "the mission plays", never "the mission
// vanishes".
//
// ─── Where it is enforced ───────────────────────────────────────────────────
//
// ONE choke point for gameplay: `buildInitialStages` (functions/src/runs) builds a
// run's stage records from the template at LAUNCH, and a benched mission is simply
// not in them. Routing, completion, the leaderboard and the participant payload all
// work from those records, so none of them needs to know this field exists — which
// is why this is a filter at the boundary rather than a condition sprinkled through
// the run code. The other enforcement points are about the TEMPLATE, not the run:
// readiness does not demand a name or a pin for a benched mission, `publishGame`
// does not publish one, and `maxCompletableTasks` does not count one toward what a
// stage can yield.
//
// Dependency-free — scripts/test-hidden-task.ts.

/** The minimum a caller must know about a task. */
export interface HiddenTaskView {
  hidden?: boolean;
}

/**
 * Is this mission benched?
 *
 * Total: `true` for a literal `true` and for nothing else. See the rule above —
 * every unknown resolves to PLAYABLE.
 */
export function isTaskHidden(task: HiddenTaskView | null | undefined): boolean {
  return !!task && (task as { hidden?: unknown }).hidden === true;
}

/**
 * The missions of a stage that take part in the game.
 *
 * Returns a NEW array, and returns `[]` rather than throwing for a stage that has
 * no `tasks` at all — the same tolerance every other stage reader in this package
 * has, because a half-written game reaches these helpers from the Builder on every
 * keystroke.
 */
export function playableTasks<T extends HiddenTaskView>(
  stage: { tasks?: readonly T[] } | null | undefined,
): T[] {
  const tasks = stage && Array.isArray(stage.tasks) ? stage.tasks : [];
  return tasks.filter((t) => !isTaskHidden(t));
}

/** How many missions of this stage are benched. For the Builder's own counters. */
export function hiddenTaskCount(
  stage: { tasks?: readonly HiddenTaskView[] } | null | undefined,
): number {
  const tasks = stage && Array.isArray(stage.tasks) ? stage.tasks : [];
  return tasks.reduce((n, t) => n + (isTaskHidden(t) ? 1 : 0), 0);
}
