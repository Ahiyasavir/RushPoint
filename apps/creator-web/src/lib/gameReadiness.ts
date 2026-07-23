// Game readiness (change: builder-first-task-flow).
//
// The Builder used to discover launch blockers one modal alert at a time: four
// sequential guards inside `saveAndLaunch`, each naming ONE offending task and
// returning, so three broken tasks cost three failed launch attempts and nothing
// surfaced any of them before a launch was tried.
//
// This module is the SINGLE place those rules live. The persistent readiness
// panel renders `computeGameReadiness`, and the launch guard is
// `canLaunchGame` over the same array, so the panel and the guard cannot drift
// (proven by the identity test in __tests__/builderFirstTaskFlow.test.ts, which
// re-expresses the four legacy predicates inline).
//
// The four rules are lifted VERBATIM from the old guards, including that
// `validateUnlockGraph` WARNINGS block a launch exactly as they do today.
// Splitting readiness into blocking issues and non blocking advisories would
// change what can launch, and is deliberately left to a follow up.
import type { Game, Stage, Task } from '@rushpoint/shared';
import { validateUnlockGraph, requiredTaskCountProblem } from '@rushpoint/shared';
import { isTaskInteractionValid, isTaskLocationValid } from './wizardLogic';

export type ReadinessCode =
  | 'stageHasNoTask'      // a stage with no tasks (or a game with no stages)
  | 'taskNotCompletable'  // a quiz/numeric/station/sequence task with no answer key
  | 'taskNotPlaced'       // a located task still on the {0,0} sentinel
  | 'stageUnwinnable';    // requiredTaskCount above what the stage can yield

export interface ReadinessIssue {
  code: ReadinessCode;
  /** Empty ONLY for a game with no stages at all, which has nothing to link to. */
  stageId: string;
  stageTitle: string;
  taskId?: string;
  taskTitle?: string;
}

/** Just enough of a game to judge it, so tests and callers stay light. */
type ReadableGame = Pick<Game, 'stages'>;

/**
 * EVERY blocking issue in the game, ordered by stage order then task order so
 * the panel is stable across renders.
 */
export function computeGameReadiness(game: ReadableGame): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const stages: Stage[] = game.stages ?? [];

  // A game with no stages at all: the same refusal the old alert produced, with
  // no stage to navigate to.
  if (stages.length === 0) {
    return [{ code: 'stageHasNoTask', stageId: '', stageTitle: '' }];
  }

  for (const stage of stages) {
    const stageId = stage.id;
    const stageTitle = stage.title ?? '';
    const tasks: Task[] = stage.tasks ?? [];

    if (tasks.length === 0) {
      issues.push({ code: 'stageHasNoTask', stageId, stageTitle });
      // An empty stage has no graph to validate; the old guards returned here too.
      continue;
    }

    for (const task of tasks) {
      const taskId = task.id;
      const taskTitle = task.title ?? '';
      if (!isTaskInteractionValid(task)) {
        issues.push({ code: 'taskNotCompletable', stageId, stageTitle, taskId, taskTitle });
      }
      if (!isTaskLocationValid(task)) {
        issues.push({ code: 'taskNotPlaced', stageId, stageTitle, taskId, taskTitle });
      }
    }

    // Stage winnability (change: stage-winnability). Two INDEPENDENT ways a stage
    // can require more than it can yield, reported under one code because the fix
    // is the same (lower the count or change the shape):
    //   • an unreachable prerequisite chain (validateUnlockGraph, as before);
    //   • exclusive groups — a group of alternatives yields ONE completion however
    //     many members it has, so six tasks in three pairs yield three. This arm is
    //     what makes an ALREADY SAVED broken game announce itself the next time its
    //     Builder is opened, and blocks its launch from the Dashboard too.
    const graph = validateUnlockGraph(stage);
    const groupProblem = requiredTaskCountProblem(stage);
    if (graph.warnings.length > 0 || graph.errors.length > 0 || groupProblem !== null) {
      issues.push({ code: 'stageUnwinnable', stageId, stageTitle });
    }
  }

  return issues;
}

/** Launch proceeds if and only if the readiness surface is empty. */
export function canLaunchGame(game: ReadableGame): boolean {
  return computeGameReadiness(game).length === 0;
}

/**
 * The issue a caller with no readiness panel should name.
 *
 * The Dashboard launches games without a Builder view, so it cannot point at the
 * panel; it names one offender the way the old sequential guards did. It reads
 * that offender from THIS module rather than re-deriving the rules, which is
 * what let the Dashboard drift from the Builder in the first place (it never
 * checked for a stage with no tasks, so it would launch a game the Builder
 * refused).
 *
 * Returns null exactly when `canLaunchGame` is true.
 */
export function firstLaunchBlocker(game: ReadableGame): ReadinessIssue | null {
  return computeGameReadiness(game)[0] ?? null;
}
