// ─── RushPoint v2 — Cloud Functions entry point ───────────────────────────────
// All callables are organised into domain modules; this file imports and
// re-exports them so Firebase can discover them at the top level.

import * as functions from 'firebase-functions';
import { loggedCallable } from './obs/log';
import { enforceRateLimit } from './rateLimitStore';
import { db } from './firebase';
import * as admin from 'firebase-admin';
import { randomInt } from 'node:crypto';
import { isValidCoord, requireStorageUrl, shouldLockout, isWithinCooldown, STAFF_RUN_LOCKOUT_LIMIT, STAFF_RUN_COOLDOWN_MS, isOutsideSafeZone, requireString, optionalString, MAX_MESSAGE_LEN, type SafeZone, buildWebhookPayload, isAllowedWebhookUrl, type WebhookEvent, applyReaction, FIRESTORE_PATHS, type FeedItem, formatScoreNotice, sanitizeChatText, appendCapped, type ChatMessage, type TeamChatDoc, isAllowedSubmissionContentType, type MediaKind } from '@rushpoint/shared';
import { validate } from './validation';

/** Cryptographic 6-digit staff PIN (replaces Math.random — anti-cheat row 40). */
function generatePin(): string {
  return String(randomInt(100000, 1000000));
}
import { completeTaskForTeam, resolveCallerTeam, maybeRefreshLeaderboardSnapshot, assignNextInActiveStage, assertStageActiveForTask } from './runs/index';
import { nextBonusPenalty } from './scoring/bonusPenalty';

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
  refreshLeaderboard, getPublicLeaderboard, getRunRecap, getRunReplay, getRunAnalytics, getRunSummary, getRunHeatmap,
  listRunTeams, completeTask, requestNextTask, requestTaskHint,
  submitTaskAnswer, submitSequenceStep, getRecommendedTasks,
  checkOutTask, getMyTeamState, listLiveRuns, getMyProfile,
  createTrackable, getRunTrackables, pickUpTrackable, dropTrackable,
  startInstantPlay,
  createZone, deleteZone, getRunZones, captureZone,
  joinTeamAsDevice, transferController, claimController,
  submitRunFeedback, getRunFeedbackSummary,
  getRunSurveyResults,
  requestGuardianConsent, grantGuardianConsent,
  activateHotZone, deactivateHotZone,
  getRunDiscoveryPois, claimDiscoveryPoi,
} from './runs/index';
// onRunFinalized is a Firestore TRIGGER (not a callable) — fires the run's
// post-finalize consolidation (player-profile folds, benchmark aggregate,
// summary email) with the platform's own execution/retry guarantee, off
// finalizeRun's critical path (perf: run-perf-scale, Task 9). Re-exported
// explicitly, alongside the callables above, so Firebase discovers it.
export { onRunFinalized } from './runs/index';


// ─── Shared auth helpers ───────────────────────────────────────────────────────

import { requireAuth } from './auth';

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


// ─── Chat integrations (change: chat-integrations) ─────────────────────────────
// Mirror a live-ops broadcast to the game's Slack/Teams incoming webhook, if set.
// Best-effort + SSRF-guarded: a bad/absent webhook NEVER fails the participant-facing
// broadcast (the Firestore write already succeeded before this runs). `gameTitle`
// is filled from the loaded game doc. Requires Blaze egress + Node-20 global fetch.
async function mirrorToChat(
  ownerUid: string,
  gameId: string,
  event: Omit<WebhookEvent, 'gameTitle'>,
): Promise<void> {
  try {
    const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
    const g = gameSnap.data() as
      | { title?: string; integrationWebhookUrl?: string; integrationPlatform?: 'slack' | 'teams' }
      | undefined;
    const url = g?.integrationWebhookUrl;
    if (!url || !isAllowedWebhookUrl(url)) return;
    const body = buildWebhookPayload({ ...event, gameTitle: g?.title ?? 'RushPoint' }, g?.integrationPlatform);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    functions.logger.warn('mirrorToChat failed', { ownerUid, gameId, err: String(e) });
  }
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
  // Run-wide throttle: per-uid alone is bypassable by minting a fresh anonymous
  // identity per guess (trivial client-side, no server control), which would
  // otherwise let an attacker brute-force the 6-digit PIN space with no real
  // limit. A SECOND counter keyed on the run itself (not the caller) catches
  // that — deliberately a higher threshold so a few different legit staff
  // mistyping a PIN in quick succession never trips it.
  const runAttemptsRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffAttempts/_run`);
  const nowMs = Date.now();
  const [aSnap, runSnap] = await Promise.all([attemptsRef.get(), runAttemptsRef.get()]);
  const a = (aSnap.exists ? aSnap.data() : {}) as { count?: number; lastFailedAtMs?: number };
  const prevCount = a.count ?? 0;
  const lastFailedAt = a.lastFailedAtMs ?? 0;
  const r = (runSnap.exists ? runSnap.data() : {}) as { count?: number; lastFailedAtMs?: number };
  const prevRunCount = r.count ?? 0;
  const lastRunFailedAt = r.lastFailedAtMs ?? 0;

  // Per-caller lockout stays a pre-check: a single caller hammering with wrong
  // PINs is hard-stopped early (row 40). This is NOT the run-wide DoS vector —
  // it can't be weaponized by identity-cycling (a fresh uid has count 0).
  if (shouldLockout(prevCount) && isWithinCooldown(lastFailedAt, nowMs)) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many failed attempts. Try again later.');
  }
  // Cooldown expired → forgive prior failures.
  const baseCount = shouldLockout(prevCount) && !isWithinCooldown(lastFailedAt, nowMs) ? 0 : prevCount;
  const baseRunCount = shouldLockout(prevRunCount, STAFF_RUN_LOCKOUT_LIMIT) && !isWithinCooldown(lastRunFailedAt, nowMs, STAFF_RUN_COOLDOWN_MS) ? 0 : prevRunCount;

  // WO-4: look up the PIN BEFORE consulting the RUN-WIDE lockout. A correct,
  // unused PIN is not a brute-force attempt — it must win even while an attacker
  // has driven the run-wide counter to lockout with fresh anonymous identities.
  // Otherwise any griefer can lock every legit staffer out of a live run.
  const inviteSnap = await db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites`)
    .where('pin', '==', pin)
    .where('used', '==', false)
    .limit(1)
    .get();

  if (inviteSnap.empty) {
    // Wrong/used PIN: NOW apply the run-wide brute-force wall (a correct PIN never
    // reaches here). Throw without incrementing, mirroring the per-caller pre-check.
    if (shouldLockout(prevRunCount, STAFF_RUN_LOCKOUT_LIMIT) && isWithinCooldown(lastRunFailedAt, nowMs, STAFF_RUN_COOLDOWN_MS)) {
      throw new functions.https.HttpsError('resource-exhausted', 'Too many failed attempts for this run. Try again later.');
    }
    await Promise.all([
      attemptsRef.set({ count: baseCount + 1, lastFailedAtMs: nowMs, updatedAt: new Date().toISOString() }, { merge: true }),
      runAttemptsRef.set({ count: baseRunCount + 1, lastFailedAtMs: nowMs, updatedAt: new Date().toISOString() }, { merge: true }),
    ]);
    throw new functions.https.HttpsError('not-found', 'Invalid or already-used PIN');
  }

  const invite = inviteSnap.docs[0].data() as { id: string; name: string; permissions: string[] };

  // Single-use consume MUST be atomic: the where('used','==',false) query above is
  // NON-transactional, so N concurrent callers with the same PIN all read used==false
  // and — without this — each mints a valid token. Re-read the specific invite ref
  // inside a transaction and let exactly one caller flip used:true; the losers see
  // used==true and get the same not-found the query-miss path returns.
  const inviteRef = inviteSnap.docs[0].ref;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(inviteRef);
    const d = fresh.data() as { used?: boolean } | undefined;
    if (!fresh.exists || d?.used === true) {
      throw new functions.https.HttpsError('not-found', 'Invalid or already-used PIN');
    }
    tx.update(inviteRef, {
      used: true,
      usedBy: uid,
      usedAt: new Date().toISOString(),
    });
  });

  // Success (transaction winner only) → reset this caller's failure counter.
  await attemptsRef.set({ count: 0, lastFailedAtMs: 0, updatedAt: new Date().toISOString() }, { merge: true });

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

  // Movement heatmap (change: movement-heatmap): retain an append-only GPS track so the
  // creator can see foot-traffic density after the run. teamLocations keeps only the
  // latest point; this keeps history. CF-write-only; pruned with the run's PII at 90 days.
  await db.collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/locationTrack`)
    .add({ teamId, lat, lng, at: now })
    .catch(() => undefined); // track is best-effort; never fail the location update

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


// ─── sendTeamChatMessage (team ↔ HQ chat) ─────────────────────────────────────
// A single thread doc per team. EITHER side may send: a participant (any attached
// device — no requireController, same rationale as triggerSOS) writes a `team`
// message attributed to the team; the owner / platform-admin / run-scoped staff
// writes an `hq` message into an explicit teamId's thread. Server-write-only doc;
// clients only read it. Rate-limited per sender uid; rejected on a finished run.
export const sendTeamChatMessage = loggedCallable('sendTeamChatMessage', async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  await enforceRateLimit(uid, 'sendTeamChatMessage');

  const { ownerUid, gameId, runId, teamId: rawTeamId, senderName: rawSenderName } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId?: string;
    senderName?: string;
    text?: string;
  };
  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }

  const text = sanitizeChatText((data as { text?: unknown }).text);
  if (text === null) {
    throw new functions.https.HttpsError('invalid-argument', 'Message must be 1 to 500 characters.');
  }

  // ── Resolve sender role ──────────────────────────────────────────────────────
  // HQ path — owner / platform admin / run-scoped staff. Detect via a non-throwing
  // probe, then enforce with assertStaffOrOwner (the claims check IS the authz; the
  // senderName label is display-only). Everyone else is a participant.
  const token = context.auth!.token as { admin?: boolean; staff?: boolean; ownerUid?: string; runId?: string };
  const isHq = uid === ownerUid
    || token.admin === true
    || (token.staff === true && token.ownerUid === ownerUid && token.runId === runId);

  let resolvedTeamId: string;
  let from: 'team' | 'hq';
  let senderName: string;
  let deviceUids: string[] | undefined;

  if (isHq) {
    assertStaffOrOwner(context, ownerUid, runId);
    if (rawTeamId === undefined || rawTeamId === '') {
      throw new functions.https.HttpsError('invalid-argument', 'teamId required');
    }
    const cleanTeamId = validate(() => requireString(rawTeamId, 'teamId', 128));
    const teamSnap = await db.doc(FIRESTORE_PATHS.team(ownerUid, gameId, runId, cleanTeamId)).get();
    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found');
    }
    resolvedTeamId = cleanTeamId;
    from = 'hq';
    senderName = validate(() => optionalString(rawSenderName, 'senderName', 64)) ?? 'HQ';
    // deviceUids left undefined on the HQ path — preserve the previously mirrored
    // value from the existing doc inside the transaction below.
  } else {
    // Participant path — server-resolved identity only; a supplied teamId is
    // ignored. No requireController (any attached device may chat — triggerSOS
    // rationale: communication beats role discipline, message attributed to team).
    const { teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId });
    resolvedTeamId = teamId;
    from = 'team';
    senderName = (team as { displayName?: string }).displayName ?? 'Team';
    deviceUids = (team as { deviceUids?: string[] }).deviceUids ?? [];
  }

  // ── Run gate — no chatting on a finished run ─────────────────────────────────
  const runSnap = await db.doc(FIRESTORE_PATHS.run(ownerUid, gameId, runId)).get();
  if (!runSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Run not found');
  }
  if ((runSnap.data() as { status?: string }).status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This race has already finished.');
  }

  // ── Transactional append (concurrent sends must not lose messages) ───────────
  const chatRef = db.doc(FIRESTORE_PATHS.runChat(ownerUid, gameId, runId, resolvedTeamId));
  const messageId = db.collection('_').doc().id;
  const at = new Date().toISOString();
  const msg: ChatMessage = { id: messageId, from, senderName, text, at };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(chatRef);
    const prev = (snap.data() as TeamChatDoc | undefined)?.messages ?? [];
    // HQ path preserves the mirror already on the doc (defaulting []); participant
    // path re-mirrors the live team deviceUids. Whole-doc set (never merge / dotted
    // array update) — this doc IS the thread, nothing else lives here.
    const mirroredDeviceUids = deviceUids
      ?? (snap.data() as TeamChatDoc | undefined)?.deviceUids
      ?? [];
    tx.set(chatRef, {
      teamId: resolvedTeamId,
      deviceUids: mirroredDeviceUids,
      messages: appendCapped(prev, msg),
      updatedAt: at,
    });
  });

  return { messageId };
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
  const { ownerUid, gameId, runId, message, messageHe, teamId } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    message: string;
    messageHe?: string;
    teamId?: string;   // targeted-announcements: absent ⇒ global broadcast
  };

  // Bound the broadcast text: it is pushed to every participant's screen, so an
  // oversized message would disrupt the whole run (and bloat the doc).
  const cleanMsg = validate(() => requireString(message, 'message', MAX_MESSAGE_LEN));
  const cleanMsgHe = validate(() => optionalString(messageHe, 'messageHe', MAX_MESSAGE_LEN));

  // Targeted announcements (change: targeted-announcements): when a teamId is given,
  // validate it and verify the team doc exists so a typo'd console call fails loud
  // (`not-found`) instead of silently addressing nobody. Client-side visibility is a
  // courtesy, not access control — see `announcementVisibleTo` + the rules comment.
  let cleanTeamId: string | undefined;
  let teamName: string | undefined;
  if (teamId !== undefined && teamId !== '') {
    cleanTeamId = validate(() => requireString(teamId, 'teamId', 128));
    const teamSnap = await db.doc(FIRESTORE_PATHS.team(ownerUid, gameId, runId, cleanTeamId)).get();
    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found');
    }
    teamName = (teamSnap.data() as { displayName?: string } | undefined)?.displayName;
  }

  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/announcements`)
    .doc();

  await ref.set({
    id: ref.id,
    message: cleanMsg,
    messageHe: cleanMsgHe ?? cleanMsg,
    kind: 'announcement',
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: context.auth!.uid,
    ...(cleanTeamId ? { teamId: cleanTeamId } : {}),
  });

  // Mirror to Slack/Teams if the game has a webhook configured (best-effort). A
  // targeted announcement prefixes the addressed team so the ops channel sees who
  // it went to.
  const mirrorMsg = cleanTeamId ? `[→ ${teamName || cleanTeamId}] ${cleanMsg}` : cleanMsg;
  await mirrorToChat(ownerUid, gameId, { kind: 'announcement', message: mirrorMsg });

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

  // Mirror to Slack/Teams if the game has a webhook configured (best-effort).
  await mirrorToChat(ownerUid, gameId, {
    kind: 'flashMission', title: cleanTitle, message: cleanDesc ?? '', bonusPoints: bonus,
  });

  return { id: ref.id, expiresAt };
});


// ─── Live photo feed (change: live-photo-feed) ─────────────────────────────────
// Broadcast an APPROVED photo to the run's shared feed. Best-effort: a feed
// failure must never fail (or slow-fail) the photo approval itself — the task
// completion already happened. Plain `.set()` on a brand-new doc; no transaction
// is added to the photo-approval paths (hot-path lesson: never txn in the
// completeTask path).
async function writeFeedItem(
  ownerUid: string,
  gameId: string,
  runId: string,
  entry: { taskId: string; taskTitle: string; teamId: string; teamName: string; photoUrl: string },
): Promise<void> {
  try {
    const ref = db.collection(FIRESTORE_PATHS.feedItemsCol(ownerUid, gameId, runId)).doc();
    const item: FeedItem = {
      id: ref.id,
      taskId: entry.taskId,
      taskTitle: entry.taskTitle,
      teamId: entry.teamId,
      teamName: entry.teamName,
      photoUrl: entry.photoUrl,
      reactions: {},
      reactedBy: {},
      active: true,
      createdAt: new Date().toISOString(),
    };
    await ref.set(item);
  } catch (e) {
    functions.logger.warn('writeFeedItem failed (feed is best-effort)', { runId, err: String(e) });
  }
}


// ─── reactToFeedItem (change: live-photo-feed) ─────────────────────────────────
// One emoji reaction per uid per feed item; re-reacting switches the emoji and
// never double-counts (pure applyReaction reducer inside a transaction).
export const reactToFeedItem = loggedCallable('reactToFeedItem', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'reactToFeedItem');
  const { ownerUid, gameId, runId, itemId, emoji } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    itemId: string;
    emoji: string;
  };
  if (!ownerUid || !gameId || !runId || !itemId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId, itemId required');
  }

  // Run membership: a participant of THIS run (any attached device) may react;
  // the owner and run-scoped staff may too. Strangers are denied.
  try {
    await resolveCallerTeam(uid, { ownerUid, gameId, runId });
  } catch {
    assertStaffOrOwner(context, ownerUid, runId);
  }

  const itemRef = db.doc(FIRESTORE_PATHS.feedItem(ownerUid, gameId, runId, itemId));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Feed item not found');
    const item = snap.data() as FeedItem;
    if (item.active === false) throw new functions.https.HttpsError('not-found', 'Feed item not found');
    let applied;
    try {
      applied = applyReaction(item, uid, emoji);
    } catch {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid reaction emoji');
    }
    if (applied.changed) {
      // Real nested objects (whole-map replace) — never dotted .set({merge}) keys.
      tx.update(itemRef, { reactions: applied.reactions, reactedBy: applied.reactedBy });
    }
    return { changed: applied.changed, reactions: applied.reactions };
  });

  return { ok: true, ...result };
});


// ─── hideFeedItem (change: live-photo-feed) ────────────────────────────────────
// Moderation: staff/owner hides a feed item (listener filters active == true).
// Same shape as deactivateAnnouncement.
export const hideFeedItem = loggedCallable('hideFeedItem', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
  const { ownerUid, gameId, runId, itemId } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    itemId: string;
  };
  if (!itemId) throw new functions.https.HttpsError('invalid-argument', 'itemId required');

  await db
    .doc(FIRESTORE_PATHS.feedItem(ownerUid, gameId, runId, itemId))
    .update({ active: false, hiddenAt: new Date().toISOString(), hiddenBy: context.auth!.uid });

  return { ok: true };
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
  const { teamId: resolvedTeamId, team } = await resolveCallerTeam(
    uid, { ownerUid, gameId, runId }, { requireController: true },
  );
  // IDOR guard (auth-anticheat row 38): a participant may only verify for their
  // OWN team. A payload teamId that isn't the caller's team is rejected.
  if (teamId && teamId !== resolvedTeamId) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot act on another team');
  }
  // WO-2: close the locked/future-stage oracle BEFORE the code comparison — a
  // wrong code and a correct code on a locked stage now throw the identical
  // "stage not active" error instead of 'Incorrect code' vs a stage error.
  assertStageActiveForTask(team, taskId);

  const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');

  const game = gameSnap.data() as {
    stages: {
      tasks: {
        id: string;
        hintAutoRevealAttempts?: number;
        smart?: { secretCode?: string; attemptLimit?: number };
      }[];
    }[];
  };
  let stationTask: (typeof game.stages)[number]['tasks'][number] | undefined;
  for (const stage of game.stages) {
    const task = stage.tasks.find((t) => t.id === taskId);
    if (task) { stationTask = task; break; }
  }

  if (!stationTask) {
    throw new functions.https.HttpsError('not-found', 'Task not found in game');
  }
  const expectedCode = stationTask.smart?.secretCode;
  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${resolvedTeamId}`);
  if (!expectedCode || expectedCode.trim().toLowerCase() !== code.trim().toLowerCase()) {
    // Hint auto escalation (change: hint-auto-escalation): a wrong station code
    // is a wrong ATTEMPT — record it (real nested map, never a dotted key in
    // .set({merge})) before rejecting, so a struggling team's free-hint
    // threshold can be reached at a station too. Tracked when a consumer needs
    // it: the task's escalation threshold or its attemptLimit (counting only —
    // enforcing a station attempt cap stays out of scope).
    if ((stationTask.hintAutoRevealAttempts ?? 0) > 0 || (stationTask.smart?.attemptLimit ?? 0) > 0) {
      await teamRef.set(
        { taskAttempts: { [taskId]: admin.firestore.FieldValue.increment(1) } },
        { merge: true },
      );
    }
    throw new functions.https.HttpsError('failed-precondition', 'Incorrect code');
  }

  const now = new Date().toISOString();
  // NB: nest under the `taskVerifications` map via a real nested object. Dotted
  // keys in .set({merge}) become *literal* top-level field names, not map paths.
  await teamRef.set(
    {
      taskVerifications: { [taskId]: { verified: true, verifiedAt: now, verifiedBy: uid } },
    },
    { merge: true },
  );

  // Correct code = task complete → score it, RELEASE the held station slot, and
  // advance the team (WO-1). Mirrors submitStationPhoto/completeTask: without the
  // releaseTask a capped smart_station leaks a slot on every verified check-in, so
  // the next team gets {taskId:null} forever. Guarded on `completed` (idempotent
  // replay must not over-release) and `heldSlot` (never drain a slot this team
  // never reserved). `verifyStationCode` carries no lat/lng → route locationless.
  const { completed } = await completeTaskForTeam(ownerUid, gameId, runId, resolvedTeamId, taskId, now);
  if (!completed) return { verified: true, already: true, nextTaskId: null };
  // WO Fix 1: the held station slot is released atomically inside completeTaskForTeam.
  const next = await assignNextInActiveStage(ownerUid, gameId, runId, resolvedTeamId, { lat: 0, lng: 0 }, now);
  return { verified: true, nextTaskId: next.taskId ?? null };
});


export const submitStationPhoto = loggedCallable('submitStationPhoto', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'submitStationPhoto');
  const { ownerUid, gameId, runId, teamId, taskId, photoUrl, contentType } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    taskId: string;
    photoUrl: string;
    // audio-tasks: the declared blob content-type. Validated against the task's
    // captureKind below. Photo clients that never send it stay accepted.
    contentType?: string;
  };

  // Shared team devices: resolve the caller's team + require the controller role.
  const { teamId: resolvedTeamId, team } = await resolveCallerTeam(
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

  // Check the task's smart config for autoApprove (staffless events). The same
  // snapshot also yields the task title + the photoFeedEnabled gate for the
  // live photo feed (live-photo-feed) — no extra read on this hot path.
  const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
  let autoApprove = false;
  let taskTitle = '';
  let feedEnabled = true;
  // audio-tasks: the task's captureKind rides the SAME snapshot (no extra read).
  let kind: MediaKind = 'photo';
  if (gameSnap.exists) {
    const game = gameSnap.data() as {
      photoFeedEnabled?: boolean;
      stages: { tasks: { id: string; title?: string; smart?: { autoApprove?: boolean; captureKind?: MediaKind } }[] }[];
    };
    feedEnabled = game.photoFeedEnabled !== false;
    for (const stage of game.stages) {
      const task = stage.tasks.find((t) => t.id === taskId);
      if (task) {
        autoApprove = task.smart?.autoApprove === true;
        taskTitle = task.title ?? '';
        kind = task.smart?.captureKind === 'audio' ? 'audio' : 'photo';
        break;
      }
    }
  }

  // audio-tasks: the declared content-type must match the task's captureKind. An
  // audio task requires a declared audio type; a photo task rejects an audio type
  // (a photo task with contentType omitted stays accepted — back-compat). The
  // actual uploaded bytes are gated by storage.rules against the same allowlist.
  validate(() => {
    if (!isAllowedSubmissionContentType(kind, contentType)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Submission content-type does not match the task's capture kind (${kind})`,
      );
    }
  });

  // WO Fix 4: gate the taskSubmissions write BEFORE it happens. The record was
  // previously written unconditionally, ahead of any completion/idempotency/stage
  // check — which (a) stored an orphan `approved` record for a locked/future stage,
  // and (b) let a re-submit flip an already-approved submission back to `pending`
  // (moderation bypass). Guard on the freshly-resolved team state:
  //  1. stage must be active for this task (rejects locked/future/completed stages);
  //  2. if the task is already completed, or its submission is already approved,
  //     return an idempotent no-op WITHOUT writing.
  assertStageActiveForTask(team, taskId);
  const priorSubmission = (team as { taskSubmissions?: Record<string, { status?: string }> })
    .taskSubmissions?.[taskId];
  const taskAlreadyCompleted = team.stages.some((s) =>
    s.tasks.some((t) => t.taskId === taskId && t.status === 'completed'),
  );
  if (taskAlreadyCompleted || priorSubmission?.status === 'approved') {
    return { submitted: true, autoApproved: autoApprove, already: true };
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
          // audio-tasks: server-derived from the task (never client-claimed) so
          // review UIs know whether to render an <img> or an <audio> player.
          mediaKind: kind,
        },
      },
    },
    { merge: true },
  );

  // autoApprove: the submission is logged but does not block progression.
  let alreadyCompleted = false;
  if (autoApprove) {
    const { completed } = await completeTaskForTeam(ownerUid, gameId, runId, resolvedTeamId, taskId, now);
    // Idempotent replay (WO-3): a duplicate autoApprove submission is a no-op —
    // `completed` is false. Surface `already:true` so a replay is observable.
    alreadyCompleted = !completed;
    // WO Fix 1: the completed task's own station slot is now released ATOMICALLY
    // inside completeTaskForTeam's transaction (along with any auto-skipped
    // siblings), so no post-commit releaseTask is needed here.
    // Live photo feed (live-photo-feed): broadcast the approved photo. Skipped
    // when the game disables the feed; best-effort (never fails the submission).
    // audio-tasks non-goal: audio submissions never enter the photo feed.
    // WO Fix 4: gated on `completed` (like the sibling releaseTask) so a duplicate
    // autoApprove submission — which returns completed:false — cannot flood the feed.
    if (completed && feedEnabled && kind !== 'audio') {
      await writeFeedItem(ownerUid, gameId, runId, {
        taskId,
        taskTitle,
        teamId: resolvedTeamId,
        teamName: team.displayName ?? '',
        photoUrl: photoUrl.trim(),
      });
    }
  }

  return { submitted: true, autoApproved: autoApprove, ...(alreadyCompleted ? { already: true } : {}) };
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
  // Existence guard: unlike submitStationPhoto (which resolves the caller's OWN
  // team server-side and so is guaranteed to exist), this teamId is staff-
  // supplied. Without this check a typo'd/stale teamId would `.set({merge})` a
  // brand-new, malformed team doc into existence (only a `taskSubmissions` field,
  // missing displayName/score/stages/…) — a phantom team that then corrupts
  // listRunTeams / the leaderboard for the rest of the run. Fail loud instead.
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found');
  }
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
    const { completed } = await completeTaskForTeam(ownerUid, gameId, runId, teamId, taskId, now);
    // WO Fix 1: the completed task's station slot is released atomically inside
    // completeTaskForTeam's transaction.

    // Live photo feed (live-photo-feed): broadcast the approved photo. This path
    // adds a game-doc read (staff review, not a hot path) for the task title +
    // the photoFeedEnabled gate; best-effort — never fails the review.
    try {
      const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
      const game = gameSnap.data() as {
        photoFeedEnabled?: boolean;
        stages?: { tasks: { id: string; title?: string }[] }[];
      } | undefined;
      if (game && game.photoFeedEnabled !== false) {
        let taskTitle = '';
        for (const stage of game.stages ?? []) {
          const task = stage.tasks.find((t) => t.id === taskId);
          if (task) { taskTitle = task.title ?? ''; break; }
        }
        const teamData = (await teamRef.get()).data() as {
          displayName?: string;
          taskSubmissions?: Record<string, { photoUrl?: string; mediaKind?: MediaKind }>;
        } | undefined;
        const submission = teamData?.taskSubmissions?.[taskId];
        const submittedPhotoUrl = submission?.photoUrl;
        // audio-tasks non-goal: audio submissions never enter the photo feed.
        // WO Fix 4: gated on `completed` — a re-approval of an already-completed
        // task returns completed:false and must not re-emit a feed item.
        if (completed && submittedPhotoUrl && submission?.mediaKind !== 'audio') {
          await writeFeedItem(ownerUid, gameId, runId, {
            taskId,
            taskTitle,
            teamId,
            teamName: teamData?.displayName ?? '',
            photoUrl: submittedPhotoUrl,
          });
        }
      }
    } catch (e) {
      functions.logger.warn('reviewStationSubmission: feed write skipped', { runId, err: String(e) });
    }
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

  // `typeof NaN === 'number'` and `typeof Infinity === 'number'`, so a bare type
  // check lets a non-finite delta through → it would write a non-finite
  // bonusPenalty that bricks refreshLeaderboard/finalizeRun (parseRunTeam rejects
  // it) and poisons run.leaderboard. Require a finite number (nightly hardening).
  // The finite check below guards the INPUT; nextBonusPenalty (used inside the
  // transaction) additionally validates the ACCUMULATED result — two large finite
  // deltas can still sum to ±Infinity across calls — and clamps its magnitude.
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    throw new functions.https.HttpsError('invalid-argument', 'delta must be a finite number');
  }

  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`);
  // Transactional read-modify-write so a concurrent captureZone / requestTaskHint (both
  // transactional) can't lose this adjustment via a stale bonusPenalty (scoring integrity).
  const { prev, newPenalty } = await db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const p = (teamSnap.data() as { bonusPenalty?: number }).bonusPenalty ?? 0;
    const np = nextBonusPenalty(p, delta);
    tx.update(teamRef, { bonusPenalty: np, updatedAt: new Date().toISOString() });
    return { prev: p, newPenalty: np };
  });

  const cleanReason = validate(() => optionalString(reason, 'reason', MAX_MESSAGE_LEN)) ?? '';

  await writeAuditLog({
    ownerUid, gameId, runId, teamId,
    operatorId: context.auth!.uid,
    actionType: delta >= 0 ? 'bonus' : 'fine',
    previousValue: -prev,
    newValue: -newPenalty,
    reason: cleanReason,
  });

  // Targeted announcements (change: targeted-announcements): make the adjustment
  // visible to the team. AFTER the scoring transaction + audit log (both untouched —
  // score integrity first), write a team-targeted `kind:'score'` notice into the run's
  // existing announcements collection so play-web renders a toast. Plain create, no
  // transaction added, no `buildRankings` change; best-effort (the adjustment already
  // landed even if this write fails).
  try {
    const nowIso = new Date().toISOString();
    const noticeRef = db
      .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/announcements`)
      .doc();
    await noticeRef.set({
      id: noticeRef.id,
      kind: 'score',
      teamId,
      delta,
      reason: cleanReason,
      message: formatScoreNotice(delta, cleanReason, 'en'),
      messageHe: formatScoreNotice(delta, cleanReason, 'he'),
      active: true,
      createdAt: nowIso,
      createdBy: context.auth!.uid,
    });
  } catch (e) {
    functions.logger.warn('adjustTeamScore score-notice write failed', { ownerUid, gameId, runId, teamId, err: String(e) });
  }

  // The operator expects the adjustment on the board NOW — forced (unthrottled)
  // refresh; still skipped for a frozen board and best-effort like the notice.
  await maybeRefreshLeaderboardSnapshot(ownerUid, gameId, runId, { force: true });

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
