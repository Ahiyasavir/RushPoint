// Sending ONE team back to a mission or a stage (change: send-team-back).
//
// Ahiya, 2026-09-25: "I have no button at all to send a team back, make sure there is one."
// Nothing could reopen a skipped/completed mission or an earlier stage (forceAssignTask refuses
// both). The case waiting for it: run oNaUvNrCWRia4Y1b9xOO (2026-09-22), where one team lost its
// whole stage 1 to the skip bug that skip-keeps-the-stage fixed.
//
// This is the pure decision; `returnTeamTo` writes exactly what it returns. The rules:
//
//   * Returning to a MISSION reopens that one record and makes it the mission to claim now. Its
//     award is removed (it is earned again on completion), its stamps cleared, its answer log KEPT.
//   * Returning to a STAGE reopens every record the organizer or the stage's own completion closed
//     (operator skips, leftovers, retirements, legacy skips with no cause). An exclusive-group loss
//     and an expiry stay closed: those are the game's authored rules, and a single mission can still
//     be reopened explicitly if the organizer really means it.
//   * The target stage becomes active; every later stage that had started goes back to `locked`
//     with its records KEPT (a completed mission there stays completed: no work is lost). Any mission
//     a team was holding is released, so its station slot can be freed.
//   * A skip may have lowered this team's requirement for the stage; it returns to the template's.
//   * The team's score never goes below zero; the delta is derived FROM the clamp so the two can
//     never disagree (the approval-reversal rule).
//
// Stage completion is NOT re-evaluated here: `applyStageCompletion` lives in functions/ and is run by
// the callable on the reactivated stage, because a stage whose requirement is already met must
// complete again at once (research 2026-09-25: completion is otherwise evaluated only when a task
// of that stage finishes). Pure and total: scripts/test-team-rewind.ts.

import type { RunStageRecord, RunTaskRecord } from './types';

export type RewindTarget = { kind: 'task'; taskId: string } | { kind: 'stage'; stageId: string };

export type RewindRefusal = 'badInput' | 'unknownTarget' | 'targetNotTerminal' | 'stageNotReached';

export interface RewindGameStage {
  id: string;
  requiredTaskCount?: number;
  tasks?: { id: string }[];
}

export interface TeamRewindInput {
  stages: RunStageRecord[];
  gameStages: RewindGameStage[];
  target: RewindTarget;
  teamScore: number;
  teamStatus?: string;
}

export interface TeamRewindPlan {
  ok: boolean;
  reason?: RewindRefusal;
  /** The team's new stage array (a deep copy; the input is never touched). */
  stages: RunStageRecord[];
  /** Index of the stage that is active after the rewind. */
  targetStageIdx: number;
  /** The mission to claim for the team now (task target only), else null: routing picks. */
  assignTaskId: string | null;
  /** Records that were `assigned` and are released: their station slots must be freed. */
  releaseTaskIds: string[];
  /** Every record this rewind reopened. */
  reopenedTaskIds: string[];
  /** Stages sent back to `locked`. */
  relockedStageIds: string[];
  scoreDelta: number;
  nextTeamScore: number;
  /** One entry per reopened record that carried an award. */
  ledger: { taskId: string; delta: number }[];
  /** The team had finished and is active again. */
  reactivatesTeam: boolean;
}

const REOPENABLE_BY_STAGE = new Set<unknown>([undefined, 'operator', 'operatorStage', 'stageSatisfied', 'unreachable']);

function refuse(reason: RewindRefusal, stages: RunStageRecord[] = [], score = 0): TeamRewindPlan {
  return {
    ok: false, reason, stages, targetStageIdx: -1, assignTaskId: null, releaseTaskIds: [],
    reopenedTaskIds: [], relockedStageIds: [], scoreDelta: 0, nextTeamScore: score, ledger: [],
    reactivatesTeam: false,
  };
}

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function reopenRecord(rec: RunTaskRecord): number {
  const award = Math.max(0, finite(rec.earnedScore));
  rec.status = 'unassigned';
  delete rec.skipCause;
  delete rec.completedAt;
  delete rec.startedAt;
  delete rec.actualMinutes;
  delete rec.excludedMs;
  delete rec.expectedDurationMinutesAtCompletion;
  delete (rec as { verificationOutcome?: unknown }).verificationOutcome;
  delete (rec as { surveyResponse?: unknown }).surveyResponse;
  delete (rec as { arrivedAt?: unknown }).arrivedAt;
  delete (rec as { scoreBreakdown?: unknown }).scoreBreakdown;
  rec.earnedScore = 0;
  return award;
}

export function planTeamRewind(input: TeamRewindInput): TeamRewindPlan {
  if (!input || typeof input !== 'object' || !Array.isArray(input.stages) || !input.target) return refuse('badInput');
  const teamScore = Math.max(0, finite(input.teamScore));
  // Deep enough a copy: stage objects and their task records are rewritten.
  const stages: RunStageRecord[] = input.stages.map((s) => ({
    ...s, tasks: (Array.isArray(s?.tasks) ? s.tasks : []).map((t) => ({ ...t })),
  }));

  const target = input.target;
  let targetStageIdx = -1;
  if (target.kind === 'task' && typeof target.taskId === 'string') {
    targetStageIdx = stages.findIndex((s) => s.tasks.some((t) => t.taskId === target.taskId));
  } else if (target.kind === 'stage' && typeof target.stageId === 'string') {
    targetStageIdx = stages.findIndex((s) => s.stageId === target.stageId);
  } else {
    return refuse('badInput', input.stages, teamScore);
  }
  if (targetStageIdx < 0) return refuse('unknownTarget', input.stages, teamScore);

  // A stage the team has not reached yet is not a place to go BACK to.
  if (stages[targetStageIdx].status === 'locked') return refuse('stageNotReached', input.stages, teamScore);

  const targetRec = target.kind === 'task'
    ? stages[targetStageIdx].tasks.find((t) => t.taskId === target.taskId)!
    : null;
  if (targetRec && targetRec.status !== 'completed' && targetRec.status !== 'skipped') {
    return refuse('targetNotTerminal', input.stages, teamScore);
  }

  const releaseTaskIds: string[] = [];
  const reopenedTaskIds: string[] = [];
  const relockedStageIds: string[] = [];
  const ledger: { taskId: string; delta: number }[] = [];
  let removed = 0;

  // Later stages that had started wait again; their records are kept, a held one released.
  for (let i = targetStageIdx + 1; i < stages.length; i++) {
    const s = stages[i];
    if (s.status === 'active' || s.status === 'completed') {
      s.status = 'locked';
      delete s.startedAt;
      delete s.completedAt;
      relockedStageIds.push(s.stageId);
    }
    for (const t of s.tasks) {
      if (t.status === 'assigned') { t.status = 'unassigned'; delete t.startedAt; releaseTaskIds.push(t.taskId); }
    }
  }

  const stage = stages[targetStageIdx];
  stage.status = 'active';
  delete stage.completedAt;

  // The template's requirement, not the one a skip lowered for this team.
  const gameStage = (Array.isArray(input.gameStages) ? input.gameStages : []).find((g) => g?.id === stage.stageId);
  if (gameStage && typeof gameStage.requiredTaskCount === 'number') stage.requiredTaskCount = gameStage.requiredTaskCount;
  else delete stage.requiredTaskCount;

  if (targetRec) {
    const rec = stage.tasks.find((t) => t.taskId === targetRec.taskId)!;
    // The mission they are holding in this stage makes way for the one they are sent back to.
    for (const t of stage.tasks) {
      if (t.status === 'assigned' && t.taskId !== rec.taskId) {
        t.status = 'unassigned'; delete t.startedAt; releaseTaskIds.push(t.taskId);
      }
    }
    const award = reopenRecord(rec);
    reopenedTaskIds.push(rec.taskId);
    if (award > 0) { removed += award; ledger.push({ taskId: rec.taskId, delta: -award }); }
    // In a stage whose requirement is ALREADY met by the other completions (a partial stage, a
    // leftover being sent back to), the stage would complete again the moment it is evaluated and
    // auto-skip the very mission the operator chose. The operator's intent wins: this team's
    // requirement rises just enough for that mission to count, never above the stage's size.
    const completedNow = stage.tasks.filter((t) => t.status === 'completed').length;
    const required = typeof stage.requiredTaskCount === 'number' ? stage.requiredTaskCount : stage.tasks.length;
    if (completedNow >= required) stage.requiredTaskCount = Math.min(stage.tasks.length, completedNow + 1);
  } else {
    for (const t of stage.tasks) {
      if (t.status === 'skipped' && REOPENABLE_BY_STAGE.has(t.skipCause)) {
        const award = reopenRecord(t);
        reopenedTaskIds.push(t.taskId);
        if (award > 0) { removed += award; ledger.push({ taskId: t.taskId, delta: -award }); }
      }
    }
  }

  const nextTeamScore = Math.max(0, teamScore - removed);
  // The ledger records what REALLY happened to the score (found in the running app: the preview
  // said "0 points come off" while the ledger said -10). When the zero clamp absorbs part of the
  // removal, the entries are trimmed in order so they sum exactly to the real delta.
  let budget = teamScore - nextTeamScore;
  const realLedger: { taskId: string; delta: number }[] = [];
  for (const l of ledger) {
    if (budget <= 0) break;
    const take = Math.min(-l.delta, budget);
    realLedger.push({ taskId: l.taskId, delta: -take });
    budget -= take;
  }
  ledger.length = 0;
  ledger.push(...realLedger);
  return {
    ok: true,
    stages,
    targetStageIdx,
    assignTaskId: targetRec ? targetRec.taskId : null,
    releaseTaskIds,
    reopenedTaskIds,
    relockedStageIds,
    scoreDelta: nextTeamScore - teamScore,
    nextTeamScore,
    ledger,
    reactivatesTeam: input.teamStatus === 'finished',
  };
}
