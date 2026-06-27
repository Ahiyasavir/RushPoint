// ─── RushPoint v2 — Cloud Functions entry point ───────────────────────────────
// All callables are organised into domain modules; this file imports and
// re-exports them so Firebase can discover them at the top level.

import * as functions from 'firebase-functions';
import { db } from './firebase';
import * as admin from 'firebase-admin';
import { randomInt } from 'node:crypto';
import { isValidCoord, requireStorageUrl, shouldLockout, isWithinCooldown } from '@rushpoint/shared';
import { validate } from './validation';

/** Cryptographic 6-digit staff PIN (replaces Math.random — anti-cheat row 40). */
function generatePin(): string {
  return String(randomInt(100000, 1000000));
}
import { completeTaskForTeam } from './runs/index';

// ─── Domain modules ────────────────────────────────────────────────────────────
export * from './games/index';
export * from './gallery/index';
export { updateMyProfile, exportMyData, deleteMyAccount } from './users/index';
export {
  pruneExpiredRunData, pruneExpiredRunDataNow, pruneRunNow,
} from './maintenance/index';
export {
  getWallet, getWalletStatus, purchaseCredits, subscribePro, claimReferral, stripeWebhook,
} from './payments/index';
// Explicit callable re-exports from runs (completeTaskForTeam is an internal
// helper, not a Cloud Function, so it must NOT be re-exported as a trigger).
export {
  launchRun, joinRun, getJoinInfo, startTeams, skipStage, finalizeRun,
  refreshLeaderboard, getPublicLeaderboard,
  listRunTeams, completeTask, requestNextTask, requestTaskHint,
  submitTaskAnswer, submitSequenceStep, getRecommendedTasks,
  checkOutTask, getMyTeamState,
} from './runs/index';


// ─── Shared auth helpers ───────────────────────────────────────────────────────

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}

function assertAdmin(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  if (!isEmulator && !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  return context.auth.uid;
}

// Live-ops actions (announce, flash, ack SOS, review photo, adjust score) are
// performed by EITHER the game owner running their own console OR a staff member
// invited to that run (their custom token is scoped via the `ownerUid` claim).
function assertStaffOrOwner(context: functions.https.CallableContext, ownerUid: string): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  if (process.env.FUNCTIONS_EMULATOR === 'true') return context.auth.uid;
  const t = context.auth.token;
  if (context.auth.uid === ownerUid) return context.auth.uid;        // the game owner
  if (t.admin) return context.auth.uid;                              // platform admin
  if (t.staff && t.ownerUid === ownerUid) return context.auth.uid;   // staff scoped to this run
  throw new functions.https.HttpsError('permission-denied', 'Staff or owner access required');
}


// ─── Audit trail ──────────────────────────────────────────────────────────────

interface AuditEntry {
  runId?: string;
  teamId?: string;
  teamName?: string;
  operatorId: string;
  actionType: string;
  previousValue?: number | string | null;
  newValue?: number | string | null;
  reason?: string;
  [key: string]: unknown;
}

async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await db.collection('auditLogs').add({
    ...entry,
    teamName:      entry.teamName ?? null,
    previousValue: entry.previousValue ?? null,
    newValue:      entry.newValue ?? null,
    reason:        entry.reason ?? '',
    timestamp:     new Date().toISOString(),
  });
}


// ─── Staff management ─────────────────────────────────────────────────────────

export const inviteStaff = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { ownerUid, gameId, runId, name, permissions } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    name: string;
    permissions: string[];
  };

  if (uid !== ownerUid) {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator && !context.auth?.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Only the game owner can invite staff');
    }
  }
  if (!name?.trim()) throw new functions.https.HttpsError('invalid-argument', 'name required');

  const pin = generatePin();
  const now = new Date().toISOString();
  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites`)
    .doc();

  await ref.set({
    id: ref.id,
    ownerUid, gameId, runId,
    name: name.trim(),
    permissions: permissions ?? [],
    pin,
    used: false,
    createdAt: now,
  });

  return { inviteId: ref.id, pin };
});


export const staffSignIn = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { ownerUid, gameId, runId, pin } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    pin: string;
  };

  if (!pin) throw new functions.https.HttpsError('invalid-argument', 'PIN required');

  // Brute-force throttle (row 40): too many failed PIN attempts within the
  // cooldown window locks this caller out of THIS run — even with a correct PIN.
  const attemptsRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffAttempts/${uid}`);
  const nowMs = Date.now();
  const aSnap = await attemptsRef.get();
  const a = (aSnap.exists ? aSnap.data() : {}) as { count?: number; lastFailedAtMs?: number };
  const prevCount = a.count ?? 0;
  const lastFailedAt = a.lastFailedAtMs ?? 0;
  if (shouldLockout(prevCount) && isWithinCooldown(lastFailedAt, nowMs)) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many failed attempts. Try again later.');
  }
  // Cooldown expired → forgive prior failures.
  const baseCount = shouldLockout(prevCount) && !isWithinCooldown(lastFailedAt, nowMs) ? 0 : prevCount;

  const inviteSnap = await db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites`)
    .where('pin', '==', pin)
    .where('used', '==', false)
    .limit(1)
    .get();

  if (inviteSnap.empty) {
    await attemptsRef.set({ count: baseCount + 1, lastFailedAtMs: nowMs, updatedAt: new Date().toISOString() }, { merge: true });
    throw new functions.https.HttpsError('not-found', 'Invalid or already-used PIN');
  }

  const invite = inviteSnap.docs[0].data() as { id: string; name: string; permissions: string[] };

  // Success → reset the failure counter for this caller.
  await attemptsRef.set({ count: 0, lastFailedAtMs: 0, updatedAt: new Date().toISOString() }, { merge: true });
  await inviteSnap.docs[0].ref.update({
    used: true,
    usedBy: uid,
    usedAt: new Date().toISOString(),
  });

  const customToken = await admin.auth().createCustomToken(context.auth!.uid, {
    staff: true,
    staffName: invite.name,
    permissions: invite.permissions,
    ownerUid,
    gameId,
    runId,
  });

  return { customToken, name: invite.name, permissions: invite.permissions };
});


// ─── updateLocation ────────────────────────────────────────────────────────────

export const updateLocation = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  const { lat, lng, ownerUid, gameId, runId } = data as {
    lat: number;
    lng: number;
    ownerUid: string;
    gameId: string;
    runId: string;
  };

  if (!isValidCoord(lat, lng)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid coordinates');
  }
  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }

  const locationRef = db.doc(
    `users/${ownerUid}/games/${gameId}/runs/${runId}/teamLocations/${uid}`,
  );
  await locationRef.set(
    { teamId: uid, lat, lng, updatedAt: new Date().toISOString() },
    { merge: true },
  );

  return { ok: true };
});


// ─── triggerSOS ───────────────────────────────────────────────────────────────

export const triggerSOS = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  const { ownerUid, gameId, runId, lat, lng, message } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    lat?: number;
    lng?: number;
    message?: string;
  };

  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`)
    .doc();

  await ref.set({
    id: ref.id,
    teamId: uid,
    type: 'sos',
    lat: lat ?? null,
    lng: lng ?? null,
    message: message?.trim() ?? '',
    acknowledged: false,
    createdAt: new Date().toISOString(),
  });

  return { alertId: ref.id };
});


// ─── acknowledgeAlert ─────────────────────────────────────────────────────────

export const acknowledgeAlert = functions.https.onCall(async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid);
  const { ownerUid, gameId, runId, alertId } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    alertId: string;
  };

  await db
    .doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/alerts/${alertId}`)
    .update({
      acknowledged: true,
      acknowledgedBy: context.auth!.uid,
      acknowledgedAt: new Date().toISOString(),
    });

  return { ok: true };
});


// ─── pushAnnouncement ─────────────────────────────────────────────────────────

export const pushAnnouncement = functions.https.onCall(async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid);
  const { ownerUid, gameId, runId, message, messageHe } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    message: string;
    messageHe?: string;
  };

  if (!message?.trim()) throw new functions.https.HttpsError('invalid-argument', 'message required');

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/announcements`)
    .doc();

  await ref.set({
    id: ref.id,
    message: message.trim(),
    messageHe: messageHe?.trim() ?? message.trim(),
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: context.auth!.uid,
  });

  return { announcementId: ref.id };
});


// ─── deactivateAnnouncement ───────────────────────────────────────────────────

export const deactivateAnnouncement = functions.https.onCall(async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid);
  const { ownerUid, gameId, runId, announcementId } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    announcementId: string;
  };

  await db
    .doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/announcements/${announcementId}`)
    .update({ active: false, deactivatedAt: new Date().toISOString() });

  return { ok: true };
});


// ─── pushFlashMission ─────────────────────────────────────────────────────────

export const pushFlashMission = functions.https.onCall(async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid);
  const {
    ownerUid, gameId, runId,
    title, titleHe, description, descriptionHe,
    bonusPoints, ttlSeconds,
  } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    title: string;
    titleHe?: string;
    description?: string;
    descriptionHe?: string;
    bonusPoints: number;
    ttlSeconds: number;
  };

  if (!title?.trim()) throw new functions.https.HttpsError('invalid-argument', 'title required');
  const ttl     = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : 300;
  const bonus   = Number(bonusPoints) >= 0 ? Number(bonusPoints) : 0;
  const nowIso  = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/flashMissions`)
    .doc();

  await ref.set({
    id: ref.id,
    title: title.trim(),
    titleHe: titleHe?.trim() ?? title.trim(),
    description: description?.trim() ?? '',
    descriptionHe: descriptionHe?.trim() ?? description?.trim() ?? '',
    bonusPoints: bonus,
    expiresAt,
    isActive: true,
    createdAt: nowIso,
    createdBy: context.auth!.uid,
  });

  return { id: ref.id, expiresAt };
});


// ─── Station callables ────────────────────────────────────────────────────────

export const verifyStationCode = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  const { ownerUid, gameId, runId, teamId, taskId, code } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    taskId: string;
    code: string;
  };

  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');
  // IDOR guard (auth-anticheat row 38): a participant may only verify for their
  // OWN team. A payload teamId that isn't the caller is rejected; uid is the key.
  if (teamId && teamId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot act on another team');
  }

  const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');

  const game = gameSnap.data() as {
    stages: { tasks: { id: string; smart?: { secretCode?: string } }[] }[];
  };
  let taskFound = false;
  let expectedCode: string | undefined;
  for (const stage of game.stages) {
    const task = stage.tasks.find((t) => t.id === taskId);
    if (task) { taskFound = true; expectedCode = task.smart?.secretCode; break; }
  }

  if (!taskFound) {
    throw new functions.https.HttpsError('not-found', 'Task not found in game');
  }
  if (!expectedCode || expectedCode.trim().toLowerCase() !== code.trim().toLowerCase()) {
    throw new functions.https.HttpsError('failed-precondition', 'Incorrect code');
  }

  const now = new Date().toISOString();
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${uid}`);
  // NB: nest under the `taskVerifications` map via a real nested object. Dotted
  // keys in .set({merge}) become *literal* top-level field names, not map paths.
  await teamRef.set(
    {
      taskVerifications: { [taskId]: { verified: true, verifiedAt: now, verifiedBy: uid } },
    },
    { merge: true },
  );

  // Correct code = task complete → score it + advance the team.
  await completeTaskForTeam(ownerUid, gameId, runId, uid, taskId, now);

  return { verified: true };
});


export const submitStationPhoto = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { ownerUid, gameId, runId, teamId, taskId, photoUrl } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    taskId: string;
    photoUrl: string;
  };

  // IDOR guard (auth-anticheat row 38): a participant may only submit for their
  // OWN team. A payload teamId that isn't the caller is rejected; uid is the key.
  if (teamId && teamId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot act on another team');
  }
  // row 41: the photo must live under the caller's OWN run/team Storage folder
  // (not just any bucket URL) — scoped to runId + uid. Throws invalid-argument.
  validate(() => requireStorageUrl(photoUrl, runId, uid));

  // Check the task's smart config for autoApprove (staffless events).
  const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
  let autoApprove = false;
  if (gameSnap.exists) {
    const game = gameSnap.data() as { stages: { tasks: { id: string; smart?: { autoApprove?: boolean } }[] }[] };
    for (const stage of game.stages) {
      const task = stage.tasks.find((t) => t.id === taskId);
      if (task) { autoApprove = task.smart?.autoApprove === true; break; }
    }
  }

  const now = new Date().toISOString();
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${uid}`);
  await teamRef.set(
    {
      taskSubmissions: {
        [taskId]: {
          photoUrl: photoUrl.trim(),
          submittedAt: now,
          status: autoApprove ? 'approved' : 'pending',
        },
      },
    },
    { merge: true },
  );

  // autoApprove: the photo is logged but does not block progression.
  if (autoApprove) {
    await completeTaskForTeam(ownerUid, gameId, runId, uid, taskId, now);
  }

  return { submitted: true, autoApproved: autoApprove };
});


export const reviewStationSubmission = functions.https.onCall(async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid);
  const { ownerUid, gameId, runId, teamId, taskId, approved, note } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    taskId: string;
    approved: boolean;
    note?: string;
  };

  const now = new Date().toISOString();
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`);
  // merge:true deep-merges this into the existing submission, preserving
  // photoUrl/submittedAt while updating the review subfields.
  await teamRef.set(
    {
      taskSubmissions: {
        [taskId]: {
          status: approved ? 'approved' : 'rejected',
          reviewedAt: now,
          reviewedBy: context.auth!.uid,
          reviewNote: note?.trim() ?? '',
        },
      },
    },
    { merge: true },
  );

  // Approved photo = task complete → score it + advance the team.
  if (approved) {
    await completeTaskForTeam(ownerUid, gameId, runId, teamId, taskId, now);
  }

  return { ok: true, approved };
});


// ─── adjustTeamScore ──────────────────────────────────────────────────────────

export const adjustTeamScore = functions.https.onCall(async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid);
  const { ownerUid, gameId, runId, teamId, delta, reason } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    delta: number;
    reason?: string;
  };

  if (typeof delta !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'delta must be a number');
  }

  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`);
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');

  const prev = (teamSnap.data() as { bonusPenalty?: number }).bonusPenalty ?? 0;
  const newPenalty = prev - delta;

  await teamRef.update({
    bonusPenalty: newPenalty,
    updatedAt: new Date().toISOString(),
  });

  await writeAuditLog({
    ownerUid, gameId, runId, teamId,
    operatorId: context.auth!.uid,
    actionType: delta >= 0 ? 'bonus' : 'fine',
    previousValue: -prev,
    newValue: -newPenalty,
    reason: reason ?? '',
  });

  return { ok: true, newBonusPenalty: newPenalty };
});


// ─── listAuditLogs ────────────────────────────────────────────────────────────

export const listAuditLogs = functions.https.onCall(async (data, context) => {
  assertAdmin(context);
  const { limit = 100 } = data as { limit?: number };
  const snap = await db
    .collection('auditLogs')
    .orderBy('timestamp', 'desc')
    .limit(Math.min(limit, 500))
    .get();
  return { logs: snap.docs.map((d) => d.data()) };
});
