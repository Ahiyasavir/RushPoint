import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase';
import { haversineKm, isValidCoord } from '@rushpoint/shared';
import type { Task, GeoPoint, TaskRecommendation } from '@rushpoint/shared';

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
const tasksCol = () => `artifacts/${APP_ID}/public/data/tasks`;

// ─── Priority sub-formulas ────────────────────────────────────────────────────

/** Φ: station availability — 1.0 when empty, 0.0 when full */
function loadFactor(task: Task): number {
  const cap = task.maxConcurrentTeams;
  return cap > 0 ? (cap - task.currentTeamCount) / cap : 0;
}

/** Transit time in minutes, assuming 5 km/h walking pace */
function transitMinutes(teamLocation: GeoPoint, task: Task): number {
  if (!task.coordinates || !isValidCoord(task.coordinates.lat, task.coordinates.lng)) return 5;
  return haversineKm(teamLocation, task.coordinates) * 12;
}

/**
 * Ω: skill-difficulty match.
 * S_i ∈ [-1, 1]  (negative = team runs fast, positive = team runs slow)
 * D_j ∈ [1, 10]  normalised to [-0.8, 1.0]
 */
function skillMatch(skillRatio: number, difficulty: number): number {
  const normalizedDifficulty = (difficulty - 5) / 5;
  return 1 - Math.abs(skillRatio - normalizedDifficulty);
}

/**
 * Priority(i, j) = 0.5 * Φ(Load_j) - 0.3 * TransitNorm(i,j) + 0.2 * Ω(S_i, D_j)
 * Higher = better assignment for this team.
 */
function priorityScore(task: Task, teamLocation: GeoPoint, skillRatio: number): number {
  const transitNorm = Math.min(transitMinutes(teamLocation, task), 30) / 30;
  return (
    0.5 * loadFactor(task) -
    0.3 * transitNorm +
    0.2 * skillMatch(skillRatio, task.difficulty ?? 5)
  );
}

// ─── Skill ratio ──────────────────────────────────────────────────────────────

type SlotSummary = { taskId?: string; startedAt?: string; completedAt?: string };

/**
 * Computes the team's historical performance ratio S_i ∈ [-1, 1].
 * Negative = consistently faster than target; positive = consistently slower.
 * Returns 0 (neutral) when no completed slots have timing data.
 */
export async function computeSkillRatio(completedSlots: SlotSummary[]): Promise<number> {
  const measurable = completedSlots.filter(
    (s) => s.taskId && s.startedAt && s.completedAt,
  );
  if (measurable.length === 0) return 0;

  const taskRefs = measurable.map((s) => db.doc(`${tasksCol()}/${s.taskId!}`));
  const taskSnaps = await db.getAll(...taskRefs);

  let total = 0;
  let count = 0;
  for (let i = 0; i < measurable.length; i++) {
    const snap = taskSnaps[i];
    if (!snap.exists) continue;
    const task = snap.data() as Task;
    const slot = measurable[i];
    const actualMs =
      new Date(slot.completedAt!).getTime() - new Date(slot.startedAt!).getTime();
    const actualMinutes = actualMs / 60_000;
    const targetMinutes = task.estimatedMinutes;
    if (targetMinutes > 0) {
      total += Math.max(-1, Math.min(1, (actualMinutes - targetMinutes) / targetMinutes));
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

// ─── Recommendation list (read-only, no Firestore writes) ────────────────────

export async function buildRecommendations(
  teamLocation: GeoPoint,
  completedTaskIds: string[],
  targetType: 'green' | 'gold',
  skillRatio: number,
  limit = 5,
): Promise<TaskRecommendation[]> {
  const snapshot = await db
    .collection(tasksCol())
    .where('type', '==', targetType)
    .where('isActive', '==', true)
    .get();

  const candidates: Task[] = [];
  for (const doc of snapshot.docs) {
    const task = { id: doc.id, ...doc.data() } as Task;
    if (completedTaskIds.includes(task.id)) continue;
    if (task.status === 'paused' || task.status === 'closed') continue; // operator override
    if (task.currentTeamCount >= task.maxConcurrentTeams) continue;
    candidates.push(task);
  }

  return candidates
    .map((task) => ({
      task,
      priority: priorityScore(task, teamLocation, skillRatio),
      distanceKm:
        task.coordinates && isValidCoord(task.coordinates.lat, task.coordinates.lng)
          ? haversineKm(teamLocation, task.coordinates)
          : 0,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
    .map(({ task, priority, distanceKm }) => ({
      taskId: task.id,
      title: task.title,
      titleHe: task.titleHe,
      priority: Math.round(priority * 1000) / 1000,
      estimatedMinutes: task.estimatedMinutes,
      difficulty: task.difficulty ?? 5,
      currentLoad:
        task.maxConcurrentTeams > 0
          ? task.currentTeamCount / task.maxConcurrentTeams
          : 0,
      distanceKm: Math.round(distanceKm * 100) / 100,
    }));
}

// ─── Task assignment (writes to Firestore) ───────────────────────────────────

export async function assignNextTask(
  teamId: string,
  teamLocation: GeoPoint,
  completedTaskIds: string[],
  targetType: 'green' | 'gold',
  skillRatio = 0,
): Promise<{ taskId?: string; injectRiddle?: boolean }> {
  const snapshot = await db
    .collection(tasksCol())
    .where('type', '==', targetType)
    .where('isActive', '==', true)
    .get();

  const candidates: Task[] = [];
  for (const doc of snapshot.docs) {
    const task = { id: doc.id, ...doc.data() } as Task;
    if (completedTaskIds.includes(task.id)) continue;
    if (task.status === 'paused' || task.status === 'closed') continue; // operator override
    if (task.currentTeamCount >= task.maxConcurrentTeams) continue;
    candidates.push(task);
  }

  if (targetType === 'gold' && candidates.length === 0) {
    return { injectRiddle: true };
  }
  if (candidates.length === 0) return {};

  const chosen = candidates.sort(
    (a, b) =>
      priorityScore(b, teamLocation, skillRatio) -
      priorityScore(a, teamLocation, skillRatio),
  )[0];

  await db.collection(tasksCol()).doc(chosen.id).update({
    currentTeamCount: FieldValue.increment(1),
  });

  return { taskId: chosen.id };
}

// ─── Task release ─────────────────────────────────────────────────────────────

export async function releaseTask(taskId: string, _teamId?: string): Promise<void> {
  const taskRef = db.collection(tasksCol()).doc(taskId);
  const snap = await taskRef.get();
  if (!snap.exists) return;
  const current = (snap.data() as Task).currentTeamCount ?? 0;
  if (current > 0) {
    await taskRef.update({ currentTeamCount: FieldValue.increment(-1) });
  }
}
