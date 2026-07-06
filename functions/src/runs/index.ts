// ─── Run management callables ─────────────────────────────────────────────────
//
// A Run is a live instance of a Game. The flow:
//   Owner calls launchRun → gets accessCode
//   Participants call joinRun(code) → registered as RunTeam
//   Owner calls startRun → all launched:true, timers start
//   As teams complete tasks → requestNextTask, verifyStationCode, etc.
//   Owner calls finalizeRun → scores computed, leaderboard written

import { randomInt, randomBytes } from 'node:crypto';
import * as functions from 'firebase-functions';
import { loggedCallable, logBestEffort } from '../obs/log';
import { enforceRateLimit } from '../rateLimitStore';
import { db } from '../firebase';
import * as admin from 'firebase-admin';
import {
  type Game,
  type Task,
  type Run,
  type RunTeam,
  type RunStageRecord,
  type RunTaskRecord,
  type AccessCode,
  type LeaderboardEntry,
  type StageStatus,
  type Wallet,
  FREE_PARTICIPANTS_PER_FREE_RUN,
  PAYMENTS_ENABLED,
  resolveLaunchBilling,
  describeGameRequirements,
  normalizeTriggerMode,
  evaluateTrigger,
  attemptLimitReached,
  matchesTaskAnswer,
  hotZoneMultiplier,
  isWithinPoiRadius,
  matchesDiscoveryAnswer,
  isPoiAlreadyClaimed,
  toDiscoveryPoiResult,
  type DiscoveryPoi,
  buildRunRecap,
  buildRunTimeline,
  computeRunAnalytics,
  buildMovementDensity,
  mergePlayerResult,
  emptyProfile,
  type PlayerProfile,
  canPickUp,
  canDrop,
  type Trackable,
  isWithinZone,
  canCapture,
  type CaptureZone,
  mergeBenchmark,
  median,
  type BenchmarkAggregate,
  isConsentSatisfied,
  haversineKm,
  isValidCoord,
  isReleased,
  releaseInstantMs,
} from '@rushpoint/shared';
import {
  scoreFixedPointsSpeed,
  scoreSmartWeighted,
  durationSeconds,
  applyCompletionBonus,
  applyPenalties,
  applyZScoreBonus,
  skipAward,
  taskScoreFixed,
  taskScoreSmart,
  COMPLETION_BONUS,
} from '@rushpoint/shared';
import { requireString, MAX_ID_LEN } from '@rushpoint/shared';
import { assignTask, releaseTask, computeSkillRatio, buildRecommendations } from '../routing/assignNextTask';
import { sanitizeTaskForParticipant } from './sanitizeTask';
import {
  assertController, resolveDeviceRole, generateDeviceJoinCode, canAttachDevice,
  attachedDeviceUids, controllerUidOf,
} from './teamDevices';
import type { RunFeedback } from '@rushpoint/shared';
import { validateFeedbackPayload, computeFeedbackSummary } from './feedbackSummary';
import { validate } from '../validation';

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}

function gamePath(ownerUid: string, gameId: string) {
  return `users/${ownerUid}/games/${gameId}`;
}
function runPath(ownerUid: string, gameId: string, runId: string) {
  return `users/${ownerUid}/games/${gameId}/runs/${runId}`;
}
function teamPath(ownerUid: string, gameId: string, runId: string, teamId: string) {
  return `users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${teamId}`;
}
function teamsCol(ownerUid: string, gameId: string, runId: string) {
  return `users/${ownerUid}/games/${gameId}/runs/${runId}/teams`;
}

// ─── Code generation ──────────────────────────────────────────────────────────

function generateCode(len = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars
  let code = '';
  // Cryptographic RNG so access codes aren't guessable (anti-cheat row 40).
  for (let i = 0; i < len; i++) code += chars[randomInt(chars.length)];
  return code;
}

async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const snap = await db.doc(`accessCodes/${code}`).get();
    if (!snap.exists) return code;
  }
  throw new functions.https.HttpsError('internal', 'Could not generate unique code');
}

// ─── Build initial stage records from game template ───────────────────────────

function buildInitialStages(game: Game): RunStageRecord[] {
  return game.stages
    .sort((a, b) => a.order - b.order)
    .map((stage, idx) => ({
      stageId: stage.id,
      order: stage.order,
      status: (idx === 0 ? 'active' : 'locked') as StageStatus,
      // Clamp to [1, tasks.length]; undefined means "all tasks".
      requiredTaskCount:
        stage.requiredTaskCount != null
          ? Math.max(1, Math.min(stage.requiredTaskCount, stage.tasks.length))
          : undefined,
      tasks: stage.tasks.map((task, tIdx) => ({
        taskId: task.id,
        taskIndex: tIdx,
        status: 'unassigned' as const,
      })),
    }));
}

// ─── launchRun ────────────────────────────────────────────────────────────────

export const launchRun = loggedCallable('launchRun', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  if (game.ownerUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your game');
  if (game.stages.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Game has no stages — add at least one stage before launching');
  }

  const code = await uniqueCode();
  const now = new Date().toISOString();
  const runRef = db.collection(`users/${uid}/games/${gameId}/runs`).doc();
  const walletRef = db.doc(`wallets/${uid}`);

  const accessCodeRef = db.doc(`accessCodes/${code}`);
  // Build the run + access-code docs once a billing decision is known.
  const buildRun = (billingType: Run['billingType'], maxParticipants: number): Run => ({
    id: runRef.id, gameId, ownerUid: uid, status: 'live', accessCode: code,
    billingType, maxParticipants, participantCount: 0,
    launchedAt: now, createdAt: now, updatedAt: now,
  });
  const accessCode: AccessCode = { code, ownerUid: uid, gameId, runId: runRef.id, status: 'unused', createdAt: now };

  // ── Billing + run creation are ATOMIC (row 43): the run + access code are
  //    written in the SAME transaction that consumes the credit, so a write
  //    failure can never burn a paid credit without producing a run. The decision
  //    (pro / free-run / credit / refuse) is the pure resolveLaunchBilling helper.
  //    Free mode (PAYMENTS_ENABLED === false) touches the wallet not at all. ──
  if (!PAYMENTS_ENABLED) {
    const free = resolveLaunchBilling(false, {});
    const billingType = free.ok ? free.billingType : 'free';
    const maxParticipants = free.ok ? free.maxParticipants : FREE_PARTICIPANTS_PER_FREE_RUN;
    const batch = db.batch();
    batch.set(runRef, buildRun(billingType, maxParticipants));
    batch.set(accessCodeRef, accessCode);
    await batch.commit();
  } else {
    await db.runTransaction(async (t) => {
      const wSnap = await t.get(walletRef);
      const w = (wSnap.exists ? wSnap.data() : {}) as Partial<Wallet>;
      // row 44: Pro counts only while the subscription is unexpired. An expired
      // proExpiresAt is treated as a free plan for the billing decision.
      const proActive = w.plan === 'pro' && !!w.proExpiresAt && new Date(w.proExpiresAt).getTime() > Date.now();
      const decision = resolveLaunchBilling(true, { ...w, plan: proActive ? 'pro' : 'free' });
      if (!decision.ok) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'No Event Credits left. Buy a credit package or upgrade to Creator Pro to launch this run.',
        );
      }
      if (decision.consume === 'free_run') {
        t.set(walletRef, {
          uid, lifetimeFreeRunsUsed: admin.firestore.FieldValue.increment(1), updatedAt: now,
        }, { merge: true });
        const txRef = walletRef.collection('transactions').doc();
        t.set(txRef, {
          id: txRef.id, type: 'free_run_consumed', runId: runRef.id, gameTitle: game.title,
          description: `Free run — ${game.title}`, createdAt: now,
        });
      } else if (decision.consume === 'credit') {
        t.set(walletRef, {
          uid, eventCredits: admin.firestore.FieldValue.increment(-1), updatedAt: now,
        }, { merge: true });
        const txRef = walletRef.collection('transactions').doc();
        t.set(txRef, {
          id: txRef.id, type: 'charge_event', runId: runRef.id, gameTitle: game.title,
          creditCost: 1, maxParticipantsPerRun: decision.maxParticipants,
          description: `1 Event Credit — ${game.title}`, createdAt: now,
        });
      }
      // Same transaction → run + access code commit atomically with the charge.
      t.set(runRef, buildRun(decision.billingType, decision.maxParticipants));
      t.set(accessCodeRef, accessCode);
    });
  }

  // Increment game.playCount (best-effort, outside the atomic launch).
  db.doc(gamePath(uid, gameId)).update({ playCount: admin.firestore.FieldValue.increment(1) }).catch((e) => logBestEffort('game.playCount.increment', { gameId }, e));

  return { runId: runRef.id, accessCode: code };
});


// ─── getJoinInfo ──────────────────────────────────────────────────────────────
// Client-safe lookup before joining: given an access code, return the game's
// title, branding, mode, and registration fields so the join form can render.

export const getJoinInfo = loggedCallable('getJoinInfo', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'getJoinInfo');
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (c.status === 'revoked') throw new functions.https.HttpsError('permission-denied', 'Code revoked');

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;

  return {
    context: { ownerUid: c.ownerUid, gameId: c.gameId, runId: c.runId },
    title: game.title,
    description: game.description ?? '',
    mode: game.mode,
    branding: game.branding ?? null,
    registrationFields: game.registrationFields,
    runStatus: run?.status ?? 'live',
    // Accurate GPS requirement derived from the game's task trigger modes.
    requirement: describeGameRequirements(game),
  };
});


// ─── joinRun ─────────────────────────────────────────────────────────────────

export const joinRun = loggedCallable('joinRun', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const teamId = context.auth.uid;
  await enforceRateLimit(teamId, 'joinRun');

  const { code, displayName, registrationData = {}, memberNames = [] } = data as {
    code: string;
    displayName: string;
    registrationData?: Record<string, unknown>;
    memberNames?: string[];
  };

  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');
  if (!displayName?.trim()) throw new functions.https.HttpsError('invalid-argument', 'displayName required');

  // Anti-griefing / DoS: bound the untrusted join payload. displayName + each
  // member name are length-capped; the member list and the free-form
  // registrationData blob are size-capped so a client can't write a huge doc.
  validate(() => requireString(displayName, 'displayName', MAX_ID_LEN));
  if (!Array.isArray(memberNames) || memberNames.length > 30) {
    throw new functions.https.HttpsError('invalid-argument', 'Too many member names (max 30)');
  }
  memberNames.forEach((n, i) => validate(() => requireString(n, `memberNames[${i}]`, MAX_ID_LEN)));
  if (registrationData && JSON.stringify(registrationData).length > 4000) {
    throw new functions.https.HttpsError('invalid-argument', 'registrationData too large');
  }

  const normalizedCode = code.trim().toUpperCase();
  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const codeData = codeSnap.data() as AccessCode;
  if (codeData.status === 'revoked') {
    throw new functions.https.HttpsError('permission-denied', 'This code has been revoked');
  }

  const { ownerUid, gameId, runId } = codeData;
  const runRef = db.doc(runPath(ownerUid, gameId, runId));
  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;

  // Idempotent: team already registered in this run
  const existingTeam = await db.doc(teamPath(ownerUid, gameId, runId, teamId)).get();
  if (existingTeam.exists) {
    return { teamId, runId, gameId, ownerUid, alreadyJoined: true };
  }

  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = runSnap.data() as Run;

  // Can't join a race that's already over.
  if (run.status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This race has already finished.');
  }

  const now = new Date().toISOString();
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, teamId));
  const team: RunTeam = {
    id: teamId,
    runId,
    gameId,
    ownerUid,
    displayName: displayName.trim(),
    registrationData,
    memberNames,
    memberCount: game.mode === 'team' ? (memberNames.length || 1) : 1,
    status: 'registered',
    stages: buildInitialStages(game),
    score: 0,
    bonusPenalty: 0,
    launched: false,
    activeTaskId: null,
    // Shared team devices: the founding phone is the sole device + controller;
    // teammates attach their own phones via joinTeamAsDevice with this code.
    deviceUids: [teamId],
    controllerUid: teamId,
    deviceJoinCode: generateDeviceJoinCode(),
    devices: [{ uid: teamId, name: displayName.trim(), joinedAt: now }],
    updatedAt: now,
  };

  // Capacity is a hard ceiling fixed at launch (free run = 5, credit = package
  // size, Pro = 50). Enforced inside a transaction so concurrent joins can't
  // overshoot the cap. No per-participant billing — the run was already paid for.
  const joined = await db.runTransaction<{ already: boolean }>(async (t) => {
    const [runFresh, teamFresh] = await Promise.all([t.get(runRef), t.get(teamRef)]);
    if (teamFresh.exists) return { already: true };
    const r = runFresh.data() as Run;
    const used = r.participantCount ?? r.freeParticipantsUsed ?? 0;
    const cap = r.maxParticipants ?? FREE_PARTICIPANTS_PER_FREE_RUN;
    if (used >= cap) {
      const msg = r.billingType === 'free'
        ? `This free run is full (${cap} participants max). The host can add an Event Credit or go Pro for more.`
        : `This run is full (${cap} participants max).`;
      throw new functions.https.HttpsError('resource-exhausted', msg, { cap, used });
    }
    t.set(teamRef, team);
    t.update(runRef, { participantCount: used + 1, updatedAt: now });
    return { already: false };
  });

  return { teamId, runId, gameId, ownerUid, alreadyJoined: joined.already };
});


// ─── startTeams ───────────────────────────────────────────────────────────────
// Owner launches all (or specific) registered teams.

export const startTeams = loggedCallable('startTeams', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, teamIds } = data as { gameId: string; runId: string; teamIds?: string[] };

  if (!gameId || !runId) throw new functions.https.HttpsError('invalid-argument', 'gameId and runId required');

  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = gameSnap.data() as Game;

  const now = new Date().toISOString();
  const teamsSnap = await db.collection(teamsCol(uid, gameId, runId)).get();

  const targets = teamsSnap.docs.filter((d) => {
    const t = d.data() as RunTeam;
    if (t.launched || (teamIds && !teamIds.includes(t.id))) return false;
    // Guardian-consent gate (guardian-consent-qr): a minor's team is held in
    // pending-consent and cannot start until a guardian has approved.
    if (!isConsentSatisfied(t, game)) return false;
    return true;
  });

  const batch = db.batch();
  for (const doc of targets) {
    const stages = (doc.data() as RunTeam).stages.map((s, i) => ({
      ...s,
      ...(i === 0 ? { startedAt: now } : {}),
    }));
    batch.update(doc.ref, { launched: true, startedAt: now, status: 'active', stages, updatedAt: now });
  }
  await batch.commit();

  // Assign the first task of the active stage for each launched team. Delegated
  // to assignNextInActiveStage so single- vs multi-task routing — and the
  // full-array write that avoids array→map corruption — lives in one place.
  if (game.stages.length > 0) {
    for (const doc of targets) {
      await assignNextInActiveStage(uid, gameId, runId, doc.id, { lat: 31.7905, lng: 35.164 }, now);
    }
  }

  return { launched: targets.length };
});


// ─── Guardian consent (change: guardian-consent-qr) ────────────────────────────
// A minor's team requests a single-use consent token; a guardian opens the link
// and approves; only then can the team be started. Consent is server-recorded and
// not self-approvable by the child (the token is the authorization).

export const requestGuardianConsent = loggedCallable('requestGuardianConsent', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'requestGuardianConsent');
  const { ownerUid, gameId, runId, teamId } = data as {
    ownerUid: string; gameId: string; runId: string; teamId?: string;
  };
  if (!ownerUid || !gameId || !runId) throw new functions.https.HttpsError('invalid-argument', 'run context required');
  // IDOR: a team may only request consent for itself.
  if (teamId && teamId !== uid) throw new functions.https.HttpsError('permission-denied', 'Cannot act on another team');

  const token = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  await db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/consentTokens/${token}`).set({
    token, teamId: uid, used: false, createdAt: now,
  });
  return { token };
});

export const grantGuardianConsent = loggedCallable('grantGuardianConsent', async (data, context) => {
  requireAuth(context); // any authed device (the guardian's), authorized by the token
  const { ownerUid, gameId, runId, token, guardianName } = data as {
    ownerUid: string; gameId: string; runId: string; token: string; guardianName?: string;
  };
  if (!ownerUid || !gameId || !runId || !token) throw new functions.https.HttpsError('invalid-argument', 'token + run context required');

  const tokenRef = db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/consentTokens/${token}`);
  const now = new Date().toISOString();
  const name = (guardianName ?? '').toString().slice(0, 120) || null;

  const teamId = await db.runTransaction(async (t) => {
    const snap = await t.get(tokenRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invalid consent token');
    const rec = snap.data() as { teamId: string; used: boolean };
    if (rec.used) throw new functions.https.HttpsError('failed-precondition', 'Consent token already used');
    t.update(tokenRef, { used: true, guardianName: name, grantedAt: now });
    t.set(
      db.doc(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${rec.teamId}`),
      { guardianConsent: { guardianName: name, grantedAt: now } },
      { merge: true },
    );
    return rec.teamId;
  });
  return { ok: true, teamId };
});


// ─── completeTask ─────────────────────────────────────────────────────────────
// Called (server-side, by verify/photo callables) when a task is verified.
// Scores the task, advances the stage, unlocks the next stage if all tasks done.

export async function completeTaskForTeam(
  ownerUid: string,
  gameId: string,
  runId: string,
  teamId: string,
  taskId: string,
  now: string,
): Promise<void> {
  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  const game = gameSnap.data() as Game;
  // Hot Zone (if any) is read-only here — used to multiply the earned score for
  // completions inside the zone+window (hot-zone-bonus). Server-decided.
  const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  const runData = runSnap.data() as Run | undefined;
  const hotZone = runData?.hotZone;
  const launchedAt = runData?.launchedAt;
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, teamId));

  await db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) return;
    const team = teamSnap.data() as RunTeam;

    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));

    // Find the task
    let stageIdx = -1, taskIdx = -1;
    for (let si = 0; si < stages.length; si++) {
      const ti = stages[si].tasks.findIndex((t) => t.taskId === taskId);
      if (ti >= 0) { stageIdx = si; taskIdx = ti; break; }
    }
    if (stageIdx < 0) return;

    const taskRec = stages[stageIdx].tasks[taskIdx];
    if (taskRec.status === 'completed') return; // idempotent

    const startedAt = taskRec.startedAt ?? team.startedAt ?? now;
    const actualMinutes = (new Date(now).getTime() - new Date(startedAt).getTime()) / 60_000;

    // Score this task. Look up the game task by id (not by [stageIdx][taskIdx]):
    // team.stages is order-sorted while game.stages is stored in the builder's
    // array order, so the two index spaces can diverge and score the wrong task.
    const gameTask = findGameTask(game, taskId);
    let earnedScore = 0;
    if (gameTask) {
      switch (game.scoringPreset) {
        case 'time_only':
          earnedScore = 0;
          break;
        case 'fixed_points_speed':
          earnedScore = taskScoreFixed(gameTask);
          break;
        case 'smart_weighted':
          earnedScore = taskScoreSmart(gameTask.difficulty, actualMinutes, gameTask.estimatedMinutes);
          break;
      }
    }

    // Hot Zone bonus: multiply if this task's (server-stored) location is inside
    // the active zone+window. Locationless / null-island tasks pass null → ×1.
    const taskCoords = gameTask?.smart?.stationCoords ?? gameTask?.coordinates;
    const validCoords = taskCoords && (taskCoords.lat !== 0 || taskCoords.lng !== 0) ? taskCoords : null;
    const multiplier = hotZoneMultiplier(hotZone, validCoords, new Date(now).getTime());
    const baseScore = earnedScore;
    if (multiplier !== 1) earnedScore = Math.round(earnedScore * multiplier);

    taskRec.status = 'completed';
    taskRec.completedAt = now;
    taskRec.actualMinutes = actualMinutes;
    taskRec.earnedScore = earnedScore;
    taskRec.scoreBreakdown = multiplier !== 1
      ? { taskScore: baseScore, hotZoneMultiplier: multiplier, total: earnedScore }
      : { taskScore: earnedScore, total: earnedScore };

    // Stage completion: a stage may require only a SUBSET of its tasks
    // (requiredTaskCount). It's done when that many are completed, OR when no
    // task remains to do. When it finishes early, the leftover tasks are
    // auto-skipped for this team so they aren't routed again.
    const completedCount = stages[stageIdx].tasks.filter((t) => t.status === 'completed').length;
    const required = Math.min(
      stages[stageIdx].requiredTaskCount ?? stages[stageIdx].tasks.length,
      stages[stageIdx].tasks.length,
    );
    const allTerminal = stages[stageIdx].tasks.every((t) => t.status === 'completed' || t.status === 'skipped');
    const stageDone = completedCount >= required || allTerminal;
    if (stageDone) {
      // Auto-skip any tasks the team didn't need to do.
      for (const t of stages[stageIdx].tasks) {
        if (t.status !== 'completed') t.status = 'skipped';
      }
      stages[stageIdx].status = 'completed';
      stages[stageIdx].completedAt = now;
      stages[stageIdx].earnedScore = stages[stageIdx].tasks.reduce((s, t) => s + (t.earnedScore ?? 0), 0);

      // Check if final stage (triggers Final Run)
      const isLastStage = game.stages.find((s) => s.id === stages[stageIdx].stageId)?.isFinal ?? (stageIdx === stages.length - 1);

      // Unlock next stage if not final — UNLESS it has a scheduled-release gate
      // that hasn't opened yet (change: scheduled-release). A gated next stage
      // stays `locked`; a later requestNextTask/getMyTeamState poll unlocks it
      // once its gate opens (see computeStageUnlock).
      if (!isLastStage && stageIdx + 1 < stages.length) {
        const nextGameStage = game.stages.find((s) => s.id === stages[stageIdx + 1].stageId);
        if (isReleased(nextGameStage, launchedAt, new Date(now).getTime())) {
          stages[stageIdx + 1].status = 'active';
          stages[stageIdx + 1].startedAt = now;
        }
      }
    }

    const allDone = stages.every((s) => s.status === 'completed');
    const newScore = (team.score ?? 0) + earnedScore;

    tx.update(teamRef, {
      stages,
      score: newScore,
      ...(allDone ? { status: 'finished', finishedAt: now } : {}),
      activeTaskId: null,
      updatedAt: now,
    });
  });
}

// Read-modify-write a player's cross-run profile (change: player-profile-badges).
// Server-only (players/{uid} is CF-write-only); transactional so concurrent finishes
// on the same device don't clobber each other. Called from finalizeRun (batch), NOT
// the hot completeTask path — one profile write per team at run finalize.
async function recordPlayerResult(
  r: { uid: string; displayName?: string; tasksCompleted: number; points: number },
): Promise<void> {
  const ref = db.doc(`players/${r.uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as PlayerProfile) : null;
    const { profile } = mergePlayerResult(prev, r);
    tx.set(ref, { ...profile, updatedAt: new Date().toISOString() }, { merge: true });
  });
}


// ─── skipStage ────────────────────────────────────────────────────────────────

export const skipStage = loggedCallable('skipStage', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, teamId } = data as { gameId: string; runId: string; teamId: string };

  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = gameSnap.data() as Game;
  const teamRef = db.doc(teamPath(uid, gameId, runId, teamId));
  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = teamSnap.data() as RunTeam;
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));

    const activeIdx = stages.findIndex((s) => s.status === 'active');
    if (activeIdx < 0) throw new functions.https.HttpsError('failed-precondition', 'No active stage');

    // Skip all pending tasks with a fair award
    let awardTotal = 0;
    for (const taskRec of stages[activeIdx].tasks) {
      if (taskRec.status !== 'completed') {
        const gameTask = game.stages[activeIdx]?.tasks[taskRec.taskIndex];
        const award = gameTask ? skipAward(game.scoringPreset, gameTask) : 0;
        taskRec.status = 'skipped';
        taskRec.completedAt = now;
        taskRec.earnedScore = award;
        awardTotal += award;
      }
    }
    stages[activeIdx].status = 'completed';
    stages[activeIdx].completedAt = now;
    stages[activeIdx].earnedScore = (stages[activeIdx].earnedScore ?? 0) + awardTotal;

    if (activeIdx + 1 < stages.length) {
      stages[activeIdx + 1].status = 'active';
      stages[activeIdx + 1].startedAt = now;
    }
    const allDone = stages.every((s) => s.status === 'completed');

    tx.update(teamRef, {
      stages,
      score: (team.score ?? 0) + awardTotal,
      ...(allDone ? { status: 'finished', finishedAt: now } : {}),
      activeTaskId: null,
      updatedAt: now,
    });
  });

  return { ok: true };
});


// ─── finalizeRun ─────────────────────────────────────────────────────────────
// Owner ends the run. Scores all teams, applies Z-Score if preset ≠ time_only,
// writes the leaderboard onto the Run doc.

// Compute ranked standings for a run from the current team state. Used by both
// finalizeRun (terminal) and refreshLeaderboard (live, mid-run) so the two can
// never drift. `now` is the reference time for not-yet-finished teams.
export function buildRankings(game: Game, teams: RunTeam[], now: string): LeaderboardEntry[] {
  type ScoredTeam = LeaderboardEntry & { durationMin: number };
  const scored: ScoredTeam[] = teams.map((team) => {
    let rawScore = 0;

    switch (game.scoringPreset) {
      case 'time_only':
        rawScore = 0;
        break;
      case 'fixed_points_speed':
        rawScore = scoreFixedPointsSpeed(team.stages, team.startedAt, team.finishedAt ?? now, game);
        break;
      case 'smart_weighted':
        rawScore = scoreSmartWeighted(team.stages);
        break;
    }

    rawScore = applyCompletionBonus(rawScore, team.stages);
    rawScore = applyPenalties(rawScore, team.bonusPenalty);

    const durSec = durationSeconds(team.startedAt, team.finishedAt ?? now);
    return {
      rank: 0,
      teamId: team.id,
      teamName: team.displayName,
      score: rawScore,
      completedStages: team.stages.filter((s) => s.status === 'completed').length,
      finishedAt: team.finishedAt,
      durationSeconds: durSec,
      totalMinutes: durSec / 60,
      durationMin: durSec / 60,
    };
  });

  // Apply Z-Score for non-time presets (only meaningful once teams have finished)
  if (game.scoringPreset !== 'time_only' && scored.length >= 2) {
    const finishedDurations = scored.filter((t) => t.finishedAt).map((t) => t.durationMin);
    if (finishedDurations.length >= 2) {
      for (const t of scored) {
        if (t.finishedAt) {
          t.score = applyZScoreBonus(t.score, t.durationMin, finishedDurations);
        }
      }
    }
  }

  scored.sort((a, b) => {
    if (game.scoringPreset === 'time_only') {
      // Finished teams (by time) first; unfinished sink to the bottom by progress.
      const aDone = a.finishedAt ? (a.durationSeconds ?? Infinity) : Infinity;
      const bDone = b.finishedAt ? (b.durationSeconds ?? Infinity) : Infinity;
      if (aDone !== bDone) return aDone - bDone;
      return b.completedStages - a.completedStages;
    }
    return b.score - a.score;
  });

  return scored.map((t, i) => ({
    rank: i + 1,
    teamId: t.teamId,
    teamName: t.teamName,
    score: t.score,
    completedStages: t.completedStages,
    finishedAt: t.finishedAt,
    durationSeconds: t.durationSeconds,
    totalMinutes: t.totalMinutes,
  }));
}

// ─── activateHotZone / deactivateHotZone ──────────────────────────────────────
// Organizer sets a timed, geofenced score multiplier on a run (hot-zone-bonus).
// Server stamps startedAt/expiresAt; a single active zone replaces any prior one.
// The multiplier is enforced in completeTaskForTeam, never from a client claim.

export const activateHotZone = loggedCallable('activateHotZone', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, center, radiusMeters, multiplier, durationMinutes } = data as {
    gameId: string; runId: string;
    center: { lat: number; lng: number };
    radiusMeters: number; multiplier: number; durationMinutes: number;
  };

  if (!gameId || !runId) throw new functions.https.HttpsError('invalid-argument', 'gameId and runId required');
  if (!center || !isValidCoord(center.lat, center.lng)) {
    throw new functions.https.HttpsError('invalid-argument', 'valid center required');
  }
  if (!(radiusMeters > 0) || !(multiplier > 1) || !(durationMinutes > 0)) {
    throw new functions.https.HttpsError('invalid-argument', 'radiusMeters>0, multiplier>1, durationMinutes>0 required');
  }
  // Bound the inputs so a typo can't grief a run.
  const radius = Math.min(radiusMeters, 5000);
  const mult = Math.min(multiplier, 5);
  const durMin = Math.min(durationMinutes, 120);

  const runRef = db.doc(runPath(uid, gameId, runId));
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const now = new Date();
  const hotZone = {
    center: { lat: center.lat, lng: center.lng },
    radiusMeters: radius,
    multiplier: mult,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + durMin * 60_000).toISOString(),
  };
  await runRef.update({ hotZone, updatedAt: now.toISOString() });
  return { ok: true, hotZone };
});

export const deactivateHotZone = loggedCallable('deactivateHotZone', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId } = data as { gameId: string; runId: string };
  if (!gameId || !runId) throw new functions.https.HttpsError('invalid-argument', 'gameId and runId required');

  const runRef = db.doc(runPath(uid, gameId, runId));
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  await runRef.update({ hotZone: admin.firestore.FieldValue.delete(), updatedAt: new Date().toISOString() });
  return { ok: true };
});


// ─── getRunDiscoveryPois / claimDiscoveryPoi (surprise-trivia-waypoints) ───────
// Hidden geofenced trivia waypoints. The POI coordinates + answer key are
// server-secret — getRunDiscoveryPois returns a coordinate/answer-stripped shape,
// and claimDiscoveryPoi re-validates proximity (server haversine) + the answer
// before awarding the bonus. Idempotent per team via team.discoveryState.

export const getRunDiscoveryPois = loggedCallable('getRunDiscoveryPois', async (data, context) => {
  const teamId = requireAuth(context);
  await enforceRateLimit(teamId, 'getRunDiscoveryPois');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

  const snap = await db.collection(`users/${ctx.ownerUid}/games/${ctx.gameId}/discoveryPois`).get();
  const pois = snap.docs.map((d) => toDiscoveryPoiResult(d.data() as DiscoveryPoi));
  return { pois };
});

export const claimDiscoveryPoi = loggedCallable('claimDiscoveryPoi', async (data, context) => {
  const teamId = requireAuth(context);
  await enforceRateLimit(teamId, 'claimDiscoveryPoi');
  const { poiId, lat, lng, answer, ownerUid, gameId, runId, code } = data as {
    poiId: string; lat: number; lng: number; answer: string;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!poiId || answer == null) {
    throw new functions.https.HttpsError('invalid-argument', 'poiId and answer required');
  }
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

  const poiSnap = await db.doc(`users/${ctx.ownerUid}/games/${ctx.gameId}/discoveryPois/${poiId}`).get();
  if (!poiSnap.exists) throw new functions.https.HttpsError('not-found', 'POI not found');
  const poi = poiSnap.data() as DiscoveryPoi;

  const teamRef = db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId));

  return db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = teamSnap.data() as RunTeam;

    // Idempotent: a POI already answered cannot be claimed again.
    if (isPoiAlreadyClaimed(team.discoveryState, poiId)) {
      throw new functions.https.HttpsError('already-exists', 'POI already claimed');
    }

    // Proximity is re-validated server-side from the secret coordinates.
    let inside = false;
    try {
      inside = isWithinPoiRadius(poi.coordinates, { lat, lng }, poi.radiusMeters);
    } catch {
      throw new functions.https.HttpsError('failed-precondition', 'Invalid location');
    }
    if (!inside) {
      throw new functions.https.HttpsError('failed-precondition', 'Not within the POI radius');
    }

    const correct = matchesDiscoveryAnswer(poi.answers, String(answer));
    const now = new Date().toISOString();
    const discoveryState = { ...(team.discoveryState ?? {}) };

    if (correct) {
      discoveryState[poiId] = 'answered';
      const bonus = Math.max(0, poi.bonusPoints ?? 0);
      tx.update(teamRef, {
        discoveryState,
        score: (team.score ?? 0) + bonus,
        updatedAt: now,
      });
      return { correct: true, bonus };
    }

    // Wrong answer: mark triggered (seen) but award nothing; retry allowed.
    discoveryState[poiId] = 'triggered';
    tx.update(teamRef, { discoveryState, updatedAt: now });
    return { correct: false, bonus: 0 };
  });
});


export const finalizeRun = loggedCallable('finalizeRun', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId } = data as { gameId: string; runId: string };

  const runRef = db.doc(runPath(uid, gameId, runId));
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = gameSnap.data() as Game;

  const teamsSnap = await db.collection(teamsCol(uid, gameId, runId)).get();
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  const now = new Date().toISOString();
  const rankings = buildRankings(game, teams, now);

  // Finalizing always publishes the final standings to participants.
  await runRef.update({
    status: 'finished',
    finishedAt: now,
    leaderboard: { rankings, frozen: false, published: true, updatedAt: now },
    updatedAt: now,
  });

  // Player profiles (change: player-profile-badges): fold each finished team's result
  // into the player's cross-run profile. Done here as a batch — OFF the hot completeTask
  // path — and made idempotent by `profileRecorded` on the team so a re-finalize never
  // double-counts. Best-effort: a profile write must never fail finalize.
  try {
    const scoreByTeam = new Map(rankings.map((r) => [r.teamId, r.score]));
    for (const d of teamsSnap.docs) {
      const team = d.data() as RunTeam & { profileRecorded?: boolean };
      if (team.status !== 'finished' || team.profileRecorded) continue;
      const tasksCompleted = (team.stages ?? []).reduce(
        (n, s) => n + (s.tasks ?? []).filter((t) => t.status === 'completed').length, 0);
      await recordPlayerResult({
        uid: d.id,
        displayName: team.displayName,
        tasksCompleted,
        points: scoreByTeam.get(d.id) ?? team.score ?? 0,
      });
      await d.ref.update({ profileRecorded: true }).catch(() => undefined);
    }
  } catch (e) {
    logBestEffort('finalize.playerProfiles', { runId }, e);
  }

  // Platform benchmark contribution (platform-benchmark): fold anonymized,
  // per-task-type aggregates (median completion time + completion rate) into
  // benchmarks/{taskType}. No per-run identifiers are written. Opt-outable via
  // game.benchmarkOptOut. Best-effort — never blocks finalize.
  if (!game.benchmarkOptOut) {
    try {
      const typeOf = new Map<string, string>();
      for (const s of game.stages) for (const t of s.tasks) typeOf.set(t.id, t.type);
      const durationsByType = new Map<string, number[]>();
      const totalsByType = new Map<string, { done: number; total: number }>();
      for (const team of teams) {
        for (const stage of team.stages ?? []) {
          for (const rec of stage.tasks ?? []) {
            const type = typeOf.get(rec.taskId);
            if (!type) continue;
            const totals = totalsByType.get(type) ?? { done: 0, total: 0 };
            totals.total += 1;
            if (rec.status === 'completed') {
              totals.done += 1;
              if (rec.actualMinutes != null) {
                const arr = durationsByType.get(type) ?? [];
                arr.push(rec.actualMinutes * 60_000);
                durationsByType.set(type, arr);
              }
            }
            totalsByType.set(type, totals);
          }
        }
      }
      for (const [type, totals] of totalsByType) {
        const sample = {
          medianMs: median(durationsByType.get(type) ?? []),
          completionRate: totals.total > 0 ? totals.done / totals.total : 0,
        };
        const benchRef = db.doc(`benchmarks/${type}`);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(benchRef);
          const prev = snap.exists ? (snap.data() as BenchmarkAggregate) : null;
          tx.set(benchRef, mergeBenchmark(prev, sample));
        });
      }
    } catch (e) {
      // Benchmark contribution is best-effort; never fail finalize over it — but
      // log so a silent merge/transaction bug here is visible, not invisible.
      logBestEffort('finalize.benchmark', { runId }, e);
    }
  }

  return { rankings };
});


// ─── refreshLeaderboard ─────────────────────────────────────────────────────────
// Compute live standings WITHOUT ending the run. Organizers always see the
// result (they read the run doc directly); `publish` controls whether
// participants may see it, so the reveal can be staged.

export const refreshLeaderboard = loggedCallable('refreshLeaderboard', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, publish, frozen } = data as {
    gameId: string; runId: string; publish?: boolean; frozen?: boolean;
  };

  const runRef = db.doc(runPath(uid, gameId, runId));
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = runSnap.data() as Run;
  if (run.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = gameSnap.data() as Game;

  const teamsSnap = await db.collection(teamsCol(uid, gameId, runId)).get();
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  const now = new Date().toISOString();
  const rankings = buildRankings(game, teams, now);

  // Preserve the previous published flag unless explicitly changed.
  const wasPublished = run.leaderboard?.published ?? false;
  const isPublished = publish ?? wasPublished;
  const isFrozen = frozen ?? run.leaderboard?.frozen ?? false;

  await runRef.update({
    leaderboard: {
      rankings,
      frozen: isFrozen,
      published: isPublished,
      updatedAt: now,
      ...(isFrozen ? { frozenAt: now } : {}),
    },
    updatedAt: now,
  });

  return { rankings, published: isPublished, frozen: isFrozen };
});


// ─── getPublicLeaderboard ───────────────────────────────────────────────────
// Read-only, shareable standings for a run, looked up by its access code so the
// link never exposes the owner/game path. Returns the leaderboard ONLY once the
// organizer has published it (same staged-reveal gate participants see); before
// that the board is reported as not-yet-published. Anyone signed in (the play
// app's anonymous users included) may call it.

export const getPublicLeaderboard = loggedCallable('getPublicLeaderboard', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;

  const board = run?.leaderboard;
  const published = !!board?.published;
  return {
    title: game.branding?.name ?? game.title,
    branding: game.branding ?? null,
    runStatus: run?.status ?? 'live',
    published,
    frozen: !!board?.frozen,
    updatedAt: board?.updatedAt ?? null,
    rankings: published ? board!.rankings : [],
  };
});


// ─── getRunRecap (run-recap) ──────────────────────────────────────────────────
// The competition summary: ordered standings + every team's approved photo +
// headline stats. The owner may read any of their runs; a non-owner only when the
// run is published (same gate as getPublicLeaderboard). Pruned runs still return
// standings with an empty photo list (buildRunRecap is prune-safe).
export const getRunRecap = loggedCallable('getRunRecap', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;

  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;
  const isOwner = uid === c.ownerUid;
  const published = !!run?.leaderboard?.published;
  if (!isOwner && !published) {
    throw new functions.https.HttpsError('permission-denied', 'Recap is not public yet');
  }

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  const teamsSnap = await db.collection(teamsCol(c.ownerUid, c.gameId, c.runId)).get();
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  const recap = buildRunRecap(teams, run ?? { leaderboard: undefined });
  return {
    title: game?.branding?.name ?? game?.title ?? 'RushPoint',
    branding: game?.branding ?? null,
    runStatus: run?.status ?? 'live',
    published,
    ...recap,
  };
});


// ─── getRunReplay (run-replay-vod) ────────────────────────────────────────────
// Owner-only chronological replay of a run: a globally time-ordered event stream
// (start / task / finish) plus per-team cumulative score series. Resolves the run
// by access code and refuses any non-owner caller. Retention-safe via
// buildRunTimeline (pruned teams are simply omitted).
export const getRunReplay = loggedCallable('getRunReplay', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (uid !== c.ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Replay is organizer-only');
  }

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;
  const teamsSnap = await db.collection(teamsCol(c.ownerUid, c.gameId, c.runId)).get();
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  const replay = buildRunTimeline(teams);
  return {
    title: game?.branding?.name ?? game?.title ?? 'RushPoint',
    runStatus: run?.status ?? 'live',
    ...replay,
  };
});


// ─── getRunAnalytics (run-analytics-heatmap) ──────────────────────────────────
// Owner-only post-run analytics: per-task completion rate, median/p90 time, hint
// + skip counts. Resolves the run by access code and refuses non-owners. Survives
// the PII prune (computeRunAnalytics just contributes nothing for cleared teams).
export const getRunAnalytics = loggedCallable('getRunAnalytics', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (uid !== c.ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Analytics are organizer-only');
  }

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  const gameTasks = (game?.stages ?? []).flatMap((s) => s.tasks).map((t) => ({ id: t.id, type: t.type }));

  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;
  const teamsSnap = await db.collection(teamsCol(c.ownerUid, c.gameId, c.runId)).get();
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  return {
    title: game?.branding?.name ?? game?.title ?? 'RushPoint',
    runStatus: run?.status ?? 'live',
    ...computeRunAnalytics(teams, gameTasks),
  };
});


// ─── getRunHeatmap (movement-heatmap) ─────────────────────────────────────────
// Owner-only foot-traffic density over the run's retained GPS track. Resolves the run
// by access code, refuses non-owners, bins the track via the pure buildMovementDensity.
// Prune-safe: a cleared track just yields no cells.
export const getRunHeatmap = loggedCallable('getRunHeatmap', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const { code } = data as { code: string };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (uid !== c.ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Heatmap is organizer-only');
  }

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;

  const trackSnap = await db
    .collection(`users/${c.ownerUid}/games/${c.gameId}/runs/${c.runId}/locationTrack`)
    .get();
  const points = trackSnap.docs.map((d) => {
    const p = d.data() as { lat: number; lng: number };
    return { lat: p.lat, lng: p.lng };
  });

  return {
    title: game?.branding?.name ?? game?.title ?? 'RushPoint',
    runStatus: run?.status ?? 'live',
    cells: buildMovementDensity(points),
    pointCount: points.length,
  };
});


// ─── getMyProfile (player-profile-badges) ─────────────────────────────────────
// The caller's own cross-run profile (lifetime stats + earned badges). Read-only;
// the profile is written server-side on run finish. Returns a zeroed profile if the
// player has never finished a run.
export const getMyProfile = loggedCallable('getMyProfile', async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await db.doc(`players/${uid}`).get();
  const profile = snap.exists ? (snap.data() as PlayerProfile) : emptyProfile(uid);
  return { profile };
});


// ─── startInstantPlay (marketplace-instant-play) ──────────────────────────────
// On-demand, free, self-guided solo play of a PUBLIC + opted-in game. Creates a fresh
// self-guided run under the owner's tree (Admin SDK — no owner auth, no credit), registers
// the caller as the sole team, starts it, and returns the run context. No organizer needed.
export const startInstantPlay = loggedCallable('startInstantPlay', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'startInstantPlay');
  const { gameId, displayName } = data as { gameId: string; displayName?: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  // Authoritative owner lookup: only games indexed in publicGames are challengeable.
  const pubSnap = await db.doc(`publicGames/${gameId}`).get();
  if (!pubSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const ownerUid = (pubSnap.data() as { ownerUid: string }).ownerUid;

  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  if (!game.allowInstantPlay) {
    throw new functions.https.HttpsError('failed-precondition', 'This game is not open for instant play');
  }
  if (!game.stages?.length) {
    throw new functions.https.HttpsError('failed-precondition', 'Game has no stages');
  }

  const now = new Date().toISOString();
  const code = await uniqueCode();
  const runRef = db.collection(`users/${ownerUid}/games/${gameId}/runs`).doc();
  const runId = runRef.id;
  const name = (displayName ?? '').trim().slice(0, MAX_ID_LEN) || 'Player';

  const run: Run = {
    id: runId, gameId, ownerUid, status: 'live', accessCode: code,
    billingType: 'free', maxParticipants: 1, participantCount: 1,
    selfGuided: true, launchedAt: now, createdAt: now, updatedAt: now,
  };
  const accessCode: AccessCode = { code, ownerUid, gameId, runId, status: 'unused', createdAt: now };
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, uid));
  const team: RunTeam = {
    id: uid, runId, gameId, ownerUid,
    displayName: name, registrationData: {}, memberNames: [], memberCount: 1,
    status: 'active', stages: buildInitialStages(game).map((s, i) => ({ ...s, ...(i === 0 ? { startedAt: now } : {}) })),
    score: 0, bonusPenalty: 0, launched: true, startedAt: now, activeTaskId: null,
    deviceUids: [uid], controllerUid: uid, deviceJoinCode: generateDeviceJoinCode(),
    devices: [{ uid, name, joinedAt: now }], updatedAt: now,
  };

  const batch = db.batch();
  batch.set(runRef, run);
  batch.set(db.doc(`accessCodes/${code}`), accessCode);
  batch.set(teamRef, team);
  await batch.commit();

  // Hand out the first task exactly as startTeams does.
  await assignNextInActiveStage(ownerUid, gameId, runId, uid, { lat: 31.7905, lng: 35.164 }, now);

  return { ownerUid, gameId, runId, accessCode: code };
});


// ─── Trackable collectibles (change: trackable-collectibles) ──────────────────
// A virtual item picked up at one task and dropped at another, carrying a travel log.
// Run-scoped subcollection; holder transfer is transactional; coordinates aren't secret.

export const createTrackable = loggedCallable('createTrackable', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, name, description, homeTaskId } = data as {
    gameId: string; runId: string; name: string; description?: string; homeTaskId?: string;
  };
  validate(() => requireString(name, 'name', MAX_ID_LEN));
  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists || (runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  const ref = db.collection(`${runPath(uid, gameId, runId)}/trackables`).doc();
  const trackable = {
    id: ref.id,
    name: name.trim(),
    description: (description ?? '').slice(0, 500),
    homeTaskId: homeTaskId ?? null,
    currentHolderTeamId: null,
    currentTaskId: homeTaskId ?? null,
    createdAt: new Date().toISOString(),
  };
  await ref.set(trackable);
  return { trackable };
});

export const getRunTrackables = loggedCallable('getRunTrackables', async (data, context) => {
  const teamId = requireAuth(context);
  await enforceRateLimit(teamId, 'getRunTrackables');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });
  const snap = await db.collection(`${runPath(ctx.ownerUid, ctx.gameId, ctx.runId)}/trackables`).get();
  const trackables = snap.docs.map((d) => d.data() as Trackable);
  return { trackables };
});

async function transferTrackable(
  context: functions.https.CallableContext, action: 'pickup' | 'drop',
  data: { ownerUid: string; gameId: string; runId: string; trackableId: string; taskId?: string },
): Promise<{ ok: boolean; trackable: Trackable }> {
  const uid = requireAuth(context);
  const { ownerUid, gameId, runId, trackableId, taskId } = data;
  if (!trackableId) throw new functions.https.HttpsError('invalid-argument', 'trackableId required');
  // Controller-only (shared team devices): a viewer device can't move items.
  const { teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId }, { requireController: true });
  const teamName = team.displayName;
  const tRef = db.doc(`${runPath(ownerUid, gameId, runId)}/trackables/${trackableId}`);
  const now = new Date().toISOString();

  const trackable = await db.runTransaction(async (tx) => {
    const snap = await tx.get(tRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Trackable not found');
    const t = snap.data() as Trackable;
    if (action === 'pickup') {
      if (!canPickUp(t)) throw new functions.https.HttpsError('failed-precondition', 'Already held by another team');
      tx.update(tRef, { currentHolderTeamId: teamId, currentTaskId: null, updatedAt: now });
      return { ...t, currentHolderTeamId: teamId, currentTaskId: null };
    }
    if (!canDrop(t, teamId)) throw new functions.https.HttpsError('failed-precondition', 'You are not carrying this');
    tx.update(tRef, { currentHolderTeamId: null, currentTaskId: taskId ?? null, updatedAt: now });
    return { ...t, currentHolderTeamId: null, currentTaskId: taskId ?? null };
  });

  // Append to the append-only travel log (best-effort; pruned with the run's PII).
  await tRef.collection('log').add({ teamId, teamName: teamName ?? null, taskId: taskId ?? null, action, at: now })
    .catch(() => undefined);

  return { ok: true, trackable };
}

export const pickUpTrackable = loggedCallable('pickUpTrackable', async (data, context) =>
  transferTrackable(context, 'pickup', data as never));

export const dropTrackable = loggedCallable('dropTrackable', async (data, context) =>
  transferTrackable(context, 'drop', data as never));


// ─── Territory / contested-zone capture (change: territory-capture) ────────────
// Run-scoped capturable zones. Proximity is re-validated server-side; the capture
// bonus is awarded IMMEDIATELY at capture time (via team.bonusPenalty, which both
// refreshLeaderboard and finalizeRun read) so live and final standings can't drift.

export const createZone = loggedCallable('createZone', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, title, lat, lng, radiusMeters, captureBonus } = data as {
    gameId: string; runId: string; title: string; lat: number; lng: number;
    radiusMeters?: number; captureBonus?: number;
  };
  validate(() => requireString(title, 'title', MAX_ID_LEN));
  if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid coordinates');
  }
  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists || (runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  const ref = db.collection(`${runPath(uid, gameId, runId)}/zones`).doc();
  const zone: CaptureZone & { createdAt: string } = {
    id: ref.id, title: title.trim(), center: { lat, lng },
    radiusMeters: Number.isFinite(radiusMeters) && radiusMeters! > 0 ? radiusMeters! : 50,
    captureBonus: Number.isFinite(captureBonus) && captureBonus! >= 0 ? captureBonus! : 10,
    ownerTeamId: null, ownerTeamName: null, createdAt: new Date().toISOString(),
  };
  await ref.set(zone);
  return { zone };
});

export const deleteZone = loggedCallable('deleteZone', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, zoneId } = data as { gameId: string; runId: string; zoneId: string };
  if (!zoneId) throw new functions.https.HttpsError('invalid-argument', 'zoneId required');
  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists || (runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  await db.doc(`${runPath(uid, gameId, runId)}/zones/${zoneId}`).delete();
  return { ok: true };
});

export const getRunZones = loggedCallable('getRunZones', async (data, context) => {
  const teamId = requireAuth(context);
  await enforceRateLimit(teamId, 'getRunZones');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });
  const snap = await db.collection(`${runPath(ctx.ownerUid, ctx.gameId, ctx.runId)}/zones`).get();
  return { zones: snap.docs.map((d) => d.data() as CaptureZone) };
});

export const captureZone = loggedCallable('captureZone', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'captureZone');
  const { ownerUid, gameId, runId, zoneId, lat, lng } = data as {
    ownerUid: string; gameId: string; runId: string; zoneId: string; lat: number; lng: number;
  };
  if (!zoneId) throw new functions.https.HttpsError('invalid-argument', 'zoneId required');
  // Controller-only; returns the caller's own team + ref for the atomic award.
  const { teamId, team, teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId }, { requireController: true });
  const zRef = db.doc(`${runPath(ownerUid, gameId, runId)}/zones/${zoneId}`);

  return db.runTransaction(async (tx) => {
    const [zSnap, tSnap] = await Promise.all([tx.get(zRef), tx.get(teamRef)]);
    if (!zSnap.exists) throw new functions.https.HttpsError('not-found', 'Zone not found');
    const zone = zSnap.data() as CaptureZone;
    if (!canCapture(zone, teamId)) {
      throw new functions.https.HttpsError('failed-precondition', 'Your team already holds this zone');
    }
    // GPS proximity is re-validated server-side (never trust client coordinates).
    if (!isWithinZone(zone.center, { lat, lng }, zone.radiusMeters)) {
      throw new functions.https.HttpsError('failed-precondition', 'Not within the zone');
    }
    const now = new Date().toISOString();
    const t = tSnap.data() as RunTeam;
    // Award the capture bonus now: bonusPenalty is SUBTRACTED from score, so a bonus
    // is a negative delta. Applied to the live team doc → live & final both see it.
    tx.update(teamRef, { bonusPenalty: (t.bonusPenalty ?? 0) - (zone.captureBonus ?? 0), updatedAt: now });
    tx.update(zRef, { ownerTeamId: teamId, ownerTeamName: team.displayName, capturedAt: now });
    return { ok: true, zone: { ...zone, ownerTeamId: teamId, ownerTeamName: team.displayName, capturedAt: now } };
  });
});


// ─── listRunTeams ─────────────────────────────────────────────────────────────

export const listRunTeams = loggedCallable('listRunTeams', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId } = data as { gameId: string; runId: string };

  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const snap = await db.collection(teamsCol(uid, gameId, runId)).get();
  const teams = snap.docs.map((d) => {
    const t = d.data() as RunTeam;
    const activeStageOrder = t.stages.find((s) => s.status === 'active')?.order ?? null;
    return {
      id: t.id,
      displayName: t.displayName,
      memberNames: t.memberNames ?? [],
      memberCount: t.memberCount ?? 1,
      status: t.status,
      score: t.score,
      completedStages: t.stages.filter((s) => s.status === 'completed').length,
      activeStageOrder,
      finished: t.status === 'finished',
      launched: t.launched,
      startedAt: t.startedAt ?? null,
      finishedAt: t.finishedAt ?? null,
    };
  });

  return { teams };
});


// ─── Participant-facing task flow ──────────────────────────────────────────────
// In v2 there are no judges: participants self-advance through tasks. Field /
// self_report tasks are completed by the team itself; smart_station tasks are
// completed by verifyStationCode / reviewStationSubmission (see index.ts), which
// call completeTaskForTeam. After any completion, if the (possibly new) active
// stage still has unassigned tasks, the next is assigned via the router.

// Resolve the run path a participant belongs to from their access code. The
// participant only knows the code; ownerUid/gameId/runId are read server-side.
async function resolveTeamContext(teamId: string, ctx: {
  ownerUid?: string; gameId?: string; runId?: string; code?: string;
}): Promise<{ ownerUid: string; gameId: string; runId: string }> {
  if (ctx.ownerUid && ctx.gameId && ctx.runId) {
    return { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId };
  }
  if (ctx.code) {
    const codeSnap = await db.doc(`accessCodes/${ctx.code.trim().toUpperCase()}`).get();
    if (codeSnap.exists) {
      const c = codeSnap.data() as AccessCode;
      return { ownerUid: c.ownerUid, gameId: c.gameId, runId: c.runId };
    }
  }
  throw new functions.https.HttpsError('invalid-argument', 'Cannot resolve run context (provide code or ownerUid/gameId/runId)');
}

// ─── Shared team devices (shared-team-devices) ────────────────────────────────
// A team is no longer 1:1 with a uid: extra phones attach via joinTeamAsDevice
// and are listed in the team doc's deviceUids. Resolve WHICH team the caller
// belongs to (fast path: founding device, uid == teamId — covers every legacy
// doc), and optionally gate mutations on the controller role.

export async function resolveCallerTeam(
  uid: string,
  ctxIn: { ownerUid?: string; gameId?: string; runId?: string; code?: string },
  opts: { requireController?: boolean } = {},
): Promise<{
  ctx: { ownerUid: string; gameId: string; runId: string };
  teamId: string;
  team: RunTeam;
  teamRef: FirebaseFirestore.DocumentReference;
}> {
  const ctx = await resolveTeamContext(uid, ctxIn);
  let teamRef = db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, uid));
  let snap: FirebaseFirestore.DocumentSnapshot = await teamRef.get();
  if (!snap.exists) {
    const q = await db.collection(teamsCol(ctx.ownerUid, ctx.gameId, ctx.runId))
      .where('deviceUids', 'array-contains', uid).limit(1).get();
    if (q.empty) throw new functions.https.HttpsError('not-found', 'Team not found');
    snap = q.docs[0];
    teamRef = snap.ref;
  }
  const team = snap.data() as RunTeam;
  if (opts.requireController) assertController(team, uid);
  return { ctx, teamId: team.id, team, teamRef };
}

// ─── joinTeamAsDevice (attach another phone to an existing team) ───────────────

export const joinTeamAsDevice = loggedCallable('joinTeamAsDevice', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  await enforceRateLimit(uid, 'joinTeamAsDevice');

  const { code, teamCode, memberName } = data as {
    code: string; teamCode: string; memberName?: string;
  };
  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');
  if (!teamCode?.trim()) throw new functions.https.HttpsError('invalid-argument', 'teamCode required');
  if (memberName != null) validate(() => requireString(memberName, 'memberName', MAX_ID_LEN));

  const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const codeData = codeSnap.data() as AccessCode;
  if (codeData.status === 'revoked') {
    throw new functions.https.HttpsError('permission-denied', 'This code has been revoked');
  }
  const { ownerUid, gameId, runId } = codeData;

  const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This race has already finished.');
  }

  // Idempotent / conflict guard: is this uid already a team or attached to one?
  const ownTeam = await db.doc(teamPath(ownerUid, gameId, runId, uid)).get();
  const attachedQ = ownTeam.exists
    ? null
    : await db.collection(teamsCol(ownerUid, gameId, runId))
        .where('deviceUids', 'array-contains', uid).limit(1).get();
  const existing = ownTeam.exists ? ownTeam : (attachedQ && !attachedQ.empty ? attachedQ.docs[0] : null);

  const normalizedTeamCode = teamCode.trim().toUpperCase();
  if (existing) {
    const t = existing.data() as RunTeam;
    if (t.deviceJoinCode === normalizedTeamCode) {
      return {
        ownerUid, gameId, runId, teamId: t.id,
        role: resolveDeviceRole(t, uid), alreadyAttached: true,
      };
    }
    throw new functions.https.HttpsError('failed-precondition', 'Already part of another team in this run');
  }

  const teamQ = await db.collection(teamsCol(ownerUid, gameId, runId))
    .where('deviceJoinCode', '==', normalizedTeamCode).limit(1).get();
  if (teamQ.empty) throw new functions.https.HttpsError('not-found', 'No team with that device code');
  const teamRef = teamQ.docs[0].ref;

  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = snap.data() as RunTeam;
    const decision = canAttachDevice(team, uid);
    if (!decision.ok) {
      if (decision.reason === 'duplicate') return; // raced with ourselves — already attached
      if (decision.reason === 'full') {
        throw new functions.https.HttpsError('resource-exhausted', 'This team already has the maximum number of phones');
      }
      throw new functions.https.HttpsError('failed-precondition', 'This team has already finished.');
    }
    // Rewrite the devices array wholesale (never dotted-path an array element)
    // and backfill the device fields on a legacy doc in the same write.
    const devices = [
      ...(team.devices ?? [{ uid: team.id, name: team.displayName, joinedAt: team.updatedAt }]),
      { uid, name: memberName?.trim() || 'Phone', joinedAt: now },
    ];
    tx.update(teamRef, {
      deviceUids: [...attachedDeviceUids(team), uid],
      controllerUid: controllerUidOf(team),
      devices,
      updatedAt: now,
    });
  });

  return { ownerUid, gameId, runId, teamId: teamRef.id, role: 'viewer', alreadyAttached: false };
});

// ─── transferController / claimController ─────────────────────────────────────

export const transferController = loggedCallable('transferController', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  await enforceRateLimit(uid, 'transferController');
  const { toUid, ownerUid, gameId, runId, code } = data as {
    toUid: string; ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!toUid?.trim()) throw new functions.https.HttpsError('invalid-argument', 'toUid required');

  const { teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code });
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = snap.data() as RunTeam;
    assertController(team, uid); // only the current controller may hand off
    if (!attachedDeviceUids(team).includes(toUid)) {
      throw new functions.https.HttpsError('invalid-argument', 'Target device is not part of this team');
    }
    tx.update(teamRef, { controllerUid: toUid, updatedAt: new Date().toISOString() });
  });
  return { ok: true, controllerUid: toUid };
});

export const claimController = loggedCallable('claimController', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  await enforceRateLimit(uid, 'claimController');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };

  // Any attached device may take control — the never-stuck fallback when the
  // controlling phone dies. Trust boundary stays at team level (attached uids).
  const { teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code });
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = snap.data() as RunTeam;
    if (!attachedDeviceUids(team).includes(uid)) {
      throw new functions.https.HttpsError('permission-denied', 'Not part of this team');
    }
    if (controllerUidOf(team) !== uid) {
      tx.update(teamRef, { controllerUid: uid, updatedAt: new Date().toISOString() });
    }
  });
  return { ok: true, controllerUid: uid };
});

// Assign the next unassigned task within the team's active stage. Single-task
// stages assign directly; multi-task stages route by priority. No-op if none left.
// Scheduled-release stage unlock (change: scheduled-release). When a team has NO
// active stage but the next locked stage's predecessor is completed and its
// release gate has opened, flip it to `active`. Mutates `stages` in place and
// returns whether it changed anything. Linear flow: only the earliest eligible
// locked stage is considered — a not-yet-released gate blocks the rest.
function computeStageUnlock(
  stages: RunStageRecord[],
  game: Game,
  launchedAt: string | undefined,
  nowMs: number,
): boolean {
  if (stages.some((s) => s.status === 'active')) return false;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].status !== 'locked') continue;
    const prevDone = i === 0 || stages[i - 1].status === 'completed';
    if (!prevDone) return false; // can't jump ahead of an unfinished stage
    const gameStage = game.stages.find((s) => s.id === stages[i].stageId);
    if (isReleased(gameStage, launchedAt, nowMs)) {
      stages[i].status = 'active';
      stages[i].startedAt = new Date(nowMs).toISOString();
      return true;
    }
    return false; // earliest eligible locked stage not released yet → hold
  }
  return false;
}

async function assignNextInActiveStage(
  ownerUid: string, gameId: string, runId: string, teamId: string,
  teamLocation: { lat: number; lng: number },
  now: string,
): Promise<{ taskId?: string }> {
  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  if (!gameSnap.exists) return {};
  const game = gameSnap.data() as Game;
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, teamId));
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) return {};
  const team = teamSnap.data() as RunTeam;

  // Poll re-check: a scheduled-release stage that has since opened gets unlocked
  // here, so a team waiting on a timed drop advances the moment its gate opens.
  if (team.stages.findIndex((s) => s.status === 'active') < 0) {
    const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
    const launchedAt = (runSnap.data() as Run | undefined)?.launchedAt;
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
    if (computeStageUnlock(stages, game, launchedAt, Date.now())) {
      await teamRef.update({ stages, updatedAt: now });
      team.stages = stages;
    }
  }

  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  if (activeStageIdx < 0) return {};
  const stageRec = team.stages[activeStageIdx];
  const gameStage = game.stages.sort((a, b) => a.order - b.order)[activeStageIdx];
  if (!gameStage) return {};

  // Already have a task in flight in this stage? Don't double-assign.
  const inFlight = stageRec.tasks.find((t) => t.status === 'assigned');
  if (inFlight) return { taskId: inFlight.taskId };

  const unassigned = stageRec.tasks.filter((t) => t.status === 'unassigned');
  if (unassigned.length === 0) return {};

  const completedTaskIds = team.stages
    .flatMap((s) => s.tasks)
    .filter((t) => t.status === 'completed')
    .map((t) => t.taskId);

  if (gameStage.tasks.length === 1) {
    // Mutate the full stages array (never dotted-path into an array — Firestore
    // would coerce `stages` into a map keyed "0", "1", … and break .findIndex).
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
    stages[activeStageIdx].tasks[0].status = 'assigned';
    stages[activeStageIdx].tasks[0].startedAt = now;
    await teamRef.update({ stages, activeTaskId: gameStage.tasks[0].id, updatedAt: now });
    return { taskId: gameStage.tasks[0].id };
  }

  // Multi-task: route among the still-unassigned tasks of this stage
  const candidateTasks = gameStage.tasks.filter(
    (gt) => stageRec.tasks.find((tr) => tr.taskId === gt.id)?.status === 'unassigned',
  );
  const skillRatio = await computeSkillRatio(
    team.stages.flatMap((s) => s.tasks).filter((t) => t.status === 'completed').map((t) => ({
      taskId: t.taskId, actualMinutes: t.actualMinutes, completedAt: t.completedAt, startedAt: t.startedAt,
    })),
    game.stages.flatMap((s) => s.tasks),
  );
  const result = await assignTask(
    teamLocation, candidateTasks, completedTaskIds, skillRatio,
    ownerUid, gameId, runId, game.scoringPreset === 'smart_weighted',
  );
  if (result.taskId) {
    const localIdx = stageRec.tasks.findIndex((t) => t.taskId === result.taskId);
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
    stages[activeStageIdx].tasks[localIdx].status = 'assigned';
    stages[activeStageIdx].tasks[localIdx].startedAt = now;
    await teamRef.update({ stages, activeTaskId: result.taskId, updatedAt: now });
  }
  return { taskId: result.taskId };
}

// ─── completeTask (participant self-report / field) ───────────────────────────

export const completeTask = loggedCallable('completeTask', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'completeTask');
  const { taskId, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');

  const { ctx, teamId } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  const now = new Date().toISOString();

  // Trigger-mode gate: radius/exact tasks validate GPS proximity server-side so
  // they can't be spoofed by calling completeTask directly; instant/locationless
  // need no GPS. Legacy `geofence`-type tasks normalize to `radius`.
  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  const gtask = gameSnap.exists ? findGameTask(gameSnap.data() as Game, taskId) : undefined;
  // Scheduled-release gate (change: scheduled-release): a not-yet-released task
  // can't be completed even by calling completeTask directly (anti-cheat: the
  // routing filter already hides it, this stops a hand-crafted bypass).
  if (gtask && (gtask.releaseAt || gtask.releaseAfterMinutes)) {
    const runSnap = await db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId)).get();
    const launchedAt = (runSnap.data() as Run | undefined)?.launchedAt;
    if (!isReleased(gtask, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task is not available yet');
    }
  }
  if (gtask) {
    const mode = normalizeTriggerMode(gtask);
    if (mode === 'radius' || mode === 'exact') {
      if (lat == null || lng == null || !isValidCoord(lat, lng) || !gtask.coordinates) {
        throw new functions.https.HttpsError('failed-precondition', 'Location required to check in here');
      }
      const distM = haversineKm({ lat, lng }, gtask.coordinates) * 1000;
      // Hidden-location tasks gate identically but the rejection must not leak the
      // distance (otherwise the secret spot is triangulable by polling).
      const verdict = evaluateTrigger(mode, distM, gtask.geofenceRadiusMeters, { hidden: !!gtask.hideLocation });
      if (!verdict.ok) {
        const fallback = gtask.hideLocation
          ? 'Not here yet — keep following the clue'
          : `Too far from the spot (${Math.round(distM)}m away)`;
        throw new functions.https.HttpsError('failed-precondition', verdict.reason ?? fallback);
      }
    }
  }

  await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
  await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);

  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);

  return { ok: true, nextTaskId: next.taskId ?? null };
});

// ─── requestNextTask (assign a task in the active stage) ──────────────────────

export const requestNextTask = loggedCallable('requestNextTask', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'requestNextTask');
  const { lat, lng, ownerUid, gameId, runId, code } = data as {
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const { ctx, teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  // Soft-pause (safe-zone-boundary): no new task while the team is out of bounds.
  if (team.outOfBounds === true) {
    return { taskId: null, outOfBounds: true };
  }
  const now = new Date().toISOString();
  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
  return { taskId: next.taskId ?? null };
});

// ─── requestTaskHint (reveal a paid hint, charge once) ────────────────────────

export const requestTaskHint = loggedCallable('requestTaskHint', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'requestTaskHint');
  const { taskId, ownerUid, gameId, runId, code } = data as {
    taskId: string;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');
  const { ctx, teamId } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  let hint: string | undefined;
  let penalty = 25;
  for (const stage of game.stages) {
    const t = stage.tasks.find((x) => x.id === taskId);
    if (t) { hint = t.hint; penalty = t.hintPenalty ?? 25; break; }
  }
  if (!hint || !hint.trim()) {
    throw new functions.https.HttpsError('failed-precondition', 'No hint available for this task');
  }
  const hintText = hint.trim();

  const teamRef = db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = snap.data() as RunTeam;
    const used = team.taskHintsUsed ?? [];
    if (used.includes(taskId)) return { alreadyUsed: true, charged: 0 }; // don't double-charge
    tx.update(teamRef, {
      taskHintsUsed: [...used, taskId],
      bonusPenalty: (team.bonusPenalty ?? 0) + penalty,
      updatedAt: new Date().toISOString(),
    });
    return { alreadyUsed: false, charged: penalty };
  });

  return { hint: hintText, penalty: result.charged, alreadyUsed: result.alreadyUsed };
});


// ─── Answer-checking helpers (quiz / numeric / sequence) ──────────────────────

function findGameTask(game: Game, taskId: string): Task | undefined {
  for (const stage of game.stages) {
    const t = stage.tasks.find((x) => x.id === taskId);
    if (t) return t;
  }
  return undefined;
}

// Answer matching is shared with checkChallengeAnswer via matchesTaskAnswer
// (packages/shared/src/challenge.ts) so the two never drift.

// ─── submitTaskAnswer (quiz / numeric) ────────────────────────────────────────

export const submitTaskAnswer = loggedCallable('submitTaskAnswer', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'submitTaskAnswer');
  const { taskId, answer, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string; answer: string;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId || answer == null) throw new functions.https.HttpsError('invalid-argument', 'taskId and answer required');
  const { ctx, teamId } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data() as Game, taskId);
  if (!task) throw new functions.https.HttpsError('not-found', 'Task not found');
  if (task.type !== 'quiz' && task.type !== 'numeric') {
    throw new functions.https.HttpsError('failed-precondition', 'Task does not take an answer');
  }

  // row 42: enforce the task's answer attempt limit server-side. Read the team's
  // recorded wrong-answer count for this task; refuse once the cap is reached
  // (even a correct answer is blocked once locked — no infinite brute force).
  const attemptLimit = task.smart?.attemptLimit;
  const teamRef = db.doc(`users/${ctx.ownerUid}/games/${ctx.gameId}/runs/${ctx.runId}/teams/${teamId}`);
  if (attemptLimit && attemptLimit > 0) {
    const teamSnap = await teamRef.get();
    const attempts = (teamSnap.data() as { taskAttempts?: Record<string, number> } | undefined)?.taskAttempts?.[taskId] ?? 0;
    if (attemptLimitReached(attempts, attemptLimit)) {
      throw new functions.https.HttpsError('resource-exhausted', 'No attempts left for this task');
    }
  }

  if (!matchesTaskAnswer(task, String(answer))) {
    // Record the wrong attempt under a real nested map (not a dotted key).
    if (attemptLimit && attemptLimit > 0) {
      await teamRef.set(
        { taskAttempts: { [taskId]: admin.firestore.FieldValue.increment(1) } },
        { merge: true },
      );
    }
    return { correct: false };
  }

  const now = new Date().toISOString();
  await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
  await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);
  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
  return { correct: true, nextTaskId: next.taskId ?? null };
});

// ─── submitSequenceStep (sequence tasks — one ordered step at a time) ──────────

export const submitSequenceStep = loggedCallable('submitSequenceStep', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'submitSequenceStep');
  const { taskId, stepIndex, answer, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string; stepIndex: number; answer?: string;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId || typeof stepIndex !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and stepIndex required');
  }
  const { ctx, teamId, team, teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data() as Game, taskId);
  if (!task || task.type !== 'sequence' || !task.steps?.length) {
    throw new functions.https.HttpsError('failed-precondition', 'Not a sequence task');
  }

  const done = team.taskStepProgress?.[taskId] ?? 0;

  // Must answer steps in order; ignore replays of already-cleared steps.
  if (stepIndex !== done) return { stepCorrect: false, stepsDone: done, totalSteps: task.steps.length, taskComplete: false };

  const step = task.steps[stepIndex];
  const expected = step.answer?.trim().toLowerCase();
  const ok = !expected || (answer ?? '').trim().toLowerCase() === expected; // no answer = tap-to-confirm
  if (!ok) return { stepCorrect: false, stepsDone: done, totalSteps: task.steps.length, taskComplete: false };

  const newDone = done + 1;
  const now = new Date().toISOString();
  const taskComplete = newDone >= task.steps.length;

  await teamRef.update({ [`taskStepProgress.${taskId}`]: newDone, updatedAt: now });

  if (taskComplete) {
    await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
    await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);
    const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
    await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
  }
  return { stepCorrect: true, stepsDone: newDone, totalSteps: task.steps.length, taskComplete };
});

// ─── getRecommendedTasks (ranked list, no assignment) ─────────────────────────

export const getRecommendedTasks = loggedCallable('getRecommendedTasks', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'getRecommendedTasks');
  const { lat, lng, ownerUid, gameId, runId, code } = data as {
    lat: number; lng: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  // Read-only: any attached device may ask for recommendations.
  const { ctx, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  const game = gameSnap.data() as Game;

  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  if (activeStageIdx < 0) return { recommendations: [] };
  const gameStage = game.stages.sort((a, b) => a.order - b.order)[activeStageIdx];
  if (!gameStage) return { recommendations: [] };

  const completedTaskIds = team.stages.flatMap((s) => s.tasks)
    .filter((t) => t.status === 'completed').map((t) => t.taskId);
  const skillRatio = await computeSkillRatio(
    team.stages.flatMap((s) => s.tasks).filter((t) => t.status === 'completed').map((t) => ({
      taskId: t.taskId, actualMinutes: t.actualMinutes, completedAt: t.completedAt, startedAt: t.startedAt,
    })),
    game.stages.flatMap((s) => s.tasks),
  );

  const recommendations = await buildRecommendations(
    { lat, lng }, gameStage.tasks, completedTaskIds, skillRatio,
    ctx.ownerUid, ctx.gameId, ctx.runId, 5, game.scoringPreset === 'smart_weighted',
  );
  return { recommendations };
});

// ─── getMyTeamState (participant read: team + client-safe active task) ─────────
// The game template is owner-only, so participants can't read task content
// directly. This returns the team's live state plus the sanitized content of
// their currently-assigned task(s) — secrets (codes) are stripped server-side.

export const getMyTeamState = loggedCallable('getMyTeamState', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'getMyTeamState');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  // Read-only: any attached device (controller or viewer) sees the same state.
  const { ctx, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code });

  const [gameSnap, runSnap] = await Promise.all([
    db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get(),
    db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId)).get(),
  ]);
  const game = gameSnap.data() as Game;
  const run = runSnap.data() as Run;

  // Scheduled-release (change: scheduled-release): unlock a due stage here too, so
  // a team waiting on a timed drop advances the moment its gate opens even when it
  // is only polling state (not requesting a task).
  if (team.stages.findIndex((s) => s.status === 'active') < 0) {
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
    if (computeStageUnlock(stages, game, run.launchedAt, Date.now())) {
      await db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, team.id))
        .update({ stages, updatedAt: new Date().toISOString() });
      team.stages = stages;
    }
  }

  // Build a map of taskId → sanitized content for tasks in the active stage
  const orderedStages = game.stages.slice().sort((a, b) => a.order - b.order);
  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  const activeStageTasks =
    activeStageIdx >= 0 && orderedStages[activeStageIdx]
      ? orderedStages[activeStageIdx].tasks.map(sanitizeTaskForParticipant)
      : [];

  // If the team is between stages waiting on a timed drop, the instant the next
  // locked stage unlocks — so the play UI can render a "next chapter unlocks in…"
  // countdown. null when nothing is waiting on a schedule.
  let nextStageReleaseAt: number | null = null;
  if (activeStageIdx < 0) {
    for (let i = 0; i < team.stages.length; i++) {
      if (team.stages[i].status !== 'locked') continue;
      const prevDone = i === 0 || team.stages[i - 1].status === 'completed';
      if (!prevDone) break;
      const gs = orderedStages.find((s) => s.id === team.stages[i].stageId);
      nextStageReleaseAt = releaseInstantMs(gs, run.launchedAt);
      break;
    }
  }

  // Narrative chapters (change: narrative-chapters): intro/outro beats for stages the
  // team has actually reached (active or completed) — never future stages, so upcoming
  // chapters aren't spoiled. Cosmetic passthrough; image URLs are https-guarded. The
  // play UI shows an intro when a chapter opens and an outro when it closes.
  const cleanBeat = (b?: { title?: string; body?: string; bodyHe?: string; imageUrl?: string }) => {
    if (!b) return undefined;
    const img = b.imageUrl && /^https:\/\//.test(b.imageUrl) ? b.imageUrl : undefined;
    return { title: b.title, body: b.body, bodyHe: b.bodyHe, imageUrl: img };
  };
  const stageNarratives = team.stages
    .map((s) => {
      const gs = orderedStages.find((g) => g.id === s.stageId);
      if (!gs?.narrative || (s.status !== 'active' && s.status !== 'completed')) return null;
      return {
        stageId: s.stageId,
        order: gs.order,
        title: gs.title,
        status: s.status,
        narrative: { intro: cleanBeat(gs.narrative.intro), outro: cleanBeat(gs.narrative.outro) },
      };
    })
    .filter(Boolean);

  return {
    team,
    stageNarratives,
    run: {
      id: run.id, status: run.status, accessCode: run.accessCode,
      billingType: run.billingType ?? 'free',
      // Run start, so the client can compute per-task `releaseAfterMinutes`
      // countdowns for scheduled-release tasks in the active stage.
      launchedAt: run.launchedAt ?? null,
      leaderboard: run.leaderboard ?? null,
      // Active hot zone (hot-zone-bonus) so the participant app can show the
      // live "🔥 Hot Zone" banner + countdown. Coordinates are the zone centre
      // (already public to anyone in the run); answer keys are unaffected.
      hotZone: run.hotZone ?? null,
    },
    // Scheduled-release countdown to the next timed stage drop (ms epoch or null).
    nextStageReleaseAt,
    game: {
      id: game.id,
      title: game.title,
      mode: game.mode,
      scoringPreset: game.scoringPreset,
      branding: game.branding ?? null,
      stageCount: orderedStages.length,
    },
    activeStageTasks,
    // Shared team devices: who controls + this caller's own role, so every
    // attached phone can render controller/viewer UI without extra reads.
    myRole: resolveDeviceRole(team, uid),
    context: ctx,
  };
});


// ─── listLiveRuns (multi-run GM overview) ─────────────────────────────────────
// Owner-scoped aggregate of every LIVE run across all of the caller's games, for a
// cross-run operations dashboard. A collection-group query filtered to the owner +
// status 'live' (needs the ownerUid+status composite index). Each row carries enough
// to render a card + alert badge; the UI deep-links into the existing per-run console.
export const listLiveRuns = loggedCallable('listLiveRuns', async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await db
    .collectionGroup('runs')
    .where('ownerUid', '==', uid)
    .where('status', '==', 'live')
    .get();

  const runs = await Promise.all(snap.docs.map(async (d) => {
    const r = d.data() as Run;
    const parts = d.ref.path.split('/'); // users/{ownerUid}/games/{gameId}/runs/{runId}
    const gameId = parts[3];
    let gameTitle = '';
    try {
      const gs = await db.doc(`users/${uid}/games/${gameId}`).get();
      gameTitle = (gs.data() as Game | undefined)?.title ?? '';
    } catch { /* title is best-effort */ }
    let unackedAlerts = 0;
    try {
      const agg = await d.ref.collection('alerts').where('acknowledged', '==', false).count().get();
      unackedAlerts = agg.data().count;
    } catch { /* alerts count is best-effort */ }
    return {
      ownerUid: uid,
      gameId,
      runId: r.id,
      gameTitle,
      accessCode: r.accessCode,
      participantCount: r.participantCount ?? 0,
      launchedAt: r.launchedAt ?? null,
      unackedAlerts,
    };
  }));

  runs.sort((a, b) => (b.launchedAt ?? '').localeCompare(a.launchedAt ?? ''));
  return { runs };
});


// ─── checkOutTask (release a station slot without completing) ─────────────────

export const checkOutTask = loggedCallable('checkOutTask', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'checkOutTask');
  const { taskId, ownerUid, gameId, runId, code } = data as {
    taskId: string;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');
  const { ctx } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);
  return { ok: true };
});


// ─── Post-game feedback (change: post-game-feedback) ──────────────────────────
// Each finished PLAYER (every attached device, not just the controller) may
// submit one short survey response. Owner-only aggregation with drill-down.

function feedbackCol(ownerUid: string, gameId: string, runId: string) {
  return `users/${ownerUid}/games/${gameId}/runs/${runId}/feedback`;
}

export const submitRunFeedback = loggedCallable('submitRunFeedback', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'submitRunFeedback');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };

  // Feedback is personal, so ANY attached device may answer (no controller gate).
  const { ctx, teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code });

  // The survey opens only once play is over — the team finished, or the whole
  // run was finalized (covers the waiting-for-finalize window on the client).
  const runSnap = await db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId)).get();
  const runFinished = (runSnap.data() as Run | undefined)?.status === 'finished';
  if (team.status !== 'finished' && !runFinished) {
    throw new functions.https.HttpsError('failed-precondition', 'Feedback opens when the game ends');
  }

  // Validate + normalize the payload (pure, unit-tested).
  const valid = validateFeedbackPayload(data);
  const memberName = team.devices?.find((d) => d.uid === uid)?.name;

  const ref = db.doc(`${feedbackCol(ctx.ownerUid, ctx.gameId, ctx.runId)}/${uid}`);
  const result = await db.runTransaction<{ already: boolean }>(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { already: true }; // one response per player; never overwrite
    const feedback: RunFeedback = {
      uid,
      teamId,
      teamName: team.displayName,
      ...(memberName ? { memberName } : {}),
      ratings: valid.ratings,
      ...(valid.issues.length ? { issues: valid.issues } : {}),
      ...(valid.comment ? { comment: valid.comment } : {}),
      lang: valid.lang,
      createdAt: new Date().toISOString(),
    };
    tx.set(ref, feedback);
    return { already: false };
  });

  return { ok: true, already: result.already };
});

export const getRunFeedbackSummary = loggedCallable('getRunFeedbackSummary', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'getRunFeedbackSummary');
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };

  // Owner-only. The creator console calls with just {gameId, runId} (owner ==
  // caller, like listRunTeams); a code path is also supported. The run doc's
  // own ownerUid is the authority for the gate.
  let resolved: { ownerUid: string; gameId: string; runId: string };
  if (code?.trim()) {
    const codeSnap = await db.doc(`accessCodes/${code.trim().toUpperCase()}`).get();
    if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
    const c = codeSnap.data() as AccessCode;
    resolved = { ownerUid: c.ownerUid, gameId: c.gameId, runId: c.runId };
  } else if (gameId && runId) {
    resolved = { ownerUid: ownerUid ?? uid, gameId, runId };
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'gameId and runId (or code) required');
  }

  const runSnap = await db.doc(runPath(resolved.ownerUid, resolved.gameId, resolved.runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if ((runSnap.data() as Run).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Feedback is organizer-only');
  }

  const [fbSnap, teamsSnap] = await Promise.all([
    db.collection(feedbackCol(resolved.ownerUid, resolved.gameId, resolved.runId)).get(),
    db.collection(teamsCol(resolved.ownerUid, resolved.gameId, resolved.runId)).get(),
  ]);
  const responses = fbSnap.docs.map((d) => d.data() as RunFeedback);
  // Participant count = distinct devices across all teams (each device is a
  // potential respondent), falling back to team count on legacy docs.
  const participantCount = teamsSnap.docs.reduce((n, d) => {
    const t = d.data() as RunTeam;
    return n + (t.deviceUids?.length ?? 1);
  }, 0);

  return {
    summary: computeFeedbackSummary(responses, participantCount),
    responses,
  };
});
