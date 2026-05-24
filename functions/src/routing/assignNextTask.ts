import { db } from '../firebase';
import type { Task, Assignment, GeoPoint } from '@rushpoint/shared';

const MAX_TEAMS_PER_STATION = 3;

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Scores each candidate task for a given team position.
 * Lower score = better assignment.
 *
 * Formula:
 *   score = distance_km * 1.0
 *           + congestion_count * 15.0   ← penalise crowded stations heavily
 *           + (estimatedMinutes / 10)   ← slight bias toward faster tasks
 */
function scoreTask(task: Task, teamLocation: GeoPoint): number {
  const dist = haversineKm(teamLocation, task.coordinates);
  const congestion = task.currentTeamIds.length;
  return dist * 1.0 + congestion * 15.0 + task.estimatedMinutes / 10;
}

/**
 * Assigns the next best open-field (green) task to a team.
 * If all Bible Park (gold) slots are full, injects an off-site riddle instead.
 */
export async function assignNextTask(
  teamId: string,
  teamLocation: GeoPoint,
  completedTaskIds: string[],
  targetType: 'green' | 'gold',
): Promise<{ taskId?: string; injectRiddle?: boolean }> {
  const snapshot = await db
    .collection('tasks')
    .where('type', '==', targetType)
    .get();

  const candidates: Task[] = [];
  for (const doc of snapshot.docs) {
    const task = { id: doc.id, ...doc.data() } as Task;
    if (completedTaskIds.includes(task.id)) continue;
    if (task.currentTeamIds.length >= (task.maxConcurrentTeams ?? MAX_TEAMS_PER_STATION)) continue;
    candidates.push(task);
  }

  // If targeting gold (park) and no capacity, signal to inject a delay riddle
  if (targetType === 'gold' && candidates.length === 0) {
    return { injectRiddle: true };
  }

  if (candidates.length === 0) return {};

  const sorted = candidates.sort(
    (a, b) => scoreTask(a, teamLocation) - scoreTask(b, teamLocation),
  );
  const chosen = sorted[0];

  // Atomically add team to currentTeamIds
  await db
    .collection('tasks')
    .doc(chosen.id)
    .update({
      currentTeamIds: [...chosen.currentTeamIds, teamId],
    });

  return { taskId: chosen.id };
}

/**
 * Called when a team checks out of a task (completed or skipped).
 * Removes teamId from the task's currentTeamIds.
 */
export async function releaseTask(taskId: string, teamId: string): Promise<void> {
  const doc = await db.collection('tasks').doc(taskId).get();
  if (!doc.exists) return;
  const task = doc.data() as Task;
  await db
    .collection('tasks')
    .doc(taskId)
    .update({
      currentTeamIds: task.currentTeamIds.filter((id) => id !== teamId),
    });
}
