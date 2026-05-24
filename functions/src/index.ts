import * as functions from 'firebase-functions';
import { db } from './firebase';
import { assignNextTask, releaseTask } from './routing/assignNextTask';
import { calculateScore } from './scoring/calculateScore';
import type { Team } from '@rushpoint/shared';

// ─── requestNextTask ──────────────────────────────────────────────────────────
// Called by the mobile app when a team completes a task and needs the next one.
// Returns { taskId } or { injectRiddle: true } if park is at capacity.
export const requestNextTask = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { teamId, lat, lng, completedTaskIds, targetType } = data as {
    teamId: string;
    lat: number;
    lng: number;
    completedTaskIds: string[];
    targetType: 'green' | 'gold';
  };

  if (context.auth.uid !== teamId) {
    throw new functions.https.HttpsError('permission-denied', 'Can only request for own team');
  }

  return assignNextTask(teamId, { lat, lng }, completedTaskIds, targetType);
});

// ─── checkOutTask ─────────────────────────────────────────────────────────────
// Called when a team leaves a station (QR scan confirmed or task approved).
export const checkOutTask = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const { taskId, teamId } = data as { taskId: string; teamId: string };
  if (context.auth.uid !== teamId) {
    throw new functions.https.HttpsError('permission-denied', 'Can only check out own team');
  }
  await releaseTask(taskId, teamId);
  return { success: true };
});

// ─── submitJudgeScore ─────────────────────────────────────────────────────────
// Called by the admin/judge interface to finalize basket scoring.
export const submitJudgeScore = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  // Verify caller is an admin
  const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admins only');
  }

  const { teamId, checkInId, judgeScore, judgeNote } = data as {
    teamId: string;
    checkInId: string;
    judgeScore: number;
    judgeNote?: string;
  };

  await db.collection('checkIns').doc(checkInId).update({
    status: 'approved',
    judgeId: context.auth.uid,
    judgeScore,
    judgeNote: judgeNote ?? '',
  });

  // Recalculate team score
  const teamDoc = await db.collection('teams').doc(teamId).get();
  const team = { id: teamDoc.id, ...teamDoc.data() } as Team;
  const startedAt = team.startedAt ? new Date(team.startedAt).getTime() : Date.now();
  const durationMinutes = (Date.now() - startedAt) / 60000;
  const newScore = calculateScore(team, judgeScore, durationMinutes);

  await db.collection('teams').doc(teamId).update({ score: newScore });

  return { success: true, newScore };
});

// ─── triggerLeaderboardFreeze ─────────────────────────────────────────────────
// Admin-callable or auto-triggered 30 min before event end.
export const triggerLeaderboardFreeze = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admins only');
  }

  const { eventId } = data as { eventId: string };
  await db.collection('leaderboard').doc(eventId).update({
    frozen: true,
    frozenAt: new Date().toISOString(),
  });
  return { success: true };
});

// ─── pushFlashMission ─────────────────────────────────────────────────────────
// Admin broadcasts a flash mission to all active teams.
export const pushFlashMission = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admins only');
  }

  const { eventId, title, description, bonusPoints, ttlSeconds } = data as {
    eventId: string;
    title: string;
    description: string;
    bonusPoints: number;
    ttlSeconds: number;
  };

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const ref = await db.collection('flashMissions').add({
    eventId,
    title,
    description,
    bonusPoints,
    expiresAt,
    isActive: true,
    createdAt: new Date().toISOString(),
  });

  return { id: ref.id, expiresAt };
});
