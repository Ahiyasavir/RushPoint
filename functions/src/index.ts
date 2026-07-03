// ─── RushPoint v2 — Cloud Functions entry point ───────────────────────────────
// All callables are organised into domain modules; this file imports and
// re-exports them so Firebase can discover them at the top level.

import * as functions from 'firebase-functions';
import { loggedCallable } from './obs/log';
import { enforceRateLimit } from './rateLimitStore';
import { db } from './firebase';
import * as admin from 'firebase-admin';
import { randomInt } from 'node:crypto';
import { isValidCoord, requireStorageUrl, shouldLockout, isWithinCooldown, isOutsideSafeZone, requireString, optionalString, MAX_MESSAGE_LEN, type SafeZone } from '@rushpoint/shared';
import { validate } from './validation';

/** Cryptographic 6-digit staff PIN (replaces Math.random — anti-cheat row 40). */
function generatePin(): string {
  return String(randomInt(100000, 1000000));
}
import { completeTaskForTeam, resolveCallerTeam } from './runs/index';

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
  refreshLeaderboard, getPublicLeaderboard, getRunRecap, getRunReplay, getRunAnalytics,
  listRunTeams, completeTask, requestNextTask, requestTaskHint,
  submitTaskAnswer, submitSequenceStep, getRecommendedTasks,
  checkOutTask, getMyTeamState,
  joinTeamAsDevice, transferController, claimController,
  submitRunFeedback, getRunFeedbackSummary,
  requestGuardianConsent, grantGuardianConsent,
  activateHotZone, deactivateHotZone,
  getRunDiscoveryPois, claimDiscoveryPoi,
} from './runs/index';


// ─── Shared auth helpers ───────────────────────────────────────────────────────

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}

function assertAdmin(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  // No emulator bypass: the e2e suite mints a real `admin` custom-token claim
  // against the Auth emulator, so tests exercise the SAME gate production runs.
  if (!context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  return context.auth.uid;
}

// Live-ops actions (announce, flash, ack SOS, review photo, adjust score) are
// performed by EITHER the game owner running their own console OR a staff member
// invited to that run. A staff custom token carries `ownerUid` AND `runId`
// claims — both must match the payload: a PIN minted for run A must not grant
// live-ops power over the owner's OTHER runs (caught by the e2e authz matrix).
function assertStaffOrOwner(
  context: functions.https.CallableContext,
  ownerUid: string,
  runId?: string,
): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  // No emulator bypass — a bypass here made every staff/owner authz check
  // untestable (and the e2e proved a participant could adjust scores, mint
  // staff PINs, and push announcements in dev). Owner + staff tokens work the
  // same in the emulator, so the real gate runs everywhere.
  const t = context.auth.token;
  if (context.auth.uid === ownerUid) return context.auth.uid;        // the game owner
  if (t.admin) return context.auth.uid;                              // platform admin
  if (t.staff && t.ownerUid === ownerUid && (!runId || t.runId === runId)) {
    return context.auth.uid;                                         // staff scoped to THIS run
  }
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

export const inviteStaff = loggedCallable('inviteStaff', async (data, context) => {
  const uid = requireAuth(context);
  const { ownerUid, gameId, runId, name, permissions } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    name: string;
    permissions: string[];
  };

  // No emulator bypass — anyone who can mint a PIN owns the run's staff surface.
  if (uid !== ownerUid && !context.auth?.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only the game owner can invite staff');
  }
  const cleanName = validate(() => requireString(name, 'name', MAX_MESSAGE_LEN));

  const pin = generatePin();
  const now = new Date().toISOString();
  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites`)
    .doc();

  await ref.set({
    id: ref.id,
    ownerUid, gameId, runId,
    name: cleanName,
    permissions: permissions ?? [],
    pin,
    used: false,
    createdAt: now,
  });

  return { inviteId: ref.id, pin };
});


export const staffSignIn = loggedCallable('staffSignIn', async (data, context) => {
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

  let customToken: string;
  try {
    customToken = await admin.auth().createCustomToken(context.auth!.uid, {
      staff: true,
      staffName: invite.name,
      permissions: invite.permissions,
      ownerUid,
      gameId,
      runId,
    });
  } catch (e) {
    functions.logger.error('staffSignIn.createCustomToken failed', { uid: context.auth!.uid, runId, err: String(e) });
    throw new functions.https.HttpsError('internal', 'Could not complete staff sign-in. Please try again.');
  }

  return { customToken, name: invite.name, permissions: invite.permissions };
});


// ─── updateLocation ────────────────────────────────────────────────────────────

export const updateLocation = loggedCallable('updateLocation', async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  await enforceRateLimit(uid, 'updateLocation');
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

  // Shared team devices: the team's map pin follows the CONTROLLING phone (the
  // one actually playing) — viewer devices don't ping, so the pin never flickers.
  const { teamId } = await resolveCallerTeam(uid, { ownerUid, gameId, runId }, { requireController: true });

  const now = new Date().toISOString();
  const locationRef = db.doc(
    `users/${ownerUid}/games/${gameId}/runs/${runId}/teamLocations/${teamId}`,
  );
  await locationRef.set({ teamId, lat, lng, updatedAt: now }, { merge: true });

  // Safe-zone breach detection (safe-zone-boundary): server-side only. On a NEW
  // breach raise an alert + flag the team out-of-bounds; on return inside, clear it.
  const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
  const safeZone = (gameSnap.data() as { safeZone?: SafeZone } | undefined)?.safeZone;
  if (!safeZone) return { ok: true, outOfBounds: false };

  const outside = isOutsideSafeZone({ lat, lng }, safeZone);
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`);
  const wasOut = ((await teamRef.get()).data() as { outOfBounds?: boolean } | undefined)?.outOfBounds === true;

  if (outside && !wasOut) {
    const alertRef = db.collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`).doc();
    await alertRef.set({
      id: alertRef.id, teamId, type: 'safe_zone_breach',
      lat, lng, message: 'Left the play area', acknowledged: false, createdAt: now,
    });
    await teamRef.set({ outOfBounds: true }, { merge: true });
  } else if (!outside && wasOut) {
    await teamRef.set({ outOfBounds: false }, { merge: true });
  }

  return { ok: true, outOfBounds: outside };
});


// ─── triggerSOS ───────────────────────────────────────────────────────────────

export const triggerSOS = loggedCallable('triggerSOS', async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  await enforceRateLimit(uid, 'triggerSOS');
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

  // Shared team devices: ANY attached phone may raise SOS (safety beats role
  // discipline) — the alert is attributed to the team, not the calling uid.
  const { teamId } = await resolveCallerTeam(uid, { ownerUid, gameId, runId });

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`)
    .doc();

  await ref.set({
    id: ref.id,
    teamId,
    type: 'sos',
    lat: lat ?? null,
    lng: lng ?? null,
    message: validate(() => optionalString(message, 'message', MAX_MESSAGE_LEN)) ?? '',
    acknowledged: false,
    createdAt: new Date().toISOString(),
  });

  return { alertId: ref.id };
});


// ─── acknowledgeAlert ─────────────────────────────────────────────────────────

export const acknowledgeAlert = loggedCallable('acknowledgeAlert', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
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

export const pushAnnouncement = loggedCallable('pushAnnouncement', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
  const { ownerUid, gameId, runId, message, messageHe } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    message: string;
    messageHe?: string;
  };

  // Bound the broadcast text: it is pushed to every participant's screen, so an
  // oversized message would disrupt the whole run (and bloat the doc).
  const cleanMsg = validate(() => requireString(message, 'message', MAX_MESSAGE_LEN));
  const cleanMsgHe = validate(() => optionalString(messageHe, 'messageHe', MAX_MESSAGE_LEN));

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/announcements`)
    .doc();

  await ref.set({
    id: ref.id,
    message: cleanMsg,
    messageHe: cleanMsgHe ?? cleanMsg,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: context.auth!.uid,
  });

  return { announcementId: ref.id };
});


// ─── deactivateAnnouncement ───────────────────────────────────────────────────

export const deactivateAnnouncement = loggedCallable('deactivateAnnouncement', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
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

export const pushFlashMission = loggedCallable('pushFlashMission', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
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

  // Bound the broadcast text (shown to every participant).
  const cleanTitle = validate(() => requireString(title, 'title', MAX_MESSAGE_LEN));
  const cleanTitleHe = validate(() => optionalString(titleHe, 'titleHe', MAX_MESSAGE_LEN));
  const cleanDesc = validate(() => optionalString(description, 'description', MAX_MESSAGE_LEN));
  const cleanDescHe = validate(() => optionalString(descriptionHe, 'descriptionHe', MAX_MESSAGE_LEN));
  const ttl     = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : 300;
  const bonus   = Number(bonusPoints) >= 0 ? Number(bonusPoints) : 0;
  const nowIso  = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/flashMissions`)
    .doc();

  await ref.set({
    id: ref.id,
    title: cleanTitle,
    titleHe: cleanTitleHe ?? cleanTitle,
    description: cleanDesc ?? '',
    descriptionHe: cleanDescHe ?? cleanDesc ?? '',
    bonusPoints: bonus,
    expiresAt,
    isActive: true,
    createdAt: nowIso,
    createdBy: context.auth!.uid,
  });

  return { id: ref.id, expiresAt };
});


// ─── Station callables ────────────────────────────────────────────────────────

export const verifyStationCode = loggedCallable('verifyStationCode', async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  await enforceRateLimit(uid, 'verifyStationCode');
  const { ownerUid, gameId, runId, teamId, taskId, code } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    taskId: string;
    code: string;
  };

  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');
  // Shared team devices: resolve the team this uid is ATTACHED to (founding
  // device or an attached phone) and require the controller role to mutate.
  const { teamId: resolvedTeamId } = await resolveCallerTeam(
    uid, { ownerUid, gameId, runId }, { requireController: true },
  );
  // IDOR guard (auth-anticheat row 38): a participant may only verify for their
  // OWN team. A payload teamId that isn't the caller's team is rejected.
  if (teamId && teamId !== resolvedTeamId) {
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
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${resolvedTeamId}`);
  // NB: nest under the `taskVerifications` map via a real nested object. Dotted
  // keys in .set({merge}) become *literal* top-level field names, not map paths.
  await teamRef.set(
    {
      taskVerifications: { [taskId]: { verified: true, verifiedAt: now, verifiedBy: uid } },
    },
    { merge: true },
  );

  // Correct code = task complete → score it + advance the team.
  await completeTaskForTeam(ownerUid, gameId, runId, resolvedTeamId, taskId, now);

  return { verified: true };
});


export const submitStationPhoto = loggedCallable('submitStationPhoto', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'submitStationPhoto');
  const { ownerUid, gameId, runId, teamId, taskId, photoUrl } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    taskId: string;
    photoUrl: string;
  };

  // Shared team devices: resolve the caller's team + require the controller role.
  const { teamId: resolvedTeamId } = await resolveCallerTeam(
    uid, { ownerUid, gameId, runId }, { requireController: true },
  );
  // IDOR guard (auth-anticheat row 38): a participant may only submit for their
  // OWN team. A payload teamId that isn't the caller's team is rejected.
  if (teamId && teamId !== resolvedTeamId) {
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
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${resolvedTeamId}`);
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
    await completeTaskForTeam(ownerUid, gameId, runId, resolvedTeamId, taskId, now);
  }

  return { submitted: true, autoApproved: autoApprove };
});


export const reviewStationSubmission = loggedCallable('reviewStationSubmission', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
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
          reviewNote: validate(() => optionalString(note, 'note', MAX_MESSAGE_LEN)) ?? '',
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

export const adjustTeamScore = loggedCallable('adjustTeamScore', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
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
    reason: validate(() => optionalString(reason, 'reason', MAX_MESSAGE_LEN)) ?? '',
  });

  return { ok: true, newBonusPenalty: newPenalty };
});


// ─── listAuditLogs ────────────────────────────────────────────────────────────

export const listAuditLogs = loggedCallable('listAuditLogs', async (data, context) => {
  assertAdmin(context);
  const { limit = 100 } = data as { limit?: number };
  const snap = await db
    .collection('auditLogs')
    .orderBy('timestamp', 'desc')
    .limit(Math.min(limit, 500))
    .get();
  return { logs: snap.docs.map((d) => d.data()) };
});
