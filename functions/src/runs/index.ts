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
import { db, docCachePolicy } from '../firebase';
import { cachedGetDoc, cachedGetCollection } from '../docCache';
// Full-fidelity movement track on the VPS disk when configured; getRunHeatmap falls back to
// the Firestore locationTrack collection when there is no disk file (change: vps-track-storage).
import { trackStore } from '../trackStore';
import { getLocationFreshness } from './locationFreshnessCache';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
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
  proximitySatisfied,
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
  sampleTrackByDistance,
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
  // One partition drives both the launch set and the reported hold count
  // (change: expose-enforced-settings). It delegates per team to
  // `isConsentSatisfied`.
  partitionTeamsByConsent,
  // The same predicate the partition delegates to, used by the two READ paths
  // that report a hold to the people it affects (change: held-team-visibility):
  // getMyTeamState's `holdReason` and listRunTeams' `heldForConsent`. Reusing it
  // is what keeps "held" one definition instead of three that can drift.
  isConsentSatisfied,
  haversineKm,
  isValidCoord,
  isReleased,
  releaseInstantMs,
  isExpired,
  isUnlocked,
  lockedTaskIds,
  unreachableTaskIds,
  resolveExclusions,
  isHintFree,
  // Wrong-answer cost (change: wrong-answer-cost): escalating, capped, preset-aware.
  resolveWrongAnswerLevel,
  wrongAnswerCost,
  // retry-lockout-clock-skew: the single lockout decision point (server clock in,
  // bounded remaining duration out).
  evaluateRetryLockout,
  retryLockoutPolicyFor,
  hashAnswerForReplay,
  answerCostDisplay,
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
  evaluateSafeZoneStatus,
  type SafeZone,
  COLLECTIONS,
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
  resolveExpectedMinutes,
  FIRESTORE_PATHS,
} from '@rushpoint/shared';
// Pause-clock tasks (change: pause-clock-tasks) — the excluded-duration rule.
import { taskExcludedMs, teamExcludedMs, teamHeldExclusionMs, adjustedElapsedSeconds } from '@rushpoint/shared';
// Test mode (change: test-mode-hidden-scoring) — the seal predicate, the participant
// team projection (the SECURITY boundary for the sealed payload, not chrome) and the
// stored-answer bound.
import { sealsScoreFromParticipant, sanitizeTeamForParticipant, boundStoredAnswer } from '@rushpoint/shared';
// The recorded answer sheet (change: post-run-player-report) — every submission a
// participant makes, right and wrong, on EVERY run. Bounded here, owner-only by
// construction (never allow-listed by sanitizeTeamForParticipant above), and
// destroyed after ANSWER_LOG_RETENTION_DAYS by the maintenance sweep.
import { buildAnswerLogEntry, appendAnswerLog, buildRunPlayerReport } from '@rushpoint/shared';
import type { AnswerLogEntry } from '@rushpoint/shared';
import { shouldEmailRunSummary } from '@rushpoint/shared';
import { requireString, MAX_ID_LEN, normalizeAccessCode } from '@rushpoint/shared';
import { shouldRefreshLeaderboard, leaderboardRefreshFields } from './leaderboardThrottle';
// Gallery ranking signals (change: gallery-popularity-ranking).
import { bumpPublicSignals } from '../gallery/popularityStore';
import { assignTask, claimSpecificTask, releaseTask, computeSkillRatio, buildRecommendations, withLockRetry } from '../routing/assignNextTask';
import type { NoAssignmentReason } from '../routing/assignNextTask';
// Test mode (change: test-mode-hidden-scoring): pace vs accuracy as the routing
// strength signal — ONE decision, shared by the assignment path and the
// recommendation list so the two can never disagree about difficulty.
import { resolveRoutingSkillRatio } from '../routing/testModeRouting';
import { reconcileTaskCounts } from '../routing/reconcileTaskCounts';
import { sanitizeTaskForParticipant } from './sanitizeTask';
// Guardian-consent assignment gate (change: consent-gate-routing): the pure,
// total predicate that decides whether a team may be assigned a task at all.
import { canReceiveTaskAssignment } from './consentGate';
import { buildCompletedPins } from './completedPins';
import {
  assertController, resolveDeviceRole, generateDeviceJoinCode, canAttachDevice,
  attachedDeviceUids, controllerUidOf, canAddRunDevice, MAX_RUN_DEVICES,
} from './teamDevices';
import type { RunFeedback, TaskProgressStatus, RehearsalReveal } from '@rushpoint/shared';
// `taskSubmissions` is a FIELD on the team doc, not part of the RunTeam type —
// see packages/shared/src/photoQueue.ts, which owns the shape.
import type { RawSubmission } from '@rushpoint/shared';
import { validateFeedbackPayload, computeFeedbackSummary } from './feedbackSummary';
import { sendRunSummaryEmail } from './runSummaryEmail';
import { validate, parseStored } from '../validation';
import { parseGame, parseRun, parseRunTeam } from '@rushpoint/shared';
import { isSoloSelfGuidedRun, soloRunReadyToAutoFinalize } from './soloAutoFinalize';

import { requireAuth, assertStaffOrOwner } from '../auth';
import { shouldFeedTask } from '../feedVisibility';
import { applyStageCompletion } from './helpers';
// Skipping ONE mission for ONE team (change: skip-single-task): the pure decision
// plus the durable trail every privileged override leaves.
import { planTaskSkip } from '@rushpoint/shared';
import {
  writeAuditLog, AUDIT_TASK_SKIPPED,
  AUDIT_TEAM_HELD, AUDIT_TEAM_RESUMED,
  AUDIT_TASK_FORCE_ASSIGNED, AUDIT_TASK_FORCE_ASSIGNED_OVERRIDE,
} from '../obs/audit';
// Game trash / tombstone (change: recoverable-game-deletion): a soft-deleted game
// must be invisible on every run-facing path too — launch, join, instant play, the
// shareable board, the recap, and the GM overview.
import { assertGameNotDeleted } from '../games/lifecycle';
import { isGameDeleted } from '@rushpoint/shared';

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

/**
 * Start a run of `gameId`, owned by `ownerUid`.
 *
 * Extracted from the callable so a SECOND door can reach it: a share-link holder
 * launching the owner's game (change: game-share-link). The alternative — a
 * parallel launch path for that case — would mean two copies of the launch
 * validation, the billing decision and the atomic run+access-code write, and the
 * copy that gets forgotten is always the one that then charges nothing, skips the
 * unwinnable-task guard, or writes a run without its access code.
 *
 * The billing decision is the OWNER's, whoever pressed the button: it is their
 * game, the run lands in their account, and any credit it costs is theirs. Deciding
 * that this launch is ALLOWED at all is the caller's job.
 */
export async function launchRunCore(
  { ownerUid, gameId, testDrive }: { ownerUid: string; gameId: string; testDrive?: boolean },
): Promise<{ runId: string; accessCode: string }> {
  const uid = ownerUid;
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  if (game.ownerUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your game');
  // A game in the trash can never go live (change: recoverable-game-deletion).
  // Paired with deleteGame's refusal to delete a game with an unfinished run,
  // this is what makes "a tombstoned game never has a live run" an invariant.
  assertGameNotDeleted(game);
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
      // At most ONE live test-drive run per game — but the second press RETIRES
      // the previous rehearsal instead of being refused (change:
      // test-drive-straight-to-play). "בדיקה" means "show me my game as it is
      // now", and a creator edits and re-checks in a tight loop, so refusing the
      // second press with "finalize the old one first" put a chore in front of
      // the one button whose whole purpose is immediacy.
      //
      // Retire rather than REUSE, deliberately: a run snapshots the game at
      // launch (buildInitialStages), so handing back the existing test run would
      // walk the creator through the version they had before their last edit —
      // silently, and looking exactly like a fresh rehearsal. That is a worse
      // failure than the refusal was.
      //
      // The invariant the guard exists for is untouched: still at most one live
      // test run per game, still no second run created.
      //
      // Equality-only query (no '!=' → no composite index, txn-safe via
      // t.get(Query)); the tiny result set is status-filtered in code.
      const liveTests = await t.get(
        db.collection(`users/${uid}/games/${gameId}/runs`).where('isTestDrive', '==', true),
      );
      for (const doc of liveTests.docs) {
        if ((doc.data() as Run).status === 'finished') continue;
        t.update(doc.ref, { status: 'finished', finishedAt: now, updatedAt: now });
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
    // …and on the PUBLIC gallery doc, with its ranking score recomputed in the
    // same transaction (change: gallery-popularity-ranking). Before this, only
    // duplicateGame bumped the public counter, so the "plays" a creator saw in
    // the gallery counted copies but not actual launches. No-ops for a private
    // game (no public doc). Best-effort: a gallery counter must never be able to
    // fail a run launch.
    bumpPublicSignals('game', gameId, { uses: 1 }).catch((e) => logBestEffort('publicGames.playCount.increment', { gameId }, e));
  }

  return { runId: runRef.id, accessCode: code };
}

export const launchRun = loggedCallable('launchRun', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, testDrive } = data as { gameId: string; testDrive?: boolean };
  // The owner IS the caller here. Ownership is re-checked inside the core against
  // the loaded document, so this line is a route, not a trust boundary.
  return launchRunCore({ ownerUid: uid, gameId, testDrive });
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

  // Perf (run-perf-scale, Task 2): the game and run reads are independent once
  // the access code has resolved ownerUid/gameId/runId — parallelize them
  // instead of two sequential round trips.
  const [gameSnap, runSnap] = await Promise.all([
    db.doc(gamePath(c.ownerUid, c.gameId)).get(),
    db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get(),
  ]);
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  // Belt and braces (change: recoverable-game-deletion): soft-delete revokes the
  // code (refused above), but a code that predates this change, or one revoked
  // then hand-edited, must still not open a trashed game's join screen.
  assertGameNotDeleted(game);
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

  // Perf (run-perf-scale, Task 2): these four reads are all independent given
  // only the access code's ownerUid/gameId/runId + this caller's teamId — none
  // depends on another's result — so read them concurrently instead of four
  // sequential round trips. The existence/priority checks below run in the
  // SAME order as before so error precedence is unchanged.
  const [gameSnap, existingTeam, attachedQ, runSnap] = await Promise.all([
    db.doc(gamePath(ownerUid, gameId)).get(),
    // Idempotent: team already registered in this run (own-team fast path).
    db.doc(teamPath(ownerUid, gameId, runId, teamId)).get(),
    // Split-brain guard: this uid may already be an ATTACHED DEVICE of another
    // team in this run (joined via joinTeamAsDevice). Minting a second standalone
    // team here makes the uid a member of two teams and double-counts
    // participant/device totals. Mirror joinTeamAsDevice's array-contains guard.
    db.collection(teamsCol(ownerUid, gameId, runId)).where('deviceUids', 'array-contains', teamId).limit(1).get(),
    runRef.get(),
  ]);
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  // Nobody joins a trashed game (change: recoverable-game-deletion). Checked
  // BEFORE the already-joined fast paths so a rejoin can't slip through either.
  assertGameNotDeleted(game);

  if (existingTeam.exists) {
    return { teamId, runId, gameId, ownerUid, alreadyJoined: true };
  }
  if (!attachedQ.empty) {
    const t = attachedQ.docs[0].data() as RunTeam;
    return { teamId: t.id, runId, gameId, ownerUid, alreadyJoined: true };
  }

  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = runSnap.data() as Run;

  // Can't join a race that's already over.
  if (run.status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This race has already finished.');
  }

  const now = new Date().toISOString();
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, teamId));
  // A TEST DRIVE self-starts (change: test-drive-straight-to-play). A creator
  // pressing "בדיקה" wants to see their own game the way a player sees it — the
  // old flow dropped them on the organizer console with a QR code, and a team that
  // joined via the code then sat on "waiting for the organizer to start" until the
  // creator went back to the console and pressed Start. That waiting screen is a
  // dead end for a rehearsal, so a test-drive run hands out the first task itself.
  //
  // Deliberately narrow. It fires ONLY on `run.isTestDrive` — a flag written by
  // exactly one place (launchRun's testDrive branch), on a run that is free,
  // capped at 2 participants, excluded from playCount/benchmarks, and limited to
  // one live instance per game. A real organizer run is untouched: its teams still
  // register and wait for startTeams, because the organizer's "everyone ready?"
  // moment is the whole point there.
  //
  // Guardian consent is the one hard stop. startTeams holds a minor's team until a
  // guardian approves, and startInstantPlay refuses outright rather than seed a
  // launched team with zero consent. Here we neither throw nor bypass: we fall back
  // to the normal registered/wait path, so the creator can still start from the
  // console after the consent flow — a rehearsal must not become the one door that
  // starts play without the check.
  const selfStart = run.isTestDrive === true && !game.requiresGuardianConsent && (game.stages?.length ?? 0) > 0;
  const team: RunTeam = {
    id: teamId,
    runId,
    gameId,
    ownerUid,
    displayName: displayName.trim(),
    registrationData,
    memberNames,
    memberCount: game.mode === 'team' ? (memberNames.length || 1) : 1,
    status: selfStart ? 'active' : 'registered',
    stages: selfStart
      ? buildInitialStages(game).map((s, i) => ({ ...s, ...(i === 0 ? { startedAt: now } : {}) }))
      : buildInitialStages(game),
    score: 0,
    bonusPenalty: 0,
    launched: selfStart,
    ...(selfStart ? { startedAt: now } : {}),
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
  // ── Why this is NOT a transaction (change: join-without-contention) ─────────────────────
  // It was one, and the transaction was the problem. A read-modify-write on the ONE run
  // document means every simultaneous join contends for the same lock, and an event begins
  // with the entire field scanning the same QR in the same minute. Measured against real
  // Firestore with 120 simultaneous writers on one document:
  //
  //   transaction (read-modify-write)   p50 10,671ms   and only 36 of 120 writes landed
  //   atomic increment                  p50  1,258ms   all 120 landed
  //   sharded increment (10 shards)     p50    798ms   all 120 landed
  //
  // The transaction did not merely queue: once its internal retries were exhausted it DROPPED
  // most of the writes. Production survived that only because `withLockRetry` caught the
  // aborts and retried them, which is precisely why a real 120-team rehearsal measured joinRun
  // at p50 12.1s and max 56s. A participant staring at a spinner for the better part of a
  // minute assumes it is broken and taps again, which makes it worse.
  //
  // An increment is commutative, so Firestore applies it server side with no read, no conflict
  // and nothing to retry. Sharding is faster still, but it costs a shard read per capacity
  // check and a rollup for anything that displays the count; 1.3s for the whole field is
  // already imperceptible, so that complexity is not bought. Sharding is the next lever if a
  // run ever needs to admit thousands.
  //
  // WHAT THIS TRADES. The cap is now enforced on a value read a moment BEFORE the increment,
  // so a simultaneous burst can overshoot it by at most the number of joins in flight. That is
  // acceptable here and would not be if it were a billing limit: `FREE_MODE_MAX_PARTICIPANTS`
  // is a SAFETY ceiling matched to measured server capacity (see runCapacity.ts), payments are
  // off, and admitting a handful past 150 costs nothing while turning a real participant away
  // at a real event costs a great deal. If payments are ever switched back on and this becomes
  // a paid entitlement, this decision has to be revisited — that is what the branch below on
  // `PAYMENTS_ENABLED` is already about.
  const runFresh = await runRef.get();
  const r = runFresh.data() as Run;
  const used = r.participantCount ?? r.freeParticipantsUsed ?? 0;
  const cap = r.maxParticipants ?? FREE_PARTICIPANTS_PER_FREE_RUN;
  if (used >= cap) {
    // The advice has to match the world the caller is actually in. While payments are off
    // (PAYMENTS_ENABLED === false, the launch default) EVERY run is billed as 'free', and the
    // Event Credit and Pro branches of resolveLaunchBilling are never reached — so telling a
    // turned-away participant's host to buy a credit sends them looking for a purchase that
    // does not exist. Say the true thing instead: the ceiling is fixed for this run and can
    // only be raised before the NEXT one is launched.
    const msg = r.billingType === 'test'
      ? `This is a ${cap}-person test run. Launch a real run to invite more players.`
      : r.billingType === 'free'
        ? (PAYMENTS_ENABLED
          ? `This free run is full (${cap} participants max). The host can add an Event Credit or go Pro for more.`
          : `This run is full (${cap} participants max). The limit is fixed when a run is launched, so the host would need to launch a new run to raise it.`)
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

  // `create` rather than `set`: it fails with ALREADY_EXISTS if the document is there, which is
  // exactly the idempotency the transaction's `teamFresh.exists` check used to provide — a
  // second tap on the join button, or a retry after a flaky response, must not count twice.
  // Doing it on the team's OWN document means it contends with nothing.
  const joined = await (async (): Promise<{ already: boolean }> => {
    try {
      await teamRef.create(team);
    } catch (e) {
      // 6 === ALREADY_EXISTS. Anything else is a real failure and must surface.
      if ((e as { code?: number }).code === 6) return { already: true };
      throw e;
    }
    // Only a join that actually created a team may move the counters. Ordered AFTER the create
    // so a failed create can never inflate the count and quietly consume a place nobody holds.
    await runRef.update({
      participantCount: FieldValue.increment(1),
      deviceCount: FieldValue.increment(1),
      updatedAt: now,
    });
    return { already: false };
  })();

  // Hand out the first task exactly as startTeams/startInstantPlay do. AFTER the
  // commit and only for a freshly self-started team, so a re-join short-circuits
  // above and never re-assigns. Best-effort by design: the team is already
  // committed as launched, so a routing hiccup must not fail the join — it
  // degrades to "joined, no task yet", which requestNextTask recovers from.
  if (selfStart && !joined.already) {
    await assignNextInActiveStage(ownerUid, gameId, runId, teamId, { lat: 31.7905, lng: 35.164 }, now, game)
      .catch((e) => logBestEffort('joinRun.testDrive.assign', { ownerUid, gameId, runId, teamId }, e));
  }

  return { teamId, runId, gameId, ownerUid, alreadyJoined: joined.already, selfStarted: selfStart && !joined.already };
});


// ─── startTeams ───────────────────────────────────────────────────────────────
// Owner launches all (or specific) registered teams.

// Perf (run-perf-scale, Task 10): startTeams used to await assignNextInActiveStage
// STRICTLY serially, one team at a time — each iteration re-read the same game
// doc and cost 3-4+ round trips, so 20+ teams could exceed the v1 default 60s
// timeout. The game doc is now read ONCE and threaded through every call, and
// assignment is fanned out in bounded-concurrency chunks (not one giant
// Promise.all, to avoid hammering Firestore / the station-cap contention path
// with the whole cohort at once). Station-capacity safety is untouched: the
// actual cap enforcement + atomic claim lives inside assignTask/the claim
// transaction in assignNextInActiveStage, which is unchanged and still race-safe
// under concurrent callers (see the station-contention e2e scenario). The
// callable is also given extra headroom (timeoutSeconds/memory) above the v1
// default, since a large cohort's fan-out is legitimately heavier than most
// callables even after this fix.
const START_TEAMS_ASSIGN_CONCURRENCY = 8;

/** Split `items` into fixed-size chunks (last chunk may be shorter). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const startTeams = loggedCallable('startTeams', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId, teamIds } = data as { gameId: string; runId: string; teamIds?: string[] };

  if (!gameId || !runId) throw new functions.https.HttpsError('invalid-argument', 'gameId and runId required');

  // Read through the process cache (change: vps-firestore-read-offload). The ownership
  // gate below is UNCHANGED and still runs on every call — serving the run document from
  // memory must never widen access, only avoid re-fetching a document this process wrote.
  const runDoc = await cachedGetDoc<Run>(db, docCachePolicy, runPath(uid, gameId, runId));
  if (!runDoc.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if (runDoc.data!.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const gameSnap = await db.doc(gamePath(uid, gameId)).get();
  const game = gameSnap.data() as Game;

  const now = new Date().toISOString();
  const teamsSnap = await db.collection(teamsCol(uid, gameId, runId)).get();

  const selected = teamsSnap.docs.filter((d) => {
    const t = d.data() as RunTeam;
    return !(t.launched || (teamIds && !teamIds.includes(t.id)));
  });
  // Guardian-consent gate (guardian-consent-qr): a minor's team is held in
  // pending-consent and cannot start until a guardian has approved.
  //
  // The hold used to be a `return false` inside this filter, so a held team was
  // the difference between two numbers the caller never saw and the console
  // reported unqualified success over a no-op (change: expose-enforced-settings).
  // The launch set and the reported count now come from ONE partition, so they
  // cannot drift.
  const wrapped = selected.map((doc) => ({ doc, ...(doc.data() as RunTeam) }));
  const { ready, held } = partitionTeamsByConsent(wrapped, game);
  const targets = ready.map((w) => w.doc);

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
  // The already-loaded `game` is passed through (no per-team re-read) and the
  // cohort is fanned out in bounded chunks rather than one team at a time.
  if (game.stages.length > 0) {
    for (const group of chunk(targets, START_TEAMS_ASSIGN_CONCURRENCY)) {
      await Promise.all(group.map((doc) =>
        assignNextInActiveStage(uid, gameId, runId, doc.id, { lat: 31.7905, lng: 35.164 }, now, game),
      ));
    }
  }

  // `heldForConsent` is ADDITIVE — `launched` keeps its exact prior meaning, so
  // every existing caller is unaffected. A caller that reads it can tell a cohort
  // that had nothing to start from a cohort that was blocked.
  return { launched: targets.length, heldForConsent: held.length };
}, { timeoutSeconds: 180, memory: '512MB' });


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


// ─── Recorded answers on a WRONG submission ───────────────────────────────────
//
// A correct answer records itself through `completeTaskForTeam`'s existing
// transaction (it is already rewriting that stage). A WRONG answer never reaches
// that path — it is the one submission the server graded and then forgot — so it
// needs its own append, and the stages array must be rewritten WHOLE (a dotted
// path into an array element coerces the array to a map and breaks the run).
//
// Mutates the stages array a transaction just read, and reports whether it found
// the record: `false` means the team has no record for that task yet (it was never
// assigned), in which case there is nothing to attach the answer to and the caller
// simply skips the rewrite rather than inventing a record.
function appendAnswerLogToStages(
  stages: RunStageRecord[] | undefined,
  taskId: string,
  entry: AnswerLogEntry | null,
): boolean {
  if (!entry || !Array.isArray(stages)) return false;
  for (const stage of stages) {
    const recs = stage?.tasks;
    if (!Array.isArray(recs)) continue;
    for (const rec of recs) {
      if (rec?.taskId !== taskId) continue;
      rec.answerLog = appendAnswerLog(rec.answerLog, entry);
      return true;
    }
  }
  return false;
}


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
  // post-run-player-report: `answerLog` is ONE recorded submission, appended to
  // this record's bounded log. Unlike `submittedAnswer` above (the single
  // test-mode slot, which stays exactly as it was because accuracySkillRatio
  // reads its verdict), this is written on EVERY run — it is the creator's
  // post-event answer sheet.
  extras?: {
    surveyResponse?: string;
    submittedAnswer?: string;
    wasCorrect?: boolean;
    answerLog?: AnswerLogEntry | null;
  },
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
  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ownerUid, gameId));
  const game = gameSnap.data as Game;
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

  // WO Item 1: wrap the scoring transaction in withLockRetry. Every completion
  // locks the ONE run doc; a burst of ≥16 synchronized teams queues on that lock
  // and Firestore aborts with "10 ABORTED: lock timeout", which surfaced to the
  // player as an opaque INTERNAL (reproduced by simulate-run.mjs --teams=16). The
  // jittered backoff absorbs the burst instead of failing the completion. The
  // `skippedHeldTaskIds = []` reset is the first statement inside the txn body, so
  // per-attempt state is correct across retries.
  const result = await withLockRetry(() =>
    db.runTransaction<{ completed: boolean; heldSlot: boolean }>(async (tx) => {
    skippedHeldTaskIds = [];
    // All reads up front (teamRef + runRef) before any write, per the Firestore
    // transaction rule (WO Fix 1).
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) return { completed: false, heldSlot: false };
    const team = teamSnap.data() as RunTeam;
    const runSnapTx = await tx.get(runRef);
    const runTx = runSnapTx.data() as { taskCounts?: Record<string, number>; status?: string } | undefined;
    // Wave-G #2 (finalize-vs-last-completion TOCTOU): the pre-txn status read at :681
    // can go stale. finalizeRun is a plain non-transactional update that can commit
    // status:'finished' + freeze the board BETWEEN that read and this commit, so a team
    // completing its LAST task exactly at run-end would land its score AFTER the board
    // froze → dropped from the published final standings (the auto path never recovers).
    // Re-check status here, inside the txn, on the run doc we already re-read for
    // taskCounts (still a read-before-write; no extra read, no disturbance to the
    // station-slot reservation / withLockRetry / idempotency guards). This closes the
    // window the pre-txn guard only narrows. failed-precondition is a NON-contention
    // error, so withLockRetry rethrows it immediately (never spins the retry loop).
    if (runTx?.status === 'finished') {
      throw new functions.https.HttpsError('failed-precondition', 'This run has already finished');
    }
    const counts = runTx?.taskCounts ?? {};

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
    // WO Fix 2: idempotent / already-advanced short-circuit. A partial-stage
    // auto-skip (applyStageCompletion) can flip a sibling team's still-held task to
    // 'skipped' AND flip the stage off 'active'. A team then completing its now-
    // 'skipped' task must be a graceful no-op — NOT fall through to the stage-active
    // throw below (which would surface failed-precondition and crash the play loop).
    // Any non-actionable status (currently 'completed' | 'skipped', and any future
    // terminal like 'expired') folds to the no-op; only 'unassigned'/'assigned' grade.
    // Kept BEFORE the stage-active throw so a terminal record never reaches it.
    if (taskRec.status !== 'unassigned' && taskRec.status !== 'assigned') {
      return { completed: false, heldSlot: false };
    }

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

    // Mutually exclusive task groups (change: mutually-exclusive-tasks): within a
    // stage, a team may complete at most ONE task per group. Placed here
    // deliberately — AFTER the already-terminal no-op above (so a duplicate
    // submission of THIS task stays a silent no-op rather than erroring the play
    // loop) and inside the same lock-retry transaction as every other guard, so two
    // devices racing two members of one group serialize on the team doc: the loser
    // retries, re-reads its own record as `skipped`, and short-circuits harmlessly.
    const gameStage = game.stages.find((s) => s.id === stages[stageIdx].stageId);
    const exclusiveSiblingIds = gameStage ? resolveExclusions(gameStage, taskId) : [];
    if (exclusiveSiblingIds.length) {
      const blockedByCompleted = stages[stageIdx].tasks.some(
        (t) => t.status === 'completed' && exclusiveSiblingIds.includes(t.taskId),
      );
      if (blockedByCompleted) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'You already completed an alternative for this challenge',
        );
      }
    }

    let earnedScore = 0;
    // Test mode (change: test-mode-hidden-scoring): a WRONG answer completes the
    // task — that is the whole point — but it must not be PAID for. Scoring every
    // completion regardless of correctness would make the creator's score column
    // read "questions attempted", which is useless for the grading this mode
    // exists to enable. `wasCorrect === false` is the only case that zeroes; a
    // task with no recorded verdict (a field check-in, a photo) scores normally.
    const gradedWrong = extras?.wasCorrect === false;
    if (gameTask && !gradedWrong) {
      switch (game.scoringPreset) {
        case 'time_only':
          earnedScore = 0;
          break;
        case 'fixed_points_speed':
          earnedScore = taskScoreFixed(gameTask);
          break;
        case 'smart_weighted':
          // pause-clock-tasks: a paused task is scored ON ESTIMATE (x = 1), so its
          // sigmoid multiplier is time-INDEPENDENT: no reward for rushing, no
          // penalty for thinking. Feeding 0 instead would pay the maximum
          // multiplier and turn "stop the clock" into "free points"; feeding the
          // real span would keep punishing deliberation, which is the bug. This
          // matches skipAward('smart_weighted'), which already awards the
          // on-estimate score, so a skipped paused task and a completed one agree.
          earnedScore = taskScoreSmart(
            gameTask.difficulty,
            gameTask.pausesTimer ? gameTask.estimatedMinutes : actualMinutes,
            gameTask.estimatedMinutes,
          );
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
    // pause-clock-tasks: stamp how much of THIS team's clock this task excludes,
    // measured from the SERVER's own stamps (the task's startedAt and `now`) —
    // never from anything the caller sent, which is what stops a client faking a
    // fast finish. Written here, once, on the same whole-object stage rewrite the
    // record already gets (never a dotted array path); the already-completed guard
    // above makes a duplicate submission a no-op, so the first stamp is final.
    // `actualMinutes` above keeps the REAL span on purpose — benchmarks, per-type
    // analytics and the staff over-duration warning read it.
    //
    // Stamped even when the span rounds to 0: routing's computeSkillRatio drops a
    // record by the PRESENCE of this field, so an instantly completed paused task
    // must still be recognisable as paused.
    if (gameTask?.pausesTimer) {
      taskRec.excludedMs = taskExcludedMs({ startedAt, completedAt: now }, true);
    }
    // fix-fixed-points-speed-template-drift: stamp the per-task EXPECTED route
    // minutes (the same resolved value scoreFixedPointsSpeed's route reduce reads —
    // expectedDurationMinutes ?? estimatedMinutes, with the same finite-and->0
    // guard) onto this record via the same whole-object stage rewrite. buildRankings
    // SUMS these stamps instead of re-reading the live template, so a creator lowering
    // a task's expected duration mid-run cannot retroactively re-score a finished
    // team. The already-completed guard above makes a duplicate submission a no-op,
    // so the first stamp is final.
    if (gameTask) {
      taskRec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask);
    }
    // survey-tasks: stamp the team's own response on its task record via the same
    // whole-object stage rewrite the record already gets (never a dotted array
    // path). The already-completed guard above makes duplicate submissions a
    // no-op, so the first response is final and is never overwritten.
    if (extras?.surveyResponse != null) {
      taskRec.surveyResponse = extras.surveyResponse;
    }
    // Test mode (change: test-mode-hidden-scoring): stamp WHAT the participant
    // answered and whether it was right, through the same whole-object stage
    // rewrite. Inside this transaction on purpose — a submission must never exist
    // without its verdict, and the already-completed guard above makes a double
    // tap a no-op, so the FIRST answer is the graded one and is never overwritten.
    // Owner-only: sanitizeTeamForParticipant never allow-lists either field.
    if (extras?.submittedAnswer != null) {
      taskRec.submittedAnswer = extras.submittedAnswer;
    }
    if (extras?.wasCorrect != null) {
      taskRec.wasCorrect = extras.wasCorrect;
    }
    // post-run-player-report: append the recorded submission through the SAME
    // whole-object stage rewrite (never a dotted array path — that coerces the
    // array to a map). Inside this transaction because the record and its verdict
    // must commit together; `appendAnswerLog` is total and bounded, so a corrupt
    // stored log or an unusable answer degrades to "record nothing" rather than
    // failing a legitimate submission. Unlike the two fields above, this is NOT
    // gated on the already-completed guard being first: the wrong answers that
    // preceded this completion were appended by the grading path on their way past.
    if (extras?.answerLog) {
      taskRec.answerLog = appendAnswerLog(taskRec.answerLog, extras.answerLog);
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

    // Mutually exclusive groups (change: mutually-exclusive-tasks): now that THIS
    // task is graded, retire its losing siblings. They are marked `skipped`, never
    // `failed` — and this MUST happen, not merely be rejected on a later attempt:
    // applyStageCompletion ends a stage on `completedCount >= required ||
    // allTerminal`, so a sibling left `pending` forever keeps completedCount below
    // an unreachable requiredTaskCount AND allTerminal false, stranding the team in
    // the stage permanently. Any sibling still ASSIGNED holds a station slot, so it
    // joins skippedHeldTaskIds and is decremented by the existing in-transaction
    // release loop below — releasing it post-commit instead would double-decrement
    // (the station-slot leak class we have shipped before). Ordered BEFORE
    // applyStageCompletion so the freshly skipped siblings count toward allTerminal.
    for (const t of stages[stageIdx].tasks) {
      if (!exclusiveSiblingIds.includes(t.taskId)) continue;
      if (t.status === 'completed' || t.status === 'skipped') continue;
      if (t.status === 'assigned') skippedHeldTaskIds.push(t.taskId);
      t.status = 'skipped';
      // fix-fixed-points-speed-template-drift: stamp the skipped sibling's expected
      // route-minutes from its template task, so a finished team's every terminal
      // record carries the immutable stamp.
      const siblingTemplate = gameStage?.tasks.find((gt) => gt.id === t.taskId);
      if (siblingTemplate) t.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(siblingTemplate);
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
  }));

  // WO Fix 4 (scale/perf): the live-leaderboard recompute is DELIBERATELY not run
  // from the completion hot path anymore. Even fire-and-forget it paid a runRef.get()
  // + an O(teams) collection scan + a SECOND transaction on the already-contended run
  // doc per scoring event — amplifying run-doc lock depth under load (it dominated
  // completeTask p95 at --teams=16). The board is now recomputed lazily at READ time:
  // the organizer-facing refreshLeaderboard / console poll and getPublicLeaderboard
  // both recompute on demand via the shared buildRankings (<100ms), skipStage's
  // force:true call keeps the low-frequency organizer path warm, and finalizeRun
  // reconciles definitively. The e2e scenario
  //   'completeTask does not write the run-doc leaderboard during active play; organizer read recomputes it'
  // and the existing live/final parity oracle guard this move.

  // Hostless-solo auto-finalize (change: fix-solo-selfguided-finalize). This is the
  // single shared grading choke point (completeTask/submitTaskAnswer/submitSequenceStep/
  // verifyStationCode/submitStationPhoto/reviewStationSubmission all funnel here), so
  // finalizing a solo self-guided run once its sole team finishes only needs this one
  // call site. GATED on the in-scope run flags — `selfGuided === true` (the airtight
  // discriminator: startInstantPlay is the ONLY writer of selfGuided; no organizer/
  // test-drive/duplicate/import run ever carries it) — so a normal organizer or
  // multi-team run enters the helper zero times and pays no extra reads. Runs only
  // after a REAL completion (result.completed), so a duplicate/idempotent no-op never
  // re-finalizes. BEST-EFFORT: the player's completion has ALREADY committed above; any
  // failure inside auto-finalize is swallowed here so it can never break or roll back
  // that committed completion — worst case is "solo run not finalized" (== prior
  // behavior, no regression). maybeAutoFinalizeSoloRun re-reads the run/team as the
  // source of truth and no-ops on an already-finished run (idempotent).
  if (result.completed && isSoloSelfGuidedRun(runData)) {
    await maybeAutoFinalizeSoloRun(ownerUid, gameId, runId).catch((e) =>
      logBestEffort('autoFinalizeSolo', { ownerUid, gameId, runId }, e),
    );
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
        // fix-fixed-points-speed-template-drift: stamp the skipped task's expected
        // route-minutes so a finished team's terminal record is immutable against
        // later template edits.
        if (gameTask) taskRec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask);
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


// ─── skipTaskForTeam (change: skip-single-task) ───────────────────────────────
// Skip ONE mission for ONE team, WITHOUT ending the stage.
//
// `skipStage` above is the only skip the platform had, and it is a blunt one: it
// marks every non-completed task of the team's active stage as skipped and closes
// the stage. So an organiser removing one unreachable stop (shop shut, riddle the
// team cannot crack, a member who cannot walk that hill) also destroyed every OTHER
// stop that team still had left. This is the per-task version:
//
//   • only the named task (default: the one the team is holding) becomes `skipped`;
//   • it earns EXACTLY 0 — `skipStage`'s `skipAward` consolation is deliberately not
//     paid here, because a single mission is not a stage being taken away. An
//     organiser who wants to compensate has `adjustTeamScore`, audited on its own;
//   • the team is routed to another task IN THE SAME STAGE through the ordinary
//     assignment path, so station caps, exclusive groups, unlock gates, expiry,
//     scheduled release and the run's live pause overrides all still apply;
//   • the stage advances ONLY if the skip genuinely completes it — decided by the
//     same `applyStageCompletion` every other completion path uses;
//   • the team is never stranded: `planTaskSkip` lowers THAT TEAM's stored
//     `requiredTaskCount` to what is still attainable (`maxCompletableTasks`, so a
//     group of alternatives yields one completion), by the smallest amount that
//     keeps the stage winnable. The lowered number lives on the TEAM's stage record,
//     never on the game template (which later runs replay and the Builder rewrites).
//
// Privileged: owner / platform admin / staff scoped to THIS run, and audited —
// it removes a scoring opportunity from a specific team.
export const skipTaskForTeam = loggedCallable('skipTaskForTeam', async (data, context) => {
  const {
    ownerUid: ownerUidIn, gameId, runId, teamId, taskId: taskIdIn, reason,
  } = data as {
    ownerUid?: string; gameId: string; runId: string; teamId: string;
    taskId?: string; reason?: string;
  };
  // The creator console calls without an explicit ownerUid (it IS the owner);
  // staff always pass it, because their token is scoped to that owner's run.
  const ownerUid = ownerUidIn ?? context.auth?.uid ?? '';
  const operatorId = assertStaffOrOwner(context, ownerUid, runId);

  const ids = validate(() => ({
    gameId: requireString(gameId, 'gameId', MAX_ID_LEN),
    runId: requireString(runId, 'runId', MAX_ID_LEN),
    teamId: requireString(teamId, 'teamId', MAX_ID_LEN),
  }));
  const cleanReason = typeof reason === 'string' ? reason.slice(0, 200) : '';

  const runRef = db.doc(runPath(ownerUid, ids.gameId, ids.runId));
  const [runSnap, gameSnap] = await Promise.all([
    runRef.get(),
    db.doc(gamePath(ownerUid, ids.gameId)).get(),
  ]);
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const run = runSnap.data() as Run;
  if (run.ownerUid !== ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  // Same rule as every other grading path: a finalized run's board is frozen, so
  // nothing may still move a team's task records.
  if (run.status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This run has already finished');
  }
  const game = gameSnap.data() as Game;
  const teamRef = db.doc(teamPath(ownerUid, ids.gameId, ids.runId, ids.teamId));
  const now = new Date().toISOString();

  // Filled inside the transaction (reset per attempt — a transaction body can run
  // more than once). Released AFTER the commit, exactly like skipStage.
  let releaseIds: string[] = [];
  let skippedTaskId = '';
  let stageCompleted = false;
  let requiredTaskCount = 0;
  let requirementLowered = false;
  let taskTitle = '';
  let previousStatus = '';

  await db.runTransaction(async (tx) => {
    releaseIds = [];
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = teamSnap.data() as RunTeam;
    const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));

    const stageIdx = stages.findIndex((s) => s.status === 'active');
    if (stageIdx < 0) throw new functions.https.HttpsError('failed-precondition', 'No active stage');
    const stageRec = stages[stageIdx];
    const gameStage = game.stages?.find((s) => s.id === stageRec.stageId);

    // Which mission. An explicit id wins; otherwise the one the team is holding
    // (activeTaskId first, then the in-flight record, so a stale activeTaskId
    // pointing at nothing still resolves).
    const inFlight = stageRec.tasks.find((t) => t.status === 'assigned');
    const targetId = taskIdIn
      ?? (stageRec.tasks.some((t) => t.taskId === team.activeTaskId) ? team.activeTaskId : undefined)
      ?? inFlight?.taskId;
    if (!targetId) {
      throw new functions.https.HttpsError('failed-precondition', 'This team is not on a mission right now');
    }

    const statusByTaskId: Record<string, TaskProgressStatus> = {};
    for (const t of stageRec.tasks) statusByTaskId[t.taskId] = t.status;

    const plan = planTaskSkip({
      // The authored stage drives the exclusive-group arithmetic; fall back to the
      // team's own record when the template no longer carries the stage (a mid-run
      // template edit must not make a skip impossible).
      stage: {
        tasks: (gameStage?.tasks ?? stageRec.tasks.map((t) => ({ id: t.taskId }))).map((t) => ({
          id: (t as { id?: string }).id ?? '',
        })),
        exclusiveGroups: gameStage?.exclusiveGroups,
      },
      statusByTaskId,
      requiredTaskCount: stageRec.requiredTaskCount,
    }, targetId);

    if (!plan.ok) {
      if (plan.reason === 'taskNotInStage') {
        throw new functions.https.HttpsError('not-found', 'That mission is not in this team\'s active stage');
      }
      // A repeat skip, or a task the team already completed. Refused, and nothing
      // is written — so a double-click can never double-release a station slot.
      throw new functions.https.HttpsError('failed-precondition', 'That mission is already completed or skipped');
    }

    const rec = stageRec.tasks.find((t) => t.taskId === targetId)!;
    previousStatus = rec.status; // 'assigned' when the team was holding it, else 'unassigned'
    rec.status = 'skipped';
    rec.completedAt = now;
    rec.earnedScore = 0; // no consolation award — see the header
    // fix-fixed-points-speed-template-drift: stamp the skipped task's expected
    // route-minutes from its template task so a finished team's terminal record is
    // immutable against later template edits.
    {
      const skipTemplate = gameStage?.tasks.find((gt) => gt.id === targetId);
      if (skipTemplate) rec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(skipTemplate);
    }
    if (plan.heldSlot) releaseIds.push(targetId);
    // The team's OWN requirement for this stage, so the stage stays winnable. Never
    // written to the template (which later runs replay and the Builder rewrites).
    stageRec.requiredTaskCount = plan.requiredTaskCount;

    // ONE definition of "did that end the stage": the same helper completeTaskForTeam
    // uses, so leftovers auto-skip, unreachable tasks retire and the next stage
    // unlocks (or stays release-gated) by exactly the same rules.
    const { completed, heldAssignedTaskIds } = applyStageCompletion(stages, stageIdx, game, run.launchedAt, now);
    releaseIds.push(...heldAssignedTaskIds);
    stageCompleted = completed;
    requiredTaskCount = plan.requiredTaskCount;
    requirementLowered = plan.requirementLowered;
    skippedTaskId = targetId;
    taskTitle = findGameTask(game, targetId)?.title ?? '';

    const allDone = stages.every((s) => s.status === 'completed');
    // Whole-array rewrite (never a dotted update into an array — it would coerce
    // the array to a map). Score is untouched: a skip pays nothing.
    tx.update(teamRef, {
      stages,
      ...(allDone ? { status: 'finished', finishedAt: now } : {}),
      activeTaskId: null,
      updatedAt: now,
    });
  });

  // Give the station its capacity back — guarded at zero inside releaseTask, and
  // deduped here so a task that was both skipped and auto-skipped is released once.
  for (const id of [...new Set(releaseIds)]) {
    await releaseTask(id, ownerUid, ids.gameId, ids.runId);
  }

  // Hand the team its next mission immediately. The console has no GPS fix for the
  // team, so a null-island origin is passed: every real candidate is then past the
  // 30-minute transit cap, which makes the transit term a constant that cancels
  // between candidates — the choice falls to station load and the adaptive
  // difficulty fit (change: adaptive-difficulty-routing removed the preset gate, so
  // that term is always on). The participant's very next poll re-routes with real
  // coordinates. Best effort: the skip has already committed, and a routing hiccup
  // must not report it as failed.
  let nextTaskId: string | null = null;
  let nextReason: string | null = null;
  try {
    const next = await assignNextInActiveStage(
      ownerUid, ids.gameId, ids.runId, ids.teamId, { lat: 0, lng: 0 }, now, game,
    );
    nextTaskId = next.taskId ?? null;
    nextReason = next.reason ?? null;
  } catch (e) {
    functions.logger.warn('skipTaskForTeam: re-assignment skipped', {
      ownerUid, gameId: ids.gameId, runId: ids.runId, teamId: ids.teamId, error: (e as Error).message,
    });
  }

  // Durable trail, like adjustTeamScore: this takes a scoring opportunity away
  // from one identified team.
  await writeAuditLog({
    ownerUid,
    gameId: ids.gameId,
    runId: ids.runId,
    teamId: ids.teamId,
    operatorId,
    actionType: AUDIT_TASK_SKIPPED,
    previousValue: previousStatus,
    newValue: 'skipped',
    reason: cleanReason,
    taskId: skippedTaskId,
    taskTitle,
    stageCompleted,
    requiredTaskCount,
    requirementLowered,
  });

  await maybeRefreshLeaderboardSnapshot(ownerUid, ids.gameId, ids.runId, { force: true });

  return {
    ok: true,
    taskId: skippedTaskId,
    stageCompleted,
    requiredTaskCount,
    requirementLowered,
    nextTaskId,
    nextReason,
  };
});


// ─── Per-team hold (change: staff-console-field-ops) ─────────────────────────
//
// A marshal parks ONE team — injury, dispute, a bathroom break, waiting on staff —
// without touching the run or any other team. Nothing in the product could do this
// before: `setRunTaskStatus` pauses a TASK for the whole run, and `outOfBounds` is
// system-detected, not staff-initiated.
//
// Three properties make it safe to hand to a volunteer with a phone:
//   1. The team's clock stops. Held time accumulates into `RunTeam.heldMs` and is
//      subtracted by buildRankings (see teamHeldExclusionMs), so a hold can never
//      cost a team its standing — otherwise no marshal would dare use it.
//   2. Progress is blocked, but READS are not. Every write path refuses via
//      assertTeamNotHeld; getMyTeamState deliberately does not, so the participant
//      app can explain the pause instead of showing seven opaque failures.
//   3. It is reversible and audited, and it cannot outlive the run (finalizeRun
//      settles any still-open hold).

/**
 * Refuse a progress-advancing action while the team is on a staff hold.
 *
 * Called at the TOP of every write path a team can advance through, before any
 * state is read that assumes the team may act — so a held team causes zero side
 * effects (no station slot reserved, no stage sweep persisted).
 *
 * Deliberately NOT applied to read paths. A held team must still be able to load
 * its own state; that is the only way the app can say "staff paused you" instead
 * of failing silently, and a read grants nothing a hold is meant to prevent.
 */
export function assertTeamNotHeld(team: Pick<RunTeam, 'held' | 'heldReason'>): void {
  if (team?.held !== true) return;
  // `failed-precondition` (not permission-denied): the caller is legitimate, the
  // STATE is temporarily wrong. describeCallFailure maps this to a non-retryable
  // 'rejected' on the client, which is exactly right — retrying changes nothing
  // until staff resume the team.
  throw new functions.https.HttpsError(
    'failed-precondition',
    'TEAM_HELD', // stable code — clients localize it, never render this string
    { reason: team.heldReason ?? '' },
  );
}

export const setTeamHold = loggedCallable('setTeamHold', async (data, context) => {
  const {
    ownerUid: ownerUidIn, gameId, runId, teamId, held, reason,
  } = data as {
    ownerUid?: string; gameId: string; runId: string; teamId: string;
    held?: unknown; reason?: string;
  };
  const ownerUid = ownerUidIn ?? context.auth?.uid ?? '';
  const operatorId = assertStaffOrOwner(context, ownerUid, runId);
  await enforceRateLimit(operatorId, 'setTeamHold');

  if (typeof held !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'held must be a boolean');
  }
  const ids = validate(() => ({
    gameId: requireString(gameId, 'gameId', MAX_ID_LEN),
    runId: requireString(runId, 'runId', MAX_ID_LEN),
    teamId: requireString(teamId, 'teamId', MAX_ID_LEN),
  }));
  const cleanReason = typeof reason === 'string' ? reason.slice(0, 200) : '';
  // Attribution comes from the token claim, never the payload — same rule the chat
  // and audit paths already follow.
  const heldBy = (context.auth?.token as { staffName?: string } | undefined)?.staffName
    ?? (operatorId === ownerUid ? 'Admin' : 'Staff');

  const runSnap = await db.doc(runPath(ownerUid, ids.gameId, ids.runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = runSnap.data() as Run;
  if (run.ownerUid !== ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  // A finalized run's board is frozen; nothing may still move a team's clock.
  if (run.status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This run has already finished');
  }

  const teamRef = db.doc(teamPath(ownerUid, ids.gameId, ids.runId, ids.teamId));
  const now = new Date().toISOString();
  let addedMs = 0;

  // Transactional read-modify-write: `heldMs` is an accumulator, so a concurrent
  // resume must not read a stale total and lose an interval.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const team = snap.data() as RunTeam;
    const currentlyHeld = team.held === true;

    // Idempotence guard, both directions. A double-tapped resume must not add a
    // second interval to heldMs (which would hand the team free time), and a
    // double-tapped hold must not restamp heldAt (which would DISCARD the elapsed
    // interval). Refusing is safer than silently no-op'ing: the marshal sees that
    // the state was already what they wanted rather than assuming their tap landed.
    if (held === currentlyHeld) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        held ? 'This team is already on hold' : 'This team is not on hold',
      );
    }

    if (held) {
      tx.update(teamRef, {
        held: true,
        heldAt: now,
        heldReason: cleanReason,
        heldBy,
        updatedAt: now,
      });
    } else {
      // Settle the interval from the SERVER's own stamps. A missing/garbled heldAt
      // (a doc hand-edited, or written by an older build) contributes 0 rather than
      // NaN — the fail-safe direction, since this number is subtracted from the
      // team's race clock.
      const startedMs = Date.parse(team.heldAt ?? '');
      const elapsed = Number.isFinite(startedMs) ? Date.now() - startedMs : 0;
      addedMs = Math.max(0, elapsed);
      tx.update(teamRef, {
        held: false,
        heldAt: FieldValue.delete(),
        heldReason: FieldValue.delete(),
        heldMs: (Number.isFinite(team.heldMs) ? (team.heldMs as number) : 0) + addedMs,
        updatedAt: now,
      });
    }
  });

  await writeAuditLog({
    ownerUid,
    gameId: ids.gameId,
    runId: ids.runId,
    teamId: ids.teamId,
    operatorId,
    actionType: held ? AUDIT_TEAM_HELD : AUDIT_TEAM_RESUMED,
    previousValue: held ? 'active' : 'held',
    newValue: held ? 'held' : 'active',
    reason: cleanReason,
    heldMsAdded: addedMs,
  });

  // The board's durations change the moment a hold is settled, so refresh it now
  // (forced, best-effort — a frozen board still wins, like every other caller).
  if (!held) {
    await maybeRefreshLeaderboardSnapshot(ownerUid, ids.gameId, ids.runId, { force: true });
  }

  return { ok: true, held, heldMsAdded: addedMs };
});


// ─── forceAssignTask (change: staff-console-field-ops) ────────────────────────
//
// Send ONE team to a SPECIFIC task, instead of waiting for smart routing to pick.
// The field reasons are crowd flow (a station is empty while another has a queue),
// and unblocking a team that routing has left circling.
//
// What it may NOT do, and why:
//   • Never exceed a station's capacity. `maxConcurrentTeams` models physical room
//     at a real location, and the concurrent-claim invariant is guarded by the e2e
//     station-contention scenario. This claims the slot inside the SAME transaction
//     that checks the cap — the identical shape assignTask uses — so a full station
//     refuses a force-assign exactly as it refuses a routed one.
//   • Never leave the team's current active stage. Stage sequencing (required task
//     counts, exclusive groups, the final-stage trigger) is not written to tolerate
//     an out-of-sequence claim, so a task from a locked future stage, a completed
//     stage, or another game is refused outright.
//
// `override` bypasses ONLY the soft sequencing gates (unlock / scheduled release /
// expiry) — the ones a marshal legitimately needs to open early for one team. It is
// off by default and audited under its own action type, so an organizer reading the
// trail can see exactly when an authored rule was deliberately set aside.
export const forceAssignTask = loggedCallable('forceAssignTask', async (data, context) => {
  const {
    ownerUid: ownerUidIn, gameId, runId, teamId, taskId, override, reason,
  } = data as {
    ownerUid?: string; gameId: string; runId: string; teamId: string;
    taskId: string; override?: unknown; reason?: string;
  };
  const ownerUid = ownerUidIn ?? context.auth?.uid ?? '';
  const operatorId = assertStaffOrOwner(context, ownerUid, runId);
  await enforceRateLimit(operatorId, 'forceAssignTask');

  const ids = validate(() => ({
    gameId: requireString(gameId, 'gameId', MAX_ID_LEN),
    runId: requireString(runId, 'runId', MAX_ID_LEN),
    teamId: requireString(teamId, 'teamId', MAX_ID_LEN),
    taskId: requireString(taskId, 'taskId', MAX_ID_LEN),
  }));
  const useOverride = override === true;
  const cleanReason = typeof reason === 'string' ? reason.slice(0, 200) : '';

  const [runSnap, gameSnap] = await Promise.all([
    db.doc(runPath(ownerUid, ids.gameId, ids.runId)).get(),
    db.doc(gamePath(ownerUid, ids.gameId)).get(),
  ]);
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const run = runSnap.data() as Run;
  if (run.ownerUid !== ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }
  if (run.status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This run has already finished');
  }
  const game = gameSnap.data() as Game;

  const teamRef = db.doc(teamPath(ownerUid, ids.gameId, ids.runId, ids.teamId));
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
  const team = teamSnap.data() as RunTeam;

  // A held team is parked on purpose — routing it somewhere would defeat the hold.
  assertTeamNotHeld(team);

  const stageIdx = team.stages.findIndex((s) => s.status === 'active');
  if (stageIdx < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'This team has no active stage');
  }
  const stageRec = team.stages[stageIdx];
  const targetRec = stageRec.tasks.find((t) => t.taskId === ids.taskId);
  // Stage scope. Refusing here (rather than letting the claim through) is what
  // keeps every stage-completion invariant intact — see the header.
  if (!targetRec) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'That mission is not in this team\'s current stage',
    );
  }
  if (targetRec.status === 'assigned') {
    // Already there. Refuse rather than release-and-reclaim, which would briefly
    // free the slot and let another team take it out from under this one.
    throw new functions.https.HttpsError('failed-precondition', 'This team is already on that mission');
  }
  if (targetRec.status === 'completed' || targetRec.status === 'skipped') {
    throw new functions.https.HttpsError('failed-precondition', 'That mission is already completed or skipped');
  }

  const gameStage = game.stages?.find((s) => s.id === stageRec.stageId);
  const gameTask = gameStage?.tasks.find((t) => t.id === ids.taskId);
  if (!gameTask) {
    throw new functions.https.HttpsError('not-found', 'Mission not found in the game');
  }

  const now = new Date().toISOString();
  const completedTaskIds = team.stages
    .flatMap((s) => s.tasks)
    .filter((t) => t.status === 'completed')
    .map((t) => t.taskId);

  // Claim the chosen task with the SAME atomic cap check assignTask performs, then
  // (only on success) release whatever the team was holding. Order matters: claiming
  // first means a refused claim leaves the team exactly as it was, still holding its
  // original task, rather than stranded with nothing.
  const claim = await claimSpecificTask(
    gameTask, completedTaskIds, ownerUid, ids.gameId, ids.runId, useOverride, run.launchedAt,
  );
  if (!claim.ok) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      claim.reason === 'stationsFull'
        ? 'That station is already full'
        : 'That mission is not open right now',
    );
  }

  let displacedTaskId: string | null = null;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(teamRef);
      if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
      const fresh = snap.data() as RunTeam;
      const stages = fresh.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
      const idx = stages.findIndex((s) => s.status === 'active');
      if (idx < 0) throw new functions.https.HttpsError('failed-precondition', 'This team has no active stage');
      const rec = stages[idx].tasks.find((t) => t.taskId === ids.taskId);
      if (!rec) throw new functions.https.HttpsError('invalid-argument', 'That mission is not in this team\'s current stage');
      if (rec.status !== 'unassigned') {
        // Re-checked inside the transaction: the team may have been routed onto this
        // very task between our read and this write.
        throw new functions.https.HttpsError('failed-precondition', 'This team is already on that mission');
      }

      // Displace whatever else is in flight in this stage. It goes back to
      // `unassigned` (NOT skipped): the team never had a chance to fail it, so it
      // must stay winnable — and leaving it unassigned means requiredTaskCount needs
      // no adjustment, unlike skipTaskForTeam.
      const inFlight = stages[idx].tasks.find((t) => t.status === 'assigned');
      if (inFlight) {
        inFlight.status = 'unassigned';
        delete inFlight.startedAt;
        displacedTaskId = inFlight.taskId;
      }

      rec.status = 'assigned';
      rec.startedAt = now;

      tx.update(teamRef, {
        stages,
        activeTaskId: ids.taskId,
        updatedAt: now,
      });
    });
  } catch (e) {
    // The slot was claimed before the team write; if the write failed, give it back
    // rather than leaking capacity at that station for the rest of the run.
    await releaseTask(ids.taskId, ownerUid, ids.gameId, ids.runId).catch(() => undefined);
    throw e;
  }

  if (displacedTaskId) {
    await releaseTask(displacedTaskId, ownerUid, ids.gameId, ids.runId);
  }

  await writeAuditLog({
    ownerUid,
    gameId: ids.gameId,
    runId: ids.runId,
    teamId: ids.teamId,
    operatorId,
    actionType: useOverride ? AUDIT_TASK_FORCE_ASSIGNED_OVERRIDE : AUDIT_TASK_FORCE_ASSIGNED,
    previousValue: displacedTaskId ?? '',
    newValue: ids.taskId,
    reason: cleanReason,
    taskId: ids.taskId,
    taskTitle: gameTask.title ?? '',
    override: useOverride,
  });

  // Tell the team WHY their mission changed. Best-effort and after the commit, the
  // same shape adjustTeamScore's score notice uses — a silent task swap mid-run
  // reads as a bug to the player holding the phone.
  try {
    const noticeRef = db
      .collection(`users/${ownerUid}/games/${ids.gameId}/runs/${ids.runId}/announcements`)
      .doc();
    await noticeRef.set({
      id: noticeRef.id,
      kind: 'forceAssign',
      teamId: ids.teamId,
      taskId: ids.taskId,
      message: `Staff sent you to: ${gameTask.title ?? ''}`,
      messageHe: `הצוות שלח אתכם אל: ${gameTask.title ?? ''}`,
      active: true,
      createdAt: now,
      createdBy: operatorId,
    });
  } catch (e) {
    functions.logger.warn('forceAssignTask notice write failed', {
      ownerUid, gameId: ids.gameId, runId: ids.runId, teamId: ids.teamId, err: String(e),
    });
  }

  return { ok: true, taskId: ids.taskId, displacedTaskId, override: useOverride };
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

    // Pause-clock tasks (change: pause-clock-tasks): ONE excluded amount per team,
    // summed from the values the server STAMPED on each completed paused task, and
    // fed to EVERY time-derived term below (speed bonus, emitted duration, the
    // time_only ordering, and the Z-Score's durationMin). Summing the stamps rather
    // than re-reading `task.pausesTimer` off the template is deliberate: a creator
    // may edit the template mid-run, and re-deriving would retroactively re-time
    // finished work and make the live board jump. Because this is a pure function
    // of the stored team document — not of `now`, not of the template, not of any
    // client input — finalizeRun and refreshLeaderboard compute the same value, so
    // live and final standings cannot drift.
    //
    // staff-console-field-ops: a staff-initiated HOLD is excluded by the same rule
    // and at the same single site. It is added here rather than anywhere downstream
    // so every time-derived term below (speed bonus, emitted duration, the time_only
    // ordering and the Z-Score's durationMin) subtracts it exactly once. Same
    // immutability argument as the task stamps: `heldMs` is an accumulated total the
    // server wrote at resume from its own clock — never `heldAt` measured against
    // `now` — so a team released an hour ago cannot keep accruing exclusion, and the
    // live board and the final board still read the identical number.
    const excludedMs = teamExcludedMs(team.stages) + teamHeldExclusionMs(team);

    switch (game.scoringPreset) {
      case 'time_only':
        rawScore = 0;
        break;
      case 'fixed_points_speed':
        // Gate the speed bonus on REAL completion. Passing `team.finishedAt ?? now`
        // scored an unfinished (started, no finishedAt) team as if it had finished at
        // `now`, so its speed bonus decayed as wall-clock advanced — a phantom score
        // that shrank between refreshes and broke live/final parity. Only a genuinely
        // finished team feeds a finishedAt into the bonus math; otherwise
        // scoreFixedPointsSpeed short-circuits to taskPoints (time-invariant).
        // fix-fixed-points-speed-template-drift: the ROUTE EXPECTED-TOTAL is likewise
        // summed from the per-task expectedDurationMinutesAtCompletion stamps the
        // server wrote at each record's terminal transition (with a template fallback
        // for legacy records), NOT re-reduced over game.stages — so a mid-run edit to
        // a task's expected duration cannot retroactively re-score a finished team.
        rawScore = scoreFixedPointsSpeed(
          team.stages,
          team.startedAt,
          team.status === 'finished' ? team.finishedAt : undefined,
          game,
          excludedMs,
        );
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

    // Gate the emitted duration on REAL completion, exactly as the fixed_points_speed
    // score above does. Passing `team.finishedAt ?? now` made an unfinished (started,
    // no finishedAt) team's durationSeconds/totalMinutes track wall-clock `now`, so
    // they drifted every recompute — breaking live/final parity AND finalize
    // idempotency (a re-finalize rewrote the frozen final board's durations against a
    // later `now`). Only a genuinely finished team feeds a finishedAt into the
    // duration; otherwise durationSeconds() returns Infinity → the field is omitted
    // below, keeping an unfinished team's entry a pure function of stored state.
    //
    // pause-clock-tasks: the excluded amount comes off HERE, once, so the emitted
    // durationSeconds/totalMinutes, the time_only ordering (which sorts on that
    // same field) and the Z-Score's durationMin all read one adjusted value. The
    // floor is zero — a game whose every task pauses the clock reaches exactly 0,
    // never a negative — and an Infinity (unfinished team) passes through so the
    // field is still omitted below.
    const durSec = adjustedElapsedSeconds(
      durationSeconds(team.startedAt, team.status === 'finished' ? team.finishedAt : undefined),
      excludedMs,
    );
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
      // Final backstop: sink any residual non-finite score to 0 at emit. This both
      // guarantees the leaderboard is JSON-encodable (getMyTeamState/refreshLeaderboard
      // must not crash) and makes the `b.score - a.score` comparator below a total
      // order (a NaN score otherwise scrambles TimSort → live/final ordering drift,
      // since teams are read from an unordered Firestore query).
      score: Number.isFinite(rawScore) ? rawScore : 0,
      completedStages: team.stages.filter((s) => s.status === 'completed').length,
      finishedAt: team.finishedAt,
      durationSeconds: durFinite,
      totalMinutes: durFinite != null ? durFinite / 60 : undefined,
      durationMin: durSec / 60,
    };
  });

  // Apply Z-Score for non-time presets (only meaningful once teams have finished)
  if (game.scoringPreset !== 'time_only' && scored.length >= 2) {
    const finishedDurations = scored
      .filter((t) => t.finishedAt && Number.isFinite(t.durationMin))
      .map((t) => t.durationMin);
    if (finishedDurations.length >= 2) {
      for (const t of scored) {
        if (t.finishedAt && Number.isFinite(t.durationMin)) {
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

    // The game template cannot change while a run is in flight, and this fires on a 20s
    // throttle for the run's whole duration (change: hot-path-read-cost).
    const gameCached = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ownerUid, gameId));
    if (!gameCached.data) return;
    const game = gameCached.data;

    // THE MOST EXPENSIVE READ IN THE PRODUCT, before this change. A plain collection get()
    // read EVERY team document every 20 seconds: at 120 teams over a 75-minute run that is
    // ~225 x 122 = ~27,450 reads, against a 50,000/day Spark ceiling — and it was invisible,
    // because the cost is billed to whichever player callable happened to trigger the refresh
    // (which is why submitTaskAnswer measured 10.53 reads/call for three documents of work).
    //
    // `cachedGetCollection` re-reads only the documents that were actually WRITTEN since the
    // last pass, which is what listRunTeams has always done over this same collection. Cost
    // now tracks churn instead of field size. Correctness is unchanged: the API is the sole
    // writer, so a team that just scored has had its entry invalidated and is re-read here —
    // the board can never rank a team on a score it has already superseded.
    const teamRows = await cachedGetCollection<unknown>(
      db, docCachePolicy, teamsCol(ownerUid, gameId, runId),
    );
    // Quarantine any single poisoned/legacy team doc instead of counting it raw
    // — finalizeRun (:1348) and refreshLeaderboard (:1504) both do this, so the
    // live auto-refresh must too or live vs final standings diverge on a bad row.
    const teams = parseTeamsQuarantining(
      teamRows.map((r) => ({ id: r.id, data: () => r.data })),
    );

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

  // Test mode (change: test-mode-hidden-scoring): a discovery waypoint is trivia with
  // a point bonus, so it leaks BOTH halves of what this mode hides. Costs one extra
  // read, on a rare path (a POI is claimed at most once per team).
  const poiGameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  const poiSealed = sealsScoreFromParticipant(poiGameSnap.data() as Game | undefined);

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
        // Wave-G #1: the RANKING must reflect the bonus. buildRankings derives every
        // ranked score from stages[].earnedScore + completionBonus − bonusPenalty and
        // NEVER reads team.score, so the bonus rides the counted bonusPenalty channel
        // (a bonus is a NEGATIVE penalty), exactly as captureZone does — otherwise it's
        // invisible on both the live and frozen-final boards.
        bonusPenalty: (team.bonusPenalty ?? 0) - bonus,
        // DISPLAY channel: team.score is the running total the participant's own
        // PlayScreen header + StaffConsole show DIRECTLY (not via rankings), kept in step
        // by completeTask/skipStage. Keep bumping it so the header doesn't visibly drop
        // the discovery bonus. buildRankings ignores team.score, so maintaining BOTH does
        // NOT double-count in the standings.
        score: (team.score ?? 0) + bonus,
        updatedAt: now,
      });
      return poiSealed ? { recorded: true } : { correct: true, bonus };
    }

    // Wrong answer. Normally: mark triggered (seen), award nothing, retry allowed.
    //
    // On a sealed run the answer is FINAL instead ('answered'), for the same reason a
    // wrong quiz answer completes its task: leaving it retryable while saying nothing
    // invites the player to grind the same waypoint forever with no signal that they
    // already had their go. No bonus either way, so the creator's scoring is unchanged.
    discoveryState[poiId] = poiSealed ? 'answered' : 'triggered';
    tx.update(teamRef, { discoveryState, updatedAt: now });
    return poiSealed ? { recorded: true } : { correct: false, bonus: 0 };
  });
});


// finalizeRunCore — the authoritative "write the final board" body, factored out
// of the finalizeRun callable so it can be reused by the hostless-solo auto-finalize
// path (change: fix-solo-selfguided-finalize) WITHOUT duplicating any scoring or the
// run write. It performs the EXACT read (game + teams) + buildRankings + runRef.update
// that finalizeRun has always done. Callers own auth/ownership; this core does not
// authenticate (an internal function). Returns the computed rankings and whether the
// run was ALREADY finished (in which case it writes nothing — the idempotency backstop).
async function finalizeRunCore(
  ownerUid: string,
  gameId: string,
  runId: string,
  opts?: { forcePublish?: boolean },
): Promise<{ rankings: LeaderboardEntry[]; alreadyFinal: boolean }> {
  const runRef = db.doc(runPath(ownerUid, gameId, runId));
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  // Validate the stored docs that feed buildRankings — a corrupt run/game/team
  // fails loud (internal) rather than skewing the final standings (parse-boundary).
  const run = parseStored(() => parseRun(runSnap.data()));
  // Idempotency backstop: a re-finish, or a manual finalize racing the auto path,
  // is a no-op rather than a second status:'finished' write. This ALSO guarantees
  // onRunFinalized (guarded on the before→'finished' transition) can never fire a
  // second time, so badges/profile/benchmark/email consolidate exactly once.
  if (run.status === 'finished') return { rankings: [], alreadyFinal: true };

  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  const game = parseStored(() => parseGame(gameSnap.data()));

  const teamsSnap = await db.collection(teamsCol(ownerUid, gameId, runId)).get();
  const teams = parseTeamsQuarantining(teamsSnap.docs);

  const now = new Date().toISOString();

  // Settle any STILL-OPEN staff hold before scoring (staff-console-field-ops).
  // A hold must not outlive the run: a team left held at finalize would otherwise
  // (a) keep `held: true` forever on a finished run, and (b) lose the exclusion for
  // the interval between "held" and "run ended" — the very stretch the marshal
  // parked them for. Settled from the SERVER's own stamps, in memory FIRST so the
  // rankings below already see the corrected total, then persisted best-effort:
  // the authoritative board write must not fail because one team-doc update did.
  const nowMs = Date.parse(now);
  const settledHolds: { teamId: string; heldMs: number }[] = [];
  for (const team of teams) {
    if (team.held !== true) continue;
    const startedMs = Date.parse(team.heldAt ?? '');
    const extra = Number.isFinite(startedMs) && Number.isFinite(nowMs)
      ? Math.max(0, nowMs - startedMs)
      : 0;
    const total = (Number.isFinite(team.heldMs) ? (team.heldMs as number) : 0) + extra;
    // Mutating the in-memory copy is what makes buildRankings below correct; the
    // persisted write right after keeps the stored doc consistent with the board.
    team.heldMs = total;
    team.held = false;
    settledHolds.push({ teamId: team.id, heldMs: total });
  }
  for (const s of settledHolds) {
    await db.doc(teamPath(ownerUid, gameId, runId, s.teamId))
      .update({
        held: false,
        heldAt: FieldValue.delete(),
        heldReason: FieldValue.delete(),
        heldMs: s.heldMs,
        updatedAt: now,
      })
      .catch((e) => logBestEffort('finalizeRunCore.settleHold', { runId, teamId: s.teamId }, e));
  }

  const rankings = buildRankings(game, teams, now);

  // Finalizing publishes the final standings to participants UNLESS the creator
  // opted into a staged reveal (change: manual-leaderboard-reveal) — then the
  // board is computed and frozen but withheld until the creator explicitly calls
  // refreshLeaderboard({ publish: true }) from the run console. Organizers always
  // see the standings regardless (they read the run doc directly). A hostless solo
  // run has no organizer to stage a reveal, so the auto-finalize path passes
  // forcePublish:true to publish unconditionally (else the finisher would just hit
  // the "🤫 under wraps" dead-end with nobody to reveal). This authoritative write
  // is the ENTIRE job of finalizeRun (perf: run-perf-scale Task 9) — it's what the
  // client is actually waiting on to move past "Ending run…", so it's the only
  // thing awaited before returning. Heavier consolidation (per-team player-profile
  // folds, the cross-tenant benchmark aggregate, the summary email) is handled by
  // the `onRunFinalized` Firestore trigger below, which fires off THIS write's
  // status:'finished' transition — see that trigger for why a background trigger
  // (not a fire-and-forget promise here) is the correct mechanism.
  const published = opts?.forcePublish ? true : !game.manualLeaderboardReveal;
  await runRef.update({
    status: 'finished',
    finishedAt: now,
    // WO Fix 3: freeze the FINAL board so the throttled auto-snapshot
    // (maybeRefreshLeaderboardSnapshot bails on frozen) can never recompute and
    // overwrite the published final standings after finalize. An organizer can
    // still explicitly un-freeze via refreshLeaderboard if they intend to.
    leaderboard: { rankings, frozen: true, published, updatedAt: now },
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

  // Release this run's cached documents (change: vps-firestore-read-offload). A finished
  // run's teams are never on a hot path again, so holding them only consumes the bound
  // that live runs need. Dropping is never a correctness risk — the worst case is one
  // Firestore read if something does read the run again.
  docCachePolicy.dropPrefix(runPath(ownerUid, gameId, runId));

  // Post-finalize consolidation, INLINE (change: run-email-scope-and-digest).
  // The `onRunFinalized` trigger below is not invoked at all on a callable-only
  // host, which is why the summary email, the player-profile folds and the
  // benchmark contribution had all silently stopped. Running it here makes the
  // behavior topology-independent; the per-concern transactional claims keep it
  // exactly-once if the trigger also fires.
  //
  // Ordered AFTER the authoritative write and wrapped whole: consolidation can
  // never prevent a run from being finalized. It is AWAITED rather than
  // fire-and-forget because an unawaited promise is not guaranteed to finish on
  // Cloud Functions (the very silent-data-loss failure the trigger comment
  // warns about) — one correct behavior on both hosts is worth the latency.
  try {
    // Must carry the leaderboard just written: the profile fold reads
    // `run.leaderboard.rankings` for each team's FINAL score (which includes
    // bonusPenalty adjustments). Passing the pre-write `run` would leave those
    // rankings empty and silently bank `team.score` instead — the unadjusted
    // number — into every player's badge total.
    const finalizedRun: Run = {
      ...run,
      status: 'finished',
      finishedAt: now,
      leaderboard: { rankings, frozen: true, published, updatedAt: now },
    };
    await runPostFinalizeConsolidation(ownerUid, gameId, runId, runRef, finalizedRun);
  } catch (e) {
    logBestEffort('finalizeRunCore.consolidation', { runId }, e);
  }

  return { rankings, alreadyFinal: false };
}

// maybeAutoFinalizeSoloRun — best-effort auto-finalize of a HOSTLESS solo run
// (change: fix-solo-selfguided-finalize). A `startInstantPlay` run is
// `selfGuided:true, participantCount:1` with no organizer, so the creator-auth
// finalizeRun is never called and the sole finisher would hang on the "waiting for
// the host" spinner. This re-reads the run/team as the source of truth (the team's
// status:'finished' was just committed by the completing call's transaction) and,
// ONLY for a genuine solo self-guided run whose single team has finished, finalizes
// with forcePublish:true. Every disqualifying condition (not self-guided, >1
// participant, already finished, not exactly one finished team) bails without a
// write — so a normal organizer/multi-team run is never touched. Callers MUST treat
// this as best-effort (see the choke point in completeTaskForTeam): any throw here
// must not roll back the player's already-committed completion.
async function maybeAutoFinalizeSoloRun(ownerUid: string, gameId: string, runId: string): Promise<void> {
  const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  const run = runSnap.data() as Run | undefined;
  // Cheap run-level gate first: never a normal organizer run, never multi-participant,
  // never an already-finished run.
  if (!isSoloSelfGuidedRun(run) || run?.status === 'finished') return;

  // Confirm the sole participant has actually finished before finalizing.
  const teamsSnap = await db.collection(teamsCol(ownerUid, gameId, runId)).get();
  const soleTeamStatus =
    teamsSnap.size === 1 ? (teamsSnap.docs[0].data() as RunTeam).status : undefined;
  if (!soloRunReadyToAutoFinalize(run, teamsSnap.size, soleTeamStatus)) return;

  // No host to stage a reveal ⇒ publish unconditionally. finalizeRunCore's own
  // status:'finished' guard makes a concurrent manual-vs-auto finalize a no-op.
  await finalizeRunCore(ownerUid, gameId, runId, { forcePublish: true });
}

export const finalizeRun = loggedCallable('finalizeRun', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, runId } = data as { gameId: string; runId: string };

  // Ownership check stays on the callable (the core is auth-agnostic). Read the run
  // doc to confirm the caller owns it before delegating the authoritative write.
  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = parseStored(() => parseRun(runSnap.data()));
  if (run.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  // Delegate the read+buildRankings+write to the shared core. No forcePublish:
  // organizer runs keep honoring manualLeaderboardReveal (the staged reveal path).
  // `alreadyFinal` is surfaced (additive) so a caller can tell a genuine finalize
  // from a no-op re-finalize of an already-frozen board — the core returns empty
  // rankings in that case rather than recomputing the frozen final standings.
  const { rankings, alreadyFinal } = await finalizeRunCore(uid, gameId, runId);
  return { rankings, ...(alreadyFinal ? { alreadyFinal: true } : {}) };
}, { timeoutSeconds: 180, memory: '512MB' });


// ─── onRunFinalized (Firestore trigger — perf: run-perf-scale, Task 9) ────────
//
// Why a trigger and not a fire-and-forget promise in finalizeRun: once a v1
// `onCall` sends its response, Cloud Functions may throttle the container's
// CPU toward zero and can freeze/reclaim the instance — an unawaited promise
// left running after the response is NOT guaranteed to finish. That would
// trade a visible latency bug for silent, non-deterministic data loss (a
// player's badge/profile or a benchmark contribution just... doesn't happen,
// with nothing but a log line nobody reads). A Firestore trigger is a
// first-class unit of work the platform itself awaits and RETRIES on failure
// (at-least-once delivery) — a real execution guarantee, not a hope.
//
// Mechanism: onUpdate on the run doc, guarded to fire exactly once per
// `status` transition into 'finished' (never on an unrelated run-doc write —
// e.g. a live team's taskCounts bump, requestNextTask, refreshLeaderboard —
// and never again on a re-finalize of an already-finished run, since `before`
// is then ALREADY 'finished'). This subsumes the old `alreadyFinalized` flag
// entirely: the transition guard IS the double-finalize guard now.
//
// Idempotency under retry (Firestore delivers onUpdate at-least-once, so this
// function itself can run more than once for the SAME transition):
//   - player-profile folds: unchanged — `profileRecorded` is checked + set
//     INSIDE recordPlayerResult's own transaction, per team, so a duplicate
//     trigger fire just no-ops on every already-recorded team.
//   - benchmark aggregate: NOT naturally idempotent (mergeBenchmark is a
//     rolling merge) — see foldPlatformBenchmark's own `benchmarkContributed`
//     transactional claim below.
//   - summary email: would otherwise double-send on a duplicate fire — see
//     sendRunSummaryEmailOnce's `summaryEmailSent` transactional claim below.
// Each of the three concerns is independently try/caught so one failing
// (e.g. a poisoned team doc, a down email provider) can never block the
// others — but all three are properly AWAITED here, which is the whole point.
export const onRunFinalized = functions.firestore
  .document('users/{ownerUid}/games/{gameId}/runs/{runId}')
  .onUpdate(async (change, context) => {
    const beforeStatus = (change.before.data() as { status?: string } | undefined)?.status;
    if (beforeStatus === 'finished') return null; // already handled on a prior transition

    let run: Run;
    try {
      run = parseStored(() => parseRun(change.after.data()));
    } catch (e) {
      logBestEffort('onRunFinalized.parse', { path: change.after.ref.path }, e);
      return null;
    }
    if (run.status !== 'finished') return null; // not the transition we care about

    const { ownerUid, gameId, runId } = context.params as { ownerUid: string; gameId: string; runId: string };
    await runPostFinalizeConsolidation(ownerUid, gameId, runId, change.after.ref, run);
    return null;
  });

// runPostFinalizeConsolidation — the three post-finalize concerns, in ONE place
// (change: run-email-scope-and-digest).
//
// WHY THIS IS NOT INSIDE THE TRIGGER ANY MORE. `onRunFinalized` is a Firestore
// trigger, and the self-hosted deployment (`functions/server.js`) mounts
// CALLABLES ONLY — triggers are skipped by design. So on that topology this work
// never ran at all: no summary email, no player-profile/badge folds, no benchmark
// contribution, silently, for every finalized run. `finalizeRunCore` now calls
// this directly, which is what makes the behavior topology-independent.
//
// Both callers may fire for the same run (a Cloud Functions deployment has the
// trigger too). That is SAFE, not a hazard, because each concern owns a
// transactional claim — per-team `profileRecorded`, run-level
// `benchmarkContributed`, run-level `summaryEmailSent` — so whichever path
// arrives first does the work and the other no-ops. The claims are why "call it
// from both places" is correct rather than reckless.
//
// Each concern stays independently try/caught: a down email provider must never
// block a badge fold, and none of them may fail the organizer's finalize call.
export async function runPostFinalizeConsolidation(
  ownerUid: string, gameId: string, runId: string,
  runRef: FirebaseFirestore.DocumentReference,
  run: Run,
): Promise<void> {
  let game: Game;
  let teams: RunTeam[];
  let teamsSnap: FirebaseFirestore.QuerySnapshot;
  try {
    const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
    if (!gameSnap.exists) return; // game deleted between finalize and here — nothing to fold
    game = parseStored(() => parseGame(gameSnap.data()));
    teamsSnap = await db.collection(teamsCol(ownerUid, gameId, runId)).get();
    teams = parseTeamsQuarantining(teamsSnap.docs);
  } catch (e) {
    logBestEffort('postFinalize.read', { runId }, e);
    return;
  }

  // Player profiles (change: player-profile-badges): fold each finished
  // team's result into the player's cross-run profile. A test-drive run is a
  // rehearsal — excluded (change: test-drive-mode).
  if (!run.isTestDrive) {
    try {
      const scoreByTeam = new Map((run.leaderboard?.rankings ?? []).map((r) => [r.teamId, r.score]));
      await Promise.all(teamsSnap.docs.map(async (d) => {
        const team = d.data() as RunTeam & { profileRecorded?: boolean };
        if (team.status !== 'finished' || team.profileRecorded) return;
        const tasksCompleted = (team.stages ?? []).reduce(
          (n, s) => n + (s.tasks ?? []).filter((t) => t.status === 'completed').length, 0);
        await recordPlayerResult({
          uid: d.id,
          displayName: team.displayName,
          tasksCompleted,
          points: scoreByTeam.get(d.id) ?? team.score ?? 0,
        }, d.ref);
      }));
    } catch (e) {
      logBestEffort('postFinalize.playerProfiles', { runId }, e);
    }
  }

  // Platform benchmark contribution (platform-benchmark): opt-outable via
  // game.benchmarkOptOut; test-drive runs are excluded (change: test-drive-mode).
  if (!game.benchmarkOptOut && !run.isTestDrive) {
    try {
      await foldPlatformBenchmark(runRef, game, teams);
    } catch (e) {
      logBestEffort('postFinalize.benchmark', { runId }, e);
    }
  }

  // Run summary email seam (change: run-summary-report). Scoped to real
  // organizer runs by sendRunSummaryEmailOnce's own eligibility gate.
  try {
    await sendRunSummaryEmailOnce(runRef, ownerUid, gameId, runId, game, run, teams);
  } catch (e) {
    logBestEffort('postFinalize.runSummaryEmail', { runId }, e);
  }
}

// Fold anonymized per-task-type aggregates (median completion time +
// completion rate) into benchmarks/{taskType}. No per-run identifiers are
// written. Guarded by a transactional claim on the run doc so a duplicate
// trigger delivery for the SAME finalize transition can never merge the same
// run's stats into the rolling aggregate twice (mergeBenchmark is not
// naturally idempotent — unlike profileRecorded, there's no cheap
// per-sample dedupe). Tradeoff: if the fold crashes AFTER the claim, it will
// not be retried on a later redelivery — accepted for this best-effort,
// anonymized, cross-tenant aggregate (never blocks scoring/leaderboard
// correctness), since the alternative (claim-after-write) risks a genuine
// double-count under concurrent redelivery, which is the worse failure mode.
async function foldPlatformBenchmark(
  runRef: FirebaseFirestore.DocumentReference,
  game: Game,
  teams: RunTeam[],
): Promise<void> {
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if ((snap.data() as { benchmarkContributed?: boolean } | undefined)?.benchmarkContributed) return false;
    tx.update(runRef, { benchmarkContributed: true });
    return true;
  });
  if (!claimed) return;

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
  // One transaction per task type — independent keys, safe to run concurrently.
  await Promise.all([...totalsByType.entries()].map(async ([type, totals]) => {
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
  }));
}

// Compose + send the organizer's run summary email, guarded by the same
// claim-transaction pattern as the benchmark fold so a duplicate trigger
// delivery can never double-send the same run's summary.
async function sendRunSummaryEmailOnce(
  runRef: FirebaseFirestore.DocumentReference,
  ownerUid: string, gameId: string, runId: string,
  game: Game, run: Run, teams: RunTeam[],
): Promise<void> {
  // Read the owner FIRST: it supplies both the eligibility input (does this run
  // belong to an identifiable creator?) and, further down, the recipient and the
  // attribution — one read serving three purposes.
  const ownerSnap = await db.doc(`users/${ownerUid}`).get();
  const owner = ownerSnap.data() as { email?: string; displayName?: string } | undefined;
  const ownerEmail = owner?.email?.trim() || '';

  // Scope gate BEFORE the claim (change: run-email-scope-and-digest). A rehearsal
  // (isTestDrive), a self-guided demo run, or a run owned by an anonymous creator
  // (every simulation and the e2e suite) must not email: demos can happen many
  // times a day from the public demo link and sims would burn provider quota, and
  // together they would bury the one email that matters. Checked before the
  // transaction on purpose, so an ineligible run neither burns the
  // `summaryEmailSent` claim nor opens a socket. Demo volume is reported by the
  // daily digest instead.
  if (!shouldEmailRunSummary(run, { hasEmail: ownerEmail.length > 0 })) {
    logBestEffort('runSummary.email.notEligible', {
      runId,
      isTestDrive: run.isTestDrive === true,
      selfGuided: run.selfGuided === true,
      ownerHasEmail: ownerEmail.length > 0,
    }, 'test-drive, self-guided, or synthetic (anonymous) owner');
    return;
  }

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if ((snap.data() as { summaryEmailSent?: boolean } | undefined)?.summaryEmailSent) return false;
    tx.update(runRef, { summaryEmailSent: true });
    return true;
  });
  if (!claimed) return;

  const feedbackSnap = await db.collection(feedbackCol(ownerUid, gameId, runId)).get();
  const responses = feedbackSnap.docs.map((d) => d.data() as RunFeedback);
  const summary = buildRunSummaryResult(game, run, teams, responses);
  const recipient = process.env.RUN_SUMMARY_EMAIL_TO ?? ownerEmail ?? null;
  // Attribute the run to the creator who built and ran it. Read from the SAME doc
  // the recipient already comes from — no extra Firestore read. Both fields are
  // optional and the formatter degrades to whatever is present, so a creator with
  // no display name (or a legacy doc missing both) renders cleanly instead of
  // emitting "undefined". Player identity travels as standings[].teamName; there
  // is no participant email to attach — they authenticate anonymously.
  await sendRunSummaryEmail(
    { ...summary, organizer: { displayName: owner?.displayName, email: owner?.email } },
    recipient,
  );
}


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
  // Shareable board pages poll this, so the budget is generous — but it was
  // previously unmetered, and it reads the run + every team on it per call.
  await enforceRateLimit(context.auth.uid, 'getPublicLeaderboard');
  const { code } = data as { code: string };
  const normalizedCode = validate(() => normalizeAccessCode(code));

  const codeSnap = await db.doc(`accessCodes/${normalizedCode}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;

  const gameSnap = await db.doc(gamePath(c.ownerUid, c.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data() as Game;
  // The shareable board link dies with the game (change: recoverable-game-deletion)
  // and comes back with a restore — "deleted" has to mean deleted everywhere,
  // including the public surfaces the creator already handed out.
  assertGameNotDeleted(game);
  const runSnap = await db.doc(runPath(c.ownerUid, c.gameId, c.runId)).get();
  const run = runSnap.exists ? (runSnap.data() as Run) : null;

  const board = run?.leaderboard;
  // Test mode (change: test-mode-hidden-scoring): a standing IS a score, and the
  // shareable board is the one participant-facing standing that never passes
  // through getMyTeamState — so it has to be sealed here or the neutral finish is
  // undone by anyone holding the access code. Forcing `published` false reuses the
  // existing withheld path end to end (rankings, ceremony feed, the client's
  // "not published yet" state) rather than inventing a second empty shape.
  const published = !!board?.published && !sealsScoreFromParticipant(game);

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
  // The shared recap dies with the game too (change: recoverable-game-deletion).
  // getRunRecap tolerates a MISSING game (a pruned run), so this is an explicit
  // tombstone check rather than a not-exists one.
  assertGameNotDeleted(game);
  // Test mode (change: test-mode-hidden-scoring): the recap is FULL STANDINGS —
  // every team, ranked, with scores. It gates on `published` alone, and finalizeRun
  // publishes a test-mode run's board like any other, so without this a participant
  // holding the access code could read the whole scoreboard the rest of the app is
  // careful never to show them. getPublicLeaderboard is sealed separately; this is
  // the second, easy-to-miss door to the same data.
  //
  // Owner-only from here, exactly as if the board were unpublished — reusing the
  // existing refusal the client already handles rather than inventing an empty shape.
  if (!isOwner && sealsScoreFromParticipant(game)) {
    throw new functions.https.HttpsError('permission-denied', 'Recap is not public yet');
  }
  const teamsSnap = await db.collection(teamsCol(c.ownerUid, c.gameId, c.runId)).get();
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  // wave-g #2: exclude hidden-location tasks' photos from the recap, mirroring the
  // live-feed exclusion via the same shouldFeedTask predicate (single source of
  // truth, fail-closed). Resolved here where the game doc is loaded, so
  // buildRunRecap stays pure (takes only a set of ids).
  const hiddenTaskIds = new Set<string>();
  for (const stage of game?.stages ?? []) {
    for (const task of stage.tasks ?? []) {
      if (!shouldFeedTask({ hideLocation: task.hideLocation })) hiddenTaskIds.add(task.id);
    }
  }

  const recap = buildRunRecap(teams, run ?? { leaderboard: undefined }, hiddenTaskIds);
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

  // The track lives on the VPS's own disk when that is configured (change: vps-track-storage),
  // where it is recorded at FULL fidelity rather than distance-sampled. A null result means no
  // disk file exists for this run — a run recorded before that shipped, or any deployment
  // without a stable local disk (the emulator, real Cloud Functions) — so fall back to
  // Firestore, which is unchanged. The two are never merged: a run is recorded wholly in one
  // mode, because the mode is a deployment fact and cannot change mid-run.
  //
  // Note the fallback turns on null, NOT on emptiness: a disk-mode run that has taken no pings
  // yet legitimately reads back [], and re-reading Firestore for it would be a wasted read.
  //
  // ⚠️ THE DISK TRACK IS SAMPLED HERE, ON READ. It is stored at full fidelity (one point per
  // ping), and feeding that to buildMovementDensity untouched would recreate the exact defect
  // the distance rule exists to prevent: the aggregator counts points per cell, so the places
  // teams STOOD STILL become the hottest cells and a movement heatmap reports the opposite of
  // movement. The Firestore path samples on WRITE because a write costs quota; the disk path
  // keeps the raw data and samples HERE instead. Both feed the aggregator the same shape,
  // which is what keeps the two modes' heatmaps comparable rather than merely both present.
  let points = await trackStore.read({ ownerUid: c.ownerUid, gameId: c.gameId, runId: c.runId })
    .then((pts) => (pts
      ? sampleTrackByDistance(pts).map((p) => ({ lat: p.lat, lng: p.lng }))
      : null));

  if (points === null) {
    const trackSnap = await db
      .collection(`users/${c.ownerUid}/games/${c.gameId}/runs/${c.runId}/locationTrack`)
      .get();
    points = trackSnap.docs.map((d) => {
      const p = d.data() as { lat: number; lng: number };
      return { lat: p.lat, lng: p.lng };
    });
  }

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
  // No instant play on a trashed game (change: recoverable-game-deletion). The
  // publicGames row is removed at soft-delete, but this closes the window where a
  // cached/stale index row could still start a brand-new run under a deleted game.
  assertGameNotDeleted(game);
  if (!game.allowInstantPlay) {
    throw new functions.https.HttpsError('failed-precondition', 'This game is not open for instant play');
  }
  // Guardian-consent gate (wave-J J1): a game requiring guardian consent CANNOT be
  // started via instant-play. Instant-play is anonymous, on-demand, self-guided solo
  // play with no organizer and no out-of-band guardian channel, so there is no way to
  // collect a valid consent record before handing out play — startTeams' consent flow
  // (requestGuardianConsent → guardian link → grantGuardianConsent, then the
  // isConsentSatisfied filter) has no analogue here. Rather than seed launched:true +
  // assign a task with zero consent (letting a minor play unchecked), refuse the
  // instant-play path entirely. Mirrors startTeams' intent (consent required ⇒ no play
  // without it) without weakening any other surface.
  if (game.requiresGuardianConsent) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This game requires guardian consent and cannot be started with instant play',
    );
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


// ─── Rehearsal control (change: test-drive-rehearsal-control) ─────────────────
// One button, in the test-run banner, that resolves whatever the CURRENT mission
// needs and that a creator at a desk cannot supply:
//
//   * a LOCATION they are not standing at  -> 'arrive' (the client then runs the
//     ordinary check-in/arrival path, which already has a server-side test-drive
//     bypass keyed on run.isTestDrive);
//   * an ANSWER they wrote weeks ago       -> the answer itself, for the client to
//     FILL IN. The human still presses submit, so the real submit/scoring/routing
//     path runs exactly as it does for a player;
//   * a STAFF APPROVAL that will never come -> the server approves (or completes)
//     the media mission. This was a genuine dead end: a photo mission without
//     `smart.autoApprove` writes status:'pending' and waits for a review that, in
//     a solo rehearsal, nobody is there to give.
//
// WHY A SEPARATE CALLABLE, not a flag on the task payload: answer keys are
// server-secret and `sanitizeTaskForParticipant` strips every one of them. Making
// the sanitizer conditional on "is this a test drive" would put the entire answer
// key one wrong boolean away from every real player. A separate, separately
// authorized call cannot do that: the worst case here is that a REHEARSAL run
// reveals its own creator's answers.
//
// The gate is the run document, never the request: `run.isTestDrive !== true` is
// permission-denied, and `resolveCallerTeam` proves the caller is a team in that
// run. A test-drive run is free, capped at 2 participants and excluded from stats,
// so the blast radius of its access code being shared is a rehearsal, not a game.
export const revealTaskAnswer = loggedCallable('revealTaskAnswer', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'revealTaskAnswer');
  const { taskId, stepIndex, ownerUid, gameId, runId, code } = data as {
    taskId: string; stepIndex?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');

  const { ctx, teamId } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });

  const runSnap = await db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId)).get();
  const run = runSnap.data() as Run | undefined;
  // THE gate. Read from the run document, so a forged request body cannot reach it.
  if (run?.isTestDrive !== true) {
    throw new functions.https.HttpsError('permission-denied', 'This is not a test run');
  }

  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data as Game;
  const task = findGameTask(game, taskId);
  if (!task) throw new functions.https.HttpsError('not-found', 'Task not found');

  const reveal = (r: RehearsalReveal): RehearsalReveal => r;

  switch (task.type) {
    case 'quiz': {
      // An ordering quiz stages an arrangement; every other quiz fills one string.
      if (task.orderItems && task.orderItems.length > 0) {
        return reveal({ kind: 'ordering', order: [...task.orderItems] });
      }
      const first = task.answers?.[0];
      return first == null
        ? reveal({ kind: 'none' })
        : reveal({ kind: 'answer', answer: String(first) });
    }
    case 'numeric':
      return task.numericAnswer == null
        ? reveal({ kind: 'none' })
        : reveal({ kind: 'answer', answer: String(task.numericAnswer) });
    case 'smart_station': {
      const secret = task.smart?.secretCode;
      return secret ? reveal({ kind: 'answer', answer: String(secret) }) : reveal({ kind: 'none' });
    }
    case 'sequence': {
      // Sequences are answered step by step, so reveal the step the client is on.
      // An out-of-range index reveals nothing rather than throwing — the client
      // may be a render behind the team document.
      const i = typeof stepIndex === 'number' ? stepIndex : 0;
      const step = task.steps?.[i];
      return step?.answer == null
        ? reveal({ kind: 'none' })
        : reveal({ kind: 'answer', answer: String(step.answer) });
    }
    case 'photo': {
      // Approve the pending submission if there is one; otherwise complete the
      // mission outright, so the creator is not forced to actually take a photo
      // at their desk just to see what comes next.
      const now = new Date().toISOString();
      // A submission lives ON the team document under `taskSubmissions[taskId]`
      // (submitStationPhoto), not in a subcollection. Marked approved only when one
      // is actually there — `merge` on a nested object would otherwise invent a
      // submission row with no photo in it. Best-effort: the completion below is
      // what the creator is waiting for, and must not fail over a review stamp.
      const teamRef = db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId));
      const teamSnap = await teamRef.get();
      const submissions = (teamSnap.data() as { taskSubmissions?: Record<string, RawSubmission> } | undefined)?.taskSubmissions;
      if (submissions?.[taskId]) {
        await teamRef.set(
          { taskSubmissions: { [taskId]: { status: 'approved', reviewedAt: now } } },
          { merge: true },
        ).catch((e) => logBestEffort('revealTaskAnswer.approve', { taskId, teamId }, e));
      }
      await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
      return reveal({ kind: 'approved' });
    }
    case 'survey':
      // No right answer exists. Saying so is the honest response.
      return reveal({ kind: 'none' });
    default:
      // field / self_report / geofence: the client runs the ordinary arrival path,
      // which the server already relaxes for a test-drive run.
      return reveal({ kind: 'arrive' });
  }
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

  // Attention signals (change: run-console-attention). Location FRESHNESS — not
  // any position — is what tells a dead GPS watch apart from a team that is just
  // taking its time. Read-only, behind the owner gate above, and best-effort: a
  // failed read degrades to "no evidence" (which the classifier treats as
  // silence) rather than failing the organizer's only view of the field.
  // Held-team visibility (change: held-team-visibility). `startTeams` reports a
  // COUNT of the teams it held back; with a dozen teams milling around, a count
  // with no names is not actionable. Deciding it per row needs the game's consent
  // setting, which this handler did not read. Best-effort on the same bias as the
  // location read below: if the game doc cannot be read, every row reports "not
  // held" (silence) rather than failing the organizer's only view of the field.
  let consentConfig: { requiresGuardianConsent?: boolean } = {};
  try {
    const gs = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(uid, gameId));
    consentConfig = { requiresGuardianConsent: gs.data?.requiresGuardianConsent };
  } catch { /* best-effort: every row degrades to heldForConsent: false */ }

  // Refreshed on its OWN interval, not on every board poll (change: hot-path-read-cost).
  // Every location ping dirties one of these documents, so the document cache could not help
  // here: at 120 pinging teams and a 5s poll this read alone was ~10,800 reads per run. It is
  // a minutes-scale freshness signal, and it gates nothing — see locationFreshnessCache.ts.
  const locationUpdatedAt = await getLocationFreshness(
    `${uid}/${gameId}/${runId}`,
    async () => {
      const byTeam = new Map<string, string>();
      const locRows = await cachedGetCollection<{ updatedAt?: unknown }>(
        db, docCachePolicy, `${runPath(uid, gameId, runId)}/${COLLECTIONS.TEAM_LOCATIONS}`,
      );
      for (const d of locRows) {
        const at = d.data.updatedAt;
        if (typeof at === 'string' && at) byTeam.set(d.id, at);
      }
      return byTeam;
    },
  );

  // The dominant cost of this callable, and the reason the change exists: with 29 teams
  // this collection read alone was 29 of the ~60 Firestore reads it made, on a poll the
  // Run Console fires every 5s. Membership survives the `update`-shaped team progress
  // writes of a live run, so a warm poll re-reads only the teams that actually changed.
  const teamRows = await cachedGetCollection<RunTeam & {
    taskSubmissions?: Record<string, { status?: string }>;
  }>(db, docCachePolicy, teamsCol(uid, gameId, runId));
  const teams = teamRows.map((d) => {
    const t = d.data;
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
      // Out-of-bounds recovery: the run console could not SEE this condition, let
      // alone clear it — a team paused by the safe-zone latch looked identical to a
      // team that was simply slow. Projected so staff can spot it and release them.
      outOfBounds: t.outOfBounds === true,
      // ── Attention signals (change: run-console-attention) ──
      // All three are read-only projections of state this handler already holds.
      // The console derives "is anyone stuck?" from them; nothing is written and
      // no new document shape exists. Each is optional/nullable on the wire, so a
      // client that predates them, or a team document that lacks them, degrades to
      // "no evidence" instead of to a false alarm.
      //
      // Last server write for this team: the only "when did anything happen"
      // clock that exists (every scoring/answer/hint/assignment path bumps it).
      updatedAt: t.updatedAt ?? null,
      // Latest expiry across the wrong-answer retry lockouts. A clock value, not
      // an answer key, so this does not touch the participant sanitizer contract.
      answerLockoutUntil: Object.values(t.answerPenalties ?? {}).reduce<number | null>(
        (max, p) => {
          const until = p?.cooldownUntil;
          return typeof until === 'number' && Number.isFinite(until) && until > (max ?? 0)
            ? until
            : max;
        },
        null,
      ),
      // Freshness of the team's GPS stream. Deliberately NOT the position: the
      // console needs to know the watch died, not where the team is.
      lastLocationAt: locationUpdatedAt.get(t.id) ?? null,
      // Whether `startTeams` would hold this team back — the same predicate it
      // partitions on. A BOOLEAN: the organizer needs to know which team to walk
      // over to, not who the guardian is. False for every team of every run that
      // does not require consent, and for every row if the game read above failed.
      heldForConsent: !t.launched && !isConsentSatisfied(t, consentConfig),
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

  // THE MOST-CALLED READ IN THE PRODUCT (change: hot-path-read-cost). Every participant
  // callable resolves its team through here — the 60s state poll, every location ping, every
  // arrival, answer and completion. At 120 teams over a 75-minute run that is roughly 23,000
  // invocations, and it was one uncached document read each time.
  //
  // Caching is correct for the same reason the run/game reads are: `firestore.rules` denies
  // client writes to team documents, so the API is their SOLE writer, and every write goes
  // through the same intercepted `db` handle that invalidates this entry. A team that just
  // scored has had its cache entry dropped, so the next read is fresh — there is no path by
  // which this document changes without the cache learning about it. See docCache.ts for the
  // single-process precondition that makes that true.
  //
  // Transactions are unaffected: they read through the driver by design, so no scoring
  // decision is ever made on a cached copy.
  const cached = await cachedGetDoc<RunTeam>(db, docCachePolicy, teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, uid));
  let team: RunTeam;
  if (cached.exists && cached.data) {
    team = cached.data;
  } else {
    // A secondary device: its uid is not the team id, so fall back to the membership query.
    // Deliberately NOT cached — it is a query rather than a document read, it happens once
    // per attached phone rather than per action, and a stale membership answer would attach
    // someone to the wrong team.
    const q = await db.collection(teamsCol(ctx.ownerUid, ctx.gameId, ctx.runId))
      .where('deviceUids', 'array-contains', uid).limit(1).get();
    if (q.empty) throw new functions.https.HttpsError('not-found', 'Team not found');
    teamRef = q.docs[0].ref;
    team = q.docs[0].data() as RunTeam;
  }
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
  // withLockRetry (change: contended-transaction-retry): this transaction increments the
  // run-wide device counter, so every extra phone on every team contends on the SAME run
  // document. Same lock, same burst, same failure mode joinRun hit in production — a
  // second phone joining reached the player as an opaque INTERNAL instead of retrying.
  await withLockRetry(() => db.runTransaction(async (tx) => {
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
    // Device-membership reverse index. The attaching phone has no team doc of its
    // own, so firestore.rules' isRunParticipant() (an exists() at the caller's OWN
    // uid) failed for it and every secondary phone got permission-denied on the
    // run's announcements / flashMissions / feedItems — which PlayScreen renders
    // unconditionally. Rules cannot query deviceUids across the teams collection,
    // so membership has to be addressable BY the device uid. Written in the same
    // transaction as the deviceUids append: the two can never disagree.
    tx.set(db.doc(FIRESTORE_PATHS.runDeviceMember(ownerUid, gameId, runId, uid)), {
      teamId: teamRef.id, deviceUid: uid, joinedAt: now,
    });
  }));

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
  // fix-fixed-points-speed-template-drift: stamp the expired task's expected
  // route-minutes so a finished team's terminal record is immutable against later
  // template edits (gameTask is already resolved and confirmed above).
  rec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask);

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
  // Perf (run-perf-scale, Task 10): the caller MAY already hold the game doc
  // (e.g. startTeams fans this out across every launched team). Accepting it
  // here avoids re-reading the SAME game doc once per team — the dominant cost
  // of the old serial startTeams loop. Falls back to a fresh read so every
  // other caller (requestNextTask, completeTask's reassign, the poll sweep…)
  // is unaffected.
  preloadedGame?: Game,
): Promise<{ taskId?: string; reason?: NoAssignmentReason | 'guardian_consent' }> {
  let game: Game;
  if (preloadedGame) {
    game = preloadedGame;
  } else {
    // The game template cannot change mid-run, and this is a hot participant path
    // (change: hot-path-read-cost).
    const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ownerUid, gameId));
    if (!gameSnap.exists) return {};
    game = gameSnap.data as Game;
  }
  const teamRef = db.doc(teamPath(ownerUid, gameId, runId, teamId));
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) return {};
  const team = teamSnap.data() as RunTeam;

  // Guardian-consent gate (consent-gate-routing): a team held on guardian consent
  // (`launched !== true`) must never be assigned a task — that reserves a station
  // slot, sets activeTaskId and routes the team toward a real-world location
  // BEFORE a guardian has approved. This is the single choke point every caller
  // (requestNextTask, startTeams, completeTask's reassign, the poll sweep, …)
  // funnels through, so checking here covers all of them. Placed before every
  // other read/write in this function so a held team causes zero side effects —
  // no slot reserved, no stage/expiry sweep persisted, activeTaskId stays unset.
  // `completeTaskForTeam` already blocks the matching GRADING path with the same
  // `team.launched !== true` check; this closes the ASSIGNMENT-side gap.
  if (!canReceiveTaskAssignment(team)) return { reason: 'guardian_consent' };

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

  // Unreachable-task heal (change: unreachable-task-strand). A team can be sitting
  // on a stage whose only remaining tasks are gated behind a task it can never
  // complete (the losing member of an exclusive group, an expiry-swept task).
  // Nothing else will ever fire for it: routing filters those tasks out as locked,
  // so no completion happens, so applyStageCompletion is never reached from
  // completeTaskForTeam. This poll is the one thing the stranded team still does,
  // so the retirement runs here too — otherwise the fix would only ever help teams
  // that were about to complete something anyway, which is precisely not the
  // stranded ones. Guarded by the pure check, so a healthy team performs no extra
  // read and no write, and self clearing (once retired the tasks are no longer
  // unassigned). Skipped entirely while a task is in flight: that team is playing,
  // not stranded, and completeTaskForTeam will apply the same rule when it grades.
  {
    const idx = team.stages.findIndex((s) => s.status === 'active');
    const gs = idx >= 0 ? game.stages.find((s) => s.id === team.stages[idx].stageId) : undefined;
    const busy = idx >= 0 && team.stages[idx].tasks.some((t) => t.status === 'assigned');
    if (idx >= 0 && !busy && Array.isArray(gs?.tasks) && gs.tasks.length > 0) {
      const statusByTaskId: Record<string, TaskProgressStatus> = {};
      for (const t of team.stages[idx].tasks) statusByTaskId[t.taskId] = t.status;
      if (unreachableTaskIds(gs.tasks, statusByTaskId).length > 0) {
        const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
        const launchedAt = (runSnap.data() as Run | undefined)?.launchedAt;
        const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
        const { heldAssignedTaskIds } = applyStageCompletion(stages, idx, game, launchedAt, now);
        const allDone = stages.every((s) => s.status === 'completed');
        await teamRef.update({
          stages,
          ...(allDone ? { status: 'finished', finishedAt: now } : {}),
          updatedAt: now,
        });
        for (const id of heldAssignedTaskIds) await releaseTask(id, ownerUid, gameId, runId);
        team.stages = stages;
      }
    }
  }

  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  if (activeStageIdx < 0) return {};
  const stageRec = team.stages[activeStageIdx];
  // .slice() before sort: never mutate the shared preloaded game array in place
  // (getMyTeamState already sorts defensively; these two hot paths did not).
  const gameStage = game.stages.slice().sort((a, b) => a.order - b.order)[activeStageIdx];
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
  const paceSkillRatio = await computeSkillRatio(
    team.stages.flatMap((s) => s.tasks).filter((t) => t.status === 'completed').map((t) => ({
      taskId: t.taskId, actualMinutes: t.actualMinutes, completedAt: t.completedAt, startedAt: t.startedAt,
      // pause-clock-tasks: carried so computeSkillRatio can drop a paused record
      // from the pace sample (its duration is deliberation, not pace).
      excludedMs: t.excludedMs,
    })),
    game.stages.flatMap((s) => s.tasks),
  );
  // Test mode (change: test-mode-hidden-scoring) routes on ACCURACY instead of
  // pace — a wrong answer completes the task there, so "fast" stops meaning
  // "strong". Returns the pace ratio unchanged for every normal run.
  const skillRatio = resolveRoutingSkillRatio(game, team, paceSkillRatio);
  const result = await assignTask(
    teamLocation, candidateTasks, completedTaskIds, skillRatio,
    ownerUid, gameId, runId,
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
    // WO Item 3: retry the claim under contention and release on ANY failure. The
    // claim transaction locks the run doc indirectly (via the follow-on releaseTask)
    // and can itself abort under a burst; an un-retried abort threw out of here as
    // INTERNAL, leaving assignTask's reservation (run.taskCounts[result.taskId]++)
    // orphaned forever — a permanent station-slot leak that dead-ends later teams at
    // 'stationsFull'. withLockRetry absorbs the abort; the try/catch guarantees the
    // reservation is reversed whether we lose the race OR the write fails outright.
    let claim: { taskId: string | undefined; mine: boolean };
    try {
      claim = await withLockRetry(() => db.runTransaction<{ taskId: string | undefined; mine: boolean }>(async (tx) => {
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
      }));
    } catch (e) {
      // Reverse assignTask's increment so a failed claim never orphans the slot.
      await releaseTask(result.taskId, ownerUid, gameId, runId);
      throw e;
    }
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

  const { ctx, teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  assertTeamNotHeld(team); // staff-console-field-ops — no check-in while held
  const now = new Date().toISOString();

  // Trigger-mode gate: radius/exact tasks validate GPS proximity server-side so
  // they can't be spoofed by calling completeTask directly; instant/locationless
  // need no GPS. Legacy `geofence`-type tasks normalize to `radius`.
  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  const gtask = gameSnap.exists ? findGameTask(gameSnap.data as Game, taskId) : undefined;
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
      // Test-run bypass (wave-J): in a TEST run the creator may check in from their
      // desk, so a would-reject verdict is overridden — but ONLY on the reject path,
      // via a lazy run-doc read, so a real run's happy path is byte-identical (zero
      // extra reads). The accept keys solely on the CF-written run.isTestDrive flag.
      if (lat == null || lng == null || !isValidCoord(lat, lng)) {
        if (!proximitySatisfied(false, await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
          throw new functions.https.HttpsError('failed-precondition', 'Location required to check in here');
        }
      } else {
        const distM = haversineKm({ lat, lng }, c!) * 1000;
        // Hidden-location tasks gate identically but the rejection must not leak the
        // distance (otherwise the secret spot is triangulable by polling).
        const verdict = evaluateTrigger(mode, distM, gtask.geofenceRadiusMeters, { hidden: !!gtask.hideLocation });
        if (!verdict.ok && !proximitySatisfied(false, await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
          const fallback = gtask.hideLocation
            ? 'Not here yet — keep following the clue'
            : `Too far from the spot (${Math.round(distM)}m away)`;
          throw new functions.https.HttpsError('failed-precondition', verdict.reason ?? fallback);
        }
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
  // Staff hold (staff-console-field-ops) — before every other read/write, so a held
  // team causes zero side effects: no station slot reserved, no stage sweep persisted.
  assertTeamNotHeld(team);
  // Soft-pause (safe-zone-boundary): no new task while the team is out of bounds.
  // Test-run bypass (wave-J): a desk rehearsal must never dead-end on the safe-zone
  // latch. The run-doc read happens ONLY when already flagged out of bounds (an
  // abnormal path), so the normal happy path adds zero reads and stays byte-identical.
  if (team.outOfBounds === true && !(await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
    // Out-of-bounds recovery: the latch may NOT outlive the evidence that set it.
    // `outOfBounds` used to be openable only by a later good fix, so a phone whose GPS
    // was denied/unavailable/inaccurate stranded its team behind an actionless card for
    // the rest of the run. Re-evaluate against the last known fix and release unless it
    // is a fresh, confident, out-of-zone reading. Still on the ABNORMAL path only — the
    // happy path adds zero reads, exactly like the test-drive bypass above.
    const verdict = await evaluateTeamOutOfBounds(ctx, teamId, team);
    if (verdict.outOfBounds) {
      // `metersOutside` rides along so the participant card can say how far back the
      // boundary is (change: blocked-player-guidance). Additive; the client treats a
      // missing value as "no distance to show".
      return { taskId: null, outOfBounds: true, reason: verdict.reason, metersOutside: verdict.metersOutside };
    }
    await db.doc(`${teamsCol(ctx.ownerUid, ctx.gameId, ctx.runId)}/${teamId}`)
      .set({ outOfBounds: false }, { merge: true })
      .catch(() => undefined); // releasing is best-effort; never block assignment on it
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
  const { ctx, teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  assertTeamNotHeld(team); // staff-console-field-ops — no charged action while held
  // Same stage-scope guard as every answer/interaction callable (submitTaskAnswer,
  // submitSequenceStep, verifyStationCode, reportArrival): a hint may only be
  // revealed for a task in the team's ACTIVE (or already-completed) stage. Without
  // this, requestTaskHint is a future-stage oracle — pay to reveal the sealed
  // find-the-spot hint of a hidden-location task in a stage you have not reached.
  // Revealing the current active-stage hidden task's hint pre-arrival stays allowed.
  assertStageActiveForTask(team, taskId);

  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data as Game;
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
    // Test mode (change: test-mode-hidden-scoring): a hint is always free on a run
    // that seals scoring. Charging points the participant is not permitted to see
    // is an invisible punishment — they cannot weigh the cost, notice it, or learn
    // from it. Decided here, inside the same transaction as every other charge
    // decision, so there is no TOCTOU between "is it free?" and "charge".
    const free = sealsScoreFromParticipant(game) || isHintFree(
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

// ─── reportArrival (unseal a hidden-location task once the team is there) ─────
// change: play-task-gating (wave D).
//
// A hidden-location ("treasure hunt") task ships to the participant as a sealed
// stub — clue only, no title/type/inputs — until the SERVER agrees the team has
// physically arrived. This is that moment. It deliberately reuses the exact
// predicate `completeTask` uses for a check-in (haversine against the
// server-held coordinates → `evaluateTrigger(mode, dist, radius, {hidden:true})`),
// so there is ONE arrival rule in the codebase, not two, and a spoofer gains
// nothing here they could not already get from completeTask.
//
// It is deliberately WEAKER than completeTask: it awards no points, starts no
// timer, holds no station slot. It only unseals text.
//
// No distance, no "getting warmer", no metres are ever returned — a numeric
// response would let a player triangulate the secret spot by polling.
//
// The verdict is LATCHED (`RunTaskRecord.arrivedAt`) rather than re-evaluated per
// read: arrival must survive a reload, a GPS dropout, and an offline spell. A
// per-read evaluation would re-seal the task in the player's hands mid-play.
export const reportArrival = loggedCallable('reportArrival', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'reportArrival');
  const { taskId, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId?: string; lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');
  assertCoordIfPresent(lat, lng);
  const { ctx, teamId, team, teamRef } = await resolveCallerTeam(
    uid, { ownerUid, gameId, runId, code }, { requireController: true },
  );
  assertTeamNotHeld(team); // staff-console-field-ops — a held team cannot unseal

  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data as Game, taskId);
  if (!task) throw new functions.https.HttpsError('not-found', 'Task not found');
  // Same stage-scope guard as every answer callable: you can't probe a stage you
  // have not reached (that would be a location oracle on a future chapter).
  assertStageActiveForTask(team, taskId);

  // Nothing to unseal on a visible task — a no-op success keeps the client simple.
  if (!task.hideLocation) return { arrived: true };

  const c = task.coordinates;
  const hasRealCoords = !!c && isValidCoord(c.lat, c.lng) && (c.lat !== 0 || c.lng !== 0);
  const mode = normalizeTriggerMode(task);
  if ((mode === 'radius' || mode === 'exact') && hasRealCoords) {
    // Arrival is NEVER self-declared: no coordinates ⇒ no reveal. Same wording
    // family as the check-in path. Test-run bypass (wave-J): in a TEST run the
    // creator unseals from their desk, so a would-reject verdict is overridden —
    // ONLY on the reject path (lazy run-doc read), keeping a real run byte-identical.
    if (lat == null || lng == null || !isValidCoord(lat, lng)) {
      if (!proximitySatisfied(false, await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
        throw new functions.https.HttpsError('failed-precondition', 'Location required to check in here');
      }
    } else {
      const distM = haversineKm({ lat, lng }, c!) * 1000;
      const verdict = evaluateTrigger(mode, distM, task.geofenceRadiusMeters, { hidden: true });
      if (!verdict.ok && !proximitySatisfied(false, await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
        // Reason strings for hidden tasks are digit-free by contract; never fall
        // back to a message that carries the distance.
        return { arrived: false, reason: verdict.reason ?? 'Not here yet — keep following the clue' };
      }
    }
  }

  // Latch. Read-modify-write of the WHOLE stages array — never a dotted-path
  // update into an array (that coerces the array to a map; see CLAUDE.md).
  const arrivedAt = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
    const fresh = snap.data() as RunTeam;
    let changed = false;
    const stages = fresh.stages.map((s) => ({
      ...s,
      tasks: s.tasks.map((r) => {
        if (r.taskId !== taskId || r.arrivedAt != null) return r; // idempotent
        changed = true;
        return { ...r, arrivedAt };
      }),
    }));
    if (!changed) return;
    tx.update(teamRef, { stages, updatedAt: arrivedAt });
  });

  functions.logger.info('reportArrival.unsealed', { runId: ctx.runId, teamId, taskId });
  return { arrived: true };
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

// WO-2 oracle guard: reject a submission whose stage the team has NOT YET reached
// (a locked / future / scheduled-gated stage) — that is the only oracle a probe
// could exploit (a wrong vs a correct answer on a locked stage now throw the
// identical error). A stage the team is ON ('active') OR has already CLEARED
// ('completed') is NOT a future-stage oracle: submitting there is legitimate —
// e.g. an auto-skipped sibling in a requiredTaskCount partial stage, or an
// idempotent duplicate on a stage that just completed. Those fall through to
// completeTaskForTeam, whose own idempotency guard folds a terminal task record to
// a graceful no-op. Gating strictly on 'active' (the pre-fix behavior) instead
// rejected those legitimate completed-stage submissions with a spurious
// failed-precondition, aborting the play loop.
export function assertStageActiveForTask(team: RunTeam, taskId: string): void {
  const status = teamStageStatusForTask(team, taskId);
  if (status !== 'active' && status !== 'completed') {
    throw new functions.https.HttpsError('failed-precondition', STAGE_NOT_ACTIVE_MSG);
  }
}

// Test-run proximity bypass (change: testdrive-here-bypass, wave-J). A LAZY
// run-doc read used ONLY on a would-reject proximity path: in a real run the gate
// passes on distance before this is ever called, so the happy path adds ZERO reads
// and stays byte-identical. The bypass keys on nothing but the CF-written run doc's
// `isTestDrive` flag — never a client payload/header/flag. A missing doc/flag ⇒
// false (treated as a real run), so the anti-cheat can never be relaxed by accident.
async function runIsTestDrive(ownerUid: string, gameId: string, runId: string): Promise<boolean> {
  const snap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  return (snap.data() as Run | undefined)?.isTestDrive === true;
}

// Out-of-bounds latch re-evaluation (change: out-of-bounds-recovery). LAZY, used
// only when `team.outOfBounds` is already set — the abnormal path — so an ordinary
// assignment adds no reads. Re-runs the fail-open evaluator over the team's LAST
// KNOWN fix: stale (the device stopped reporting), absent, malformed, low-confidence,
// released by staff, or back inside all mean "we cannot verify a breach right now",
// and an unverifiable condition must never keep a player stranded. Only a fresh,
// confident, out-of-zone fix keeps the pause. A read failure also fails open.
async function evaluateTeamOutOfBounds(
  ctx: { ownerUid: string; gameId: string; runId: string },
  teamId: string,
  team: { outOfBoundsOverrideUntil?: string },
): Promise<{ outOfBounds: boolean; reason: string; metersOutside: number | null }> {
  try {
    const [gameSnap, locSnap] = await Promise.all([
      db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get(),
      db.doc(`${runPath(ctx.ownerUid, ctx.gameId, ctx.runId)}/teamLocations/${teamId}`).get(),
    ]);
    const safeZone = (gameSnap.data() as { safeZone?: SafeZone } | undefined)?.safeZone;
    const loc = locSnap.data() as
      { lat?: number; lng?: number; accuracyMeters?: number | null; updatedAt?: string } | undefined;
    const status = evaluateSafeZoneStatus({
      fix: loc
        ? { lat: loc.lat, lng: loc.lng, accuracyMeters: loc.accuracyMeters, atMs: Date.parse(loc.updatedAt ?? '') }
        : null,
      safeZone,
      nowMs: Date.now(),
      overrideUntilMs: team.outOfBoundsOverrideUntil ? Date.parse(team.outOfBoundsOverrideUntil) : null,
    });
    // The one number a stranded player can act on (change: blocked-player-guidance):
    // metres BEYOND the boundary, not the distance to the centre — it says how far
    // back to walk without disclosing the zone's centre, radius or shape. Emitted
    // only on a CONFIRMED breach, so a distance derived from a fix the evaluator
    // itself refused to trust never reaches the card.
    const radius = safeZone?.radiusMeters;
    const metersOutside = status.outOfBounds
      && typeof status.distanceMeters === 'number' && Number.isFinite(status.distanceMeters)
      && typeof radius === 'number' && Number.isFinite(radius)
      ? Math.max(0, Math.round(status.distanceMeters - radius))
      : null;
    return { outOfBounds: status.outOfBounds, reason: status.reason, metersOutside };
  } catch {
    return { outOfBounds: false, reason: 'unverifiable', metersOutside: null };
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
  assertTeamNotHeld(team); // staff-console-field-ops — no scoring action while held

  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = gameSnap.data as Game;
  const task = findGameTask(game, taskId);
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
    // Test-run bypass (wave-J): a desk rehearsal answers from anywhere. The run-doc
    // read happens ONLY on the would-reject path, so a real run is byte-identical.
    // evaluatePresence also returns ok:false for missing GPS, so this one wrap
    // covers both the too-far and the no-coords case.
    if (!verdict.ok && !proximitySatisfied(false, await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
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
    // Test mode (change: test-mode-hidden-scoring): a survey has no right answer, so
    // nothing leaks either way — but the SHAPE must match every other answer on a
    // sealed run. Returning `correct: true` here makes the play app fire its
    // celebratory "you got it" feedback for one task type and stay neutral for the
    // rest, which reads as an accidental tell about which questions are graded.
    const sealedSurvey = sealsScoreFromParticipant(game);
    if (!completed) return sealedSurvey ? { recorded: true, nextTaskId: null } : { correct: true, nextTaskId: null };
    // WO Fix 1: slot release is atomic inside completeTaskForTeam.
    const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
    const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
    return sealedSurvey
      ? { recorded: true, nextTaskId: next.taskId ?? null }
      : { correct: true, nextTaskId: next.taskId ?? null };
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

  // ── Test mode (change: test-mode-hidden-scoring) ────────────────────────────
  // On a run whose game seals scoring, an answer is FREE AND FINAL: it completes
  // the task and routing moves on, right or wrong. So every pre-grade gate below
  // is skipped wholesale rather than neutralised piecemeal — the attempt cap, the
  // replay guard and the retry cooldown all exist to make a wrong answer
  // expensive, and there is no cheaper way to be wrong than "it already counted".
  //
  // Skipping is also what keeps the participant unstuck: a lockout they are not
  // allowed to see the reason for is a stuck player with no signal, which is worse
  // than the feedback this mode removes. And because the first submission
  // completes the task, re-submitting cannot re-grade it — there is nothing left
  // to brute-force, which is what the attempt cap defended.
  //
  // The answer is still GRADED and still SCORED: the creator's console, analytics,
  // leaderboard and recap are untouched. Only the verdict's visibility and its
  // consequences change.
  if (sealsScoreFromParticipant(game)) {
    const correctSealed = ordering
      ? matchesOrderedAnswer(task.orderItems as string[], orderedAnswer)
      : matchesTaskAnswer(task, String(answer));
    const nowSealed = new Date().toISOString();
    const { completed } = await completeTaskForTeam(
      ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, nowSealed,
      {
        submittedAnswer: boundStoredAnswer(ordering ? JSON.stringify(orderedAnswer) : answer),
        wasCorrect: correctSealed,
        // post-run-player-report: the same submission also joins the recorded
        // answer sheet. Both are written here, from THIS verdict, so the single
        // test-mode slot and the log can never disagree about what happened.
        answerLog: buildAnswerLogEntry({
          kind: ordering ? 'ordering' : 'answer',
          answer: ordering ? JSON.stringify(orderedAnswer) : answer,
          correct: correctSealed,
          at: nowSealed,
        }),
      },
    );
    // `recorded` is the whole verdict the participant gets. `correct` is OMITTED,
    // never set to a fixed value: an always-true field would be a false statement
    // on the wire that some future client could surface, whereas an absent field
    // cannot be misread. A correct and a wrong answer return the identical key set.
    if (!completed) return { recorded: true, nextTaskId: null };
    const teamLocSealed = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
    const nextSealed = await assignNextInActiveStage(
      ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLocSealed, nowSealed,
    );
    return { recorded: true, nextTaskId: nextSealed.taskId ?? null };
  }

  // ── Pre-grade gates ─────────────────────────────────────────────────────────
  // Everything below runs BEFORE the answer is graded, on ONE team read. Order
  // matters and is deliberate:
  //   1. attempt limit  — a locked task must cost nothing at all (row 42)
  //   2. replay guard   — a retried identical submission is not a new attempt
  //   3. retry cooldown — a wrong-answer lockout, checked before grading so a
  //                       team cannot fire every option while it is running
  const attemptLimit = task.smart?.attemptLimit;
  const teamRef = db.doc(`users/${ctx.ownerUid}/games/${ctx.gameId}/runs/${ctx.runId}/teams/${teamId}`);
  // Wrong-answer cost (change: wrong-answer-cost). Absent config ⇒ 'off' ⇒ this
  // whole block is a no-op and the callable behaves exactly as it did before.
  const costLevel = resolveWrongAnswerLevel(game, task);
  const costActive = costLevel !== 'off';

  // One read serves the attempt limit, the replay guard and the cooldown. It
  // still only happens when SOMETHING needs it, so a plain task with no limit,
  // no hint escalation and no cost level performs exactly as many reads as before.
  const needsTeamRead = (attemptLimit != null && attemptLimit > 0) || costActive;
  let attempts = 0;
  let penaltyRec: NonNullable<RunTeam['answerPenalties']>[string] | undefined;
  // retry-lockout-clock-skew: the lockout ceiling belongs to the level that
  // created it, and the verdict below is the ONLY place the "still locked?"
  // question is answered — for the gate, the replay reply and the charge reply.
  const lockoutPolicy = retryLockoutPolicyFor(costLevel);
  if (needsTeamRead) {
    const teamSnap = await teamRef.get();
    const teamData = teamSnap.data() as Pick<RunTeam, 'taskAttempts' | 'answerPenalties'> | undefined;
    attempts = teamData?.taskAttempts?.[taskId] ?? 0;
    penaltyRec = teamData?.answerPenalties?.[taskId];
  }

  // 1. row 42: enforce the task's answer attempt limit server-side. Refuse once
  // the cap is reached (even a correct answer is blocked once locked — no
  // infinite brute force). Unchanged, and still FIRST: a locked task must never
  // be charged, cooled down, or graded.
  if (attemptLimit && attemptLimit > 0 && attemptLimitReached(attempts, attemptLimit)) {
    throw new functions.https.HttpsError('resource-exhausted', 'No attempts left for this task');
  }

  // The answer as the replay guard sees it. Computed for both shapes so an
  // ordering arrangement is deduped the same way a typed answer is.
  const submissionHash = costActive
    ? hashAnswerForReplay(ordering ? (orderedAnswer as string[]).map(String) : String(answer))
    : '';

  // 2. Replay guard — a network retry, a double tap, or an offline replay of the
  // SAME wrong answer is a replay of a call the server already graded, not a new
  // attempt. Return the stored verdict: no attempt recorded, no points charged,
  // no cooldown started or extended. Checked BEFORE the cooldown so a double tap
  // during a lockout gets a clean replay rather than an error. A brute-forcer
  // submits DIFFERENT answers by definition, so this cannot be abused.
  if (costActive && penaltyRec && submissionHash && penaltyRec.lastHash === submissionHash) {
    const verdict = evaluateRetryLockout(Date.now(), penaltyRec, lockoutPolicy);
    return {
      correct: false,
      replay: true,
      penalty: 0,
      attemptsUsed: attempts,
      // `cooldownUntil` / `retryAfterSeconds` are kept for a play-web bundle
      // cached before retry-lockout-clock-skew; `retryAfterMs` is what the
      // current client counts down (a duration, never an instant to re-interpret).
      cooldownUntil: penaltyRec.cooldownUntil ?? 0,
      retryAfterSeconds: verdict.remainingSeconds,
      retryAfterMs: verdict.remainingMs,
    };
  }

  // 3. Retry cooldown. It MUST gate before grading: grading first would let a
  // team fire every remaining option during the lockout and the deterrent would
  // be exactly zero. The wait is bounded by the level's ceiling and the level's
  // free attempts mean a first wrong answer never blocks anyone. The message
  // carries only a duration, never anything about the answer. A test-drive
  // rehearsal skips the wait — the run-doc read happens ONLY on the would-block
  // path, mirroring the presence gate above, so a real run is byte-identical.
  if (costActive && penaltyRec) {
    // Server instant vs SERVER clock — a participant's clock plays no part, and a
    // stored expiry that somehow exceeds the level's ceiling decays to it instead
    // of locking the team out of the task for the rest of the run.
    const waitSeconds = evaluateRetryLockout(Date.now(), penaltyRec, lockoutPolicy).remainingSeconds;
    if (waitSeconds > 0 && !(await runIsTestDrive(ctx.ownerUid, ctx.gameId, ctx.runId))) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Wrong answer cooldown, try again in ${waitSeconds}s`,
      );
    }
  }

  const correct = ordering
    ? matchesOrderedAnswer(task.orderItems as string[], orderedAnswer)
    : matchesTaskAnswer(task, String(answer));
  if (!correct) {
    // Record the wrong attempt under a real nested map (not a dotted key).
    // Tracked when ANY consumer needs it: the attempt-limit cap (row 42), hint
    // auto escalation (change: hint-auto-escalation), or the wrong-answer cost
    // curve (change: wrong-answer-cost) — wrong ordering arrangements flow
    // through here too and count the same.
    const trackAttempts =
      (attemptLimit != null && attemptLimit > 0) ||
      (task.hintAutoRevealAttempts ?? 0) > 0 ||
      costActive;
    // post-run-player-report: record the wrong submission. Built ONCE here and
    // reused by both branches below, from the verdict that was just computed, so
    // a stored entry can never disagree with how the answer was graded.
    const wrongEntry = buildAnswerLogEntry({
      kind: ordering ? 'ordering' : 'answer',
      answer: ordering ? JSON.stringify(orderedAnswer) : String(answer),
      correct: false,
      at: new Date().toISOString(),
    });
    if (!costActive) {
      // This branch used to be a single `FieldValue.increment` merge-set (or, with
      // nothing tracking attempts, no write at all). Appending to the log needs a
      // read-modify-write of the stages ARRAY, so it becomes a transaction — the
      // one genuine cost increase in this change. It is bounded by the callable's
      // rate limit and by MAX_ANSWER_LOG_ENTRIES, and it is still only taken on a
      // WRONG answer, never on the completion hot path.
      if (!trackAttempts && !wrongEntry) return { correct: false };
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(teamRef);
        if (!snap.exists) return;
        const t = snap.data() as RunTeam;
        const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (trackAttempts) {
          patch.taskAttempts = { ...(t.taskAttempts ?? {}), [taskId]: (t.taskAttempts?.[taskId] ?? 0) + 1 };
        }
        if (appendAnswerLogToStages(t.stages, taskId, wrongEntry)) patch.stages = t.stages;
        tx.update(teamRef, patch);
      });
      return { correct: false };
    }

    // A cost level is active ⇒ charge it. A transaction (the same shape
    // requestTaskHint already uses) because the cumulative point CAP and the
    // replay guard are read-modify-write decisions that FieldValue.increment
    // alone cannot honour under a race. This is NOT the completeTask hot path:
    // it only runs when the team got the answer wrong, and the correct-answer
    // path below keeps its transaction-free flow untouched.
    const nowMs = Date.now();
    const charged = await db.runTransaction(async (tx) => {
      const snap = await tx.get(teamRef);
      if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
      const t = snap.data() as RunTeam;
      const prior = t.answerPenalties?.[taskId];
      // Re-decide inside the transaction: a concurrent duplicate that lost the
      // race must not be charged a second time either.
      if (prior && prior.lastHash === submissionHash) {
        return {
          points: 0,
          cooldownUntil: prior.cooldownUntil ?? 0,
          lockout: { ...prior },
          attemptsUsed: t.taskAttempts?.[taskId] ?? attempts,
          replay: true,
        };
      }
      const priorAttempts = t.taskAttempts?.[taskId] ?? 0;
      const priorCharged = prior?.charged ?? 0;
      const cost = wrongAnswerCost(costLevel, game.scoringPreset, priorAttempts + 1, priorCharged);
      const lockoutMs = cost.cooldownSeconds > 0 ? cost.cooldownSeconds * 1000 : 0;
      const cooldownUntil = lockoutMs > 0 ? nowMs + lockoutMs : 0;
      // retry-lockout-clock-skew: record the lockout as (server instant + the
      // duration it earned) as well as the legacy absolute expiry. The duration
      // is what lets the read path bound the wait by the level's own ceiling and
      // ship the participant a remaining duration instead of an instant.
      const lockout = { lastFailureAt: nowMs, lockoutMs, failureCount: cost.chargedIndex };
      // Real nested objects only. `bonusPenalty` is the same channel paid hints
      // and manual adjustments use, so buildRankings is untouched and the live
      // and final boards cannot drift. applyPenalties already floors the score
      // at 0, so no charge can push a team negative.
      // post-run-player-report: the charged wrong answer joins the record too,
      // inside the SAME transaction that charges for it — so the penalty and the
      // submission that earned it commit together or not at all.
      const loggedStages = appendAnswerLogToStages(t.stages, taskId, wrongEntry);
      tx.update(teamRef, {
        ...(loggedStages ? { stages: t.stages } : {}),
        taskAttempts: { ...(t.taskAttempts ?? {}), [taskId]: priorAttempts + 1 },
        answerPenalties: {
          ...(t.answerPenalties ?? {}),
          [taskId]: {
            charged: priorCharged + cost.points,
            lastHash: submissionHash,
            cooldownUntil,
            ...lockout,
          },
        },
        ...(cost.points > 0 ? { bonusPenalty: (t.bonusPenalty ?? 0) + cost.points } : {}),
        updatedAt: new Date().toISOString(),
      });
      return {
        points: cost.points,
        cooldownUntil,
        lockout: { cooldownUntil, ...lockout },
        attemptsUsed: priorAttempts + 1,
        replay: false,
      };
    });

    const verdict = evaluateRetryLockout(Date.now(), charged.lockout, lockoutPolicy);
    return {
      correct: false,
      penalty: charged.points,
      // Deprecated-but-kept for a cached older bundle; `retryAfterMs` is the
      // clock-skew-proof value the current client counts down.
      cooldownUntil: charged.cooldownUntil,
      retryAfterSeconds: verdict.remainingSeconds,
      retryAfterMs: verdict.remainingMs,
      attemptsUsed: charged.attemptsUsed,
      replay: charged.replay,
    };
  }

  const now = new Date().toISOString();
  // post-run-player-report: the winning answer is recorded too — it rides the
  // completion transaction that already rewrites this stage, so the correct-answer
  // hot path costs no extra read and no extra transaction.
  const { completed } = await completeTaskForTeam(
    ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now,
    {
      answerLog: buildAnswerLogEntry({
        kind: ordering ? 'ordering' : 'answer',
        answer: ordering ? JSON.stringify(orderedAnswer) : answer,
        correct: true,
        at: now,
      }),
    },
  );
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
  assertTeamNotHeld(team); // staff-console-field-ops — no step progress while held

  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const seqGame = gameSnap.data as Game;
  // Test mode (change: test-mode-hidden-scoring): a sequence is a knowledge task
  // like a quiz, so it gets the same treatment — every step advances, no step ever
  // reports a verdict, and the per-task result is recorded for the creator.
  const seqSealed = sealsScoreFromParticipant(seqGame);
  const task = findGameTask(seqGame, taskId);
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

  // Must answer steps in order; ignore replays of already-cleared steps. This is a
  // REPLAY, not a wrong answer, so it stays a no-op in both modes — it just cannot
  // say "incorrect" on a sealed run.
  if (stepIndex !== done) {
    return seqSealed
      ? { recorded: true, stepsDone: done, totalSteps: task.steps.length, taskComplete: false }
      : { stepCorrect: false, stepsDone: done, totalSteps: task.steps.length, taskComplete: false };
  }

  const step = task.steps[stepIndex];
  const expected = step.answer?.trim().toLowerCase();
  const ok = !expected || (answer ?? '').trim().toLowerCase() === expected; // no answer = tap-to-confirm
  // Normal run: a wrong step stops here and says so. Sealed run: it FALLS THROUGH and
  // advances like any other answer — being told nothing while also being blocked is
  // the stuck-player-with-no-signal failure this mode must never create.
  if (!ok && !seqSealed) {
    return { stepCorrect: false, stepsDone: done, totalSteps: task.steps.length, taskComplete: false };
  }

  // How many steps of THIS task the team has now got wrong. Reuses `taskAttempts`
  // (a map keyed by taskId, already sealed from the participant payload) rather than
  // adding a field, and is read back locally so the verdict below counts the step
  // being graded right now.
  const seqWrongBefore = team.taskAttempts?.[taskId] ?? 0;
  const seqWrongNow = seqWrongBefore + (ok ? 0 : 1);

  const newDone = done + 1;
  const now = new Date().toISOString();
  const taskComplete = newDone >= task.steps.length;

  // post-run-player-report: record THIS step's submission. A sequence's answers
  // span several calls and no single one of them is "the answer" — which is why
  // the single `submittedAnswer` slot below is still deliberately left unwritten
  // for a sequence — but the LOG is a list, so each step is recorded on its own
  // with its `stepIndex` and its own verdict.
  const stepEntry = buildAnswerLogEntry({
    kind: 'sequence_step',
    answer: answer ?? '',
    correct: ok,
    stepIndex,
    at: now,
  });
  if (stepEntry) {
    // A transaction rather than the plain update below, because appending needs a
    // read-modify-write of the stages ARRAY and a stale array written wholesale
    // could clobber a concurrent write. One transaction REPLACES the update — the
    // cost is a single extra read, on a path that fires once per sequence step.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(teamRef);
      if (!snap.exists) return;
      const t = snap.data() as RunTeam;
      const patch: Record<string, unknown> = {
        [`taskStepProgress.${taskId}`]: newDone,
        ...(seqSealed && !ok ? { [`taskAttempts.${taskId}`]: admin.firestore.FieldValue.increment(1) } : {}),
        updatedAt: now,
      };
      if (appendAnswerLogToStages(t.stages, taskId, stepEntry)) patch.stages = t.stages;
      tx.update(teamRef, patch);
    });
  } else {
    await teamRef.update({
      [`taskStepProgress.${taskId}`]: newDone,
      // Dotted path on a MAP field, which IS a real nested path — the documented
      // footgun is dotted-updating an ARRAY element, which this is not.
      ...(seqSealed && !ok ? { [`taskAttempts.${taskId}`]: admin.firestore.FieldValue.increment(1) } : {}),
      updatedAt: now,
    });
  }

  if (taskComplete) {
    const { completed } = await completeTaskForTeam(
      ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now,
      // The whole sequence counts as correct only if no step was missed. There is one
      // verdict slot per task record, so `submittedAnswer` is deliberately NOT written
      // for a sequence: its answers span several calls and no single one of them is
      // "the answer" — recording the last step alone would read as the whole thing.
      seqSealed ? { wasCorrect: seqWrongNow === 0 } : undefined,
    );
    if (completed) {
      // WO Fix 1: slot release is atomic inside completeTaskForTeam.
      const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
      await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
    }
  }
  return seqSealed
    ? { recorded: true, stepsDone: newDone, totalSteps: task.steps.length, taskComplete }
    : { stepCorrect: true, stepsDone: newDone, totalSteps: task.steps.length, taskComplete };
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

  // The game template cannot change mid-run, and this is a hot participant path
  // (change: hot-path-read-cost).
  const gameSnap = await cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId));
  const game = gameSnap.data as Game;

  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  if (activeStageIdx < 0) return { recommendations: [] };
  // .slice() before sort: never mutate the shared preloaded game array in place
  // (getMyTeamState already sorts defensively; these two hot paths did not).
  const gameStage = game.stages.slice().sort((a, b) => a.order - b.order)[activeStageIdx];
  if (!gameStage) return { recommendations: [] };

  const completedTaskIds = team.stages.flatMap((s) => s.tasks)
    .filter((t) => t.status === 'completed').map((t) => t.taskId);
  const paceSkillRatio = await computeSkillRatio(
    team.stages.flatMap((s) => s.tasks).filter((t) => t.status === 'completed').map((t) => ({
      taskId: t.taskId, actualMinutes: t.actualMinutes, completedAt: t.completedAt, startedAt: t.startedAt,
      // pause-clock-tasks: carried so computeSkillRatio can drop a paused record
      // from the pace sample (its duration is deliberation, not pace).
      excludedMs: t.excludedMs,
    })),
    game.stages.flatMap((s) => s.tasks),
  );
  // Test mode (change: test-mode-hidden-scoring) routes on ACCURACY instead of
  // pace — a wrong answer completes the task there, so "fast" stops meaning
  // "strong". Returns the pace ratio unchanged for every normal run.
  const skillRatio = resolveRoutingSkillRatio(game, team, paceSkillRatio);

  const recommendations = await buildRecommendations(
    { lat, lng }, gameStage.tasks, completedTaskIds, skillRatio,
    ctx.ownerUid, ctx.gameId, ctx.runId, 5,
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

  // The participant hot path (change: vps-firestore-read-offload). This callable ran
  // 1,516 times in nine minutes of the 2026-08-26 run; these two documents change rarely
  // and are written only by this process, so they are served from memory. Everything the
  // payload is built from below — including sanitizeTaskForParticipant — is unchanged.
  const [gameDoc, runDoc] = await Promise.all([
    cachedGetDoc<Game>(db, docCachePolicy, gamePath(ctx.ownerUid, ctx.gameId)),
    cachedGetDoc<Run>(db, docCachePolicy, runPath(ctx.ownerUid, ctx.gameId, ctx.runId)),
  ]);
  const game = gameDoc.data as Game;
  const run = runDoc.data as Run;

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
  // ── Visibility gating (change: play-task-gating, wave D) ────────────────────
  // A participant may only ACT on the task routing assigned them, so they only
  // RECEIVE that one — plus the ones they already finished (history/progress must
  // still render). Every other task of the active stage is OMITTED ENTIRELY from
  // the payload: no title, no stub, no lock reason.
  //
  // Why this is a security fix and not just polish: a multi-task stage used to
  // ship EVERY task's quiz choices / sequence prompts / station instructions at
  // once, so a player could pre-read the whole stage in devtools before routing
  // ever handed a task out. "Withheld" now means absent from the wire.
  //
  // NOTE: this is a PAYLOAD concern only. completeTask / submitTaskAnswer /
  // verifyStationCode keep their own authorization + locked/unreleased/expired
  // gates unchanged — omission is never the security control.
  // Test mode (change: test-mode-hidden-scoring). Declared HERE, above the task
  // decoration below, because that .map reads it and runs immediately — leaving
  // this next to its other use (the team projection at the return) put it in the
  // temporal dead zone and crashed every getMyTeamState with "Cannot access
  // 'sealed' before initialization". tsc cannot see that across a closure.
  const sealed = sealsScoreFromParticipant(game);
  const recByTaskId = new Map(
    (activeStageIdx >= 0 ? team.stages[activeStageIdx].tasks : []).map((r) => [r.taskId, r]),
  );
  const activeStageTasks =
    activeStageIdx >= 0 && orderedStages[activeStageIdx]
      ? orderedStages[activeStageIdx].tasks.filter((t) => {
          const st = recByTaskId.get(t.id)?.status;
          return st === 'assigned' || st === 'completed';
        }).map((t) => {
          // Hidden-location tasks stay SEALED until reportArrival has latched
          // `arrivedAt` (or the team already completed them — you can't un-find a
          // spot you've been to).
          const rec = recByTaskId.get(t.id);
          const revealed = rec?.arrivedAt != null || rec?.status === 'completed';
          const safe = sanitizeTaskForParticipant(t, { shuffleSeed: `${team.id}:${t.id}`, revealed }) as Record<string, unknown>;
          // Hint auto escalation (change: hint-auto-escalation): decorate the
          // team's ACTIVE task with a display-only `hintFreeNow` flag. The charge
          // decision is re-made inside requestTaskHint's transaction, so a stale
          // flag can never mischarge — this only lights up the free-hint button.
          // Test mode (change: test-mode-hidden-scoring): the attempt cap does not
          // apply on a sealed run, so it must not be ADVERTISED either. The play
          // app uses this value to warn "a wrong answer spends one of your 2
          // remaining attempts" before submitting — a warning that is false there,
          // and which tells the participant that wrong answers are a thing that
          // happens to them, in the one mode built to withhold exactly that.
          if (sealed && safe.smart && typeof safe.smart === 'object') {
            delete (safe.smart as Record<string, unknown>).attemptLimit;
          }
          // Test mode (change: test-mode-hidden-scoring): every hint is free on a
          // sealed run, so report it through the EXISTING free-hint flag rather
          // than adding a second signal. Without this the participant app still
          // renders the price tag ("gy a hint (-25 pts)") for a charge the server
          // no longer applies — a score on screen in the one mode that must show
          // none, and a lie about the cost besides.
          if (assignedActiveRec?.taskId === t.id && sealed && safe.hasHint) {
            safe.hintFreeNow = true;
          } else if (
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
          // Wrong-answer cost (change: wrong-answer-cost): tell the participant
          // what a wrong answer will cost BEFORE they answer. A cost nobody was
          // warned about is not a game mechanic. Display-only and derived purely
          // from the level table plus the team's OWN progress, so it carries no
          // fragment of an answer key; the real charge is re-decided inside
          // submitTaskAnswer's transaction. Omitted entirely when the level is
          // 'off', so a game authored before this change ships an identical payload.
          // Test mode (change: test-mode-hidden-scoring): no cost is charged on a
          // sealed run, so warning about one would be both a lie and a leak — the
          // warning names a point value, which is a score.
          if (
            !sealed &&
            assignedActiveRec?.taskId === t.id &&
            (t.type === 'quiz' || t.type === 'numeric')
          ) {
            const level = resolveWrongAnswerLevel(game, t);
            if (level !== 'off') {
              const penRec = team.answerPenalties?.[t.id];
              safe.answerCost = answerCostDisplay(
                level,
                game.scoringPreset,
                team.taskAttempts?.[t.id] ?? 0,
                penRec?.charged ?? 0,
                // retry-lockout-clock-skew: hand the whole lockout row + the
                // SERVER clock, so what ships is a remaining duration the phone
                // can count down without interpreting a server instant.
                penRec,
                Date.now(),
              );
            }
          }
          return safe;
        })
      : [];

  // ── Genuine lock signal (change: wave-f next-task-regression, Bug A) ─────────
  // wave D omits every non-assigned task from `activeStageTasks`, so the client
  // can no longer look up an unassigned task's content to decide whether it is
  // unlock/release-gated vs merely awaiting routing. Ship the server's
  // authoritative verdict instead: the ids of active-stage tasks that are
  // GENUINELY gated. Ids only, no content — the client already holds these ids in
  // team.stages[].tasks[].taskId, and this is a response-level field (not a task
  // payload), so the sanitizer allowlist is unaffected and nothing new leaks.
  const completedActiveIds = team.stages
    .flatMap((s) => s.tasks)
    .filter((r) => r.status === 'completed')
    .map((r) => r.taskId);
  const unassignedActive =
    activeStageIdx >= 0 && orderedStages[activeStageIdx]
      ? orderedStages[activeStageIdx].tasks.filter(
          (t) => recByTaskId.get(t.id)?.status === 'unassigned',
        )
      : [];
  const activeLockedTaskIds = lockedTaskIds(
    unassignedActive, completedActiveIds, run.launchedAt, Date.now(),
  );

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

  // ── Completed-mission pins (change: hidden-mission-map) ─────────────────────
  // A SAFE map channel: the coordinates of every mission this team has ALREADY
  // COMPLETED, across ALL stages — a trail of where they've been. Built BY
  // CONSTRUCTION from the team's completed RunTaskRecords joined to the game task
  // coords, so it is structurally incapable of shipping a non-completed task's
  // location (a hidden-not-arrived task, an unassigned task, or the active sealed
  // target). Leak-safe on the same principle as revealing a hidden task's coords
  // AFTER arrival: you can't un-find a spot you've stood on. Locationless /
  // coordinate-less completed tasks are simply omitted. The play map plots these +
  // the client's own GPS while the active mission is a still-sealed hidden target,
  // instead of the old map placeholder.
  const completedTaskPins = buildCompletedPins(
    team.stages,
    orderedStages.flatMap((s) => s.tasks),
  );

  // ── Why this team is not playing yet (change: held-team-visibility) ─────────
  // startTeams holds back any team that is not cleared to start, and never writes
  // to it — so a held team is indistinguishable, on the wire, from a team whose
  // run has simply not started. It sat on "waiting for the host to start" while
  // the rest of the field walked away.
  //
  // A REASON, not a record: `null` unless this team is actually being held, and
  // never a guardian's name, contact, token or age. Derived from the SAME
  // predicate startTeams partitions on, so the explanation cannot disagree with
  // the behaviour. Response-level (not a task payload), so the participant
  // sanitizer contract is untouched. Read-only: nothing here releases anybody.
  const holdReason: 'guardian_consent' | null =
    !team.launched && !isConsentSatisfied(team, game) ? 'guardian_consent' : null;

  // ── Test mode (change: test-mode-hidden-scoring) ────────────────────────────
  // THE seal. This function returns the team document WHOLE, so every field on
  // RunTeam and on each nested RunTaskRecord reaches the device — task CONTENT is
  // sanitized by construction, team PROGRESS never was. Hiding a score in play-web
  // would leave it sitting in this response, readable in devtools; the projection
  // below is the actual boundary, exactly as `run.leaderboard`'s `published` gate
  // is for the staged reveal.
  //
  // It runs on EVERY run, not only sealed ones: the recorded submission fields are
  // stripped in both modes (they are simply never allow-listed), because a stored
  // `wasCorrect` has no participant use in any game and would void this feature.
  return {
    team: sanitizeTeamForParticipant(team, sealed),
    // Why the team is held back from starting, or null when it is not.
    holdReason,
    stageNarratives,
    completedTaskPins,
    run: {
      id: run.id, status: run.status, accessCode: run.accessCode,
      billingType: run.billingType ?? 'free',
      // Run start, so the client can compute per-task `releaseAfterMinutes`
      // countdowns for scheduled-release tasks in the active stage.
      launchedAt: run.launchedAt ?? null,
      // Only ever ship a PUBLISHED board to a participant (change:
      // manual-leaderboard-reveal). Every participant consumer already requires
      // `published` before rendering, but an unpublished board on the wire is
      // still readable in devtools — which would defeat a staged reveal. Gate it
      // at the source so "hidden from players" means hidden, not just unrendered.
      // Test mode seals the board outright, on top of the `published` gate: a
      // standing is a score, and this run has none as far as the player is
      // concerned (change: test-mode-hidden-scoring).
      leaderboard: !sealed && run.leaderboard?.published ? run.leaderboard : null,
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
      // Test mode (change: test-mode-hidden-scoring): tells the participant app to
      // render its sealed chrome — no score header, no right/wrong feedback, no
      // board, a neutral finish. Presentation only; the payload above is already
      // empty of everything it would otherwise show, so this flag decides how the
      // absence LOOKS, never whether the data is withheld.
      testMode: sealed,
      // Game intro primer (change: game-intro-instructions): the "How to play"
      // card/modal content. Cleaned at the echo boundary so even a legacy/hand-edited
      // doc with a non-https image is https-guarded on the way out. null when unset.
      instructions: cleanGameInstructions(game.instructions) ?? null,
    },
    activeStageTasks,
    // wave-f (next-task-regression, Bug A): ids of active-stage tasks that are
    // genuinely release/unlock-gated (routing cannot hand them out yet). The play
    // UI uses this — NOT the presence of omitted content — to decide "all
    // remaining locked" vs "awaiting routing".
    lockedTaskIds: activeLockedTaskIds,
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
    // Trashed games are dropped from the GM overview (change:
    // recoverable-game-deletion). deleteGame refuses while a run is unfinished so
    // this should be empty in practice, but the overview is a collection-GROUP
    // query that never touches the game doc for filtering — a legacy row must not
    // resurrect a deleted game on the operations dashboard.
    let deleted = false;
    try {
      const gs = await db.doc(`users/${uid}/games/${gameId}`).get();
      const g = gs.data() as Game | undefined;
      gameTitle = g?.title ?? '';
      deleted = isGameDeleted(g);
    } catch { /* title is best-effort */ }
    if (deleted) return null;
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

  const visible = runs.filter((r): r is NonNullable<typeof r> => r !== null);
  visible.sort((a, b) => (b.launchedAt ?? '').localeCompare(a.launchedAt ?? ''));
  return { runs: visible };
});


// ─── listMyRuns (run history) ─────────────────────────────────────────────────
//
// Every run the caller owns, LIVE OR FINISHED — the thing `listLiveRuns` above
// deliberately is not. Without it a run that ended falls off every navigation path
// the console has: the per-run surfaces all resolve by ACCESS CODE, which is
// revoked when a game is trashed and is not something a creator still holds weeks
// later, so "show me last month's event" was simply unreachable.
//
// Same query shape as listLiveRuns (collection group + `ownerUid`), minus the
// status filter, so it needs NO new composite index. Ordering and the cap are
// applied in memory for the same reason.
export const MAX_LISTED_RUNS = 100;

export const listMyRuns = loggedCallable('listMyRuns', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'listMyRuns');
  const { gameId, limit } = (data ?? {}) as { gameId?: string; limit?: number };
  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.min(Math.floor(limit), MAX_LISTED_RUNS)
    : MAX_LISTED_RUNS;

  // `ownerUid` is the authorization, not `gameId`: the filter below narrows what
  // the owner sees, it never widens it. A payload naming somebody else's game
  // returns that owner's runs only if this owner owns them, i.e. never.
  const snap = await db.collectionGroup('runs').where('ownerUid', '==', uid).get();

  // One read per distinct game rather than per run — a creator replays one game
  // many times, and the title/tombstone answer is identical for every run of it.
  const gameCache = new Map<string, Game | undefined>();
  const loadGame = async (id: string): Promise<Game | undefined> => {
    if (!gameCache.has(id)) {
      try {
        const gs = await db.doc(gamePath(uid, id)).get();
        gameCache.set(id, gs.exists ? (gs.data() as Game) : undefined);
      } catch { gameCache.set(id, undefined); /* title is best-effort */ }
    }
    return gameCache.get(id);
  };

  const rows = [];
  for (const d of snap.docs) {
    const r = d.data() as Run;
    const parts = d.ref.path.split('/'); // users/{ownerUid}/games/{gameId}/runs/{runId}
    const runGameId = parts[3];
    if (gameId && runGameId !== gameId) continue;
    const g = await loadGame(runGameId);
    // A trashed game's runs are hidden, exactly as the GM overview hides them:
    // the game is in the trash and its history goes with it until it is restored.
    if (isGameDeleted(g)) continue;
    const top = r.leaderboard?.rankings?.[0];
    rows.push({
      ownerUid: uid,
      gameId: runGameId,
      runId: r.id ?? parts[5] ?? d.id,
      gameTitle: g?.title ?? '',
      accessCode: r.accessCode ?? '',
      status: r.status ?? 'live',
      launchedAt: r.launchedAt ?? null,
      finishedAt: r.finishedAt ?? null,
      createdAt: r.createdAt ?? null,
      participantCount: r.participantCount ?? 0,
      isTestDrive: r.isTestDrive ?? false,
      leaderboardPublished: !!r.leaderboard?.published,
      topTeamName: top?.teamName ?? null,
      topScore: typeof top?.score === 'number' ? top.score : null,
    });
  }

  // Newest first on the best timestamp each row has: an abandoned run never got a
  // `finishedAt` and a draft never got a `launchedAt`, and either sorting to the
  // bottom forever would bury exactly the runs a creator is hunting for.
  const when = (row: { finishedAt: string | null; launchedAt: string | null; createdAt: string | null }) =>
    row.launchedAt ?? row.createdAt ?? row.finishedAt ?? '';
  rows.sort((a, b) => when(b).localeCompare(when(a)));
  return { runs: rows.slice(0, cap), truncated: rows.length > cap };
});


// ─── getRunPlayerReport (post-run per-player analysis) ─────────────────────────
//
// OWNER ONLY, and addressed by `{gameId, runId}` rather than by an access code —
// see listMyRuns above for why the code is the wrong handle for a finished run.
//
// This is the one surface that returns team-level identity together with what each
// player SUBMITTED, so the gate is the run document's own `ownerUid` (the same one
// listRunTeams uses) and nothing else: not a staff claim, not a published board.
// `getRunAnalytics` stays anonymous and unchanged; this is a second, narrower door.
export const getRunPlayerReport = loggedCallable('getRunPlayerReport', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'getRunPlayerReport');
  const { gameId, runId } = data as { gameId: string; runId: string };
  requireString(gameId, 'gameId', MAX_ID_LEN);
  requireString(runId, 'runId', MAX_ID_LEN);

  const runSnap = await db.doc(runPath(uid, gameId, runId)).get();
  if (!runSnap.exists) throw new functions.https.HttpsError('not-found', 'Run not found');
  const run = runSnap.data() as Run;
  if (run.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your run');
  }

  const [gameSnap, teamsSnap] = await Promise.all([
    db.doc(gamePath(uid, gameId)).get(),
    db.collection(teamsCol(uid, gameId, runId)).get(),
  ]);
  const game = gameSnap.exists ? (gameSnap.data() as Game) : null;
  // A trashed game's report is refused rather than served from the trash — the
  // same rule the recap and the GM overview follow.
  assertGameNotDeleted(game);
  const teams = teamsSnap.docs.map((d) => d.data() as RunTeam);

  return buildRunPlayerReport({ game, run, teams });
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
  const { ctx, team, teamRef } = await resolveCallerTeam(uid, { ownerUid, gameId, runId, code }, { requireController: true });
  assertTeamNotHeld(team); // staff-console-field-ops — no abandoning a task while held

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
