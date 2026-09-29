// What stands between ONE team and ONE mission an operator wants to send it to
// (change: route-team-to-mission).
//
// Field report 2026-09-27: "only the conditions that actually block this jump may be waived". If a
// mission opens after X and Y and the team did X, the list is exactly "Y is not done" — X is never
// mentioned, because X is not in the way. `forceAssignTask`'s old `override: true` waived release
// time, expiry and every prerequisite together; this list is what the organizer sees, confirms, and
// what the server re-computes and waives, item by item.
//
// Built ON the routing predicates (isReleased / isExpired / isUnlocked / isTaskAssignable /
// gateSatisfiedTaskIds), never beside them, so "blocked" here means exactly what it means to
// routing. Pure and total.

import { isReleased, isExpired } from './schedule';
import { isUnlocked, gateSatisfiedTaskIds } from './gating';
import { isTaskAssignable, type TaskStatusOverrides } from './liveTaskStatus';

export type WaivableBlocker =
  | { kind: 'otherStage'; stageId: string }
  | { kind: 'notReleased' }
  | { kind: 'expired' }
  | { kind: 'prerequisites'; missing: string[] }
  | { kind: 'stationFull'; count: number; cap: number };

export type HardBlocker = {
  kind: 'unknownTask' | 'runFinished' | 'teamRemoved' | 'teamHeld' | 'missionClosed' | 'alreadyDone' | 'alreadyCurrent';
};

export type WaivableKind = WaivableBlocker['kind'];
export const WAIVABLE_ORDER: readonly WaivableKind[] = ['otherStage', 'notReleased', 'expired', 'prerequisites', 'stationFull'];

export interface RouteBlockerInput {
  // `object`, not Record<string, unknown>: a `Task` interface has no index signature.
  game: { stages?: readonly { id: string; tasks?: readonly object[] }[] } | null | undefined;
  team: {
    stages?: { stageId: string; status?: string; tasks?: { taskId: string; status?: string; skipCause?: string }[] }[];
    held?: boolean;
    removed?: boolean;
  } | null | undefined;
  run: {
    status?: string;
    launchedAt?: string;
    taskStatusOverrides?: TaskStatusOverrides;
    taskCounts?: Record<string, number>;
  } | null | undefined;
  taskId: string;
  nowMs: number;
}

export interface RouteBlockers { waivable: WaivableBlocker[]; hard: HardBlocker[] }

const DEFAULT_STATION_CAP = 3;

export function routeBlockers(input: RouteBlockerInput | null | undefined): RouteBlockers {
  const unknown: RouteBlockers = { waivable: [], hard: [{ kind: 'unknownTask' }] };
  if (!input || typeof input !== 'object' || typeof input.taskId !== 'string') return unknown;
  const { game, team, run, taskId, nowMs } = input;

  // Locate the mission in the template and its record on the team.
  let task: Record<string, unknown> | null = null;
  let taskStageId = '';
  for (const s of Array.isArray(game?.stages) ? game!.stages! : []) {
    const found = (Array.isArray(s?.tasks) ? (s.tasks as Record<string, unknown>[]) : []).find((t) => t && t.id === taskId);
    if (found) { task = found; taskStageId = s.id; break; }
  }
  const teamStages = Array.isArray(team?.stages) ? team!.stages! : [];
  const stageRec = teamStages.find((s) => s && s.stageId === taskStageId);
  const rec = (Array.isArray(stageRec?.tasks) ? stageRec!.tasks! : []).find((r) => r && r.taskId === taskId);
  if (!task || !stageRec || !rec) return unknown;

  // Hard blockers: never waived by routing. Fixed order, most fundamental first.
  const hard: HardBlocker[] = [];
  if (run?.status === 'finished') hard.push({ kind: 'runFinished' });
  if (team?.removed === true) hard.push({ kind: 'teamRemoved' });
  else if (team?.held === true) hard.push({ kind: 'teamHeld' });
  if (!isTaskAssignable(task as never, run?.taskStatusOverrides)) hard.push({ kind: 'missionClosed' });
  if (rec.status === 'completed' || rec.status === 'skipped') hard.push({ kind: 'alreadyDone' });
  else if (rec.status === 'assigned') hard.push({ kind: 'alreadyCurrent' });

  // Waivable blockers, in WAIVABLE_ORDER.
  const waivable: WaivableBlocker[] = [];
  const activeStage = teamStages.find((s) => s && s.status === 'active');
  if (!activeStage || activeStage.stageId !== taskStageId) waivable.push({ kind: 'otherStage', stageId: taskStageId });
  const launchedAt = run?.launchedAt;
  if (!isReleased(task as never, launchedAt, nowMs)) waivable.push({ kind: 'notReleased' });
  if (isExpired(task as never, launchedAt, nowMs)) waivable.push({ kind: 'expired' });
  const satisfied = gateSatisfiedTaskIds(teamStages as never);
  if (!isUnlocked(task as never, satisfied)) {
    const prereqs = Array.isArray(task.unlockAfterTaskIds) ? (task.unlockAfterTaskIds as unknown[]) : [];
    // ONLY the missing ones: a satisfied prerequisite is not in the way and is never named.
    const missing = prereqs.filter((id): id is string => typeof id === 'string' && !satisfied.includes(id));
    waivable.push({ kind: 'prerequisites', missing });
  }
  if (task.locationless !== true) {
    const count = Number(run?.taskCounts?.[taskId] ?? 0);
    const capRaw = Number(task.maxConcurrentTeams);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DEFAULT_STATION_CAP;
    if (Number.isFinite(count) && count >= cap) waivable.push({ kind: 'stationFull', count, cap });
  }
  return { waivable, hard };
}

/** Is every computed waivable blocker covered by what the operator accepted? */
export function acceptsAll(blockers: RouteBlockers, accepted: readonly string[] | null | undefined): boolean {
  const ok = new Set(Array.isArray(accepted) ? accepted : []);
  return blockers.waivable.every((b) => ok.has(b.kind));
}
