import {
  isReleased, unreachableTaskIds, resolveExpectedMinutes,
  type Game, type RunStageRecord, type TaskProgressStatus, type Task,
} from '@rushpoint/shared';

// fix-fixed-points-speed-template-drift: stamp the resolved expected route-minutes
// onto a record as it transitions to `skipped`, from the corresponding template
// task, using the SAME resolution the completion path and scoreFixedPointsSpeed use.
// So a finished team's EVERY terminal record carries the stamp and its
// fixed_points_speed expected-total is immutable against later template edits.
function stampSkipExpected(rec: { taskId: string; expectedDurationMinutesAtCompletion?: number }, templateTasks: Task[] | undefined): void {
  if (!templateTasks) return;
  const gameTask = templateTasks.find((t) => t.id === rec.taskId);
  if (gameTask) rec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask);
}

// Shared run-domain helpers.
//
// `applyStageCompletion` is the SINGLE source of truth for "a team's active
// stage just completed" — the required-task-count check, leftover auto-skip,
// final-stage detection, summed stage score, and scheduled-release-gated
// next-stage unlock. It was previously duplicated verbatim in
// `completeTaskForTeam` and (as a comment literally noted) mirrored in
// `sweepExpiredInFlight`; both now delegate here so the two copies can't drift.
//
// It mutates `stages` in place (the caller works on a fresh clone) and returns
// whether the stage completed plus the ids of any tasks that were ASSIGNED when
// auto-skipped — those still hold a station-occupancy slot, so the caller must
// release them after its transaction. `sweepExpiredInFlight` intentionally
// ignores that list (its historical behavior releases no slots).
export function applyStageCompletion(
  stages: RunStageRecord[],
  stageIdx: number,
  game: Game,
  launchedAt: string | undefined,
  now: string,
): { completed: boolean; heldAssignedTaskIds: string[] } {
  const heldAssignedTaskIds: string[] = [];
  const gameStage = game.stages?.find((s) => s.id === stages[stageIdx].stageId);

  // Unreachable tasks (change: unreachable-task-strand). BEFORE any counting: a
  // task gated (`unlockAfterTaskIds`) on a task this team can never complete —
  // the losing member of an exclusive group, an expiry-swept task, or anything
  // downstream of one — can never be handed out, graded or skipped by any other
  // rule. Left alone it stays `unassigned` forever, which keeps `allTerminal`
  // false and strands the team in this stage for the rest of the event, with no
  // path out except an owner noticing and calling skipStage.
  //
  // `unreachableTaskIds` returns ONLY still-unassigned tasks, so nothing the team
  // completed or is currently holding is ever retired here, and a retired task
  // holds no station slot (it was never assigned) — hence no addition to
  // heldAssignedTaskIds. They are marked `skipped` with NO award, exactly like
  // the exclusive-group losers (runs/index.ts) and the leftovers auto-skipped
  // below; skipAward is deliberately NOT used, that is the owner-initiated
  // skipStage compensation, not an automatic retirement.
  if (gameStage && Array.isArray(gameStage.tasks) && gameStage.tasks.length > 0) {
    const statusByTaskId: Record<string, TaskProgressStatus> = {};
    for (const t of stages[stageIdx].tasks) statusByTaskId[t.taskId] = t.status;
    const dead = new Set(unreachableTaskIds(gameStage.tasks, statusByTaskId));
    if (dead.size > 0) {
      for (const t of stages[stageIdx].tasks) {
        if (dead.has(t.taskId)) {
          t.status = 'skipped';
          stampSkipExpected(t, gameStage.tasks);
        }
      }
    }
  }

  // A stage may require only a SUBSET of its tasks (requiredTaskCount). It's
  // done when that many are completed, OR when no task remains to do.
  const completedCount = stages[stageIdx].tasks.filter((t) => t.status === 'completed').length;
  const required = Math.min(
    stages[stageIdx].requiredTaskCount ?? stages[stageIdx].tasks.length,
    stages[stageIdx].tasks.length,
  );
  const allTerminal = stages[stageIdx].tasks.every((t) => t.status === 'completed' || t.status === 'skipped');
  const stageDone = completedCount >= required || allTerminal;
  if (!stageDone) return { completed: false, heldAssignedTaskIds };

  // Auto-skip any tasks the team didn't need to do. A task still ASSIGNED holds
  // a station-occupancy slot (assignTask incremented taskCounts), so record it
  // for release after the transaction — otherwise the slot leaks.
  for (const t of stages[stageIdx].tasks) {
    if (t.status !== 'completed') {
      if (t.status === 'assigned') heldAssignedTaskIds.push(t.taskId);
      t.status = 'skipped';
      stampSkipExpected(t, gameStage?.tasks);
    }
  }
  stages[stageIdx].status = 'completed';
  stages[stageIdx].completedAt = now;
  stages[stageIdx].earnedScore = stages[stageIdx].tasks.reduce((s, t) => s + (t.earnedScore ?? 0), 0);

  // Check if final stage (triggers Final Run).
  const isLastStage = gameStage?.isFinal ?? (stageIdx === stages.length - 1);

  // Unlock next stage if not final — UNLESS it has a scheduled-release gate that
  // hasn't opened yet (change: scheduled-release). A gated next stage stays
  // `locked`; a later requestNextTask/getMyTeamState poll unlocks it once its
  // gate opens (see computeStageUnlock).
  if (!isLastStage && stageIdx + 1 < stages.length) {
    const nextGameStage = game.stages.find((s) => s.id === stages[stageIdx + 1].stageId);
    if (isReleased(nextGameStage, launchedAt, new Date(now).getTime())) {
      stages[stageIdx + 1].status = 'active';
      stages[stageIdx + 1].startedAt = now;
    }
  }
  return { completed: true, heldAssignedTaskIds };
}
