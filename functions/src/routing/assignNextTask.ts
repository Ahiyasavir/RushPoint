// ─── Smart Routing — generic task pool within a Stage ────────────────────────
//
// Operates on the tasks inside a single Stage (Stage.tasks[]). Called when a
// team's active stage has multiple tasks and the system must pick the best one.
// If the stage has only one task, the caller should skip routing and assign directly.
//
// Priority(team, task) = 0.5·Φ − 0.3·TransitNorm + 0.2·Ω
//   Φ            = station availability  (1=empty, 0=full)
//   TransitNorm  = walking distance, normalised to 30-min cap
//   Ω            = skill-difficulty match

import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase';
import { haversineKm, isValidCoord } from '@rushpoint/shared';
import type { Task, GeoPoint, TaskRecommendation } from '@rushpoint/shared';

// Runtime counter path for a task within a run
// (stored as a flat map on the Run doc: run.taskCounts[taskId])
const runPath = (ownerUid: string, gameId: string, runId: string) =>
  `users/${ownerUid}/games/${gameId}/runs/${runId}`;


// ─── Priority sub-formulas ────────────────────────────────────────────────────

function loadFactor(task: Task, taskCounts: Record<string, number>): number {
  const cap = task.maxConcurrentTeams ?? 3;
  const current = taskCounts[task.id] ?? 0;
  return cap > 0 ? Math.max(0, (cap - current) / cap) : 0;
}

function transitMinutes(teamLocation: GeoPoint, task: Task): number {
  // A locationless (general) task can be done from wherever the team is.
  if (task.locationless) return 0;
  if (!task.coordinates || !isValidCoord(task.coordinates.lat, task.coordinates.lng)) return 5;
  return haversineKm(teamLocation, task.coordinates) * 12; // 5 km/h walking
}

function skillMatch(skillRatio: number, difficulty: number): number {
  const normalizedDifficulty = (difficulty - 5) / 5;
  return 1 - Math.abs(skillRatio - normalizedDifficulty);
}

// When `skillAware` (the smart_weighted preset) the routing balances station
// load, walking distance AND skill-difficulty fit + the team's pace history.
// Otherwise (fixed-points / time presets) there's no per-team difficulty target,
// so we route purely to the nearest available station — distance + load only.
function priorityScore(
  task: Task,
  teamLocation: GeoPoint,
  skillRatio: number,
  taskCounts: Record<string, number>,
  skillAware: boolean,
): number {
  const transitNorm = Math.min(transitMinutes(teamLocation, task), 30) / 30;
  if (!skillAware) {
    return 0.6 * loadFactor(task, taskCounts) - 0.4 * transitNorm;
  }
  return (
    0.5 * loadFactor(task, taskCounts) -
    0.3 * transitNorm +
    0.2 * skillMatch(skillRatio, task.difficulty ?? 5)
  );
}


// ─── Skill ratio ─────────────────────────────────────────────────────────────
// Historical performance ratio S_i ∈ [-1, 1].
// Negative = consistently faster than estimate; positive = slower.

type SlotSummary = {
  taskId?: string;
  startedAt?: string;
  completedAt?: string;
  actualMinutes?: number;
};

export async function computeSkillRatio(
  completedTasks: SlotSummary[],
  gameTasks: Task[],
): Promise<number> {
  const taskMap = new Map(gameTasks.map((t) => [t.id, t]));
  const measurable = completedTasks.filter(
    (s) => s.taskId && (s.actualMinutes != null || (s.startedAt && s.completedAt)),
  );
  if (measurable.length === 0) return 0;

  let total = 0, count = 0;
  for (const s of measurable) {
    const task = taskMap.get(s.taskId!);
    if (!task || task.estimatedMinutes <= 0) continue;
    const actual = s.actualMinutes ??
      (new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime()) / 60_000;
    if (!Number.isFinite(actual)) continue; // garbage timestamps must not poison the ratio
    total += Math.max(-1, Math.min(1, (actual - task.estimatedMinutes) / task.estimatedMinutes));
    count++;
  }
  return count > 0 ? total / count : 0;
}


// ─── Read task runtime counters from the Run doc ──────────────────────────────

async function getTaskCounts(
  ownerUid: string,
  gameId: string,
  runId: string,
): Promise<Record<string, number>> {
  const snap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  if (!snap.exists) return {};
  const data = snap.data() as { taskCounts?: Record<string, number> };
  return data.taskCounts ?? {};
}


// ─── Recommendation list (read-only, no Firestore writes) ────────────────────

export async function buildRecommendations(
  teamLocation: GeoPoint,
  tasks: Task[],
  completedTaskIds: string[],
  skillRatio: number,
  ownerUid: string,
  gameId: string,
  runId: string,
  limit = 5,
  skillAware = true,
): Promise<TaskRecommendation[]> {
  const taskCounts = await getTaskCounts(ownerUid, gameId, runId);

  const candidates = tasks.filter((t) => {
    if (completedTaskIds.includes(t.id)) return false;
    if (t.status === 'paused' || t.status === 'closed') return false;
    const current = taskCounts[t.id] ?? 0;
    if (current >= (t.maxConcurrentTeams ?? 3)) return false;
    return true;
  });

  return candidates
    .map((task) => ({
      task,
      priority: priorityScore(task, teamLocation, skillRatio, taskCounts, skillAware),
      distanceKm:
        !task.locationless && task.coordinates && isValidCoord(task.coordinates.lat, task.coordinates.lng)
          ? haversineKm(teamLocation, task.coordinates)
          : 0,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
    .map(({ task, priority, distanceKm }, idx) => ({
      taskId: task.id,
      taskIndex: tasks.indexOf(task),
      title: task.title,
      priority: Math.round(priority * 1000) / 1000,
      estimatedMinutes: task.estimatedMinutes,
      difficulty: task.difficulty ?? 5,
      currentLoad:
        (task.maxConcurrentTeams ?? 3) > 0
          ? (taskCounts[task.id] ?? 0) / (task.maxConcurrentTeams ?? 3)
          : 0,
      distanceKm: Math.round(distanceKm * 100) / 100,
    }));
}


// ─── Task assignment (atomically increments run.taskCounts[taskId]) ───────────

export async function assignTask(
  teamLocation: GeoPoint,
  tasks: Task[],
  completedTaskIds: string[],
  skillRatio: number,
  ownerUid: string,
  gameId: string,
  runId: string,
  skillAware = true,
): Promise<{ taskId?: string; taskIndex?: number }> {
  const taskCounts = await getTaskCounts(ownerUid, gameId, runId);

  const candidates = tasks.filter((t) => {
    if (completedTaskIds.includes(t.id)) return false;
    if (t.status === 'paused' || t.status === 'closed') return false;
    const current = taskCounts[t.id] ?? 0;
    if (current >= (t.maxConcurrentTeams ?? 3)) return false;
    return true;
  });

  if (candidates.length === 0) return {};

  const chosen = candidates.sort(
    (a, b) =>
      priorityScore(b, teamLocation, skillRatio, taskCounts, skillAware) -
      priorityScore(a, teamLocation, skillRatio, taskCounts, skillAware),
  )[0];

  // Increment the runtime counter atomically on the Run doc
  await db.doc(runPath(ownerUid, gameId, runId)).update({
    [`taskCounts.${chosen.id}`]: FieldValue.increment(1),
  });

  return { taskId: chosen.id, taskIndex: tasks.indexOf(chosen) };
}


// ─── Task release ─────────────────────────────────────────────────────────────

export async function releaseTask(
  taskId: string,
  ownerUid: string,
  gameId: string,
  runId: string,
): Promise<void> {
  const runRef = db.doc(runPath(ownerUid, gameId, runId));
  const snap = await runRef.get();
  if (!snap.exists) return;
  const data = snap.data() as { taskCounts?: Record<string, number> };
  const current = data.taskCounts?.[taskId] ?? 0;
  if (current > 0) {
    await runRef.update({
      [`taskCounts.${taskId}`]: FieldValue.increment(-1),
    });
  }
}
