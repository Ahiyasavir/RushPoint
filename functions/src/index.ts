// ─── RushPoint v2 — Cloud Functions entry point ───────────────────────────────
// All callables are organised into domain modules; this file imports and
// re-exports them so Firebase can discover them at the top level.

import * as functions from 'firebase-functions';
import { loggedCallable, logBestEffort } from './obs/log';
import { enforceRateLimit } from './rateLimitStore';
import { db } from './firebase';
import * as admin from 'firebase-admin';
import { randomInt } from 'node:crypto';
import { isValidCoord, requireStorageUrl, shouldLockout, isWithinCooldown, STAFF_RUN_LOCKOUT_LIMIT, STAFF_RUN_COOLDOWN_MS, isOutsideSafeZone, evaluateSafeZoneStatus, DEFAULT_OUT_OF_BOUNDS_GRACE_MS, requireString, optionalString, MAX_MESSAGE_LEN, type SafeZone, buildWebhookPayload, isAllowedWebhookUrl, type WebhookEvent, applyReaction, applyReport, FEED_REPORT_REASONS, FIRESTORE_PATHS, COLLECTIONS, type FeedItem, formatScoreNotice, sanitizeChatText, appendCapped, type ChatMessage, type TeamChatDoc, type StaffChannelMessage, type StaffChannelDoc, isAllowedSubmissionContentType, type MediaKind, isReleased, isExpired, attemptLimitReached, isStationStatus, LIVE_TASK_STATUSES, planTaskStatusChange, type StationStatus, type TaskStatusOverrides, type Task } from '@rushpoint/shared';
// The recorded answer sheet (change: post-run-player-report) — every submission,
// right and wrong, on every run. Owner-only by construction: `answerLog` is never
// added to sanitizeTeamForParticipant's allow-list.
import { buildAnswerLogEntry, appendAnswerLog, type RunTeam } from '@rushpoint/shared';
import { validate } from './validation';
import { storageOriginOpts } from './storageOriginOpts';

/**
 * Record ONE station-code attempt on the team's stored task record.
 *
 * A correct code records itself through `completeTaskForTeam`'s existing
 * transaction; a WRONG code never reaches that path, so it needs its own append.
 * The stages array is rewritten WHOLE inside a transaction — a dotted path into an
 * array element would coerce the array to a map and break the run, and a
 * non-transactional whole-array write could clobber a concurrent one.
 *
 * Returns quietly when the team has no record for that task (nothing to attach
 * the attempt to) — recording is bookkeeping and must never fail a submission.
 */
async function recordStationCodeAttempt(
  teamRef: FirebaseFirestore.DocumentReference,
  taskId: string,
  code: string,
  correct: boolean,
): Promise<void> {
  const entry = buildAnswerLogEntry({ kind: 'station_code', answer: code, correct, at: new Date().toISOString() });
  if (!entry) return;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) return;
    const stages = (snap.data() as RunTeam).stages;
    if (!Array.isArray(stages)) return;
    for (const stage of stages) {
      const recs = stage?.tasks;
      if (!Array.isArray(recs)) continue;
      for (const rec of recs) {
        if (rec?.taskId !== taskId) continue;
        rec.answerLog = appendAnswerLog(rec.answerLog, entry);
        tx.update(teamRef, { stages, updatedAt: new Date().toISOString() });
        return;
      }
    }
  });
}

/** Cryptographic 6-digit staff PIN (replaces Math.random — anti-cheat row 40). */
function generatePin(): string {
  return String(randomInt(100000, 1000000));
}
import { completeTaskForTeam, resolveCallerTeam, maybeRefreshLeaderboardSnapshot, assignNextInActiveStage, assertStageActiveForTask, assertTeamNotHeld } from './runs/index';
import { nextBonusPenalty } from './scoring/bonusPenalty';
import { shouldFeedTask, type FeedTaskVisibilityInput } from './feedVisibility';

// ─── Domain modules ────────────────────────────────────────────────────────────
export * from './games/index';
export * from './gallery/index';
export { updateMyProfile, exportMyData, deleteMyAccount } from './users/index';
export {
  pruneExpiredRunData, pruneExpiredRunDataNow, pruneRunNow, purgeDeletedGamesNow,
  backfillPublicTaskCoordinatesNow,
} from './maintenance/index';
export { listPlatformUsers, recordEngagement, setUserNote } from './admin/index';
// Marketing site contact form (change: marketing-site). submitContactMessage is
// UNAUTHENTICATED by necessity and is declared in PUBLIC_CALLABLES with its
// reason; listContactMessages is admin only and audit logged.
export { submitContactMessage, listContactMessages } from './contact/index';
// Admin-managed game templates (change: admin-manage-game-templates).
export { setGameTemplateFlag, listAdminTemplates, listGameTemplates, createGameFromTemplate } from './admin/templates';
export {
  getWallet, getWalletStatus, purchaseCredits, subscribePro, claimReferral, stripeWebhook,
} from './payments/index';
// Explicit callable re-exports from runs (completeTaskForTeam is an internal
// helper, not a Cloud Function, so it must NOT be re-exported as a trigger).
// skipStage ends the whole stage; skipTaskForTeam removes ONE mission from ONE
// team and keeps them in the same stage (change: skip-single-task).
// setTeamHold parks/resumes ONE team (its clock stops and it cannot advance);
// forceAssignTask sends ONE team to a SPECIFIC task in its current stage
// (change: staff-console-field-ops).
// listMyRuns + getRunPlayerReport are the run-history and post-run per-player
// report surfaces (change: post-run-player-report) — the only way back into a run
// that has already ENDED, since every other post-run callable is keyed by an
// access code that only the live console holds.
export {
  launchRun, joinRun, getJoinInfo, startTeams, skipStage, skipTaskForTeam, finalizeRun,
  setTeamHold, forceAssignTask,
  refreshLeaderboard, getPublicLeaderboard, getRunRecap, getRunReplay, getRunAnalytics, getRunSummary, getRunHeatmap,
  listRunTeams, completeTask, requestNextTask, requestTaskHint, reportArrival,
  submitTaskAnswer, submitSequenceStep, getRecommendedTasks, revealTaskAnswer,
  checkOutTask, getMyTeamState, listLiveRuns, getMyProfile,
  listMyRuns, getRunPlayerReport,
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

import { requireAuth, assertStaffOrOwner, assertAdmin } from './auth';

// Live-ops actions (announce, flash, ack SOS, review photo, adjust score) are
// performed by EITHER the game owner running their own console OR a staff member
// invited to that run. A staff custom token carries `ownerUid` AND `runId`
// claims — both must match the payload: a PIN minted for run A must not grant
// live-ops power over the owner's OTHER runs (caught by the e2e authz matrix).
//
// The definition itself now lives in ./auth (change: skip-single-task) so the runs
// domain can use the SAME gate without importing this module (which would be an
// import cycle). Imported above; behaviour unchanged.


// ─── Audit trail ──────────────────────────────────────────────────────────────
// The writer now lives in obs/audit.ts so the games domain can record destructive
// actions too (change: recoverable-game-deletion). Behaviour is unchanged.
import { writeAuditLog, auditBestEffort } from './obs/audit';


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
      // wave-h P2 #1: bound the outbound webhook. pushAnnouncement/pushFlashMission
      // AWAIT this mirror, so a slow allow-listed endpoint would otherwise hang the
      // owner-console callable up to the function timeout (and hold a billable
      // instance). AbortSignal.timeout is a Node-20 global. The surrounding
      // try/catch already fails open, so a timeout (AbortError) never breaks the
      // participant-facing broadcast (the Firestore write already committed).
      signal: AbortSignal.timeout(3000),
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
  const { ownerUid, gameId, runId, pin, name } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    pin: string;
    // Optional self-declared display name (change: staff-onboarding-simplification).
    // The staffer types who they are at sign-in; see the staffName claim below for
    // why this is attribution, not authorization.
    name?: string;
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
      // Attribution, NOT authorization: the audit trail should name the human who
      // actually signed in, not whatever placeholder the creator typed when
      // generating the invite ("Staff 1"). Self-declared and therefore untrusted —
      // it never grants anything. Every real permission comes from `permissions`,
      // `ownerUid/gameId/runId` and the single-use PIN, all invite-derived above.
      // Falls back to the invite name when the staffer types nothing. Trimmed and
      // length-capped so a hostile value can't bloat the token or the audit rows.
      staffName: (typeof name === 'string' && name.trim() ? name.trim() : invite.name).slice(0, 60),
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
  const { lat, lng, accuracyMeters, ownerUid, gameId, runId } = data as {
    lat: number;
    lng: number;
    // Out-of-bounds recovery: the fix's own error radius. Optional and never fatal —
    // an older client that cannot supply it must keep working (it then simply gets no
    // confidence tolerance). Never trusted to *widen* anything beyond the ceiling.
    accuracyMeters?: number;
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
  const accuracy = typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) && accuracyMeters >= 0
    ? accuracyMeters
    : null;
  await locationRef.set({ teamId, lat, lng, accuracyMeters: accuracy, updatedAt: now }, { merge: true });

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

  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`);
  const teamData = (await teamRef.get()).data() as
    { outOfBounds?: boolean; outOfBoundsOverrideUntil?: string; lastBreachAlertAt?: string } | undefined;
  const wasOut = teamData?.outOfBounds === true;
  const overrideUntilMs = teamData?.outOfBoundsOverrideUntil
    ? Date.parse(teamData.outOfBoundsOverrideUntil)
    : null;
  const nowMs = Date.parse(now);

  // Out-of-bounds recovery: the flag is now decided by the fail-open evaluator, so a
  // low-confidence fix, a malformed one, or a team a human already released can never
  // latch. `outside` (the raw geometry) is kept separately because the ORGANIZER's
  // breach alert must still fire on a genuine crossing during a staff override — the
  // override releases the player, it does not blind the run console.
  const status = evaluateSafeZoneStatus({
    fix: { lat, lng, accuracyMeters: accuracy, atMs: nowMs },
    safeZone,
    nowMs,
    overrideUntilMs,
  });
  const outside = status.reason === 'outside' || (status.reason === 'override' && isOutsideSafeZone({ lat, lng }, safeZone));

  // Alert dedup: while the flag latches, `wasOut` already suppresses repeats. Under an
  // ACTIVE OVERRIDE the flag never latches, so without a cooldown every 20 s ping from a
  // genuinely-outside team would mint a fresh alert. 10 minutes keeps the organizer
  // informed without burying the alerts panel.
  const lastAlertMs = teamData?.lastBreachAlertAt ? Date.parse(teamData.lastBreachAlertAt) : NaN;
  const alertCooledDown = !Number.isFinite(lastAlertMs) || nowMs - lastAlertMs > 10 * 60 * 1000;
  if (outside && !wasOut && alertCooledDown) {
    const alertRef = db.collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`).doc();
    await alertRef.set({
      id: alertRef.id, teamId, type: 'safe_zone_breach',
      lat, lng, message: 'Left the play area', acknowledged: false, createdAt: now,
    });
    await teamRef.set({ lastBreachAlertAt: now }, { merge: true });
  }
  if (status.outOfBounds && !wasOut) {
    await teamRef.set({ outOfBounds: true, outOfBoundsAt: now }, { merge: true });
  } else if (!status.outOfBounds && wasOut) {
    await teamRef.set({ outOfBounds: false }, { merge: true });
  }

  return { ok: true, outOfBounds: status.outOfBounds, reason: status.reason };
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
  // Stamp the caller uid so a client can attribute each line to its true author
  // regardless of `from` (an owner who plays their own game is stamped from:'hq'
  // yet must still read as themselves). Display-only — authz is the claims check.
  const msg: ChatMessage = { id: messageId, from, senderId: uid, senderName, text, at };

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


// ─── sendStaffChannelMessage (change: staff-console-field-ops) ────────────────
//
// ONE shared thread per run between the field marshals and the run's owner. A
// marshal reports a problem or asks for an exception; the organizer answers from
// the desktop console or their own phone. Deliberately NOT a per-marshal DM system
// and NOT a ticketing workflow — it is coordination, and an SOS-severity issue
// still belongs on the existing triggerSOS/alerts path (which has an audio cue).
//
// The SENDER ROLE is decided here, never accepted from the client: uid === ownerUid
// ⇒ 'admin', otherwise 'staff'. `assertStaffOrOwner` is the actual authorization —
// exactly the guard adjustTeamScore and acknowledgeAlert already use — so a
// participant, a stranger, or another run's staff token cannot reach this thread at
// all, and firestore.rules independently denies them the read.
export const sendStaffChannelMessage = loggedCallable('sendStaffChannelMessage', async (data, context) => {
  requireAuth(context);
  const uid = context.auth!.uid;
  await enforceRateLimit(uid, 'sendStaffChannelMessage');

  const { ownerUid, gameId, runId, senderName: rawSenderName } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    senderName?: string;
    text?: string;
  };
  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }
  // Authorization FIRST — before any read, so an unauthorized caller learns nothing
  // about whether the run exists.
  assertStaffOrOwner(context, ownerUid, runId);

  const text = sanitizeChatText((data as { text?: unknown }).text);
  if (text === null) {
    throw new functions.https.HttpsError('invalid-argument', 'Message must be 1 to 500 characters.');
  }

  // Role is derived from the authenticated identity, never from the payload. A
  // platform admin acting on someone else's run reads as 'admin' too — they are
  // acting in the organizer's seat, which is what a marshal needs to know.
  const token = context.auth!.token as { admin?: boolean; staffName?: string };
  const from: 'staff' | 'admin' = uid === ownerUid || token.admin === true ? 'admin' : 'staff';
  // Attribution mirrors sendTeamChatMessage: the token's own staffName claim is the
  // trustworthy label; the client-supplied name is only a fallback for the owner,
  // whose token carries no staffName. Display-only either way — authz is the claims
  // check above, so a wrong label can never widen access.
  const senderName = token.staffName
    ?? validate(() => optionalString(rawSenderName, 'senderName', 64))
    ?? (from === 'admin' ? 'Admin' : 'Staff');

  // Run gate — same rule as team chat: no coordination thread on a finished run.
  const runSnap = await db.doc(FIRESTORE_PATHS.run(ownerUid, gameId, runId)).get();
  if (!runSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Run not found');
  }
  if ((runSnap.data() as { status?: string }).status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This race has already finished.');
  }

  // Transactional append for the same reason team chat is: two marshals sending at
  // once must not lose a message. Whole-doc set — this doc IS the thread.
  const channelRef = db.doc(FIRESTORE_PATHS.runStaffChannel(ownerUid, gameId, runId));
  const messageId = db.collection('_').doc().id;
  const at = new Date().toISOString();
  const msg: StaffChannelMessage = { id: messageId, from, senderId: uid, senderName, text, at };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(channelRef);
    const prev = (snap.data() as StaffChannelDoc | undefined)?.messages ?? [];
    tx.set(channelRef, {
      runId,
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


// ─── clearTeamOutOfBounds ─────────────────────────────────────────────────────
//
// The human escape hatch (change: out-of-bounds-recovery). `team.outOfBounds` used to
// be openable by exactly one thing — a later GPS fix proving the team came back — so a
// phone with denied/dead/wildly-inaccurate location left its team behind a blocking
// card for the rest of the run, and NO staff or creator action could free them.
//
// The grace stamp is the point: without it the very next bad fix from the same broken
// phone re-latches the team seconds after the rescue and staff are in a loop they
// cannot win. It is short by design — a rescue, not a permanent exemption — and
// updateLocation keeps raising breach alerts throughout, so the organizer never loses
// the safety signal.

export const clearTeamOutOfBounds = loggedCallable('clearTeamOutOfBounds', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
  const { ownerUid, gameId, runId, teamId, reason } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    teamId: string;
    reason?: string;
  };
  if (!ownerUid || !gameId || !runId || !teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId, teamId required');
  }

  const teamRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`);
  if (!(await teamRef.get()).exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found');
  }

  const nowMs = Date.now();
  const overrideUntil = new Date(nowMs + DEFAULT_OUT_OF_BOUNDS_GRACE_MS).toISOString();
  await teamRef.set(
    { outOfBounds: false, outOfBoundsOverrideUntil: overrideUntil },
    { merge: true },
  );

  await auditBestEffort({
    ownerUid, gameId, runId, teamId,
    operatorId: context.auth!.uid,
    actionType: 'out_of_bounds_cleared',
    previousValue: 'out_of_bounds',
    newValue: 'released',
    reason: validate(() => optionalString(reason, 'reason', MAX_MESSAGE_LEN)) ?? '',
  });

  return { ok: true, overrideUntil };
});


// ─── Stale live-ops sweep (opportunistic) ─────────────────────────────────────
// WHY THIS EXISTS. Two live-ops docs are written `active`/`isActive: true` and
// then nothing ever turns them off: the `kind:'score'` notice `adjustTeamScore`
// writes (only the CLIENT hides it, on a 10-minute TTL) and a `flashMission`
// past its `expiresAt` (only the client's render filter drops it). Both keep
// matching every participant's `onSnapshot` query forever.
//
// This is NOT the unbounded billing tail it looks like — `LiveOps.tsx` already
// caps both listeners (`limit(30)` / `limit(20)`, `orderBy('createdAt','desc')`),
// so a long run can never cost more than that per attach. What it IS, is a
// CORRECTNESS bug against those bounds: expired docs occupy slots in a
// newest-first window, so a still-relevant global banner can be pushed out of
// the window by a burst of score notices the player is no longer even shown.
// Clearing them keeps the bounded window full of things that still render, and
// as a side effect shrinks each re-attach (a backgrounded PWA re-attaches a lot).
//
// SAFETY — the reason this cannot hide a live announcement: we only deactivate
// documents the client ALREADY refuses to render (a score notice past the same
// TTL the client applies, a flash mission past its own `expiresAt`). A global
// `kind:'announcement'` banner is never touched at any age; it persists until an
// operator calls `deactivateAnnouncement` or a player dismisses it, exactly as
// before. Nothing anywhere reads an INACTIVE doc from either collection (the
// sole reader is `LiveOps.tsx`, on `active == true` / `isActive == true`), and we
// deactivate rather than delete so the history survives for any future recap.
//
// Shape: opportunistic — it piggybacks on the next staff-driven live-ops write
// instead of a new scheduled function (deploy cost) or a new callable (which the
// callable-coverage guard would fail until a test exists).

/**
 * Mirror of `SCORE_NOTICE_TTL_MS` in `apps/play-web/src/components/LiveOps.tsx`.
 * If that TTL ever grows, this must grow with it — a smaller value here would
 * retire a notice the client would still be showing.
 */
const SCORE_NOTICE_TTL_MS = 10 * 60 * 1000;

/**
 * Extra slack on top of the TTL before the server retires a notice. The TTL is
 * evaluated against each PHONE's clock, so a phone running slow could still be
 * counting down a notice the server considers expired; this makes the server the
 * strictly later of the two and keeps the sweep invisible.
 */
const SCORE_NOTICE_SWEEP_GRACE_MS = 60 * 1000;

/**
 * Hard cap on documents examined per collection per sweep. Bounds both the read
 * cost of the sweep itself and the resulting batch: 2 × 40 = 80 writes, far under
 * the 500-op WriteBatch ceiling (`MAX_BATCH_OPS = 450`), so this sweep is bounded
 * by construction and never needs `chunk`/`deleteDocsInChunks`.
 */
const LIVE_OPS_SWEEP_LIMIT = 40;

/**
 * Retire live-ops documents that have outlived their own visibility rules.
 * Best-effort and total: it NEVER throws, because every caller has already
 * completed the operation the staff member actually asked for.
 */
async function sweepStaleLiveOps(ownerUid: string, gameId: string, runId: string): Promise<void> {
  try {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const runPath = FIRESTORE_PATHS.run(ownerUid, gameId, runId);
    const batch = db.batch();
    let ops = 0;

    // Score notices. The `createdAt` range does the filtering server-side so a
    // quiet run reads ZERO documents — the sweep costs nothing when there is
    // nothing to clear. Comparing ISO strings lexicographically is chronological
    // here because every writer stamps `new Date().toISOString()`: fixed-width,
    // always UTC. The range also excludes any legacy doc with no `createdAt`,
    // which is the fail-closed outcome we want (unknown age ⇒ leave it alone).
    // `kind` is filtered in memory rather than in the query on purpose: a third
    // equality would need a new composite index, and the range already keeps the
    // candidate set tiny.
    const noticeCutoff = new Date(now - SCORE_NOTICE_TTL_MS - SCORE_NOTICE_SWEEP_GRACE_MS).toISOString();
    const staleNotices = await db
      .collection(`${runPath}/${COLLECTIONS.ANNOUNCEMENTS}`)
      .where('active', '==', true)
      .where('createdAt', '<', noticeCutoff)
      .orderBy('createdAt', 'asc')
      .limit(LIVE_OPS_SWEEP_LIMIT)
      .get();
    for (const doc of staleNotices.docs) {
      // Only a score notice self-expires. A `kind:'announcement'` doc (or a
      // legacy doc with no `kind` at all, which the type says means
      // 'announcement') stays active however old it is — retiring one of those
      // WOULD be the "hid a live announcement mid-game" failure.
      if ((doc.data() as { kind?: string }).kind !== 'score') continue;
      batch.update(doc.ref, { active: false, deactivatedAt: nowIso });
      ops++;
    }

    // Flash missions. Their lifetime is a per-doc `expiresAt` (the TTL is caller
    // supplied), so there is no `createdAt` cutoff that would be correct for all
    // of them, and no index on (isActive, expiresAt) to range on. Instead we scan
    // the oldest still-active ones and expire in memory. That is self-limiting:
    // because this sweep retires them, the active set stays down to the handful
    // that are genuinely live, so the scan reads a handful too.
    const activeFlashes = await db
      .collection(`${runPath}/${COLLECTIONS.FLASH_MISSIONS}`)
      .where('isActive', '==', true)
      .orderBy('createdAt', 'asc')
      .limit(LIVE_OPS_SWEEP_LIMIT)
      .get();
    for (const doc of activeFlashes.docs) {
      const expiresAt = (doc.data() as { expiresAt?: unknown }).expiresAt;
      if (typeof expiresAt !== 'string') continue;
      const expiresMs = Date.parse(expiresAt);
      // An unparseable stamp is not proof of expiry — leave it live and let the
      // client keep deciding, same fail-open posture as the rest of the app.
      if (!Number.isFinite(expiresMs) || expiresMs > now) continue;
      batch.update(doc.ref, { isActive: false, deactivatedAt: nowIso });
      ops++;
    }

    if (ops > 0) await batch.commit();
  } catch (e) {
    functions.logger.warn('sweepStaleLiveOps skipped', { ownerUid, gameId, runId, err: String(e) });
  }
}


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

  // Opportunistic: retire anything that has outlived its own visibility rules, so
  // the banner just pushed isn't competing for a slot in the client's bounded
  // newest-first window with notices nobody is being shown. AFTER the write, so a
  // sweep failure can never cost the announcement itself (it also cannot throw).
  await sweepStaleLiveOps(ownerUid, gameId, runId);

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

  // Opportunistic sweep (see sweepStaleLiveOps): this is the write that most often
  // follows a batch of missions having quietly expired, so it is the cheapest
  // moment to retire them. Never throws; the mission above is already live.
  await sweepStaleLiveOps(ownerUid, gameId, runId);

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
  entry: {
    taskId: string; taskTitle: string; teamId: string; teamName: string; photoUrl: string;
    // run-media-gallery-and-video-feed: only ever 'video' in practice (a 'photo'
    // caller can simply omit it — absent already means photo on read).
    mediaKind?: MediaKind;
  },
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
      ...(entry.mediaKind && entry.mediaKind !== 'photo' ? { mediaKind: entry.mediaKind } : {}),
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


// Run membership shared by every feed callable (change: feed-ugc-safety
// refactor — reactToFeedItem and reportFeedItem had identical copy-pasted
// try/catch bodies; this is the single source of truth for both). A
// participant of THIS run (any attached device) is allowed and their teamId
// is returned; the owner and run-scoped staff are also allowed (returns
// undefined — they have no team); a stranger is denied. Authz semantics are
// IDENTICAL to the pre-refactor inline bodies.
async function assertRunMemberOrStaff(
  uid: string,
  context: functions.https.CallableContext,
  ctx: { ownerUid: string; gameId: string; runId: string },
): Promise<string | undefined> {
  try {
    const { teamId } = await resolveCallerTeam(uid, ctx);
    return teamId;
  } catch {
    assertStaffOrOwner(context, ctx.ownerUid, ctx.runId);
    return undefined;
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
  await assertRunMemberOrStaff(uid, context, { ownerUid, gameId, runId });

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


// ─── reportFeedItem (change: feed-ugc-safety) ──────────────────────────────────
// Any run participant (any device on any team), staff, or the owner may report a
// feed item from a closed reason set. Reports auto-hide an item at
// FEED_AUTO_HIDE_REPORTS distinct reporterKeys via the pure applyReport reducer.
//
// DESIGN AMENDMENT: reportedBy is keyed by the caller's **teamId**, not uid —
// shared team devices (multiple uids per team) would otherwise let one team
// reach the auto-hide threshold by itself. A staff/owner reporter (no team) is
// keyed by the sentinel `staff:<uid>`.
export const reportFeedItem = loggedCallable('reportFeedItem', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'reportFeedItem');
  const { ownerUid, gameId, runId, itemId, reason } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    itemId: string;
    reason: string;
  };
  if (!ownerUid || !gameId || !runId || !itemId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId, itemId required');
  }
  if (!(FEED_REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid report reason');
  }

  // Run membership: a participant of THIS run (any attached device) may report;
  // the owner and run-scoped staff may too. Strangers are denied. Resolve the
  // reporter's teamId for the distinctness key (see DESIGN AMENDMENT above); a
  // staff/owner reporter has no team, so falls back to the sentinel below.
  const teamId = await assertRunMemberOrStaff(uid, context, { ownerUid, gameId, runId });
  const reporterKey = teamId ?? `staff:${uid}`;

  const itemRef = db.doc(FIRESTORE_PATHS.feedItem(ownerUid, gameId, runId, itemId));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Feed item not found');
    const item = snap.data() as FeedItem;
    // Unlike reactToFeedItem, an already-inactive item still accepts reports —
    // reporting an item a rival already got auto-hidden must stay idempotent.
    const applied = applyReport(item, reporterKey, reason);
    // Whole nested map (never dotted .set({merge}) keys); scalars alongside.
    const update: Record<string, unknown> = {
      reportedBy: applied.reportedBy,
      reportCount: applied.reportCount,
      active: applied.active,
    };
    if (applied.hidden) {
      update.hiddenAt = applied.hiddenAt;
      update.hiddenBy = applied.hiddenBy;
    }
    tx.update(itemRef, update);
    return { reportCount: applied.reportCount, hidden: applied.hidden };
  });

  return { ok: true, ...result };
});


// ─── hideFeedItem (change: live-photo-feed) ────────────────────────────────────
// Moderation: staff/owner hides a feed item (listener filters active == true).
// Same shape as deactivateAnnouncement. `restore` (change: feed-ugc-safety)
// reverses an auto-hide (or a staff hide) and disarms future auto-hiding for
// this item via `reportsCleared` — authz stays identical for both directions.
export const hideFeedItem = loggedCallable('hideFeedItem', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
  const { ownerUid, gameId, runId, itemId, restore } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    itemId: string;
    restore?: boolean;
  };
  if (!itemId) throw new functions.https.HttpsError('invalid-argument', 'itemId required');

  const itemRef = db.doc(FIRESTORE_PATHS.feedItem(ownerUid, gameId, runId, itemId));
  if (restore) {
    await itemRef.update({
      active: true,
      hiddenAt: admin.firestore.FieldValue.delete(),
      hiddenBy: admin.firestore.FieldValue.delete(),
      reportsCleared: true,
    });
  } else {
    await itemRef.update({ active: false, hiddenAt: new Date().toISOString(), hiddenBy: context.auth!.uid });
  }

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
  // Staff hold (staff-console-field-ops) — before the code comparison, so a held
  // team cannot use this path as a code oracle while parked.
  assertTeamNotHeld(team);
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
        releaseAt?: string;
        releaseAfterMinutes?: number;
        expiresAfterMinutes?: number;
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

  // wave-h #2: an EXPIRED / not-yet-RELEASED smart_station is refused by its own
  // completion callable, exactly as completeTask does — the shared
  // completeTaskForTeam choke point never carried this gate, so each wrapper must.
  // Otherwise a station that expires WHILE a team holds it could still be scored by
  // POSTing the code afterward (or a scheduled station completed before its window).
  // Loads the run once, only when the task actually carries a schedule/expiry gate.
  if (stationTask.releaseAt || stationTask.releaseAfterMinutes || stationTask.expiresAfterMinutes) {
    const runSnap = await db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}`).get();
    const launchedAt = (runSnap.data() as { launchedAt?: string } | undefined)?.launchedAt;
    if (!isReleased(stationTask, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task is not available yet');
    }
    if (isExpired(stationTask, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task has expired');
    }
  }

  // wave-h #1: enforce the station's attemptLimit (mirrors submitTaskAnswer's cap at
  // runs/index.ts). The per team/task wrong-code count already lives in
  // team.taskAttempts[taskId] (incremented below); refuse once the cap is reached
  // BEFORE the compare — even a correct code is blocked once locked, so a short /
  // numeric secretCode can't be brute-forced. Previously the cap was only COUNTED
  // here, never enforced (a silent no-op vs the same control on a quiz).
  const stationAttemptLimit = stationTask.smart?.attemptLimit;
  if (stationAttemptLimit && stationAttemptLimit > 0) {
    const attempts = (team as { taskAttempts?: Record<string, number> }).taskAttempts?.[taskId] ?? 0;
    if (attemptLimitReached(attempts, stationAttemptLimit)) {
      throw new functions.https.HttpsError('resource-exhausted', 'No attempts left for this task');
    }
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
    // post-run-player-report: the wrong code is recorded too. Best-effort and
    // AFTER the attempt counter: a bookkeeping failure must not turn a wrong code
    // into a 500 — the participant still gets the same 'Incorrect code' refusal.
    await recordStationCodeAttempt(teamRef, taskId, code, false)
      .catch(() => { /* recording is never allowed to fail a submission */ });
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
  const { completed } = await completeTaskForTeam(
    ownerUid, gameId, runId, resolvedTeamId, taskId, now,
    // post-run-player-report: the accepted code rides the completion transaction
    // that already rewrites this stage — no extra read, no extra transaction.
    { answerLog: buildAnswerLogEntry({ kind: 'station_code', answer: code, correct: true, at: now }) },
  );
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
  // Staff hold (staff-console-field-ops) — a parked team cannot bank a submission.
  assertTeamNotHeld(team);
  // IDOR guard (auth-anticheat row 38): a participant may only submit for their
  // OWN team. A payload teamId that isn't the caller's team is rejected.
  if (teamId && teamId !== resolvedTeamId) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot act on another team');
  }
  // row 41: the photo must live under the caller's OWN run/team Storage folder
  // (not just any bucket URL) — scoped to runId + uid. Throws invalid-argument.
  // wave-c: against the Storage EMULATOR (dev + playtest tunnel) getDownloadURL()
  // returns an emulator-hosted /v0/b/<bucket>/o/<path> URL, not a production
  // firebasestorage.googleapis.com one — so this guard rejected EVERY real upload
  // locally ("the photo upload has never worked"). FUNCTIONS_EMULATOR is set only by
  // the Functions emulator and is absent in deployed functions, so production keeps
  // the exact old accept-set. The runs/{runId}/teams/{uid}/ prefix (the IDOR guard)
  // is enforced in both modes. See docs/wave-c/photo-upload-fix.md.
  validate(() => requireStorageUrl(photoUrl, runId, uid, storageOriginOpts()));

  // Check the task's smart config for autoApprove (staffless events). The same
  // snapshot also yields the task title + the photoFeedEnabled gate for the
  // live photo feed (live-photo-feed) — no extra read on this hot path.
  const gameSnap = await db.doc(`users/${ownerUid}/games/${gameId}`).get();
  let autoApprove = false;
  let taskTitle = '';
  let feedEnabled = true;
  // wave-f S1: the resolved task's hidden-location flag decides whether its
  // photo may enter the run-wide live feed (shouldFeedTask). Left undefined when
  // the task can't be resolved — shouldFeedTask then fails closed.
  let feedTask: FeedTaskVisibilityInput | undefined;
  // audio-tasks: the task's captureKind rides the SAME snapshot (no extra read).
  let kind: MediaKind = 'photo';
  // wave-h #3: the task's schedule/expiry gate rides the SAME snapshot too — no
  // extra read on the common (no-gate) path. Undefined when the task can't resolve.
  let scheduleGate: { releaseAt?: string; releaseAfterMinutes?: number; expiresAfterMinutes?: number } | undefined;
  if (gameSnap.exists) {
    const game = gameSnap.data() as {
      photoFeedEnabled?: boolean;
      stages: { tasks: { id: string; title?: string; hideLocation?: boolean; releaseAt?: string; releaseAfterMinutes?: number; expiresAfterMinutes?: number; smart?: { autoApprove?: boolean; captureKind?: MediaKind } }[] }[];
    };
    feedEnabled = game.photoFeedEnabled !== false;
    for (const stage of game.stages) {
      const task = stage.tasks.find((t) => t.id === taskId);
      if (task) {
        autoApprove = task.smart?.autoApprove === true;
        taskTitle = task.title ?? '';
        feedTask = { hideLocation: task.hideLocation };
        kind = task.smart?.captureKind === 'audio' || task.smart?.captureKind === 'video'
          ? task.smart.captureKind
          : 'photo';
        scheduleGate = { releaseAt: task.releaseAt, releaseAfterMinutes: task.releaseAfterMinutes, expiresAfterMinutes: task.expiresAfterMinutes };
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
  // wave-h #3: an EXPIRED / not-yet-RELEASED photo task is refused, same gate as
  // completeTask/verifyStationCode (the shared completeTaskForTeam choke point never
  // carried it). Placed here so the existing stage-active / idempotency / slot
  // guards are untouched; loads the run once, only when the task is actually gated.
  if (scheduleGate && (scheduleGate.releaseAt || scheduleGate.releaseAfterMinutes || scheduleGate.expiresAfterMinutes)) {
    const runSnap = await db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}`).get();
    const launchedAt = (runSnap.data() as { launchedAt?: string } | undefined)?.launchedAt;
    if (!isReleased(scheduleGate, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task is not available yet');
    }
    if (isExpired(scheduleGate, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task has expired');
    }
  }
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
    // audio-tasks: audio submissions never enter the feed. video-submission-task
    // (change: run-media-gallery-and-video-feed): video now DOES, on the same
    // terms as photo — this stays an ALLOWLIST (photo, video), not a deny-list,
    // so a future capture kind still cannot leak into the feed just by not being
    // named here.
    // WO Fix 4: gated on `completed` (like the sibling releaseTask) so a duplicate
    // autoApprove submission — which returns completed:false — cannot flood the feed.
    // wave-f S1: a HIDDEN-LOCATION task is excluded from the feed entirely — its
    // photo (taken AT the secret spot) would leak the location to teams still
    // hunting it, defeating the wave-D hidden-task gating.
    if (completed && feedEnabled && (kind === 'photo' || kind === 'video') && shouldFeedTask(feedTask)) {
      await writeFeedItem(ownerUid, gameId, runId, {
        taskId,
        taskTitle,
        teamId: resolvedTeamId,
        teamName: team.displayName ?? '',
        photoUrl: photoUrl.trim(),
        mediaKind: kind,
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
        stages?: { tasks: { id: string; title?: string; hideLocation?: boolean }[] }[];
      } | undefined;
      if (game && game.photoFeedEnabled !== false) {
        let taskTitle = '';
        // wave-f S1: same hidden-location feed-exclusion decision as the
        // submitStationPhoto autoApprove path — shared via shouldFeedTask so the
        // two write sites cannot diverge. Undefined ⇒ fails closed.
        let feedTask: FeedTaskVisibilityInput | undefined;
        for (const stage of game.stages ?? []) {
          const task = stage.tasks.find((t) => t.id === taskId);
          if (task) { taskTitle = task.title ?? ''; feedTask = { hideLocation: task.hideLocation }; break; }
        }
        const teamData = (await teamRef.get()).data() as {
          displayName?: string;
          taskSubmissions?: Record<string, { photoUrl?: string; mediaKind?: MediaKind }>;
        } | undefined;
        const submission = teamData?.taskSubmissions?.[taskId];
        const submittedPhotoUrl = submission?.photoUrl;
        // audio-tasks: audio submissions never enter the feed. video-submission-task
        // (change: run-media-gallery-and-video-feed): video now DOES, on the same
        // allowlist as the autoApprove site above. An absent mediaKind is a
        // pre-audio-tasks record, which could only have been a photo.
        // WO Fix 4: gated on `completed` — a re-approval of an already-completed
        // task returns completed:false and must not re-emit a feed item.
        // wave-f S1: a HIDDEN-LOCATION task is excluded from the feed entirely
        // (photo would leak the secret spot to teams still hunting it).
        const submissionKind = submission?.mediaKind ?? 'photo';
        if (completed && submittedPhotoUrl && (submissionKind === 'photo' || submissionKind === 'video') && shouldFeedTask(feedTask)) {
          await writeFeedItem(ownerUid, gameId, runId, {
            taskId,
            taskTitle,
            teamId,
            teamName: teamData?.displayName ?? '',
            photoUrl: submittedPhotoUrl,
            mediaKind: submissionKind,
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
    const teamData = teamSnap.data() as { bonusPenalty?: number; score?: number };
    const p = teamData.bonusPenalty ?? 0;
    const np = nextBonusPenalty(p, delta);
    tx.update(teamRef, {
      bonusPenalty: np,
      // DISPLAY channel: team.score is what the participant's own PlayScreen
      // header + StaffConsole show DIRECTLY (getMyTeamState returns the raw
      // team doc, not a ranking). buildRankings ignores team.score and derives
      // the ranked score from bonusPenalty instead, so bumping both here can't
      // double-count on the leaderboard/final board — it only keeps the
      // player's own live score badge from silently freezing until finalizeRun.
      score: (teamData.score ?? 0) + delta,
      updatedAt: new Date().toISOString(),
    });
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

  // This callable is the ONLY producer of `kind:'score'` notices, so it is also
  // the natural place to retire the ones that have aged out — a run where staff
  // adjust scores repeatedly is exactly the run where the notices accumulate.
  // Runs after the notice write and, like it, cannot throw.
  await sweepStaleLiveOps(ownerUid, gameId, runId);

  // The operator expects the adjustment on the board NOW — forced (unthrottled)
  // refresh; still skipped for a frozen board and best-effort like the notice.
  await maybeRefreshLeaderboardSnapshot(ownerUid, gameId, runId, { force: true });

  return { ok: true, newBonusPenalty: newPenalty };
});


// ─── setRunTaskStatus (change: live-task-pause) ───────────────────────────────
// Take ONE task out of play for ONE live run, or put it back. `Task.status`
// (StationStatus) was already enforced by routing in three places and written by
// nothing, so when a stop died mid event (shop closed, street blocked, host gone,
// weather) the organizer could only keep routing teams to it or end the run.
//
// RUN scoped on purpose: the override lives on the run document, never on the game
// template, because the template is replayed by later runs, duplicated, exported and
// published to the gallery, and is rewritten wholesale by the Builder. See
// openspec/changes/live-task-pause/design.md D1.
//
// A team already HOLDING the task keeps it: the override is read by the assignment
// filters only, never by the completion path, so a team standing at the station
// finishes and scores it (D2). The response reports how many teams that is.
export const setRunTaskStatus = loggedCallable('setRunTaskStatus', async (data, context) => {
  assertStaffOrOwner(context, (data as { ownerUid: string }).ownerUid, (data as { runId?: string }).runId);
  const { ownerUid, gameId, runId, taskId, status, reason, force } = data as {
    ownerUid: string;
    gameId: string;
    runId: string;
    taskId: string;
    status: StationStatus;
    reason?: string;
    force?: boolean;
  };

  const ids = validate(() => ({
    gameId: requireString(gameId, 'gameId', 200),
    runId: requireString(runId, 'runId', 200),
    taskId: requireString(taskId, 'taskId', 200),
  }));
  if (!isStationStatus(status)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `status must be one of ${LIVE_TASK_STATUSES.join(', ')}`,
    );
  }
  const cleanReason = validate(() => optionalString(reason, 'reason', MAX_MESSAGE_LEN)) ?? '';

  const runRef = db.doc(`users/${ownerUid}/games/${ids.gameId}/runs/${ids.runId}`);
  const [gameSnap, runSnap] = await Promise.all([
    db.doc(`users/${ownerUid}/games/${ids.gameId}`).get(),
    runRef.get(),
  ]);
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const game = gameSnap.data() as { stages?: { id: string; title?: string; requiredTaskCount?: number; tasks?: Task[] }[] };
  const run = runSnap.data() as { taskStatusOverrides?: TaskStatusOverrides };

  const stage = (game.stages ?? []).find((s) => (s.tasks ?? []).some((t) => t?.id === ids.taskId));
  if (!stage) throw new functions.https.HttpsError('not-found', 'Task not found in this game');
  const task = (stage.tasks ?? []).find((t) => t?.id === ids.taskId)!;

  // How many teams are on it RIGHT NOW. Reported, never acted on: this call must
  // not revoke a task from a team that already walked to the stop.
  let teamsHolding = 0;
  try {
    const holders = await db
      .collection(`users/${ownerUid}/games/${ids.gameId}/runs/${ids.runId}/teams`)
      .where('activeTaskId', '==', ids.taskId)
      .select()
      .get();
    teamsHolding = holders.size;
  } catch (e) {
    // A count is informational; never fail the operator's action over it.
    logBestEffort('setRunTaskStatus.holders', { gameId: ids.gameId, runId: ids.runId, taskId: ids.taskId }, e);
  }

  const plan = planTaskStatusChange({
    taskId: ids.taskId,
    stage: { tasks: stage.tasks ?? [], requiredTaskCount: stage.requiredTaskCount },
    overrides: run.taskStatusOverrides,
    next: status,
    teamsHolding,
  });
  if (!plan.ok) {
    // emptyStage / taskNotInStage are structural; unknownStatus was screened above.
    throw new functions.https.HttpsError('failed-precondition', `Cannot change this task: ${plan.reason}`);
  }

  // The organizer learns about a dead-ended stage HERE, not through stuck teams.
  // Same rule and the same quantity the Builder reports as `stageUnwinnable`.
  if (plan.stageUnwinnable && force !== true) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pausing this task would leave the stage with fewer available tasks than it requires',
      {
        code: 'stageUnwinnable',
        availableCount: plan.availableAfter,
        requiredCount: plan.requiredCount,
        stageTitle: stage.title ?? '',
        taskTitle: task.title ?? '',
      },
    );
  }

  // Whole-map write inside a transaction. Deliberately NOT a dotted path: task ids
  // are opaque strings and this repo has been bitten by dotted-key writes twice.
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(runRef);
    if (!cur.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
    const overrides = { ...((cur.data() as { taskStatusOverrides?: TaskStatusOverrides }).taskStatusOverrides ?? {}) };
    overrides[ids.taskId] = status;
    tx.update(runRef, { taskStatusOverrides: overrides, updatedAt: new Date().toISOString() });
  });

  // Durable, like adjustTeamScore: taking a task out of play changes what every
  // team in the run can score.
  await writeAuditLog({
    ownerUid, gameId: ids.gameId, runId: ids.runId,
    operatorId: context.auth!.uid,
    actionType: 'task_status_changed',
    previousValue: plan.from,
    newValue: plan.to,
    reason: cleanReason,
    taskId: ids.taskId,
    taskTitle: task.title ?? '',
    forced: plan.stageUnwinnable === true,
  });

  return {
    ok: true,
    taskId: ids.taskId,
    status: plan.to,
    previousStatus: plan.from,
    noop: plan.noop,
    teamsHolding: plan.teamsHolding,
    availableCount: plan.availableAfter,
    requiredCount: plan.requiredCount,
    stageUnwinnable: plan.stageUnwinnable,
  };
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
