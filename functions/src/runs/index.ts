// ─── Run management callables ─────────────────────────────────────────────────
//
// A Run is a live instance of a Game. The flow:
//   Owner calls launchRun → gets accessCode
//   Participants call joinRun(code) → registered as RunTeam
//   Owner calls startRun → all launched:true, timers start
//   As teams complete tasks → requestNextTask, verifyStationCode, etc.
//   Owner calls finalizeRun → scores computed, leaderboard written

import * as functions from 'firebase-functions';
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
  haversineKm,
  isValidCoord,
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
import { assignTask, releaseTask, computeSkillRatio, buildRecommendations } from '../routing/assignNextTask';

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
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
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

export const launchRun = functions.https.onCall(async (data, context) => {
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

  // ── Billing. The decision (pro / free-run / credit / refuse) lives in the pure
  //    resolveLaunchBilling helper; this function only performs the side-effects.
  //    Free mode (PAYMENTS_ENABLED === false) short-circuits with a free launch
  //    and touches the wallet not at all — no read, no decrement. ──
  let billing: { billingType: Run['billingType']; maxParticipants: number };
  if (!PAYMENTS_ENABLED) {
    const free = resolveLaunchBilling(false, {});
    // free.ok is always true when payments are off.
    billing = free.ok
      ? { billingType: free.billingType, maxParticipants: free.maxParticipants }
      : { billingType: 'free', maxParticipants: FREE_PARTICIPANTS_PER_FREE_RUN };
  } else {
    billing = await db.runTransaction<{ billingType: Run['billingType']; maxParticipants: number }>(async (t) => {
      const wSnap = await t.get(walletRef);
      const w = (wSnap.exists ? wSnap.data() : {}) as Partial<Wallet>;
      const decision = resolveLaunchBilling(true, w);
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
      return { billingType: decision.billingType, maxParticipants: decision.maxParticipants };
    });
  }

  const run: Run = {
    id: runRef.id,
    gameId,
    ownerUid: uid,
    status: 'live',
    accessCode: code,
    billingType: billing.billingType,
    maxParticipants: billing.maxParticipants,
    participantCount: 0,
    launchedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const accessCode: AccessCode = {
    code,
    ownerUid: uid,
    gameId,
    runId: runRef.id,
    status: 'unused',
    createdAt: now,
  };

  const batch = db.batch();
  batch.set(runRef, run);
  batch.set(db.doc(`accessCodes/${code}`), accessCode);
  await batch.commit();

  // Increment game.playCount
  db.doc(gamePath(uid, gameId)).update({ playCount: admin.firestore.FieldValue.increment(1) }).catch(() => undefined);

  return { runId: runRef.id, accessCode: code };
});


// ─── getJoinInfo ──────────────────────────────────────────────────────────────
// Client-safe lookup before joining: given an access code, return the game's
// title, branding, mode, and registration fields so the join form can render.

export const getJoinInfo = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
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

export const joinRun = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const teamId = context.auth.uid;

  const { code, displayName, registrationData = {}, memberNames = [] } = data as {
    code: string;
    displayName: string;
    registrationData?: Record<string, unknown>;
    memberNames?: string[];
  };

  if (!code?.trim()) throw new functions.https.HttpsError('invalid-argument', 'code required');
  if (!displayName?.trim()) throw new functions.https.HttpsError('invalid-argument', 'displayName required');

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

export const startTeams = functions.https.onCall(async (data, context) => {
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
    return !t.launched && (teamIds ? teamIds.includes(t.id) : true);
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

    // Score this task
    const gameTask = game.stages[stageIdx]?.tasks[taskIdx];
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

    taskRec.status = 'completed';
    taskRec.completedAt = now;
    taskRec.actualMinutes = actualMinutes;
    taskRec.earnedScore = earnedScore;
    taskRec.scoreBreakdown = { taskScore: earnedScore, total: earnedScore };

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

      // Unlock next stage if not final
      if (!isLastStage && stageIdx + 1 < stages.length) {
        stages[stageIdx + 1].status = 'active';
        stages[stageIdx + 1].startedAt = now;
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


// ─── skipStage ────────────────────────────────────────────────────────────────

export const skipStage = functions.https.onCall(async (data, context) => {
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

export const finalizeRun = functions.https.onCall(async (data, context) => {
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

  return { rankings };
});


// ─── refreshLeaderboard ─────────────────────────────────────────────────────────
// Compute live standings WITHOUT ending the run. Organizers always see the
// result (they read the run doc directly); `publish` controls whether
// participants may see it, so the reveal can be staged.

export const refreshLeaderboard = functions.https.onCall(async (data, context) => {
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

export const getPublicLeaderboard = functions.https.onCall(async (data, context) => {
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


// ─── listRunTeams ─────────────────────────────────────────────────────────────

export const listRunTeams = functions.https.onCall(async (data, context) => {
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

// Assign the next unassigned task within the team's active stage. Single-task
// stages assign directly; multi-task stages route by priority. No-op if none left.
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

export const completeTask = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { taskId, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');

  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });
  const now = new Date().toISOString();

  // Geofence tasks auto-complete on arrival — the server validates the GPS
  // distance so it can't be spoofed by simply calling completeTask.
  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  const gtask = gameSnap.exists ? findGameTask(gameSnap.data() as Game, taskId) : undefined;
  if (gtask?.type === 'geofence') {
    const radiusM = gtask.geofenceRadiusMeters ?? 50;
    if (lat == null || lng == null || !isValidCoord(lat, lng) || !gtask.coordinates) {
      throw new functions.https.HttpsError('failed-precondition', 'Location required to check in here');
    }
    const distM = haversineKm({ lat, lng }, gtask.coordinates) * 1000;
    if (distM > radiusM) {
      throw new functions.https.HttpsError('failed-precondition', `Too far from the spot (${Math.round(distM)}m away)`);
    }
  }

  await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
  await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);

  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);

  return { ok: true, nextTaskId: next.taskId ?? null };
});

// ─── requestNextTask (assign a task in the active stage) ──────────────────────

export const requestNextTask = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { lat, lng, ownerUid, gameId, runId, code } = data as {
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });
  const now = new Date().toISOString();
  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
  return { taskId: next.taskId ?? null };
});

// ─── requestTaskHint (reveal a paid hint, charge once) ────────────────────────

export const requestTaskHint = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { taskId, ownerUid, gameId, runId, code } = data as {
    taskId: string;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

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

function answerMatches(task: Task, raw: string): boolean {
  const given = raw.trim().toLowerCase();
  if (task.type === 'numeric') {
    const n = parseFloat(raw);
    if (Number.isNaN(n) || task.numericAnswer == null) return false;
    return Math.abs(n - task.numericAnswer) <= (task.numericTolerance ?? 0);
  }
  // quiz (and any answer-list task): match any accepted answer, case-insensitive
  return (task.answers ?? []).some((a) => a.trim().toLowerCase() === given);
}

// ─── submitTaskAnswer (quiz / numeric) ────────────────────────────────────────

export const submitTaskAnswer = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { taskId, answer, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string; answer: string;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId || answer == null) throw new functions.https.HttpsError('invalid-argument', 'taskId and answer required');
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data() as Game, taskId);
  if (!task) throw new functions.https.HttpsError('not-found', 'Task not found');
  if (task.type !== 'quiz' && task.type !== 'numeric') {
    throw new functions.https.HttpsError('failed-precondition', 'Task does not take an answer');
  }

  if (!answerMatches(task, String(answer))) return { correct: false };

  const now = new Date().toISOString();
  await completeTaskForTeam(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, taskId, now);
  await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);
  const teamLoc = lat != null && lng != null ? { lat, lng } : { lat: 0, lng: 0 };
  const next = await assignNextInActiveStage(ctx.ownerUid, ctx.gameId, ctx.runId, teamId, teamLoc, now);
  return { correct: true, nextTaskId: next.taskId ?? null };
});

// ─── submitSequenceStep (sequence tasks — one ordered step at a time) ──────────

export const submitSequenceStep = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { taskId, stepIndex, answer, lat, lng, ownerUid, gameId, runId, code } = data as {
    taskId: string; stepIndex: number; answer?: string;
    lat?: number; lng?: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId || typeof stepIndex !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and stepIndex required');
  }
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  if (!gameSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const task = findGameTask(gameSnap.data() as Game, taskId);
  if (!task || task.type !== 'sequence' || !task.steps?.length) {
    throw new functions.https.HttpsError('failed-precondition', 'Not a sequence task');
  }

  const teamRef = db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId));
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
  const team = teamSnap.data() as RunTeam;
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

export const getRecommendedTasks = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { lat, lng, ownerUid, gameId, runId, code } = data as {
    lat: number; lng: number;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

  const gameSnap = await db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get();
  const game = gameSnap.data() as Game;
  const teamSnap = await db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId)).get();
  if (!teamSnap.exists) return { recommendations: [] };
  const team = teamSnap.data() as RunTeam;

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

function sanitizeTaskForParticipant(task: Task) {
  // Strip every server-secret answer key: the hint text (paid reveal only),
  // quiz answers, the numeric target, and each sequence step's answer. The UI
  // still gets choices / tolerance / radius / step prompts so it can render.
  const { smart, hint, answers, numericAnswer, steps, ...rest } = task;
  return {
    ...rest,
    hasHint: !!hint && hint.trim().length > 0,
    hintPenalty: task.hintPenalty ?? 25,
    steps: steps?.map((s) => ({ id: s.id, prompt: s.prompt })),
    smart: smart
      ? {
          enabled: smart.enabled,
          verificationType: smart.verificationType,
          longInstructions: smart.longInstructions,
          longInstructionsHe: smart.longInstructionsHe,
          extraInfo: smart.extraInfo,
          mediaUrl: smart.mediaUrl,
          imageUrl: smart.imageUrl,
          codeInputLabel: smart.codeInputLabel,
          hasCode: smart.hasCode,
          geofenceRadiusMeters: smart.geofenceRadiusMeters,
          stationCoords: smart.stationCoords,
          timeLimitSeconds: smart.timeLimitSeconds,
          autoApprove: smart.autoApprove,
          attemptLimit: smart.attemptLimit,
          // secretCode intentionally omitted
        }
      : undefined,
  };
}

export const getMyTeamState = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { ownerUid, gameId, runId, code } = data as {
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });

  const [teamSnap, gameSnap, runSnap] = await Promise.all([
    db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, teamId)).get(),
    db.doc(gamePath(ctx.ownerUid, ctx.gameId)).get(),
    db.doc(runPath(ctx.ownerUid, ctx.gameId, ctx.runId)).get(),
  ]);
  if (!teamSnap.exists) throw new functions.https.HttpsError('not-found', 'Team not found');
  const team = teamSnap.data() as RunTeam;
  const game = gameSnap.data() as Game;
  const run = runSnap.data() as Run;

  // Build a map of taskId → sanitized content for tasks in the active stage
  const orderedStages = game.stages.slice().sort((a, b) => a.order - b.order);
  const activeStageIdx = team.stages.findIndex((s) => s.status === 'active');
  const activeStageTasks =
    activeStageIdx >= 0 && orderedStages[activeStageIdx]
      ? orderedStages[activeStageIdx].tasks.map(sanitizeTaskForParticipant)
      : [];

  return {
    team,
    run: {
      id: run.id, status: run.status, accessCode: run.accessCode,
      billingType: run.billingType ?? 'free',
      leaderboard: run.leaderboard ?? null,
    },
    game: {
      id: game.id,
      title: game.title,
      mode: game.mode,
      scoringPreset: game.scoringPreset,
      branding: game.branding ?? null,
      stageCount: orderedStages.length,
    },
    activeStageTasks,
    context: ctx,
  };
});


// ─── checkOutTask (release a station slot without completing) ─────────────────

export const checkOutTask = functions.https.onCall(async (data, context) => {
  const teamId = requireAuth(context);
  const { taskId, ownerUid, gameId, runId, code } = data as {
    taskId: string;
    ownerUid?: string; gameId?: string; runId?: string; code?: string;
  };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId required');
  const ctx = await resolveTeamContext(teamId, { ownerUid, gameId, runId, code });
  await releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId);
  return { ok: true };
});
