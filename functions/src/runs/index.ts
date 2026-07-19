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
  evaluatePresence,
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
  composeRunSummary,
  type RunSummary,
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
  isExpired,
  isUnlocked,
  isHintFree,
  isOrderingTask,
  matchesOrderedAnswer,
  validateSurveyResponse,
  pickCeremonyFeed,
  type FeedItem,
  type CeremonyFeedItem,
  rollPowerUp,
  POWER_UP_BONUS,
  type TeamPowerUps,
  type PowerUpLogEntry,
  taskCompletabilityError,
  cleanGameInstructions,
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
import { requireString, MAX_ID_LEN, normalizeAccessCode } from '@rushpoint/shared';
import { shouldRefreshLeaderboard, leaderboardRefreshFields } from './leaderboardThrottle';
import { assignTask, releaseTask, computeSkillRatio, buildRecommendations } from '../routing/assignNextTask';
import type { NoAssignmentReason } from '../routing/assignNextTask';
import { reconcileTaskCounts } from '../routing/reconcileTaskCounts';
import { sanitizeTaskForParticipant } from './sanitizeTask';
import {
  assertController, resolveDeviceRole, generateDeviceJoinCode, canAttachDevice,
  attachedDeviceUids, controllerUidOf, canAddRunDevice, MAX_RUN_DEVICES,
} from './teamDevices';
import type { RunFeedback } from '@rushpoint/shared';
import { validateFeedbackPayload, computeFeedbackSummary } from './feedbackSummary';
import { sendRunSummaryEmail } from './runSummaryEmail';
import { validate, parseStored } from '../validation';
import { parseGame, parseRun, parseRunTeam } from '@rushpoint/shared';

import { requireAuth } from '../auth';
import { applyStageCompletion } from './helpers';

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

// Parse a run's team docs for scoring, QUARANTINING (skipping) any single
// unparseable row instead of aborting the whole run's leaderboard. A legacy /
// poisoned team doc (e.g. a non-object registrationData written before the
// joinRun type guard existed) must not brick refreshLeaderboard / finalizeRun
// for every other team. Structural doc type so the pure-logic vitest can drive
// it without Firestore snapshots. buildRankings is shared by finalize + refresh,
// so both must quarantine identically or live vs final standings would drift.
export function parseTeamsQuarantining(
  docs: ReadonlyArray<{ id: string; data(): unknown }>,
): RunTeam[] {
  const out: RunTeam[] = [];
  for (const d of docs) {
    try {
      out.push(parseStored(() => parseRunTeam(d.data())));
    } catch (e) {
      logBestEffort('parseRunTeam.quarantine', { teamId: d.id }, e); // one bad row can't abort scoring
    }
  }
  return out;
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
  const { gameId, testDrive } = data as { gameId: string; testDrive?: boolean };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  if (game.ownerUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your game');
  if (game.stages.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Game has no stages — add at least one stage before launching');
  }
  // Unwinnable-task guard (defense in depth): updateGame rejects a task with no
  // usable answer key going forward, but a game saved before that check existed
  // (or edited by any other path) could still carry one. Catch it at launch —
  // the last point before real participants start racing against it — rather
  // than let every attempt fail forever.
  for (const stage of game.stages) {
    // Empty-stage guard (nightly hardening): a stage with no tasks becomes active
    // but has nothing to assign or complete, so it never finishes and the next
    // stage never unlocks — the team is stuck for the whole run. Reject at launch.
    if ((stage.tasks?.length ?? 0) === 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Every stage needs at least one task before launching');
    }
    for (const task of stage.tasks ?? []) {
      const err = taskCompletabilityError(task);
      if (err) throw new functions.https.HttpsError('failed-precondition', err);
    }
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
    // Only test-drive runs carry the flag — normal runs stay free of the field.
    ...(testDrive ? { isTestDrive: true } : {}),
    launchedAt: now, createdAt: now, updatedAt: now,
  });
  const accessCode: AccessCode = { code, ownerUid: uid, gameId, runId: runRef.id, status: 'unused', createdAt: now };

  // ── Billing + run creation are ATOMIC (row 43): the run + access code are
  //    written in the SAME transaction that consumes the credit, so a write
  //    failure can never burn a paid credit without producing a run. The decision
  //    (pro / free-run / credit / refuse) is the pure resolveLaunchBilling helper.
  //    Free mode (PAYMENTS_ENABLED === false) touches the wallet not at all. ──
  if (testDrive) {
    // Test-drive (rehearsal) launch (change: test-drive-mode): free, capped at 2,
    // wallet never touched — SAME path in both payment modes. Always a transaction
    // (even in free mode, which normally uses a batch) because the abuse guard
    // needs a read phase.
    const decision = resolveLaunchBilling(PAYMENTS_ENABLED, {}, { testDrive: true });
    const billingType = decision.ok ? decision.billingType : 'test';
    const maxParticipants = decision.ok ? decision.maxParticipants : 2;
    await db.runTransaction(async (t) => {
      // Abuse guard: at most ONE live (not finished) test-drive run per game.
      // Equality-only query (no '!=' → no composite index, txn-safe via
      // t.get(Query)); the tiny result set is status-filtered in code.
      const liveTests = await t.get(
        db.collection(`users/${uid}/games/${gameId}/runs`).where('isTestDrive', '==', true),
      );
      if (liveTests.docs.some((d) => (d.data() as Run).status !== 'finished')) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'A test run for this game is already live. Finalize it before launching another.',
        );
      }
      t.set(runRef, buildRun(billingType, maxParticipants));
      t.set(accessCodeRef, accessCode);
    });
  } else if (!PAYMENTS_ENABLED) {
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

  // Increment game.playCount (best-effort, outside the atomic launch). A test
  // drive is a rehearsal, not a play, so it is excluded (change: test-drive-mode).
  if (!testDrive) {
    db.doc(gamePath(uid, gameId)).update({ playCount: admin.firestore.FieldValue.increment(1) }).catch((e) => logBestEffort('game.playCount.increment', { gameId }, e));
  }

  return { runId: runRef.id, accessCode: code };
});


// ─── getJoinInfo ──────────────────────────────────────────────────────────────
// Client-safe lookup before joining: given an access code, return the game's
// title, branding, mode, and registration fields so the join form can render.

export const getJoinInfo = loggedCallable('getJoinInfo', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'getJoinInfo');
  const { code } = data as { code: string };
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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
    // Test-drive flag so play-web can show a persistent "TEST RUN" banner
    // (change: test-drive-mode). Absent on normal runs → false.
    isTestDrive: run?.isTestDrive ?? false,
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

  const normalizedCode = validate(() => normalizeAccessCode(code));
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
  // Type guard: a non-plain-object registrationData (array / string / number)
  // would be stored and later make parseRunTeam throw when scoring the run
  // (reqObject('RunTeam', …, 'registrationData')), bricking refreshLeaderboard/
  // finalizeRun. Reject at the boundary; the quarantine below is the backstop.
  if (
    registrationData != null &&
    (typeof registrationData !== 'object' ||
      Array.isArray(registrationData) ||
      Object.getPrototypeOf(registrationData) !== Object.prototype)
  ) {
    throw new functions.https.HttpsError('invalid-argument', 'registrationData must be an object');
  }

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

  // Idempotent: team already registered in this run (own-team fast path).
  const existingTeam = await db.doc(teamPath(ownerUid, gameId, runId, teamId)).get();
  if (existingTeam.exists) {
    return { teamId, runId, gameId, ownerUid, alreadyJoined: true };
  }
  // Split-brain guard: this uid may already be an ATTACHED DEVICE of another
  // team in this run (joined via joinTeamAsDevice). Minting a second standalone
  // team here makes the uid a member of two teams and double-counts
  // participant/device totals. Mirror joinTeamAsDevice's array-contains guard.
  const attachedQ = await db.collection(teamsCol(ownerUid, gameId, runId))
    .where('deviceUids', 'array-contains', teamId).limit(1).get();
  if (!attachedQ.empty) {
    const t = attachedQ.docs[0].data() as RunTeam;
    return { teamId: t.id, runId, gameId, ownerUid, alreadyJoined: true };
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
      const msg = r.billingType === 'test'
        ? `This is a ${cap}-person test run. Launch a real run to invite more players.`
        : r.billingType === 'free'
          ? `This free run is full (${cap} participants max). The host can add an Event Credit or go Pro for more.`
          : `This run is full (${cap} participants max).`;
      throw new functions.https.HttpsError('resource-exhausted', msg, { cap, used });
    }
    // Global per-run phone ceiling — additive to the billing cap above. The founding
    // phone counts as one device. Legacy runs (no deviceCount) fall back to the team
    // count as a lower bound; the field becomes exact once written here.
    const usedDevices = r.deviceCount ?? used;
    if (!canAddRunDevice(usedDevices).ok) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `This run is full (${MAX_RUN_DEVICES} devices max).`,
        { cap: MAX_RUN_DEVICES, used: usedDevices },
      );
    }
    t.set(teamRef, team);
    t.update(runRef, { participantCount: used + 1, deviceCount: usedDevices + 1, updatedAt: now });
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
  // survey-tasks: optional per-completion extras stamped onto the team's task
  // record INSIDE the existing transaction (no new transaction, no new reads).
  extras?: { surveyResponse?: string },
): Promise<{ completed: boolean; heldSlot: boolean }> {
  // Returns { completed, heldSlot }. `completed` is TRUE only when this call
  // actually transitioned the task to completed; a duplicate/idempotent no-op
  // (already completed, team/task missing) returns completed:false so callers skip
  // the follow-on releaseTask + next-task assignment — otherwise two concurrent
  // duplicate completions each assign the next task and leak a station-occupancy
  // slot (adversarial-smoke "leaked station slots"). `heldSlot` is TRUE only when
  // THIS team actually reserved this task (activeTaskId/'assigned') so callers
  // release the station slot ONLY for a slot the team held — a permissive/cross-
  // team completion must not decrement another team's reservation (station-cap-bypass).
  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  const game = gameSnap.data() as Game;
  // Hot Zone (if any) is read-only here — used to multiply the earned score for
  // completions inside the zone+window (hot-zone-bonus). Server-decided.
  const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  const runData = runSnap.data() as Run | undefined;
  // WO Fix 3: a finished run's final board is published — a straggler completion
  // must not score, or it would (together with an un-frozen board) silently rewrite
  // the published FINAL standings. Reject at every grading path (this is the single
  // choke point). finalizeRun also freezes the board (belt-and-suspenders).
  if (runData?.status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This run has already finished');
  }
  const hotZone = runData?.hotZone;
  const launchedAt = runData?.launchedAt;
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, teamId));
  // WO Fix 1: fold the station-slot release INTO this transaction so completion and
  // release commit atomically. Read the run doc inside the txn (all reads precede
  // all writes) and decrement run.taskCounts for the completed slot + any
  // assigned-but-auto-skipped slots — no separate post-commit releaseTask that
  // could be dropped (leaving a leaked slot) if the process dies between commit and
  // release.
  const runRef = db.doc(runPath(ownerUid, gameId, runId));

  // Station-occupancy slots held by tasks that get auto-skipped when a partial
  // stage completes early. assignTask incremented taskCounts for an ASSIGNED
  // task; the skip below must release it or the slot leaks. WO Fix 1: released
  // INSIDE this transaction (atomic with the completion). Reset per attempt so a
  // transaction retry never double-decrements.
  let skippedHeldTaskIds: string[] = [];

  const result = await db.runTransaction<{ completed: boolean; heldSlot: boolean }>(async (tx) => {
    skippedHeldTaskIds = [];
    // All reads up front (teamRef + runRef) before any write, per the Firestore
    // transaction rule (WO Fix 1).
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) return { completed: false, heldSlot: false };
    const team = teamSnap.data() as RunTeam;
    const runSnapTx = await tx.get(runRef);
    const counts = (runSnapTx.data() as { taskCounts?: Record<string, number> } | undefined)?.taskCounts ?? {};

    // WO Fix 2: stage 0 is 'active' at join (buildInitialStages) while the team is
    // still launched:false, so a team could grade stage-1 tasks BEFORE the host
    // presses start. Gate every grading path on launched here (the single choke
    // point) — startTeams sets launched:true before assigning, so real completions
    // are unaffected, and self-guided runs seed launched:true.
    if (team.launched !== true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        "The host hasn't started the game yet",
      );
    }

    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));

    // Find the task
    let stageIdx = -1, taskIdx = -1;
    for (let si = 0; si < stages.length; si++) {
      const ti = stages[si].tasks.findIndex((t) => t.taskId === taskId);
      if (ti >= 0) { stageIdx = si; taskIdx = ti; break; }
    }
    if (stageIdx < 0) return { completed: false, heldSlot: false };

    const taskRec = stages[stageIdx].tasks[taskIdx];
    if (taskRec.status === 'completed') return { completed: false, heldSlot: false }; // idempotent

    // Station-cap integrity (fix: station-cap-bypass): did THIS team actually hold a
    // reservation for this task? run.taskCounts is incremented ONLY by assignTask for
    // a task it assigns (→ record 'assigned' + activeTaskId). A completion of a task
    // the team never reserved (a hand-crafted completeTask on a slot ANOTHER team
    // holds) must not let the caller releaseTask — that decrement would drain the
    // other team's reservation and silently defeat the station cap. Mirrors the
    // checkOutTask in-flight test.
    const heldSlot = team.activeTaskId === taskId || taskRec.status === 'assigned';

    // Stage-lock enforcement: a completion may only land in the team's ACTIVE
    // stage. A task in a locked (future / scheduled-gated) or already-completed
    // stage must be rejected — the only prior guard (isUnlocked) covers
    // intra-stage prerequisites, not stage ordering. Central here so all five
    // calling paths (completeTask, submitTaskAnswer, submitSequenceStep,
    // verifyStationCode, submitStationPhoto autoApprove) are closed at once.
    // Order matters: the already-completed no-op above stays BEFORE this throw so
    // a duplicate submission of an already-graded task remains a silent no-op.
    if (stages[stageIdx].status !== 'active') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This stage is not active yet — finish your current stage first',
      );
    }

    const startedAt = taskRec.startedAt ?? team.startedAt ?? now;
    // Guard against an unparsable stored timestamp: a NaN here would be persisted
    // onto the team doc and later poison the benchmark aggregation (nightly hardening).
    const rawMinutes = (new Date(now).getTime() - new Date(startedAt).getTime()) / 60_000;
    const actualMinutes = Number.isFinite(rawMinutes) ? Math.max(0, rawMinutes) : 0;

    // Score this task. Look up the game task by id (not by [stageIdx][taskIdx]):
    // team.stages is order-sorted while game.stages is stored in the builder's
    // array order, so the two index spaces can diverge and score the wrong task.
    const gameTask = findGameTask(game, taskId);

    // Unlockable tasks (change: unlockable-tasks): a task with unmet same-stage
    // prerequisites cannot be completed, whatever path funnels here (completeTask,
    // submitTaskAnswer, submitSequenceStep, verifyStationCode, photo review).
    // Completed ids come from the freshly-read team state INSIDE this transaction.
    if (gameTask) {
      const completedTaskIds = stages
        .flatMap((s) => s.tasks)
        .filter((t) => t.status === 'completed')
        .map((t) => t.taskId);
      if (!isUnlocked(gameTask, completedTaskIds)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'This task is locked — complete its prerequisite tasks first',
        );
      }
    }

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
    // survey-tasks: stamp the team's own response on its task record via the same
    // whole-object stage rewrite the record already gets (never a dotted array
    // path). The already-completed guard above makes duplicate submissions a
    // no-op, so the first response is final and is never overwritten.
    if (extras?.surveyResponse != null) {
      taskRec.surveyResponse = extras.surveyResponse;
    }

    // Power-ups (change: power-ups) — ALL inside this existing transaction; no new
    // transaction, no new reads (game/run docs already fetched above). Two phases:
    // (1) CONSUME an armed double on THIS completion, then (2) ROLL for it. Effects
    // flow through the two audited channels only (`earnedScore` and `bonusPenalty`)
    // so buildRankings never changes and Σ-earned == score stays true by construction.
    const powerUps: TeamPowerUps = team.powerUps
      ? { active: team.powerUps.active, log: [...team.powerUps.log] }
      : { log: [] };
    let bonusPenaltyDelta = 0; // negative = a flat bonus (bonusPenalty is subtracted)

    // (1) Consume: an armed double_points doubles a >0 earnedScore. Hot-zone first
    // (already applied above), THEN ×2 — both recorded in scoreBreakdown. A 0-point
    // task must NOT burn the double (it stays armed for the next scoring completion).
    let powerUpMultiplier = 1;
    if (powerUps.active === 'double_points' && earnedScore > 0) {
      const preDouble = earnedScore;
      earnedScore *= 2;
      powerUpMultiplier = 2;
      // Stamp the matching (most recent unconsumed) double log entry.
      for (let i = powerUps.log.length - 1; i >= 0; i--) {
        if (powerUps.log[i].type === 'double_points' && !powerUps.log[i].consumedByTaskId) {
          powerUps.log[i] = { ...powerUps.log[i], consumedByTaskId: taskId, amount: preDouble };
          break;
        }
      }
      powerUps.active = undefined;
    }

    taskRec.earnedScore = earnedScore;
    // scoreBreakdown composes hot-zone (first) then the ×2 power-up (both fields set
    // when both applied) so the audit trail shows the full derivation.
    taskRec.scoreBreakdown = {
      taskScore: baseScore,
      ...(multiplier !== 1 ? { hotZoneMultiplier: multiplier } : {}),
      ...(powerUpMultiplier !== 1 ? { powerUpMultiplier } : {}),
      total: earnedScore,
    };

    // (2) Roll for the just-completed task. Only when enabled AND not time_only (no
    // task points to double; a flat bonus corrupts a pure-time ranking). Deterministic
    // seeded hash ⇒ an idempotent replay recomputes the same result (and the
    // already-completed guard above means this is never reached twice anyway).
    if (game.powerUpsEnabled === true && game.scoringPreset !== 'time_only') {
      let won = rollPowerUp(runId, teamId, taskId);
      // Single armed slot: a second double while one is armed converts to a bonus.
      if (won === 'double_points' && powerUps.active === 'double_points') {
        won = 'bonus_points';
      }
      if (won) {
        const entry: PowerUpLogEntry = { taskId, type: won, awardedAt: now };
        if (won === 'bonus_points') {
          bonusPenaltyDelta -= POWER_UP_BONUS; // a bonus is a NEGATIVE penalty (decrement)
          entry.amount = POWER_UP_BONUS;
        } else {
          powerUps.active = 'double_points';
        }
        powerUps.log.push(entry);
      }
    }

    // Stage completion via the shared single-source helper (applyStageCompletion):
    // a stage may require only a SUBSET of its tasks (requiredTaskCount); when it
    // finishes, leftover tasks are auto-skipped, the next stage unlocks (unless
    // scheduled-release-gated), and any leftover that was still ASSIGNED holds a
    // station slot — collect those for release after the transaction.
    const { heldAssignedTaskIds } = applyStageCompletion(stages, stageIdx, game, launchedAt, now);
    skippedHeldTaskIds.push(...heldAssignedTaskIds);

    const allDone = stages.every((s) => s.status === 'completed');
    const newScore = (team.score ?? 0) + earnedScore;

    // powerUps is written as a WHOLE nested object (log rewritten as a full array —
    // never a dotted array-element update, which would coerce the array to a map).
    // An update() replaces the whole `powerUps` field with the object below, so when
    // the slot is cleared we OMIT the `active` key entirely (it reads back as absent)
    // rather than writing an explicit null that would persist as a stored null.
    const powerUpsChanged =
      game.powerUpsEnabled === true &&
      (powerUps.log.length > 0 || powerUps.active !== undefined || team.powerUps !== undefined);

    tx.update(teamRef, {
      stages,
      score: newScore,
      ...(bonusPenaltyDelta !== 0 ? { bonusPenalty: (team.bonusPenalty ?? 0) + bonusPenaltyDelta } : {}),
      ...(powerUpsChanged
        ? { powerUps: { log: powerUps.log, ...(powerUps.active !== undefined ? { active: powerUps.active } : {}) } }
        : {}),
      ...(allDone ? { status: 'finished', finishedAt: now } : {}),
      activeTaskId: null,
      updatedAt: now,
    });

    // WO Fix 1: release the station slots ATOMICALLY in the same commit. Decrement
    // the completed task's slot (only when THIS team held it) plus every
    // assigned-but-auto-skipped leftover, each guarded by the same >0 check
    // releaseTask uses so a stale/zero counter never goes negative. `counts` is the
    // value read at the top of this txn; Firestore serializes conflicting writes so
    // the increment is applied against the committed value.
    if (heldSlot && (counts[taskId] ?? 0) > 0) {
      tx.update(runRef, { [`taskCounts.${taskId}`]: admin.firestore.FieldValue.increment(-1) });
    }
    for (const id of skippedHeldTaskIds) {
      if ((counts[id] ?? 0) > 0) {
        tx.update(runRef, { [`taskCounts.${id}`]: admin.firestore.FieldValue.increment(-1) });
      }
    }
    return { completed: true, heldSlot };
  });

  // Keep the live leaderboard snapshot fresh (throttled; best-effort). WO Fix 2:
  // fire-and-forget — the ~throttled recompute must NOT block the player's
  // completion response (it dominated completeTask p95). maybeRefreshLeaderboard
  // re-reads + re-throttles + is last-write-wins idempotent, so dropping the await
  // is safe; the next scoring event and every organizer refresh recompute it, and
  // finalizeRun reconciles definitively. Caveat: post-response background work on
  // Cloud Functions can be terminated before it runs — acceptable here (best-effort).
  if (result.completed) {
    void maybeRefreshLeaderboardSnapshot(ownerUid, gameId, runId)
      .catch((e) => functions.logger.warn('leaderboard refresh (best-effort) failed', { runId, error: (e as Error).message }));
  }
  return result;
}

// Read-modify-write a player's cross-run profile (change: player-profile-badges).
// Server-only (players/{uid} is CF-write-only); transactional so concurrent finishes
// on the same device don't clobber each other. Called from finalizeRun (batch), NOT
// the hot completeTask path — one profile write per team at run finalize.
// When `teamRef` is given, the run's `profileRecorded` guard is checked AND set inside
// the SAME transaction, so two concurrent finalizeRun calls can't double-count.
async function recordPlayerResult(
  r: { uid: string; displayName?: string; tasksCompleted: number; points: number },
  teamRef?: FirebaseFirestore.DocumentReference,
): Promise<void> {
  const ref = db.doc(`players/${r.uid}`);
  await db.runTransaction(async (tx) => {
    // All reads before any writes (Firestore transaction rule).
    const teamSnap = teamRef ? await tx.get(teamRef) : null;
    if (teamSnap && (teamSnap.data() as { profileRecorded?: boolean } | undefined)?.profileRecorded) {
      return; // already recorded by a concurrent finalize — skip
    }
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as PlayerProfile) : null;
    const { profile } = mergePlayerResult(prev, r);
    tx.set(ref, { ...profile, updatedAt: new Date().toISOString() }, { merge: true });
    if (teamRef) tx.update(teamRef, { profileRecorded: true });
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

  // Station slots held by an assigned task that gets skipped here — released
  // after the transaction (same reason as completeTaskForTeam). Reset per attempt.
  let skippedHeldTaskIds: string[] = [];

  await db.runTransaction(async (tx) => {
    skippedHeldTaskIds = [];
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
        if (taskRec.status === 'assigned') skippedHeldTaskIds.push(taskRec.taskId);
        // Look the game task up by id, not by (activeIdx, taskIndex): team.stages is
        // sorted by `order` but `game.stages` is builder-array order, so indexing can
        // hit the wrong stage/task and mis-award. Same fix completeTaskForTeam already
        // uses (nightly hardening).
        const gameTask = findGameTask(game, taskRec.taskId);
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

  // Release any station slot held by a skipped-while-assigned task (guarded no-op at 0).
  for (const id of skippedHeldTaskIds) {
    await releaseTask(id, uid, gameId, runId);
  }

  // Owner-triggered scoring event: surface the skip award immediately.
  await maybeRefreshLeaderboardSnapshot(uid, gameId, runId, { force: true });

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
    // Default a missing bonusPenalty to 0 (every other read of it in this file
    // does) — the auto-refresh path reads teams with a raw cast (no parseRunTeam),
    // so an absent field here would otherwise yield NaN in run.leaderboard.
    rawScore = applyPenalties(rawScore, team.bonusPenalty ?? 0);

    const durSec = durationSeconds(team.startedAt, team.finishedAt ?? now);
    // A joined-but-not-started team has no startedAt → durationSeconds returns
    // Infinity. Never let a non-finite duration reach the (serialized) leaderboard
    // — it would crash getMyTeamState/refreshLeaderboard at JSON-encode. Both sort
    // comparators below already coalesce a missing durationSeconds with `?? Infinity`,
    // so omitting the field keeps ordering identical.
    const durFinite = Number.isFinite(durSec) ? durSec : undefined;
    return {
      rank: 0,
      teamId: team.id,
      teamName: team.displayName,
      score: rawScore,
      completedStages: team.stages.filter((s) => s.status === 'completed').length,
      finishedAt: team.finishedAt,
      durationSeconds: durFinite,
      totalMinutes: durFinite != null ? durFinite / 60 : undefined,
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
      // WO Fix 3: terminal teamId tie-break so tied teams don't churn between
      // refreshes (the team list is read via an unordered Firestore query). Mirrors
      // the non-time branch's stable fallback below.
      if (b.completedStages !== a.completedStages) return b.completedStages - a.completedStages;
      return a.teamId.localeCompare(b.teamId);
    }
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break (equal score is common mid-run, e.g. two teams at 0
    // points, and the team list is read via an unordered Firestore query — without
    // this the live leaderboard could silently reorder tied teams on every
    // refresh). Prefer more progress, then a finished team over an unfinished one,
    // then less elapsed time, then teamId as a final stable fallback.
    if (b.completedStages !== a.completedStages) return b.completedStages - a.completedStages;
    const aFinished = a.finishedAt ? 1 : 0;
    const bFinished = b.finishedAt ? 1 : 0;
    if (bFinished !== aFinished) return bFinished - aFinished;
    if (a.durationSeconds !== b.durationSeconds) return (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity);
    return a.teamId.localeCompare(b.teamId);
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

// ─── Live leaderboard auto-refresh (change: live-leaderboard-auto-refresh) ────
// Recompute run.leaderboard after a scoring event so every surface that renders
// the snapshot (console panel, TV/public boards, participant final screen) stays
// fresh without the organizer clicking "Refresh standings". INTERNAL — called
// from completeTaskForTeam / adjustTeamScore / skipStage, never re-exported as a
// callable (like completeTaskForTeam itself).
//
// Best-effort by design: a refresh failure must never fail the completion or
// adjustment that triggered it. Plain reads + one update(), NO transaction —
// concurrent refreshes are idempotent recomputes from current team docs, so
// last-write-wins is always a correct board.
export async function maybeRefreshLeaderboardSnapshot(
  ownerUid: string,
  gameId: string,
  runId: string,
  opts?: { force?: boolean },
): Promise<void> {
  try {
    const runRef = db.doc(runPath(ownerUid, gameId, runId));
    const runSnap = await runRef.get();
    if (!runSnap.exists) return;
    const run = runSnap.data() as Run;

    // A frozen board means "stop updating the reveal" — never auto-overwrite it.
    if (run.leaderboard?.frozen) return;
    if (!opts?.force && !shouldRefreshLeaderboard(run.leaderboard?.updatedAt, Date.now())) return;

    const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
    if (!gameSnap.exists) return;
    const game = gameSnap.data() as Game;

    const teamsSnap = await db.collection(teamsCol(ownerUid, gameId, runId)).get();
    const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

    const now = new Date().toISOString();
    const rankings = buildRankings(game, teams, now);

    // Commit under a SHORT transaction that RE-READS the run doc. The game + teams
    // reads above take tens of ms; an organizer publish (refreshLeaderboard
    // publish:true / finalizeRun) or a freeze can land in that window. Re-reading
    // here lets us respect a freeze that just landed, and writing via dotted FIELD
    // PATHS (leaderboardRefreshFields) rewrites only rankings + timestamps so the
    // organizer-controlled published/frozen flags are never clobbered. A plain
    // full-object write would revert `published` to a stale value — silently
    // un-publishing the public board at the exact moment of the reveal.
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(runRef);
      if (!cur.exists) return;
      if ((cur.data() as Run).leaderboard?.frozen) return; // a freeze landed — respect it
      tx.update(runRef, leaderboardRefreshFields(rankings, now));
    });
  } catch (e) {
    functions.logger.warn('leaderboard auto-refresh skipped', {
      ownerUid, gameId, runId, error: (e as Error).message,
    });
  }
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
  // Validate the stored docs that feed buildRankings — a corrupt run/game/team
  // fails loud (internal) rather than skewing the final standings (parse-boundary).
  const run = parseStored(() => parseRun(runSnap.data()));
  if (run.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  // Double-finalize guard (state-machine): the leaderboard recompute below is
  // deterministic from current team state, so re-running it is harmless — but
  // the platform benchmark contribution further down is a ROLLING aggregate
  // merge and is NOT idempotent. Without this flag, a double-click / retried
  // finalizeRun call would fold the same run's stats into benchmarks/{taskType}
  // twice, corrupting the cross-tenant median/completion-rate for every
  // creator sharing that task type (player-profile writes are separately
  // guarded by `profileRecorded` on each team, so they stay safe either way).
  const alreadyFinalized = run.status === 'finished';

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = parseStored(() => parseGame(gameSnap.data()));

  const teamsSnap = await db.collection(teamsCol(uid, gameId, runId)).get();
  const teams = parseTeamsQuarantining(teamsSnap.docs);

  const now = new Date().toISOString();
  const rankings = buildRankings(game, teams, now);

  // Finalizing always publishes the final standings to participants.
  await runRef.update({
    status: 'finished',
    finishedAt: now,
    // WO Fix 3: freeze the FINAL board so the throttled auto-snapshot
    // (maybeRefreshLeaderboardSnapshot bails on frozen) can never recompute and
    // overwrite the published final standings after finalize. An organizer can
    // still explicitly un-freeze via refreshLeaderboard if they intend to.
    leaderboard: { rankings, frozen: true, published: true, updatedAt: now },
    // Reconcile station reservations from the live team docs (Fix 1 backstop):
    // recompute taskCounts as the ground truth of who ACTUALLY still holds a slot
    // (a non-empty activeTaskId) rather than blindly zeroing. A fully-finished run
    // reconciles to {} (all teams released), but a team stuck mid-task at finalize
    // keeps its real reservation instead of the doc lying with {}. Crucially, a
    // LEAKED +1 (a counter above its true holder count, e.g. from a crash between
    // reserve and release) is self-healed here to the reconciled value — one
    // idempotent write, off the hot path. Harmless post-finalize (no more
    // assignments), and keeps archived taskCounts honest for audits.
    taskCounts: reconcileTaskCounts(teams),
    updatedAt: now,
  });

  // Player profiles (change: player-profile-badges): fold each finished team's result
  // into the player's cross-run profile. Done here as a batch — OFF the hot completeTask
  // path — and made idempotent by `profileRecorded` on the team so a re-finalize never
  // double-counts. Best-effort: a profile write must never fail finalize.
  // A test-drive run is a rehearsal — excluded from cross-run player profiles
  // (change: test-drive-mode).
  if (!run.isTestDrive) try {
    const scoreByTeam = new Map(rankings.map((r) => [r.teamId, r.score]));
    for (const d of teamsSnap.docs) {
      const team = d.data() as RunTeam & { profileRecorded?: boolean };
      if (team.status !== 'finished' || team.profileRecorded) continue;
      const tasksCompleted = (team.stages ?? []).reduce(
        (n, s) => n + (s.tasks ?? []).filter((t) => t.status === 'completed').length, 0);
      // The `profileRecorded` guard is checked + set atomically inside recordPlayerResult
      // (same transaction as the profile write) so a concurrent finalize can't double-count.
      await recordPlayerResult({
        uid: d.id,
        displayName: team.displayName,
        tasksCompleted,
        points: scoreByTeam.get(d.id) ?? team.score ?? 0,
      }, d.ref);
    }
  } catch (e) {
    logBestEffort('finalize.playerProfiles', { runId }, e);
  }

  // Platform benchmark contribution (platform-benchmark): fold anonymized,
  // per-task-type aggregates (median completion time + completion rate) into
  // benchmarks/{taskType}. No per-run identifiers are written. Opt-outable via
  // game.benchmarkOptOut. Best-effort — never blocks finalize. A test-drive run
  // is excluded so a rehearsal never pollutes platform benchmarks
  // (change: test-drive-mode).
  if (!game.benchmarkOptOut && !run.isTestDrive && !alreadyFinalized) {
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

  // Run summary email seam (change: run-summary-report). Strictly last, post-commit,
  // OUTSIDE any transaction: compose the organizer summary from the just-written
  // standings + feedback and hand it to the single email seam. Recipient is an env
  // override or the owner's stored email. Best-effort — never allowed to affect
  // finalize's return. Disabled/no-provider ⇒ a logged no-op (no socket opened).
  try {
    const feedbackSnap = await db.collection(feedbackCol(uid, gameId, runId)).get();
    const responses = feedbackSnap.docs.map((d) => d.data() as RunFeedback);
    const summary = buildRunSummaryResult(
      game,
      { ...run, status: 'finished', finishedAt: now, leaderboard: { rankings, frozen: true, published: true, updatedAt: now } },
      teams,
      responses,
    );
    const ownerSnap = await db.doc(`users/${uid}`).get();
    const recipient = process.env.RUN_SUMMARY_EMAIL_TO
      ?? (ownerSnap.data() as { email?: string } | undefined)?.email
      ?? null;
    await sendRunSummaryEmail(summary, recipient);
  } catch (e) {
    logBestEffort('finalize.runSummaryEmail', { runId }, e);
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
  // Validate the stored docs that feed buildRankings — buildRankings is shared by
  // finalizeRun + refreshLeaderboard, so a corrupt doc here would drift live vs
  // final standings; fail loud (internal) instead (parse-boundary).
  const run = parseStored(() => parseRun(runSnap.data()));
  if (run.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = parseStored(() => parseGame(gameSnap.data()));

  const teamsSnap = await db.collection(teamsCol(uid, gameId, runId)).get();
  const teams = parseTeamsQuarantining(teamsSnap.docs);

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
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;

  const board = run?.leaderboard;
  const published = !!board?.published;

  // Ceremony mode (change: ceremony-mode): the run's top-liked approved feed
  // items, server-selected + capped, so the big screen never needs a Firestore
  // rules path to feedItems. Gated on `published` exactly like rankings — an
  // unpublished run leaks neither standings nor photos. A run that predates
  // live-photo-feed (or was pruned) simply yields [] and the slideshow skips.
  let ceremonyFeed: CeremonyFeedItem[] = [];
  if (published) {
    try {
      const feedSnap = await db
        .collection(`${runPath(c.ownerUid, c.gameId, c.runId)}/feedItems`)
        .get();
      ceremonyFeed = pickCeremonyFeed(feedSnap.docs.map((d) => d.data() as FeedItem));
    } catch {
      ceremonyFeed = [];
    }
  }

  return {
    title: game.branding?.name ?? game.title,
    branding: game.branding ?? null,
    runStatus: run?.status ?? 'live',
    published,
    frozen: !!board?.frozen,
    updatedAt: board?.updatedAt ?? null,
    rankings: published ? board!.rankings : [],
    ceremonyFeed,
    // Labeling flag so shared surfaces can watermark test-drive data
    // (change: test-drive-mode).
    isTestDrive: run?.isTestDrive ?? false,
    // The `time_only` preset's `score` field is a meaningless placeholder
    // (e.g. 500/0) — it's time, not points, that ranks teams. Surface the
    // preset so public/TV leaderboard surfaces can honestly hide the score
    // column and show elapsed time instead, rather than a fake-looking number.
    scoringPreset: game.scoringPreset,
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
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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
    isTestDrive: run?.isTestDrive ?? false,
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
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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
    isTestDrive: run?.isTestDrive ?? false,
    ...computeRunAnalytics(teams, gameTasks),
  };
});


// ─── getRunSummary (run-summary-report) ───────────────────────────────────────
// Owner-only, one-shot organizer report that folds the three existing post-run
// aggregators (recap + analytics + feedback) into a single RunSummary via the pure
// composeRunSummary. Resolves the run by access code and refuses non-owners —
// exactly mirroring getRunAnalytics. Retention-safe: pruned teams/feedback just
// contribute nothing. The same helper feeds the finalizeRun email seam so the two
// can never drift.

/**
 * Assemble a RunSummary from the raw docs: run each of the three aggregators, then
 * fold via composeRunSummary. Internal (not a callable) so the getRunSummary
 * callable and the finalizeRun email seam share one code path and can't diverge.
 * participantCount uses the same "distinct devices" rule as getRunFeedbackSummary.
 */
function buildRunSummaryResult(
  game: Game | null,
  run: (Pick<Run, 'leaderboard'> & Partial<Run>) | null,
  teams: RunTeam[],
  responses: RunFeedback[],
): RunSummary {
  const gameTasks = (game?.stages ?? []).flatMap((s) => s.tasks).map((t) => ({ id: t.id, type: t.type }));
  const participantCount = teams.reduce((n, t) => n + (t.deviceUids?.length ?? 1), 0);
  // A few real player comments give the organizer actual feedback text, not just
  // counts. composeRunSummary caps this to 5; we just filter empties here.
  const comments = responses
    .filter((r) => r.comment && r.comment.trim())
    .map((r) => ({ teamName: r.teamName, text: r.comment!.trim() }));
  return composeRunSummary({
    title: game?.branding?.name ?? game?.title ?? 'RushPoint',
    runStatus: run?.status ?? 'live',
    finishedAt: run?.finishedAt,
    isTestDrive: run?.isTestDrive ?? false,
    recap: buildRunRecap(teams, run ?? { leaderboard: undefined }),
    analytics: computeRunAnalytics(teams, gameTasks),
    feedback: computeFeedbackSummary(responses, participantCount),
    comments,
  });
}

export const getRunSummary = loggedCallable('getRunSummary', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const { code } = data as { code: string };
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (uid !== c.ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Summary is organizer-only');
  }

  const [gameSnap, runSnap, teamsSnap, fbSnap] = await Promise.all([
    db.doc(gamePath(c.ownerUid, c.gameId)).get(),
    db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get(),
    db.collection(teamsCol(c.ownerUid, c.gameId, c.runId)).get(),
    db.collection(feedbackCol(c.ownerUid, c.gameId, c.runId)).get(),
  ]);
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  const run = runSnap.exists ? (runSnap.data() as Run) : null;
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);
  const responses = fbSnap.docs.map((d) => d.data() as RunFeedback);

  return buildRunSummaryResult(game, run, teams, responses);
});


// ─── getRunHeatmap (movement-heatmap) ─────────────────────────────────────────
// Owner-only foot-traffic density over the run's retained GPS track. Resolves the run
// by access code, refuses non-owners, bins the track via the pure buildMovementDensity.
// Prune-safe: a cleared track just yields no cells.
export const getRunHeatmap = loggedCallable('getRunHeatmap', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  await enforceRateLimit(uid, 'getRunHeatmap');
  const { code } = data as { code: string };
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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
  await enforceRateLimit(uid, 'getMyProfile');
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
  await enforceRateLimit(uid, 'createTrackable');
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
  await enforceRateLimit(uid, 'createZone');
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
  await enforceRateLimit(uid, 'deleteZone');
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
    const t = d.data() as RunTeam & {
      taskSubmissions?: Record<string, { status?: string }>;
    };
    const activeStageOrder = t.stages.find((s) => s.status === 'active')?.order ?? null;
    // Pending photo/audio station reviews awaiting staff action (WO-4): without
    // this signal a non-console consumer is blind to why a team has stalled.
    const pendingReviews = Object.values(t.taskSubmissions ?? {}).filter(
      (s) => s?.status === 'pending',
    ).length;
    return {
      id: t.id,
      displayName: t.displayName,
      memberNames: t.memberNames ?? [],
      memberCount: t.memberCount ?? 1,
      status: t.status,
      score: t.score,
      // Staff adjustments/hints live here (subtracted from score at ranking
      // time); exposed so the console can show the effective score.
      bonusPenalty: t.bonusPenalty ?? 0,
      completedStages: t.stages.filter((s) => s.status === 'completed').length,
      pendingReviews,
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
    const normalizedCode = validate(() => normalizeAccessCode(ctx.code));
    const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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
  const normalizedCode = validate(() => normalizeAccessCode(code));
  if (!teamCode?.trim()) throw new functions.https.HttpsError('invalid-argument', 'teamCode required');
  if (memberName != null) validate(() => requireString(memberName, 'memberName', MAX_ID_LEN));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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

  const runRef = db.doc(runPath(ownerUid, gameId, runId));
  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    // All reads before any write (Firestore transaction rule).
    const [snap, runFresh] = await Promise.all([tx.get(teamRef), tx.get(runRef)]);
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
    // Global per-run phone ceiling — additive to the per-team cap above. Legacy runs
    // fall back to the team count; the field becomes exact once written here.
    const r = runFresh.data() as Run | undefined;
    const usedDevices = r?.deviceCount ?? r?.participantCount ?? 0;
    if (!canAddRunDevice(usedDevices).ok) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `This run is full (${MAX_RUN_DEVICES} devices max).`,
        { cap: MAX_RUN_DEVICES, used: usedDevices },
      );
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
    tx.update(runRef, { deviceCount: usedDevices + 1, updatedAt: now });
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

// Task expiry auto-skip sweep (change: task-expiry). When the team's ASSIGNED
// task has expired, mark it `skipped` (full-array clone — never dotted
// array-element updates) and, if every task in the stage is now terminal,
// complete the stage and unlock the next one with the SAME logic/ordering as
// completeTaskForTeam's stageDone block (including the scheduled-release gate
// on the next stage). Lazy evaluation, same pattern as computeStageUnlock —
// runs on the next poll, no scheduler. Returns the new stages + the expired
// task id, or null when nothing in flight is expired. Idempotent: a skipped
// task stays skipped, so a racing second sweep is a no-op.
function sweepExpiredInFlight(
  team: RunTeam,
  game: Game,
  launchedAt: string | undefined,
  nowMs: number,
): { stages: RunStageRecord[]; expiredTaskId: string } | null {
  const activeIdx = team.stages.findIndex((s) => s.status === 'active');
  if (activeIdx < 0) return null;
  const assignedRec = team.stages[activeIdx].tasks.find((t) => t.status === 'assigned');
  if (!assignedRec) return null;
  const gameTask = findGameTask(game, assignedRec.taskId);
  if (!gameTask || !isExpired(gameTask, launchedAt, nowMs)) return null;

  const now = new Date(nowMs).toISOString();
  const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
  const rec = stages[activeIdx].tasks.find((t) => t.taskId === assignedRec.taskId);
  if (!rec) return null;
  rec.status = 'skipped'; // expired mid-work → skipped, not scored (no partial credit)
  rec.completedAt = now;

  // Stage completion via the shared single-source helper (same logic/ordering as
  // completeTaskForTeam, including the scheduled-release gate). The sweep path
  // historically releases no station slots, so the helper's returned
  // held-assigned-task ids are intentionally ignored — behavior preserved exactly.
  applyStageCompletion(stages, activeIdx, game, launchedAt, now);
  return { stages, expiredTaskId: assignedRec.taskId };
}

// Advance a team's state on a POLL (getMyTeamState) — scheduled-release unlock and
// task-expiry sweep (change: fix-getmyteamstate-hotpath-writes). getMyTeamState is
// the hottest callable (every attached device, every few seconds); doing these
// writes inline used to contend on the team doc (multiple devices of one team
// racing the same write, plus the team's own completeTask/requestNextTask
// transactions) → 20s lock timeouts that FAILED the read (the family-playtest
// "frozen screen"). So:
//   • the in-memory `team` is ALWAYS advanced (the response reflects it immediately);
//   • persistence is BEST-EFFORT (a contended write is caught, never thrown — the
//     poll still returns the advanced state; requestNextTask reconciles it durably);
//   • persistence is CONTROLLER-ONLY (the ≤3 devices of a team no longer stampede
//     the same write). requestNextTask's transactional write is the durable path.
// `persist`/`release` are injected so the policy is unit-tested without the emulator.
export async function advanceTeamStateOnPoll(args: {
  team: RunTeam;
  game: Game;
  launchedAt: string | undefined;
  nowMs: number;
  isController: boolean;
  persist: (patch: Record<string, unknown>) => Promise<unknown>;
  release: (taskId: string) => Promise<unknown>;
  onPersistError: (op: string, err: unknown) => void;
}): Promise<void> {
  const { team, game, launchedAt, nowMs, isController } = args;
  const nowIso = new Date(nowMs).toISOString();

  // (1) Scheduled-release unlock while between stages.
  if (team.stages.findIndex((s) => s.status === 'active') < 0) {
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
    if (computeStageUnlock(stages, game, launchedAt, nowMs)) {
      team.stages = stages;
      if (isController) {
        try { await args.persist({ stages, updatedAt: nowIso }); }
        catch (e) { args.onPersistError('poll.unlock', e); }
      }
    }
  }

  // (2) Task-expiry sweep of an in-flight expired task. The run doc (launchedAt)
  // was already read by the caller; the sweep is a no-op unless the assigned task
  // actually carries an expiry.
  const idx = team.stages.findIndex((s) => s.status === 'active');
  const assignedRec = idx >= 0 ? team.stages[idx].tasks.find((t) => t.status === 'assigned') : undefined;
  const gt = assignedRec ? findGameTask(game, assignedRec.taskId) : undefined;
  if (assignedRec && gt?.expiresAfterMinutes) {
    const swept = sweepExpiredInFlight(team, game, launchedAt, nowMs);
    if (swept) {
      const allDone = swept.stages.every((s) => s.status === 'completed');
      team.stages = swept.stages;
      team.activeTaskId = null;
      if (allDone) { team.status = 'finished'; team.finishedAt = nowIso; }
      if (isController) {
        try {
          await args.persist({
            stages: swept.stages,
            activeTaskId: null,
            ...(allDone ? { status: 'finished', finishedAt: nowIso } : {}),
            updatedAt: nowIso,
          });
          await args.release(swept.expiredTaskId);
        } catch (e) { args.onPersistError('poll.sweep', e); }
      }
    }
  }
}

export async function assignNextInActiveStage(
  ownerUid: string, gameId: string, runId: string, teamId: string,
  teamLocation: { lat: number; lng: number },
  now: string,
): Promise<{ taskId?: string; reason?: NoAssignmentReason }> {
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

  // Task expiry sweep (change: task-expiry): a team stuck ON an expired task is
  // rerouted on its next poll — skip it, free its station slot, clear the active
  // task, then continue assigning below. The run doc (launchedAt) is read only
  // when the in-flight task actually carries an expiry — zero cost otherwise.
  {
    const idx = team.stages.findIndex((s) => s.status === 'active');
    const assignedRec = idx >= 0 ? team.stages[idx].tasks.find((t) => t.status === 'assigned') : undefined;
    const gt = assignedRec ? findGameTask(game, assignedRec.taskId) : undefined;
    if (assignedRec && gt?.expiresAfterMinutes) {
      const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
      const launchedAt = (runSnap.data() as Run | undefined)?.launchedAt;
      const swept = sweepExpiredInFlight(team, game, launchedAt, Date.now());
      if (swept) {
        const allDone = swept.stages.every((s) => s.status === 'completed');
        await teamRef.update({
          stages: swept.stages,
          activeTaskId: null,
          ...(allDone ? { status: 'finished', finishedAt: now } : {}),
          updatedAt: now,
        });
        await releaseTask(swept.expiredTaskId, ownerUid, gameId, runId);
        team.stages = swept.stages;
      }
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

  // NOTE: single-task stages are NOT special-cased. A former fast path assigned the
  // sole task directly, bypassing assignTask — which silently skipped the station
  // cap (`maxConcurrentTeams`), the scheduled-release / expiry / unlock gates, and
  // the paused/closed check (nightly hardening: single-task stages are the most
  // common shape, so the cap was effectively a lie for stations). A 1-element
  // candidate list flows through assignTask fine, so every stage now shares the
  // same gated, cap-enforced, atomically-claimed assignment path.

  // Route among the still-unassigned tasks of this stage
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
    // assignTask has already reserved a station slot (run.taskCounts[result.taskId]++).
    // Claim it onto the team ATOMICALLY: the read of `team` above and this write are
    // NOT one operation, so a concurrent assignment for the SAME team (a controller
    // double-tap, or completeTask's post-completion reassign racing a requestNextTask
    // poll) could otherwise overwrite each other — leaving one reserved slot with no
    // team on it (a permanent station-capacity leak). Re-read the team inside a
    // transaction: if another task already went in-flight for this stage we LOST the
    // race, so release our reserved slot instead of clobbering the winner.
    const claim = await db.runTransaction(async (tx) => {
      const cur = await tx.get(teamRef);
      if (!cur.exists) return { taskId: undefined as string | undefined, mine: false };
      const curTeam = cur.data() as RunTeam;
      const curStage = curTeam.stages[activeStageIdx];
      if (!curStage) return { taskId: undefined, mine: false };
      const existing = curStage.tasks.find((t) => t.status === 'assigned');
      if (existing) return { taskId: existing.taskId, mine: false };
      const localIdx = curStage.tasks.findIndex((t) => t.taskId === result.taskId);
      if (localIdx < 0) return { taskId: undefined, mine: false };
      const stages = curTeam.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
      stages[activeStageIdx].tasks[localIdx].status = 'assigned';
      stages[activeStageIdx].tasks[localIdx].startedAt = now;
      tx.update(teamRef, { stages, activeTaskId: result.taskId, updatedAt: now });
      return { taskId: result.taskId, mine: true };
    });
    if (!claim.mine) {
      // Lost the race (or team/stage vanished): reverse assignTask's reservation so
      // the slot doesn't leak, and hand back whatever is actually in flight.
      await releaseTask(result.taskId, ownerUid, gameId, runId);
      return { taskId: claim.taskId };
    }
  }
  // Thread the "why nothing" reason (stationsFull / allLocked / none) so the
  // participant UI can wait-and-retry on a full station instead of dead-ending.
  return { taskId: result.taskId, reason: result.reason };
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
  // WO-5: reject a bad coordinate up front — BEFORE completeTaskForTeam — so the
  // player never sees a 500 AFTER a successful check-in.
  assertCoordIfPresent(lat, lng);

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
  if (gtask && (gtask.releaseAt || gtask.releaseAfterMinutes || gtask.expiresAfterMinutes)) {
    const runSnap = await db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId)).get();
    const launchedAt = (runSnap.data() as Run | undefined)?.launchedAt;
    if (!isReleased(gtask, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task is not available yet');
    }
    // Task expiry (change: task-expiry): a closed task can't be completed even by
    // a hand-crafted call (the routing filter already stopped handing it out).
    if (isExpired(gtask, launchedAt, Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'This task has expired');
    }
  }
  if (gtask) {
    // Type gate (anti-cheat): completeTask is the check-in / self-report path
    // only. Every other task type is graded exclusively by its own callable
    // (quiz/numeric/survey → submitTaskAnswer, sequence → submitSequenceStep,
    // smart_station → verifyStationCode, photo → submitStationPhoto). Without
    // this, a participant who reads their own assigned taskId could call
    // completeTask with a bare id and score a quiz/photo/etc. with no answer and
    // no verification — completeTaskForTeam never checks task.type.
    const COMPLETE_TASK_TYPES: ReadonlySet<Task['type']> = new Set([
      'field', 'self_report', 'geofence',
    ]);
    if (!COMPLETE_TASK_TYPES.has(gtask.type)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This task type is completed a different way',
      );
    }

    const mode = normalizeTriggerMode(gtask);
    // A task at (0,0) has no real location — coordinates were never placed. Every
    // UI filters it out as the null-island sentinel (no pin, no distance badge), so
    // enforcing proximity here makes it permanently unwinnable. Treat it as
    // locationless server-side too (nightly hardening).
    const c = gtask.coordinates;
    const hasRealCoords = !!c && isValidCoord(c.lat, c.lng) && (c.lat !== 0 || c.lng !== 0);
    if ((mode === 'radius' || mode === 'exact') && hasRealCoords) {
      if (lat == null || lng == null || !isValidCoord(lat, lng)) {
        throw new functions.https.HttpsError('failed-precondition', 'Location required to check in here');
      }
      const distM = haversineKm({ lat, lng }, c!) * 1000;
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

  const { completed } = await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
  // A duplicate/idempotent completion must NOT release or re-assign: a concurrent
  // real completion already did, and doubling the assignment leaks a station slot.
  // Idempotent replay (WO-3): a duplicate completion of an already-graded task is
  // a no-op for score/slots — surface `already:true` so clients/sims/support can
  // tell a replay from a first completion (score is already conserved either way).
  if (!completed) return { ok: true, already: true, nextTaskId: null };
  // WO Fix 1: the station slot the team held is released atomically inside
  // completeTaskForTeam's transaction — no post-commit releaseTask here.

  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);

  return { ok: true, nextTaskId: next.taskId ?? null, nextReason: next.reason ?? null };
});

// ─── requestNextTask (assign a task in the active stage) ──────────────────────

export const requestNextTask = loggedCallable('requestNextTask', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'requestNextTask');
  const { lat, lng, ownerUid, gameId, runId, code } = data as {
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  assertCoordIfPresent(lat, lng); // WO-5: bad coords → clean invalid-argument, not 500
  const { ctx, teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  // Soft-pause (safe-zone-boundary): no new task while the team is out of bounds.
  if (team.outOfBounds === true) {
    return { taskId: null, outOfBounds: true };
  }
  const now = new Date().toISOString();
  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
  return { taskId: next.taskId ?? null, reason: next.reason ?? null };
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
  let hintTask: Task | undefined;
  for (const stage of game.stages) {
    const t = stage.tasks.find((x) => x.id === taskId);
    if (t) { hintTask = t; break; }
  }
  const hint = hintTask?.hint;
  const penalty = hintTask?.hintPenalty ?? 25;
  if (!hintTask || !hint || !hint.trim()) {
    throw new functions.https.HttpsError('failed-precondition', 'No hint available for this task');
  }
  const hintText = hint.trim();
  const escalation = hintTask; // narrowed for the transaction closure below

  const teamRef = db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = snap.data() as RunTeam & { taskAttempts?: Record<string, number> };
    const used = team.taskHintsUsed ?? [];
    if (used.includes(taskId)) return { alreadyUsed: true, charged: 0, free: false }; // don't double-charge
    // Hint auto escalation (change: hint-auto-escalation): the charge decision is
    // made HERE, inside the transaction, from the same team doc we update — no
    // TOCTOU between "is it free?" and "charge". Time basis is the task record's
    // server-written startedAt vs the server clock; attempts basis is the team's
    // recorded wrong-attempt count. Free ⇒ record the reveal in taskHintsUsed as
    // usual (idempotence unchanged) but leave bonusPenalty untouched.
    const rec = team.stages.flatMap((s) => s.tasks).find((r) => r.taskId === taskId);
    const free = isHintFree(
      { startedAt: rec?.startedAt, wrongAttempts: team.taskAttempts?.[taskId] ?? 0 },
      escalation,
      Date.now(),
    );
    tx.update(teamRef, {
      taskHintsUsed: [...used, taskId],
      ...(free ? {} : { bonusPenalty: (team.bonusPenalty ?? 0) + penalty }),
      updatedAt: new Date().toISOString(),
    });
    return { alreadyUsed: false, charged: free ? 0 : penalty, free };
  });

  return { hint: hintText, penalty: result.charged, alreadyUsed: result.alreadyUsed, free: result.free };
});


// ─── Answer-checking helpers (quiz / numeric / sequence) ──────────────────────

function findGameTask(game: Game, taskId: string): Task | undefined {
  for (const stage of game.stages) {
    const t = stage.tasks.find((x) => x.id === taskId);
    if (t) return t;
  }
  return undefined;
}

// WO-5: reject a PRESENT-but-invalid client coordinate up front, with a clean
// `invalid-argument` — never let out-of-range/NaN/string lat/lng reach
// haversineKm (which throws LocationError → opaque INTERNAL). "Absent" (both
// null/undefined) falls through to the existing (0,0) no-location path. Mirrors
// updateLocation's isValidCoord guard. Placed before any completion/side-effect
// so completeTask can't 500 AFTER the task is already marked complete.
function assertCoordIfPresent(lat: unknown, lng: unknown): void {
  const present = lat != null || lng != null;
  if (present && !isValidCoord(lat as number, lng as number)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid coordinates');
  }
}

// WO-2: the caller-team's status for the stage that CONTAINS taskId (or
// undefined if the task isn't in the team's stages). Lets the answer callables
// close the locked/future-stage oracle BEFORE computing correctness, so a wrong
// vs a correct probe on a locked stage are byte-identical. Message string must
// match completeTaskForTeam's in-transaction gate exactly.
function teamStageStatusForTask(team: RunTeam, taskId: string): string | undefined {
  for (const s of team.stages) {
    if (s.tasks.some((t) => t.taskId === taskId)) return s.status;
  }
  return undefined;
}

const STAGE_NOT_ACTIVE_MSG = 'This stage is not active yet — finish your current stage first';

export function assertStageActiveForTask(team: RunTeam, taskId: string): void {
  if (teamStageStatusForTask(team, taskId) !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', STAGE_NOT_ACTIVE_MSG);
  }
}

// Task expiry guard shared by the answer callables (change: task-expiry). Reads
// the run doc for `launchedAt` only when the task actually carries an expiry —
// zero extra reads on the common (no-expiry) path.
async function assertTaskNotExpired(
  ownerUid: string, gameId: string, runId: string, task: Task,
): Promise<void> {
  if (!task.expiresAfterMinutes) return;
  const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  const launchedAt = (runSnap.data() as Run | undefined)?.launchedAt;
  if (isExpired(task, launchedAt, Date.now())) {
    throw new functions.https.HttpsError('failed-precondition', 'This task has expired');
  }
}

// Answer matching is shared with checkChallengeAnswer via matchesTaskAnswer
// (packages/shared/src/challenge.ts) so the two never drift.

// ─── submitTaskAnswer (quiz / numeric) ────────────────────────────────────────

export const submitTaskAnswer = loggedCallable('submitTaskAnswer', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'submitTaskAnswer');
  const { taskId, answer, orderedAnswer, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string; answer?: string; orderedAnswer?: unknown;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');
  if (answer == null && orderedAnswer === undefined) {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and answer required');
  }
  assertCoordIfPresent(lat, lng); // WO-5: bad coords → clean invalid-argument, not 500
  const { ctx, teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data() as Game, taskId);
  if (!task) throw new functions.https.HttpsError('not-found', 'Task not found');
  if (task.type !== 'quiz' && task.type !== 'numeric' && task.type !== 'survey') {
    throw new functions.https.HttpsError('failed-precondition', 'Task does not take an answer');
  }
  // WO-2: close the locked/future-stage answer oracle BEFORE any correctness
  // computation (and before the attempt-limit read, so a probe consumes no slot).
  // A wrong and a correct answer on a locked stage now throw the identical error.
  assertStageActiveForTask(team, taskId);

  // Optional presence gate (change: quiz-location-verification): when the creator
  // opted this task into requirePresence AND it has real coordinates, the submitted
  // GPS must be within a LENIENT radius before we grade — so a quiz/trivia can't be
  // answered from anywhere. Default OFF ⇒ existing games unaffected. Placed BEFORE
  // grading so an out-of-range attempt is not recorded as wrong and consumes no
  // attempt-limit slot. The reason carries no distance and no answer (safe for hidden).
  if (task.requirePresence) {
    const verdict = evaluatePresence(task.coordinates, { lat, lng }, task.geofenceRadiusMeters);
    if (!verdict.ok) {
      throw new functions.https.HttpsError('failed-precondition', verdict.reason ?? 'Move closer to answer this task');
    }
  }

  // Survey (change: survey-tasks): NO right answer — validation is shape-only via
  // the shared validateSurveyResponse (trims; choice mode must match a listed
  // choice; free-text ≤ 500 chars). Any valid response completes the task for its
  // fixed pointValue through the EXISTING completion path. No attempt tracking,
  // no wrong-answer path, and a survey never carries an ordering arrangement.
  if (task.type === 'survey') {
    if (orderedAnswer !== undefined) {
      throw new functions.https.HttpsError('invalid-argument', 'orderedAnswer only applies to an ordering task');
    }
    const resp = validateSurveyResponse(answer, task.surveyChoices);
    if (resp == null) {
      throw new functions.https.HttpsError('invalid-argument', 'Valid survey response required');
    }
    // Task expiry still applies (a closed task takes no more responses).
    await assertTaskNotExpired(ctx.ownerUid, ctx.gameId, ctx.runId, task);
    const now = new Date().toISOString();
    const { completed } = await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now, { surveyResponse: resp });
    if (!completed) return { correct: true, nextTaskId: null };
    // WO Fix 1: slot release is atomic inside completeTaskForTeam.
    const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
    const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
    return { correct: true, nextTaskId: next.taskId ?? null };
  }

  // Ordering variant (change: quiz-ordering): an ordering task is graded ONLY
  // from `orderedAnswer` (a string[] arrangement); a classic quiz/numeric task
  // must NOT carry one (loud invalid-argument instead of a silent ignore).
  const ordering = isOrderingTask(task);
  if (ordering && !Array.isArray(orderedAnswer)) {
    throw new functions.https.HttpsError('invalid-argument', 'orderedAnswer (string[]) required for an ordering task');
  }
  if (!ordering && orderedAnswer !== undefined) {
    throw new functions.https.HttpsError('invalid-argument', 'orderedAnswer only applies to an ordering task');
  }
  if (!ordering && answer == null) {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and answer required');
  }
  // Task expiry (change: task-expiry): a closed task takes no more answers.
  await assertTaskNotExpired(ctx.ownerUid, ctx.gameId, ctx.runId, task);

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

  const correct = ordering
    ? matchesOrderedAnswer(task.orderItems as string[], orderedAnswer)
    : matchesTaskAnswer(task, String(answer));
  if (!correct) {
    // Record the wrong attempt under a real nested map (not a dotted key).
    // Tracked when EITHER consumer needs it: the attempt-limit cap (row 42) or
    // hint auto escalation (change: hint-auto-escalation) — wrong ordering
    // arrangements flow through here too and count the same.
    const trackAttempts =
      (attemptLimit != null && attemptLimit > 0) || (task.hintAutoRevealAttempts ?? 0) > 0;
    if (trackAttempts) {
      await teamRef.set(
        { taskAttempts: { [taskId]: admin.firestore.FieldValue.increment(1) } },
        { merge: true },
      );
    }
    return { correct: false };
  }

  const now = new Date().toISOString();
  const { completed } = await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
  if (!completed) return { correct: true, nextTaskId: null };
  // WO Fix 1: slot release is atomic inside completeTaskForTeam.
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
  assertCoordIfPresent(lat, lng); // WO-5: bad coords → clean invalid-argument, not 500
  const { ctx, teamId, team, teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data() as Game, taskId);
  if (!task || task.type !== 'sequence' || !task.steps?.length) {
    throw new functions.https.HttpsError('failed-precondition', 'Not a sequence task');
  }
  // WO-2: close the locked/future-stage oracle — a step submission on a locked
  // stage throws the identical error regardless of step-answer correctness,
  // before any step-progress read/write.
  assertStageActiveForTask(team, taskId);
  // Task expiry (change: task-expiry): a closed task takes no more steps.
  await assertTaskNotExpired(ctx.ownerUid, ctx.gameId, ctx.runId, task);

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
    const { completed } = await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
    if (completed) {
      // WO Fix 1: slot release is atomic inside completeTaskForTeam.
      const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
      await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
    }
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
  assertCoordIfPresent(lat, lng); // WO-5: bad coords → clean invalid-argument, not 500
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

  // Advance the team on this poll — scheduled-release unlock (change:
  // scheduled-release) + task-expiry sweep (change: task-expiry) — but WITHOUT
  // letting a contended write fail or stall this hot read
  // (change: fix-getmyteamstate-hotpath-writes). The in-memory `team` is advanced
  // unconditionally (so the response reflects it), while persistence is
  // best-effort and controller-only; requestNextTask reconciles durably.
  await advanceTeamStateOnPoll({
    team,
    game,
    launchedAt: run.launchedAt,
    nowMs: Date.now(),
    isController: resolveDeviceRole(team, uid) === 'controller',
    persist: (patch) => db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, team.id)).update(patch),
    release: (taskId) => releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId),
    onPersistError: (op, e) => logBestEffort(op, { runId: ctx.runId, teamId: team.id }, e),
  });

  // Build a map of taskId → sanitized content for tasks in the active stage.
  // quiz-ordering: the per-team, per-task shuffleSeed keeps ordering items
  // deterministically shuffled (reload-stable) and never in the authored order.
  const orderedStages = game.stages.slice().sort((a, b) => a.order - b.order);
  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  const assignedActiveRec =
    activeStageIdx >= 0 ? team.stages[activeStageIdx].tasks.find((r) => r.status === 'assigned') : undefined;
  const activeStageTasks =
    activeStageIdx >= 0 && orderedStages[activeStageIdx]
      ? orderedStages[activeStageIdx].tasks.map((t) => {
          const safe = sanitizeTaskForParticipant(t, { shuffleSeed: `${team.id}:${t.id}` }) as Record<string, unknown>;
          // Hint auto escalation (change: hint-auto-escalation): decorate the
          // team's ACTIVE task with a display-only `hintFreeNow` flag. The charge
          // decision is re-made inside requestTaskHint's transaction, so a stale
          // flag can never mischarge — this only lights up the free-hint button.
          if (
            assignedActiveRec?.taskId === t.id &&
            (t.hintAutoRevealMinutes != null || t.hintAutoRevealAttempts != null) &&
            isHintFree(
              {
                startedAt: assignedActiveRec.startedAt,
                wrongAttempts: (team as RunTeam & { taskAttempts?: Record<string, number> }).taskAttempts?.[t.id] ?? 0,
              },
              t,
              Date.now(),
            )
          ) {
            safe.hintFreeNow = true;
          }
          return safe;
        })
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
      // Live photo feed (live-photo-feed): whether the play app should show the
      // Feed panel. Not a secret; the write-side gate lives in the functions.
      photoFeedEnabled: game.photoFeedEnabled !== false,
      // Game intro primer (change: game-intro-instructions): the "How to play"
      // card/modal content. Cleaned at the echo boundary so even a legacy/hand-edited
      // doc with a non-https image is https-guarded on the way out. null when unset.
      instructions: cleanGameInstructions(game.instructions) ?? null,
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
  await enforceRateLimit(uid, 'listLiveRuns');
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
  const { ctx, teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  // Only release a slot this team actually holds, and clear our own record —
  // otherwise a replayed / cross-team call drains run.taskCounts for a slot it
  // never owned (defeating station caps). Mirror completeTaskForTeam: no-op
  // when not in-flight. releaseTask (its own txn) runs AFTER, never nested.
  const held = await db.runTransaction<boolean>(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) return false;
    const team = snap.data() as RunTeam;
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
    let found: null | { s: number; t: number } = null;
    for (let si = 0; si < stages.length; si++) {
      const ti = stages[si].tasks.findIndex((t) => t.taskId === taskId);
      if (ti >= 0) { found = { s: si, t: ti }; break; }
    }
    const rec = found ? stages[found.s].tasks[found.t] : null;
    const inFlight = team.activeTaskId === taskId || rec?.status === 'assigned';
    if (!inFlight) return false;
    if (rec) rec.status = 'unassigned';
    tx.update(teamRef, {
      stages,
      ...(team.activeTaskId === taskId ? { activeTaskId: null } : {}),
      updatedAt: new Date().toISOString(),
    });
    return true;
  });

  if (held) await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);
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
    const normalizedCode = validate(() => normalizeAccessCode(code));
    const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
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


// ─── getRunSurveyResults (change: survey-tasks) ────────────────────────────────
// Owner / run-scoped-staff read-only aggregation of every survey task in the run.
// One game-doc read (to collect the survey tasks + their choices) + one teams
// scan (the team docs already carry `surveyResponse` on completed survey task
// records). No writes, no transaction. Choice surveys → 0-filled per-choice
// counts; free-text surveys → {teamName, response} rows.

export const getRunSurveyResults = loggedCallable('getRunSurveyResults', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'getRunSurveyResults');
  const { ownerUid, gameId, runId } = data as {
    ownerUid?: string; gameId?: string; runId?: string;
  };
  if (!gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId and runId required');
  }
  // The creator console calls with {gameId, runId} (owner == caller, like
  // listRunTeams). The run doc's own ownerUid is the authority for the gate.
  const resolvedOwner = ownerUid ?? uid;
  const runSnap = await db.doc(runPath(resolvedOwner, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = runSnap.data() as Run;

  // Authz: owner OR admin OR staff scoped to THIS run — same contract as
  // assertStaffOrOwner (functions/src/index.ts). A staff PIN minted for another
  // run (or a participant / stranger) gets permission-denied (e2e authz matrix).
  const token = context.auth!.token;
  const isOwner = uid === run.ownerUid;
  const isAdmin = token.admin === true;
  const isRunStaff = token.staff === true && token.ownerUid === run.ownerUid && token.runId === runId;
  if (!isOwner && !isAdmin && !isRunStaff) {
    throw new functions.https.HttpsError('permission-denied', 'Staff or owner access required');
  }

  const gameSnap = await db.doc(gamePath(run.ownerUid, gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;

  // Collect the survey tasks (id → {title, choices?}), preserving builder order.
  const surveyTasks: { taskId: string; title: string; surveyChoices?: string[] }[] = [];
  for (const stage of [...(game.stages ?? [])].sort((a, b) => a.order - b.order)) {
    for (const task of stage.tasks ?? []) {
      if (task.type === 'survey') {
        surveyTasks.push({
          taskId: task.id,
          title: task.title,
          ...(Array.isArray(task.surveyChoices) && task.surveyChoices.length > 0
            ? { surveyChoices: task.surveyChoices }
            : {}),
        });
      }
    }
  }
  if (surveyTasks.length === 0) return { results: [] };

  // One teams scan. Each completed survey task record carries the team's own
  // `surveyResponse`. Index responses by taskId.
  const teamsSnap = await db.collection(teamsCol(run.ownerUid, gameId, runId)).get();
  const byTask = new Map<string, { teamName: string; response: string }[]>();
  for (const st of surveyTasks) byTask.set(st.taskId, []);
  for (const doc of teamsSnap.docs) {
    const team = doc.data() as RunTeam;
    const teamName = team.displayName ?? team.id;
    for (const stage of team.stages ?? []) {
      for (const rec of stage.tasks ?? []) {
        if (rec.status === 'completed' && typeof rec.surveyResponse === 'string' && byTask.has(rec.taskId)) {
          byTask.get(rec.taskId)!.push({ teamName, response: rec.surveyResponse });
        }
      }
    }
  }

  const results = surveyTasks.map((st) => {
    const rows = byTask.get(st.taskId) ?? [];
    if (st.surveyChoices) {
      // 0-filled per-choice tally; responses outside the choice set are ignored
      // (validateSurveyResponse already rejects them at submit time).
      const counts: Record<string, number> = {};
      for (const choice of st.surveyChoices) counts[choice] = 0;
      for (const r of rows) {
        if (counts[r.response] !== undefined) counts[r.response] += 1;
      }
      return {
        taskId: st.taskId,
        title: st.title,
        surveyChoices: st.surveyChoices,
        counts,
        responseCount: rows.length,
      };
    }
    return {
      taskId: st.taskId,
      title: st.title,
      responses: rows,
      responseCount: rows.length,
    };
  });

  return { results };
});
