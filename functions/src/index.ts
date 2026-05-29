import * as functions from 'firebase-functions';
import { db } from './firebase';
import * as admin from 'firebase-admin';
import { assignNextTask, releaseTask, buildRecommendations, computeSkillRatio } from './routing/assignNextTask';
import {
  computeProductScore,
  clampScore,
  MAX_DESIGN_SCORE,
  MAX_PRESENTATION_SCORE,
  TENE_PRODUCTS,
} from './scoring/teneProducts';
import { calculateTaskScore } from './scoring/taskScore';
import {
  computeTransitPenalty,
  computeSprintPenalty,
  applyZScoreBonus,
  completionBonus,
  computeTieMetrics,
  compareForRanking,
} from './scoring/calculateScore';

// â”€â”€â”€ Path + auth helpers for the judge flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';

const userPath = (teamId: string) => `artifacts/${APP_ID}/users/${teamId}`;
const taskPath = (taskId: string) => `artifacts/${APP_ID}/public/data/tasks/${taskId}`;

// ─── Audit trail helper ───────────────────────────────────────────────────────
// Immutable record of every administrative action, for live dispute resolution.
// Written by Cloud Functions only (Admin SDK) at artifacts/{appId}/auditLogs/{id}.
interface AuditEntry {
  teamId: string;
  teamName?: string;
  operatorId: string;
  actionType: 'fine' | 'score_override' | 'manual_unlock' | 'evacuation' | 'skip';
  previousValue?: number | string | null;
  newValue?: number | string | null;
  reason?: string;
}

async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await db.collection(`artifacts/${APP_ID}/auditLogs`).add({
    ...entry,
    teamName:      entry.teamName ?? null,
    previousValue: entry.previousValue ?? null,
    newValue:      entry.newValue ?? null,
    reason:        entry.reason ?? '',
    timestamp:     new Date().toISOString(),
  });
}

/**
 * Gate judge-only callables. In production a judge must carry the
 * `{ role: 'admin' }` custom claim. The emulator relaxes this so the Phase 1
 * tracer bullet runs with a plain anonymous sign-in.
 */
function assertJudge(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  if (!isEmulator && context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Judges only');
  }
}

interface JudgeSlot {
  index: number;
  type: 'green' | 'gate' | 'orange' | 'gold';
  status: 'locked' | 'active' | 'completed' | 'skipped';
  taskId?: string;
  taskTitle?: string;
  startedAt?: string;
  completedAt?: string;
  earnedScore?: number;
  scoreBreakdown?: {
    products: string[];
    productScore: number;
    designScore: number;
    presentationScore: number;
    taskScore: number;
    total: number;
    missingMembers?: number;
    cohesionPenalty?: number;
  };
}

interface JudgingState {
  slotIndex: number;
  checkInId: string;
  arrivedAt: string;
}

/**
 * Apply the slot unlock rules after a slot completes, stamping startedAt on any
 * slot that newly becomes active (this resumes the elapsed clock on mobile).
 * Mirrors the mobile gameStore rules: green[n]â†’green[n+1]; green[3]â†’orange;
 * orangeâ†’all three gold; goldâ†’nothing further.
 */
function unlockNext(slots: JudgeSlot[], completedIndex: number, nowIso: string): void {
  const activate = (i: number) => {
    if (slots[i] && slots[i].status === 'locked') {
      slots[i] = { ...slots[i], status: 'active', startedAt: nowIso };
    }
  };
  // Linear chain: each slot activates exactly the next one.
  if (completedIndex + 1 < slots.length) activate(completedIndex + 1);
}

// â”€â”€â”€ requestNextTask â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called by the mobile app when a team completes a task and needs the next one.
// completedTaskIds are read server-side from GameState — never trusted from the client.
// Returns { taskId } or { injectRiddle: true } if park is at capacity.
export const requestNextTask = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { lat, lng, targetType } = data as {
    lat: number;
    lng: number;
    targetType?: 'green' | 'gold';
  };
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'lat and lng are required numbers');
  }
  const teamId = context.auth.uid;

  // Read completed tasks and skill ratio from authoritative GameState
  const gsSnap = await db.doc(`${userPath(teamId)}/gameState/current`).get();
  const completedTaskIds: string[] = [];
  let skillRatio = 0;
  let activeSlotType: 'green' | 'gate' | 'orange' | 'gold' | undefined;

  if (gsSnap.exists) {
    const gs = gsSnap.data() as { slots: JudgeSlot[] };
    const completedSlots = gs.slots.filter((s) => s.status === 'completed');
    for (const slot of completedSlots) {
      if (slot.taskId) completedTaskIds.push(slot.taskId);
    }
    activeSlotType = gs.slots.find((s) => s.status === 'active')?.type;
    skillRatio = await computeSkillRatio(completedSlots);
  }

  // Routing only targets green or gold tasks. Prefer the client hint, else infer
  // from the team's active slot. Orange (find-the-Tene) is a fixed location, not routed.
  const resolvedTarget: 'green' | 'gold' | undefined =
    targetType === 'green' || targetType === 'gold'
      ? targetType
      : activeSlotType === 'green' || activeSlotType === 'gold'
        ? activeSlotType
        : undefined;

  if (!resolvedTarget) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No routable target: provide targetType ("green" or "gold") or have an active green/gold slot',
    );
  }

  const result = await assignNextTask(teamId, { lat, lng }, completedTaskIds, resolvedTarget, skillRatio);

  // Write the assigned taskId + taskTitle back into the active slot so the mobile
  // onSnapshot mirror reflects it immediately (clients cannot write gameState).
  if (result.taskId) {
    const gsRef   = db.doc(`${userPath(teamId)}/gameState/current`);
    const gsSnap  = await gsRef.get();
    if (gsSnap.exists) {
      const gs = gsSnap.data() as { slots: JudgeSlot[] };
      const activeIdx = gs.slots.findIndex((s) => s.status === 'active');
      if (activeIdx >= 0 && !gs.slots[activeIdx].taskId) {
        const taskSnap = await db.doc(taskPath(result.taskId)).get();
        const taskTitle = taskSnap.exists
          ? (taskSnap.data() as { title?: string }).title
          : undefined;
        const updatedSlots = gs.slots.map((s, i) =>
          i === activeIdx
            ? { ...s, taskId: result.taskId, ...(taskTitle ? { taskTitle } : {}) }
            : s,
        );
        await gsRef.update({ slots: updatedSlots, updatedAt: new Date().toISOString() });
      }
    }
  }

  return result;
});

// â”€â”€â”€ checkOutTask â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ getRecommendedTasks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns a prioritised list of open tasks without committing an assignment.
// The mobile app can display this as a recommendation carousel; the team then
// calls requestNextTask to atomically claim their chosen task.
export const getRecommendedTasks = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { lat, lng, targetType } = data as {
    lat: number;
    lng: number;
    targetType: 'green' | 'gold';
  };
  const teamId = context.auth.uid;

  // Read game state server-side so completedTaskIds can't be spoofed
  const gsSnap = await db.doc(`${userPath(teamId)}/gameState/current`).get();
  const completedTaskIds: string[] = [];
  let skillRatio = 0;

  if (gsSnap.exists) {
    const gs = gsSnap.data() as { slots: JudgeSlot[] };
    const completedSlots = gs.slots.filter((s) => s.status === 'completed');
    for (const slot of completedSlots) {
      if (slot.taskId) completedTaskIds.push(slot.taskId);
    }
    skillRatio = await computeSkillRatio(completedSlots);
  }

  const recommendations = await buildRecommendations(
    { lat, lng },
    completedTaskIds,
    targetType,
    skillRatio,
  );
  return { recommendations };
});

// â”€â”€â”€ listTeams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns all registered teams with their live score and slot progress.
// Uses Admin SDK so it bypasses Firestore rules (safe — judge-gated callable).
export const listTeams = functions.https.onCall(async (_data, context) => {
  assertJudge(context);

  // Fetch all profile/team docs and gameState/current docs in parallel
  const [profileSnap, gsSnap] = await Promise.all([
    db.collectionGroup('profile').get(),
    db.collectionGroup('gameState').get(),
  ]);

  // Build a map of userId → gameState for O(1) join, deriving the live stage.
  interface TeamProgress {
    score: number;
    completedSlots: number;
    stageIndex: number | null;   // active slot index, or null when finished
    stageType: string | null;    // active slot type: green | gate | orange | gold
    judging: boolean;            // clock frozen at a judge
    crafting: boolean;           // inside the 20-min Tene crafting window
    finished: boolean;           // all slots terminal
  }
  const scoreMap: Record<string, TeamProgress> = {};
  for (const doc of gsSnap.docs) {
    const parts = doc.ref.path.split('/');
    // path: artifacts/{appId}/users/{userId}/gameState/{docId}
    const userId = parts[parts.indexOf('users') + 1];
    const gs = doc.data() as {
      score?: number;
      slots?: { index: number; type: string; status: string }[];
      judging?: unknown;
      craftingStartedAt?: unknown;
    };
    const slots = gs.slots ?? [];
    const active = slots.find((s) => s.status === 'active') ?? null;
    const finished = slots.length > 0 && slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    scoreMap[userId] = {
      score: gs.score ?? 0,
      completedSlots: slots.filter((s) => s.status === 'completed').length,
      stageIndex: active?.index ?? null,
      stageType:  active?.type ?? null,
      judging:    gs.judging != null,
      crafting:   gs.craftingStartedAt != null && active?.type === 'gold',
      finished,
    };
  }

  const teams = profileSnap.docs
    .filter((doc) => doc.id === 'team')          // only the profile/team document
    .map((doc) => {
      const parts = doc.ref.path.split('/');
      const userId = parts[parts.indexOf('users') + 1];
      const profile = doc.data() as {
        name: string; code: string; status: string;
        memberNames?: string[]; startedAt?: string; captainPhone?: string;
      };
      return {
        id:             userId,
        name:           profile.name,
        code:           profile.code,
        status:         profile.status,
        memberNames:    profile.memberNames ?? [],
        captainPhone:   profile.captainPhone ?? '',
        startedAt:      profile.startedAt ?? null,
        score:          scoreMap[userId]?.score ?? 0,
        completedSlots: scoreMap[userId]?.completedSlots ?? 0,
        stageIndex:     scoreMap[userId]?.stageIndex ?? null,
        stageType:      scoreMap[userId]?.stageType ?? null,
        judging:        scoreMap[userId]?.judging ?? false,
        crafting:       scoreMap[userId]?.crafting ?? false,
        finished:       scoreMap[userId]?.finished ?? false,
      };
    })
    .sort((a, b) => b.score - a.score);          // highest score first

  return { teams };
});

// Average score teams have actually earned on a given task (completed slots only).
// Falls back to the on-target sigmoid score when no team has completed it yet,
// so a skip is never penalised just because it's early in the event.
async function averageTaskScore(
  taskId: string,
  difficulty: number,
  estimatedMinutes: number,
): Promise<number> {
  const snap = await db.collectionGroup('gameState').get();
  const scores: number[] = [];
  for (const d of snap.docs) {
    const gs = d.data() as { slots?: JudgeSlot[] };
    for (const s of gs.slots ?? []) {
      if (s.taskId === taskId && s.status === 'completed' && typeof s.earnedScore === 'number') {
        scores.push(s.earnedScore);
      }
    }
  }
  if (scores.length > 0) {
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  return calculateTaskScore(difficulty, estimatedMinutes, estimatedMinutes);
}

// ─── skipTask ──────────────────────────────────────────────────────────────────
// Admin/judge escape hatch: skip a team's current task and advance them to the
// next one. Rather than zeroing the slot, the team is AWARDED the average score
// other teams earned on that same task (fair, non-punitive default). The slot is
// marked 'skipped' (terminal, but distinct from a judge-graded 'completed') and
// the award is added to the team score. Releases the claimed station slot and
// clears any pending judge state.
export const skipTask = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const { teamId } = data as { teamId: string };
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId is required');
  }

  const nowIso = new Date().toISOString();
  const gsRef  = db.doc(`${userPath(teamId)}/gameState/current`);

  // Pre-read (outside the transaction) to find which task is being skipped and
  // compute its average award — collectionGroup reads don't belong in a tx.
  const preSnap = await gsRef.get();
  if (!preSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Game state not found for team');
  }
  const preSlots  = (preSnap.data() as { slots: JudgeSlot[] }).slots;
  const preTarget = preSlots.findIndex((s) => s.status === 'active');
  if (preTarget < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Team has no active task to skip');
  }

  let awarded = 0;
  const skipTaskId = preSlots[preTarget].taskId;
  if (skipTaskId) {
    const taskSnap = await db.doc(taskPath(skipTaskId)).get();
    const task = taskSnap.exists
      ? (taskSnap.data() as { difficulty?: number; estimatedMinutes?: number })
      : {};
    awarded = await averageTaskScore(skipTaskId, task.difficulty ?? 5, task.estimatedMinutes ?? 15);
  }

  const { skippedTaskId, skippedIndex, allDone, newScore } = await db.runTransaction(async (tx) => {
    const profRef = db.doc(`${userPath(teamId)}/profile/team`);

    const gsSnap = await tx.get(gsRef);
    if (!gsSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    }

    const gs    = gsSnap.data() as { slots: JudgeSlot[]; score?: number; judging?: JudgingState | null };
    const slots = gs.slots.map((s) => ({ ...s }));

    // Skip the lowest-index active slot (handles the 3 simultaneous gold slots).
    const target = slots.findIndex((s) => s.status === 'active');
    if (target < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Team has no active task to skip');
    }

    const taskId = slots[target].taskId;
    slots[target] = {
      ...slots[target],
      status: 'skipped',
      completedAt: nowIso,
      earnedScore: awarded,
      scoreBreakdown: {
        products: [], productScore: 0, designScore: 0, presentationScore: 0,
        taskScore: awarded, total: awarded,
      },
    };

    // Unlock whatever the next objective would have been.
    unlockNext(slots, target, nowIso);

    // Unfreeze the mobile clock if the judge had this slot checked in.
    const clearJudging = gs.judging?.slotIndex === target;
    const done = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    const updatedScore = (gs.score ?? 0) + awarded;

    tx.update(gsRef, {
      slots,
      score:     updatedScore,
      updatedAt: nowIso,
      ...(clearJudging ? { judging: null } : {}),
    });

    if (done) {
      tx.set(profRef, { status: 'finished', finishedAt: nowIso }, { merge: true });
    }

    return { skippedTaskId: taskId, skippedIndex: target, allDone: done, newScore: updatedScore };
  });

  // Post-transaction side effects (safe to run outside the atomic write):
  // 1. Free the station capacity the team was occupying.
  if (skippedTaskId) {
    await releaseTask(skippedTaskId, teamId);
  }
  // 2. Drop any pending check-ins for this team so they leave the judge queue.
  const pending = await db
    .collection(`${userPath(teamId)}/checkIns`)
    .where('status', '==', 'pending')
    .get();
  if (!pending.empty) {
    const batch = db.batch();
    for (const doc of pending.docs) {
      batch.update(doc.ref, { status: 'skipped', resolvedAt: nowIso });
    }
    await batch.commit();
  }

  // Audit: a skip is a manual operator override of a team's progression.
  const profForLog = await db.doc(`${userPath(teamId)}/profile/team`).get();
  await writeAuditLog({
    teamId,
    teamName:      profForLog.exists ? (profForLog.data() as { name?: string }).name : undefined,
    operatorId:    context.auth!.uid,
    actionType:    'skip',
    previousValue: newScore - awarded,
    newValue:      newScore,
    reason:        `Skipped slot ${skippedIndex} (awarded average ${awarded})`,
  });

  return { success: true, skippedIndex, allDone, awardedScore: awarded, newScore };
});

// â”€â”€â”€ triggerLeaderboardFreeze â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Admin-callable or auto-triggered 30 min before event end.
export const triggerLeaderboardFreeze = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { freeze = true } = data as { freeze?: boolean };
  const nowIso = new Date().toISOString();
  const lbRef = db.doc('artifacts/' + APP_ID + '/public/data/leaderboard/current');
  await lbRef.set(
    { frozen: freeze, ...(freeze ? { frozenAt: nowIso } : {}), updatedAt: nowIso },
    { merge: true },
  );
  return { success: true, frozen: freeze };
});

export const pushFlashMission = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const { title, titleHe, description, descriptionHe, bonusPoints, ttlSeconds } = data as {
    title: string;
    titleHe?: string;
    description: string;
    descriptionHe?: string;
    bonusPoints: number;
    ttlSeconds: number;
  };

  if (!title || typeof title !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'title is required');
  }
  const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : 300;
  const bonus = Number(bonusPoints) >= 0 ? Number(bonusPoints) : 0;

  const nowIso    = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const ref = await db.collection(`artifacts/${APP_ID}/public/data/flashMissions`).add({
    eventId:       APP_ID,
    title,
    titleHe:       titleHe ?? title,
    description:   description ?? '',
    descriptionHe: descriptionHe ?? description ?? '',
    bonusPoints:   bonus,
    expiresAt,
    isActive:      true,
    createdAt:     nowIso,
  });

  return { id: ref.id, expiresAt };
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// JUDGE FLOW (Tracer Bullet Step 3)
// All three callables use the Admin SDK and therefore bypass Firestore rules,
// keeping score/gameState writes server-authoritative per the TECH_SPEC.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ listPendingArrivals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns every team with a 'pending' check-in, enriched with team + task names,
// so the judge can pick who is standing at their station.
export const listPendingArrivals = functions.https.onCall(async (_data, context) => {
  assertJudge(context);

  const snap = await db.collectionGroup('checkIns').where('status', '==', 'pending').get();

  const arrivals = await Promise.all(
    snap.docs.map(async (d) => {
      const ci = d.data() as { teamId: string; taskId: string; taskTitle?: string; timestamp?: string; arrivedAt?: string };

      const [profSnap, taskSnap, gsSnap] = await Promise.all([
        db.doc(`${userPath(ci.teamId)}/profile/team`).get(),
        db.doc(taskPath(ci.taskId)).get(),
        db.doc(`${userPath(ci.teamId)}/gameState/current`).get(),
      ]);

      const prof = profSnap.exists
        ? (profSnap.data() as { name: string; code?: string; memberNames?: string[]; captainPhone?: string })
        : null;

      return {
        checkInId: d.id,
        teamId:    ci.teamId,
        teamName:  prof?.name ?? ci.teamId,
        teamCode:  prof?.code ?? '',
        memberNames:  prof?.memberNames ?? [],
        captainPhone: prof?.captainPhone ?? '',
        taskId:    ci.taskId,
        taskTitle: taskSnap.exists ? (taskSnap.data() as { title: string }).title : (ci.taskTitle ?? ci.taskId),
        timestamp: ci.timestamp ?? null,
        arrivedAt: ci.arrivedAt ?? null,
        teneSelection: gsSnap.exists ? ((gsSnap.data() as { teneSelection?: string[] }).teneSelection ?? []) : [],
        maxDurationMinutes: taskSnap.exists ? ((taskSnap.data() as { maxDurationMinutes?: number }).maxDurationMinutes ?? null) : null,
        stationStatus: taskSnap.exists ? ((taskSnap.data() as { status?: string }).status ?? 'active') : null,
      };
    }),
  );

  return { arrivals };
});

// â”€â”€â”€ checkInArrival â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Judge confirms the team physically arrived. Records arrival time and FREEZES
// the elapsed clock for the active slot on the mobile client (gameState.judging).
// Idempotent: re-running for the same check-in returns the existing freeze.
export const checkInArrival = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const { teamId, checkInId } = data as { teamId: string; checkInId: string };
  if (!teamId || !checkInId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and checkInId are required');
  }

  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
    const ciRef = db.doc(`${userPath(teamId)}/checkIns/${checkInId}`);

    const gsSnap = await tx.get(gsRef);
    if (!gsSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    }

    const gs       = gsSnap.data() as { slots: JudgeSlot[]; judging?: JudgingState | null };
    const existing = gs.judging;

    // Idempotent: already frozen for this check-in.
    if (existing && existing.checkInId === checkInId) {
      return { slotIndex: existing.slotIndex, arrivedAt: existing.arrivedAt, alreadyCheckedIn: true };
    }

    const slotIndex = gs.slots.findIndex((s) => s.status === 'active');
    if (slotIndex < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Team has no active slot to judge');
    }

    const judging: JudgingState = { slotIndex, checkInId, arrivedAt: nowIso };

    tx.update(gsRef, { judging, updatedAt: nowIso });
    tx.update(ciRef, { arrivedAt: nowIso });

    return { slotIndex, arrivedAt: nowIso, alreadyCheckedIn: false };
  });
});

// â”€â”€â”€ finalizeJudgeEvaluation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Atomic write that scores the basket, completes the slot, unfreezes the clock,
// and transitions the team to their next objective.
const COHESION_PENALTY_PER_MEMBER = 100;

export const finalizeJudgeEvaluation = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const {
    teamId,
    checkInId,
    products = [],
    designScore = 0,
    presentationScore = 0,
    missingMembers = 0,
    judgeNote = '',
  } = data as {
    teamId: string;
    checkInId: string;
    products: string[];
    designScore: number;
    presentationScore: number;
    missingMembers?: number;
    judgeNote?: string;
  };

  if (!teamId || !checkInId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and checkInId are required');
  }
  if (!Array.isArray(products)) {
    throw new functions.https.HttpsError('invalid-argument', 'products must be an array of ids');
  }

  // Basket scoring — authoritative, never trust client totals.
  const productScore = computeProductScore(products);
  const design       = clampScore(designScore, MAX_DESIGN_SCORE);
  const presentation = clampScore(presentationScore, MAX_PRESENTATION_SCORE);
  // Team cohesion: severe penalty per missing member (teams must stay together).
  const missing      = Math.max(0, Math.floor(Number(missingMembers) || 0));
  const cohesionPenalty = missing * COHESION_PENALTY_PER_MEMBER;
  const nowIso       = new Date().toISOString();

  const txResult = await db.runTransaction(async (tx) => {
    const gsRef   = db.doc(`${userPath(teamId)}/gameState/current`);
    const ciRef   = db.doc(`${userPath(teamId)}/checkIns/${checkInId}`);
    const profRef = db.doc(`${userPath(teamId)}/profile/team`);

    const [gsSnap, ciSnap] = await Promise.all([tx.get(gsRef), tx.get(ciRef)]);
    if (!gsSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    }

    const gs    = gsSnap.data() as { slots: JudgeSlot[]; score: number; bonusPenalty?: number; judging?: JudgingState | null };
    const slots = gs.slots.map((s) => ({ ...s }));

    // Target = the slot that was checked in, else lowest active slot.
    const target =
      gs.judging?.slotIndex ?? slots.findIndex((s) => s.status === 'active');

    if (target == null || target < 0 || !slots[target]) {
      throw new functions.https.HttpsError('failed-precondition', 'No slot available to finalize');
    }

    // Idempotent: slot already scored (e.g. double submit) â€” return current state.
    if (slots[target].status === 'completed') {
      return { newScore: gs.score, total: slots[target].earnedScore ?? 0, alreadyFinalized: true, releaseTaskId: undefined };
    }

    const ci = ciSnap.exists ? (ciSnap.data() as { taskId?: string; taskTitle?: string }) : {};

    // Sigmoid task score: read task difficulty + timing from Firestore
    let taskScore = 0;
    const resolvedTaskId = slots[target].taskId ?? ci.taskId;
    if (resolvedTaskId) {
      const taskSnap = await tx.get(db.doc(taskPath(resolvedTaskId)));
      if (taskSnap.exists) {
        const task = taskSnap.data() as { difficulty?: number; estimatedMinutes?: number };
        const difficulty    = task.difficulty ?? 5;
        const estimatedMins = task.estimatedMinutes ?? 15;
        const startMs = slots[target].startedAt
          ? new Date(slots[target].startedAt!).getTime()
          : gs.judging?.arrivedAt
            ? new Date(gs.judging.arrivedAt).getTime()
            : Date.now() - estimatedMins * 60_000;
        const actualMins = (Date.now() - startMs) / 60_000;
        taskScore = calculateTaskScore(difficulty, actualMins, estimatedMins);
      }
    }

    const total     = productScore + design + presentation + taskScore;
    const breakdown = {
      products, productScore, designScore: design, presentationScore: presentation,
      taskScore, total, missingMembers: missing, cohesionPenalty,
    };

    slots[target] = {
      ...slots[target],
      status:    'completed',
      taskId:    resolvedTaskId,
      taskTitle: slots[target].taskTitle ?? ci.taskTitle,
      completedAt: nowIso,
      earnedScore: total,
      scoreBreakdown: breakdown,
    };

    // Transition: unlock the next objective and resume its clock.
    unlockNext(slots, target, nowIso);

    const newScore     = (gs.score ?? 0) + total;
    const newPenalty   = (gs.bonusPenalty ?? 0) + cohesionPenalty;
    // A team is done when no slot is still pending — completed or skipped both count as terminal.
    const allDone   = slots.every((s) => s.status === 'completed' || s.status === 'skipped');

    tx.update(gsRef, {
      slots,
      score:        newScore,
      bonusPenalty: newPenalty,
      judging:      null,       // unfreeze the mobile clock
      updatedAt:    nowIso,
    });

    tx.update(ciRef, {
      status:    'approved',
      judgeId:   context.auth!.uid,
      judgeScore: total,
      judgeNote,
      scoreBreakdown: breakdown,
    });

    if (allDone) {
      tx.set(profRef, { status: 'finished', finishedAt: nowIso }, { merge: true });
    }

    return { newScore, total, breakdown, allDone, alreadyFinalized: false, releaseTaskId: resolvedTaskId };
  });

  // Release the station counter this team was occupying so the routing
  // algorithm doesn't keep "ghost" load on a station the team already left.
  if (!txResult.alreadyFinalized && txResult.releaseTaskId) {
    await releaseTask(txResult.releaseTaskId, teamId);
  }

  return txResult;
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// REGISTRATION (Tracer Bullet Step 1/2)
// Server-authoritative team registration. Replaces the client-side batch write so
// the access-code claim + profile + initial gameState are written atomically with
// the Admin SDK (clients cannot write gameState â€” see firestore.rules).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Team-size rules (event constraint): min 4, max 7 participants.
const MIN_TEAM_SIZE = 4;
const MAX_TEAM_SIZE = 7;

// Initial 6-slot layout: 0-2 green (field missions), 3 gate (matchmaking),
// 4 orange (find the Tene), 5 gold (fill the Tene + judging). startedAt must be a
// concrete value (Firestore forbids serverTimestamp() sentinels inside array
// elements) â€” server clock is authoritative.
function buildInitialSlots(nowIso: string): JudgeSlot[] {
  return [
    { index: 0, type: 'green',  status: 'active', startedAt: nowIso, taskId: 'task-green-001', taskTitle: 'Jerusalem Landmarks Photo Hunt' },
    { index: 1, type: 'green',  status: 'locked' },
    { index: 2, type: 'green',  status: 'locked' },
    { index: 3, type: 'gate',   status: 'locked' },
    { index: 4, type: 'orange', status: 'locked' },
    { index: 5, type: 'gold',   status: 'locked' },
  ];
}

export const registerTeam = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required before registering');
  }

  const {
    code,
    teamName,
    captainPhone,
    participants = [],
    waiverAccepted,
  } = data as {
    code: string;
    teamName: string;
    captainPhone: string;
    participants: { name: string; age: string }[];
    waiverAccepted?: boolean;
  };

  // â”€â”€ Validate input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const normalizedCode = (code ?? '').trim().toUpperCase();
  const name           = (teamName ?? '').trim();
  const phone          = (captainPhone ?? '').trim();
  const validParticipants = (participants ?? []).filter((p) => p && p.name && p.name.trim());

  if (!normalizedCode) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required');
  }
  if (!name) {
    throw new functions.https.HttpsError('invalid-argument', 'Team name is required');
  }
  if (!phone) {
    throw new functions.https.HttpsError('invalid-argument', "Captain's phone number is required");
  }
  if (validParticipants.length < MIN_TEAM_SIZE) {
    throw new functions.https.HttpsError('invalid-argument', `A team needs at least ${MIN_TEAM_SIZE} participants`);
  }
  if (validParticipants.length > MAX_TEAM_SIZE) {
    throw new functions.https.HttpsError('invalid-argument', `A team can have at most ${MAX_TEAM_SIZE} participants`);
  }
  if (!waiverAccepted) {
    throw new functions.https.HttpsError('failed-precondition', 'The liability waiver must be accepted');
  }

  const uid         = context.auth.uid;
  const memberNames = validParticipants.map((p) => p.name.trim());
  const nowIso      = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const codeRef    = db.doc(`artifacts/${APP_ID}/accessCodes/${normalizedCode}`);
    const profileRef = db.doc(`${userPath(uid)}/profile/team`);
    const gsRef      = db.doc(`${userPath(uid)}/gameState/current`);

    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Invalid access code');
    }

    const cd = codeSnap.data() as { claimed?: boolean; teamId?: string | null };

    // Idempotent: this user already claimed this code â€” return success on retry.
    if (cd.claimed && cd.teamId && cd.teamId === uid) {
      return { teamId: uid, teamName: name, alreadyRegistered: true };
    }
    // Claimed by someone else â€” block.
    if (cd.claimed && cd.teamId && cd.teamId !== uid) {
      throw new functions.https.HttpsError('already-exists', 'This access code has already been claimed');
    }

    tx.set(profileRef, {
      id:             uid,
      name,
      code:           normalizedCode,
      captainPhone:   phone,
      participants:   validParticipants,
      memberNames,
      waiverAccepted: true,
      status:         'registered',
      createdAt:      nowIso,
    });

    tx.set(gsRef, {
      teamId:       uid,
      slots:        buildInitialSlots(nowIso),
      score:        0,
      bonusPenalty: 0,
      updatedAt:    nowIso,
    });

    tx.update(codeRef, { claimed: true, teamId: uid });

    return { teamId: uid, teamName: name, alreadyRegistered: false };
  });
});

// â”€â”€â”€ joinTeam â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A SECOND device joining an already-claimed access code. Anonymous auth gives
// each device a distinct uid, so the second phone cannot read the original team's
// owner-scoped data. We mint a custom token for the original team's uid so the
// second device signs in AS the same team (same account, two devices) â€” after
// which onSnapshot + Firestore rules work transparently.
export const joinTeam = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required before joining');
  }
  const normalizedCode = ((data as { code?: string })?.code ?? '').trim().toUpperCase();
  if (!normalizedCode) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required');
  }

  const codeSnap = await db.doc(`artifacts/${APP_ID}/accessCodes/${normalizedCode}`).get();
  if (!codeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Invalid access code');
  }
  const cd = codeSnap.data() as { claimed?: boolean; teamId?: string | null };
  if (!cd.claimed || !cd.teamId) {
    throw new functions.https.HttpsError('failed-precondition', 'This code has not been registered yet');
  }

  const teamId   = cd.teamId;
  const profSnap = await db.doc(`${userPath(teamId)}/profile/team`).get();
  const prof     = profSnap.exists
    ? (profSnap.data() as { name?: string; memberNames?: string[] })
    : {};

  const token = await admin.auth().createCustomToken(teamId);
  return {
    token,
    teamId,
    teamName:    prof.name ?? '',
    memberNames: prof.memberNames ?? [],
  };
});


// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — GATE SPRINT · BASKET ZONES · CRAFTING · MATCHMAKING · LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════

const SLOT_COUNT         = 6;
const GATE_SLOT_INDEX    = 3;
const BASKET_SLOT_INDEX  = 4;

/**
 * Marks the gate slot (4) as completed and activates the basket slot (5).
 * Called server-side by resolveMatch and bypassMatchmaking.
 */
async function completeGateSlot(teamId: string, nowIso: string): Promise<void> {
  const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gsRef);
    if (!snap.exists) return;
    const gs    = snap.data() as { slots: JudgeSlot[] };
    const slots = gs.slots.map((s) => ({ ...s }));
    if (slots[GATE_SLOT_INDEX]?.status === 'active') {
      slots[GATE_SLOT_INDEX] = { ...slots[GATE_SLOT_INDEX], status: 'completed', completedAt: nowIso };
      unlockNext(slots, GATE_SLOT_INDEX, nowIso);
      tx.update(gsRef, { slots, updatedAt: nowIso });
    }
  });
}

/**
 * Marks the basket (orange) slot as completed and activates the crafting (gold) slot.
 * Called when the team scans the basket QR (startCraftingTimer).
 */
async function completeBasketSlot(teamId: string, nowIso: string, tx: FirebaseFirestore.Transaction): Promise<void> {
  const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
  const snap  = await tx.get(gsRef);
  if (!snap.exists) return;
  const gs    = snap.data() as { slots: JudgeSlot[] };
  const slots = gs.slots.map((s) => ({ ...s }));
  if (slots[BASKET_SLOT_INDEX]?.status === 'active') {
    slots[BASKET_SLOT_INDEX] = { ...slots[BASKET_SLOT_INDEX], status: 'completed', completedAt: nowIso };
    unlockNext(slots, BASKET_SLOT_INDEX, nowIso);
    tx.update(gsRef, { slots, updatedAt: nowIso });
  }
}

// Static basket zone definitions (fallback when Firestore zones are not seeded).
const STATIC_BASKET_ZONES = [
  {
    id: 'zone-a',
    name: 'Olive Press Area',
    nameHe: 'אזור בית הבד',
    riddle: 'Where ancient stones press the golden fruit — find your basket near the millstone.',
    riddleHe: 'בין אבני הקדם שסוחטות את הפרי הזהוב — מצאו את הסל ליד אבן הריחיים.',
    coordinates: { lat: 31.7683, lng: 35.2137 },
    currentTeamCount: 0,
    maxTeams: 3,
  },
  {
    id: 'zone-b',
    name: 'Fig Tree Grove',
    nameHe: 'חורשת התאנים',
    riddle: 'Under the shade of the fig tree, where the prophet once rested — your basket awaits.',
    riddleHe: 'בצל תאנה, שם הנביא נח — מחכה לכם הסל שלכם.',
    coordinates: { lat: 31.769, lng: 35.2145 },
    currentTeamCount: 0,
    maxTeams: 3,
  },
  {
    id: 'zone-c',
    name: 'Vineyard Terrace',
    nameHe: 'מדרגות הכרם',
    riddle: 'Climb the stone terraces where grapes once grew in abundance — your treasure is here.',
    riddleHe: 'טפסו במדרגות האבן שם גדלו ענבים בשפע — המטמון שלכם חבוי כאן.',
    coordinates: { lat: 31.7676, lng: 35.213 },
    currentTeamCount: 0,
    maxTeams: 3,
  },
];

const TARGET_TRANSIT_MINUTES = 20;
const CRAFTING_DURATION_SECONDS = 20 * 60;
const SPRINT_BUDGET_SECONDS = 90;
const MATCH_WIN_BONUS = 150;

// ─── checkInGate ──────────────────────────────────────────────────────────────
// Called when a team scans the Bible Park gate QR.
// Records gateArrivedAt and applies an exponential transit penalty if late.
export const checkInGate = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const teamId = context.auth.uid;
  const nowIso = new Date().toISOString();
  const nowMs  = Date.now();

  const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
  return db.runTransaction(async (tx) => {
    const gsSnap = await tx.get(gsRef);
    if (!gsSnap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found');
    const gs = gsSnap.data() as { slots: JudgeSlot[]; bonusPenalty?: number; gateArrivedAt?: string };

    if (gs.gateArrivedAt) {
      return { alreadyCheckedIn: true, gateArrivedAt: gs.gateArrivedAt, penaltyPoints: 0 };
    }

    // Transit clock starts when slot 4 (orange) was activated.
    const orangeStartedAt = gs.slots[4]?.startedAt;
    const transitStartMs  = orangeStartedAt ? new Date(orangeStartedAt).getTime() : nowMs;
    const actualMins      = (nowMs - transitStartMs) / 60_000;
    const penaltyPoints   = computeTransitPenalty(actualMins, TARGET_TRANSIT_MINUTES);

    tx.update(gsRef, {
      gateArrivedAt: nowIso,
      bonusPenalty:  (gs.bonusPenalty ?? 0) + penaltyPoints,
      updatedAt:     nowIso,
    });
    tx.set(db.doc(`${userPath(teamId)}/profile/team`), { status: 'park' }, { merge: true });

    return {
      alreadyCheckedIn: false,
      gateArrivedAt:    nowIso,
      penaltyPoints,
      transitMinutes:   Math.round(actualMins),
    };
  });
});

// ─── getBasketZone ────────────────────────────────────────────────────────────
// Returns the least-crowded basket zone with its riddle. Does not claim the spot.
export const getBasketZone = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const zonesSnap = await db
    .collection(`artifacts/${APP_ID}/public/data/basketZones`)
    .get();

  const zones = zonesSnap.empty
    ? STATIC_BASKET_ZONES
    : (zonesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as typeof STATIC_BASKET_ZONES);

  const best = zones.reduce((prev, cur) => {
    const prevLoad = prev.currentTeamCount / prev.maxTeams;
    const curLoad  = cur.currentTeamCount  / cur.maxTeams;
    return curLoad < prevLoad ? cur : prev;
  });

  return {
    zoneId:      best.id,
    zoneName:    best.name,
    zoneNameHe:  best.nameHe,
    riddle:      best.riddle,
    riddleHe:    best.riddleHe,
    coordinates: best.coordinates,
    currentLoad: best.currentTeamCount,
    maxTeams:    best.maxTeams,
  };
});

// ─── startCraftingTimer ───────────────────────────────────────────────────────
// Called when the team scans the basket QR at their zone.
// Stamps craftingStartedAt and starts the 20-minute countdown on mobile.
export const startCraftingTimer = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const teamId  = context.auth.uid;
  const { zoneId } = data as { zoneId?: string };
  const nowIso  = new Date().toISOString();

  const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
  const result = await db.runTransaction(async (tx) => {
    const gsSnap = await tx.get(gsRef);
    if (!gsSnap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found');
    const gs = gsSnap.data() as { craftingStartedAt?: string; matchStatus?: string; slots: JudgeSlot[] };

    if (gs.craftingStartedAt) {
      const deadlineAt = new Date(new Date(gs.craftingStartedAt).getTime() + CRAFTING_DURATION_SECONDS * 1000).toISOString();
      return { alreadyStarted: true, craftingStartedAt: gs.craftingStartedAt, deadlineAt };
    }

    // Complete the basket (orange) slot and activate the crafting (gold) slot.
    const slots = gs.slots.map((s) => ({ ...s }));
    if (slots[BASKET_SLOT_INDEX]?.status === 'active') {
      slots[BASKET_SLOT_INDEX] = { ...slots[BASKET_SLOT_INDEX], status: 'completed', completedAt: nowIso };
      unlockNext(slots, BASKET_SLOT_INDEX, nowIso);
    }

    tx.update(gsRef, {
      slots,
      craftingStartedAt: nowIso,
      matchStatus: gs.matchStatus === 'waiting' ? 'bypassed' : (gs.matchStatus ?? 'bypassed'),
      updatedAt: nowIso,
    });
    tx.set(db.doc(`${userPath(teamId)}/profile/team`), { status: 'crafting' }, { merge: true });

    const deadlineAt      = new Date(new Date(nowIso).getTime() + CRAFTING_DURATION_SECONDS * 1000).toISOString();
    const sprintDeadlineAt = new Date(new Date(deadlineAt).getTime() + SPRINT_BUDGET_SECONDS * 1000).toISOString();
    return { alreadyStarted: false, craftingStartedAt: nowIso, deadlineAt, sprintDeadlineAt };
  });

  // Best-effort zone counter increment (outside transaction).
  if (zoneId) {
    db.doc(`artifacts/${APP_ID}/public/data/basketZones/${zoneId}`)
      .update({ currentTeamCount: admin.firestore.FieldValue.increment(1) })
      .catch(() => undefined);
  }

  return result;
});

// ─── joinMatchQueue ───────────────────────────────────────────────────────────
// Team enters the matchmaking queue at the gate.
// Immediately matched if an opponent within 300 pts is already waiting.
export const joinMatchQueue = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const teamId = context.auth.uid;
  const nowIso = new Date().toISOString();

  const [gsSnap, profSnap] = await Promise.all([
    db.doc(`${userPath(teamId)}/gameState/current`).get(),
    db.doc(`${userPath(teamId)}/profile/team`).get(),
  ]);
  if (!gsSnap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found');

  const gs        = gsSnap.data() as { score?: number; matchStatus?: string };
  const teamScore = gs.score ?? 0;
  const teamName  = (profSnap.data() as { name?: string })?.name ?? teamId;

  const queueColl  = db.collection(`artifacts/${APP_ID}/public/data/matchQueue`);
  const matchColl  = db.collection(`artifacts/${APP_ID}/public/data/matches`);

  // Idempotent: if the team is already in an unresolved match, don't create a
  // second one (guards against rapid double-taps on the join button).
  if (gs.matchStatus === 'matched') {
    const ownQueue = (await queueColl.doc(teamId).get()).data() as { matchId?: string } | undefined;
    return { matched: true, matchId: ownQueue?.matchId, alreadyInMatch: true };
  }

  const waitingSnap = await queueColl.where('status', '==', 'waiting').get();
  const opponent = waitingSnap.docs
    .filter((d) => d.id !== teamId)
    .find((d) => Math.abs(((d.data() as { score: number }).score) - teamScore) <= 300);

  if (opponent) {
    const oppData  = opponent.data() as { teamName: string; score: number };
    const matchRef = matchColl.doc();
    const batch    = db.batch();
    batch.set(matchRef, {
      teamAId: teamId, teamAName: teamName,
      teamBId: opponent.id, teamBName: oppData.teamName,
      scoreA: teamScore, scoreB: oppData.score,
      createdAt: nowIso, penaltySeconds: SPRINT_BUDGET_SECONDS,
    });
    batch.set(queueColl.doc(teamId),   { teamId, teamName, score: teamScore, joinedAt: nowIso, status: 'matched', matchId: matchRef.id });
    batch.update(opponent.ref, { status: 'matched', matchId: matchRef.id });
    batch.set(db.doc(`${userPath(teamId)}/gameState/current`),   { matchStatus: 'matched', updatedAt: nowIso }, { merge: true });
    batch.set(db.doc(`${userPath(opponent.id)}/gameState/current`), { matchStatus: 'matched', updatedAt: nowIso }, { merge: true });
    await batch.commit();
    return { matched: true, matchId: matchRef.id, opponentName: oppData.teamName, opponentScore: oppData.score };
  }

  await queueColl.doc(teamId).set({ teamId, teamName, score: teamScore, joinedAt: nowIso, status: 'waiting' });
  await db.doc(`${userPath(teamId)}/gameState/current`).update({ matchStatus: 'waiting', updatedAt: nowIso });
  return { matched: false, status: 'waiting' };
});

// ─── resolveMatch ─────────────────────────────────────────────────────────────
// Judge records the 1v1 outcome. Only the WINNER advances past the gate (+150 pts
// and the gate slot completes → find-the-Tene unlocks). The LOSER is sent back to
// the matchmaking queue (status 'waiting') to be paired again until they win.
export const resolveMatch = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { matchId, winnerId } = data as { matchId: string; winnerId: string };
  if (!matchId || !winnerId) {
    throw new functions.https.HttpsError('invalid-argument', 'matchId and winnerId are required');
  }
  const nowIso = new Date().toISOString();

  const matchRef  = db.doc(`artifacts/${APP_ID}/public/data/matches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found');

  const match = matchSnap.data() as { teamAId: string; teamBId: string; resolvedAt?: string };
  if (match.resolvedAt) return { alreadyResolved: true };

  const loserId   = match.teamAId === winnerId ? match.teamBId : match.teamAId;
  const winnerRef = db.doc(`${userPath(winnerId)}/gameState/current`);
  const winnerGs  = (await winnerRef.get()).data() as { score?: number } | undefined;

  const [loserName] = await Promise.all([
    db.doc(`${userPath(loserId)}/profile/team`).get().then((s) => (s.exists ? (s.data() as { name?: string }).name ?? loserId : loserId)),
  ]);
  const loserScore = ((await db.doc(`${userPath(loserId)}/gameState/current`).get()).data() as { score?: number } | undefined)?.score ?? 0;

  const queueColl = db.collection(`artifacts/${APP_ID}/public/data/matchQueue`);

  const batch = db.batch();
  batch.update(matchRef, { winnerId, loserId, resolvedAt: nowIso });
  // Winner: bonus + advance.
  batch.update(winnerRef, {
    score: (winnerGs?.score ?? 0) + MATCH_WIN_BONUS,
    matchStatus: 'won',
    updatedAt: nowIso,
  });
  batch.set(queueColl.doc(winnerId), { status: 'resolved' }, { merge: true });
  // Loser: mark 'lost' (for the mobile "waiting for a new opponent" UI) and
  // re-enter the queue so they can be matched again.
  batch.set(db.doc(`${userPath(loserId)}/gameState/current`), { matchStatus: 'lost', updatedAt: nowIso }, { merge: true });
  batch.set(queueColl.doc(loserId), { teamId: loserId, teamName: loserName, score: loserScore, joinedAt: nowIso, status: 'waiting', matchId: null }, { merge: true });
  await batch.commit();

  // Only the winner clears the gate → activates find-the-Tene (orange slot 4).
  await completeGateSlot(winnerId, nowIso);

  return { success: true, winnerId, loserId, bonusAwarded: MATCH_WIN_BONUS };
});

// ─── bypassMatchmaking ────────────────────────────────────────────────────────
// Team (or judge) skips the matchmaking step. Completes gate slot immediately.
// Deprecated: teams MUST win a matchmaking duel to advance past the gate — there
// is no skip path. Retained only so existing clients fail loudly instead of
// silently calling a missing function.
export const bypassMatchmaking = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Matchmaking cannot be bypassed — you must win a duel to advance.',
  );
});

// ─── finalizeLeaderboard ──────────────────────────────────────────────────────
// Admin-triggered at event end. Reads all teams, applies Z-Score normalization,
// adds completion bonus, and writes the canonical leaderboard doc.
export const finalizeLeaderboard = functions.https.onCall(async (_data, context) => {
  assertJudge(context);
  const nowIso = new Date().toISOString();

  const [profileSnap, gsSnap] = await Promise.all([
    db.collectionGroup('profile').get(),
    db.collectionGroup('gameState').get(),
  ]);

  // Build gameState map: userId → gs data.
  const gsMap: Record<string, {
    score: number;
    bonusPenalty: number;
    slots: JudgeSlot[];
    craftingStartedAt?: string;
    startedAt?: string;
  }> = {};
  for (const doc of gsSnap.docs) {
    const parts  = doc.ref.path.split('/');
    const userId = parts[parts.indexOf('users') + 1];
    const gs     = doc.data() as typeof gsMap[string];
    gsMap[userId] = {
      score:             gs.score ?? 0,
      bonusPenalty:      gs.bonusPenalty ?? 0,
      slots:             gs.slots ?? [],
      craftingStartedAt: gs.craftingStartedAt,
    };
  }

  // Build profile map.
  const profMap: Record<string, { name: string; startedAt?: string; finishedAt?: string }> = {};
  for (const doc of profileSnap.docs) {
    if (doc.id !== 'team') continue;
    const parts  = doc.ref.path.split('/');
    const userId = parts[parts.indexOf('users') + 1];
    profMap[userId] = doc.data() as typeof profMap[string];
  }

  interface TeamResult {
    teamId: string;
    teamName: string;
    rawScore: number;
    finalScore: number;
    completedSlots: number;
    finishedAt?: string;
    durationMinutes?: number;
    metrics: ReturnType<typeof computeTieMetrics>;
  }

  const results: TeamResult[] = Object.keys(profMap).map((teamId) => {
    const prof = profMap[teamId];
    const gs   = gsMap[teamId];
    if (!gs) return null;
    const completedSlots = gs.slots.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    const allDone        = completedSlots === SLOT_COUNT;
    let durationMinutes: number | undefined;
    if (allDone && prof.startedAt) {
      const endProxy  = gs.craftingStartedAt ?? nowIso;
      durationMinutes = (new Date(endProxy).getTime() - new Date(prof.startedAt).getTime()) / 60_000;
    }
    const bonus    = allDone ? 500 : 0;
    const rawScore = Math.max(0, gs.score + bonus - (gs.bonusPenalty ?? 0));
    const metrics  = computeTieMetrics(gs.slots, gs.bonusPenalty ?? 0);
    return { teamId, teamName: prof.name, rawScore, finalScore: rawScore, completedSlots, finishedAt: prof.finishedAt, durationMinutes, metrics };
  }).filter(Boolean) as TeamResult[];

  // Apply Z-Score to finished teams.
  const finishedDurations = results.filter((r) => r.durationMinutes != null).map((r) => r.durationMinutes as number);
  for (const r of results) {
    if (r.durationMinutes != null) {
      r.finalScore = applyZScoreBonus(r.rawScore, r.durationMinutes, finishedDurations);
    }
  }

  // Sort: finished teams first; then finalScore desc with strict tie-breakers
  // (penalties → combined green-task time → transit time) via compareForRanking.
  results.sort((a, b) => {
    const aF = a.durationMinutes != null ? 1 : 0;
    const bF = b.durationMinutes != null ? 1 : 0;
    if (aF !== bF) return bF - aF;
    return compareForRanking(
      { finalScore: a.finalScore, metrics: a.metrics },
      { finalScore: b.finalScore, metrics: b.metrics },
    );
  });

  const rankings = results.map((r, i) => ({
    rank:            i + 1,
    teamId:          r.teamId,
    teamName:        r.teamName,
    score:           r.finalScore,
    rawScore:        r.rawScore,
    completedSlots:  r.completedSlots,
    finishedAt:      r.finishedAt ?? null,
    durationMinutes: r.durationMinutes ?? null,
    tieBreak:        { penalties: r.metrics.penalties, fieldTaskMs: r.metrics.fieldTaskMs, transitMs: r.metrics.transitMs },
  }));

  const lbRef = db.doc(`artifacts/${APP_ID}/public/data/leaderboard/current`);
  await lbRef.set({
    eventId:     APP_ID,
    rankings,
    frozen:      false,
    finalizedAt: nowIso,
    updatedAt:   nowIso,
  });

  return { success: true, count: rankings.length, rankings };
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOS / ADMIN ALERTS (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── triggerSOS ("Call staff") ────────────────────────────────────────────────
// Any authenticated team can summon staff. The team identity is taken from the
// auth token (never trusted from the client). `kind` distinguishes a real
// emergency (loud alarm in the admin UIs) from a planned/technical issue (soft
// chime). The alert carries everything staff need to respond: team name, member
// roster, captain phone, and GPS when available.
export const triggerSOS = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const uid = context.auth.uid;
  const { lat, lng, message, kind } = (data ?? {}) as {
    lat?: number; lng?: number; message?: string; kind?: 'emergency' | 'technical';
  };
  const alertKind: 'emergency' | 'technical' = kind === 'technical' ? 'technical' : 'emergency';

  const profSnap = await db.doc(`${userPath(uid)}/profile/team`).get();
  const prof = profSnap.exists
    ? (profSnap.data() as { name?: string; memberNames?: string[]; captainPhone?: string })
    : null;
  const teamName = prof?.name ?? uid;

  const nowIso = new Date().toISOString();
  const defaultMsg = alertKind === 'emergency'
    ? `🆘 ${teamName} — emergency`
    : `🛠️ ${teamName} — needs assistance`;
  const alert: Record<string, unknown> = {
    type:         'sos',
    kind:         alertKind,
    teamId:       uid,
    teamName,
    memberNames:  prof?.memberNames ?? [],
    captainPhone: prof?.captainPhone ?? '',
    message:      (message ?? '').trim() || defaultMsg,
    timestamp:    nowIso,
    acknowledged: false,
  };
  if (typeof lat === 'number' && typeof lng === 'number') {
    alert.location = { lat, lng };
  }

  const ref = await db.collection(`artifacts/${APP_ID}/public/data/adminAlerts`).add(alert);
  return { id: ref.id, timestamp: nowIso };
});

// ─── acknowledgeAlert ─────────────────────────────────────────────────────────
// Judge/admin marks an alert as handled so it drops off the live list.
export const acknowledgeAlert = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { alertId } = (data ?? {}) as { alertId?: string };
  if (!alertId) {
    throw new functions.https.HttpsError('invalid-argument', 'alertId is required');
  }
  await db.doc(`artifacts/${APP_ID}/public/data/adminAlerts/${alertId}`).update({
    acknowledged:   true,
    acknowledgedAt: new Date().toISOString(),
  });
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLUE HINTS (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════════

const CLUE_HINT_PENALTY = 50;

// ─── requestClueHint ──────────────────────────────────────────────────────────
// A team trades points for a hint on their active task. Each hint adds a fixed
// penalty to gameState.bonusPenalty (server-authoritative — deducted from the
// final score). Runs in a transaction so rapid double-taps each count cleanly.
export const requestClueHint = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const uid   = context.auth.uid;
  const gsRef = db.doc(`${userPath(uid)}/gameState/current`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(gsRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'No active game');
    }
    const gs = snap.data() as { bonusPenalty?: number };
    const newPenalty = (gs.bonusPenalty ?? 0) + CLUE_HINT_PENALTY;
    tx.update(gsRef, { bonusPenalty: newPenalty, updatedAt: new Date().toISOString() });
    return { bonusPenalty: newPenalty, penaltyApplied: CLUE_HINT_PENALTY };
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TENE SELECTION (crafting menu — Slot 5)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── saveTeneSelection ────────────────────────────────────────────────────────
// During the 20-minute crafting window the team picks which Tene products they
// prepared. The selection is stored server-authoritatively on gameState so it
// pre-fills the judge's checklist (the judge still verifies against the real
// basket). Product ids are validated against the catalog; unknown ids dropped.
export const saveTeneSelection = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const uid = context.auth.uid;
  const raw = (data as { productIds?: unknown })?.productIds;
  if (!Array.isArray(raw)) {
    throw new functions.https.HttpsError('invalid-argument', 'productIds must be an array');
  }
  const valid = new Set(TENE_PRODUCTS.map((p) => p.id));
  const productIds = Array.from(new Set(raw.filter((id): id is string => typeof id === 'string' && valid.has(id))));

  await db.doc(`${userPath(uid)}/gameState/current`).set(
    { teneSelection: productIds, updatedAt: new Date().toISOString() },
    { merge: true },
  );
  return { teneSelection: productIds };
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCED OPERATIONAL FEATURES (Phase 3) — station mgmt, broadcast, audit, geo
// ═══════════════════════════════════════════════════════════════════════════════

// ─── getStationTeams ──────────────────────────────────────────────────────────
// Station operator console: list the teams currently AT this station (their active
// slot's taskId === this task). Returns each team's roster, captain phone, member
// count and how long they've been on the task — everything the operator needs to
// judge the mission and decide whether all members are present.
export const getStationTeams = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { taskId } = data as { taskId?: string };
  if (!taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'taskId is required');
  }

  const [gsSnap, taskSnap] = await Promise.all([
    db.collectionGroup('gameState').get(),
    db.doc(taskPath(taskId)).get(),
  ]);

  const teams = await Promise.all(
    gsSnap.docs.map(async (doc) => {
      const parts  = doc.ref.path.split('/');
      const userId = parts[parts.indexOf('users') + 1];
      const gs     = doc.data() as { slots?: JudgeSlot[] };
      const active = (gs.slots ?? []).find((s) => s.status === 'active');
      if (!active || active.taskId !== taskId) return null;

      const prof = (await db.doc(`${userPath(userId)}/profile/team`).get()).data() as
        | { name?: string; code?: string; memberNames?: string[]; captainPhone?: string }
        | undefined;
      return {
        teamId:       userId,
        teamName:     prof?.name ?? userId,
        teamCode:     prof?.code ?? '',
        memberNames:  prof?.memberNames ?? [],
        memberCount:  prof?.memberNames?.length ?? 0,
        captainPhone: prof?.captainPhone ?? '',
        slotIndex:    active.index,
        startedAt:    active.startedAt ?? null,
      };
    }),
  );

  return {
    taskId,
    taskTitle: taskSnap.exists ? (taskSnap.data() as { title?: string }).title ?? taskId : taskId,
    teams: teams.filter(Boolean),
  };
});

// ─── stationReleaseTeam ───────────────────────────────────────────────────────
// Station operator's verdict: the team passed (or not) this station's mission.
// Completes the active slot with the sigmoid task score, applies a cohesion
// penalty for any missing members, advances the team to their next objective,
// and frees the station counter. A non-pass marks the slot 'skipped' with no
// award (the team still moves on so the event keeps flowing).
const STATION_COHESION_PENALTY = 100;
export const stationReleaseTeam = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { teamId, taskId, missingMembers = 0, passed = true } = data as {
    teamId?: string; taskId?: string; missingMembers?: number; passed?: boolean;
  };
  if (!teamId || !taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and taskId are required');
  }
  const missing  = Math.max(0, Math.floor(Number(missingMembers) || 0));
  const cohesion = missing * STATION_COHESION_PENALTY;
  const nowIso   = new Date().toISOString();

  // Pre-read task difficulty/timing target (outside the tx).
  const taskSnap = await db.doc(taskPath(taskId)).get();
  const task = taskSnap.exists
    ? (taskSnap.data() as { difficulty?: number; estimatedMinutes?: number })
    : {};

  const result = await db.runTransaction(async (tx) => {
    const gsRef   = db.doc(`${userPath(teamId)}/gameState/current`);
    const profRef = db.doc(`${userPath(teamId)}/profile/team`);
    const gsSnap  = await tx.get(gsRef);
    if (!gsSnap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found for team');

    const gs    = gsSnap.data() as { slots: JudgeSlot[]; score?: number; bonusPenalty?: number; judging?: JudgingState | null };
    const slots = gs.slots.map((s) => ({ ...s }));
    const target = slots.findIndex((s) => s.status === 'active' && s.taskId === taskId);
    if (target < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'This team is not active at your station');
    }

    let taskScore = 0;
    if (passed) {
      const difficulty = task.difficulty ?? 5;
      const estMins    = task.estimatedMinutes ?? 15;
      const startMs    = slots[target].startedAt ? new Date(slots[target].startedAt!).getTime() : Date.now() - estMins * 60_000;
      const actualMins = (Date.now() - startMs) / 60_000;
      taskScore = calculateTaskScore(difficulty, actualMins, estMins);
    }

    slots[target] = {
      ...slots[target],
      status:      passed ? 'completed' : 'skipped',
      completedAt: nowIso,
      earnedScore: taskScore,
      scoreBreakdown: {
        products: [], productScore: 0, designScore: 0, presentationScore: 0,
        taskScore, total: taskScore, missingMembers: missing, cohesionPenalty: cohesion,
      },
    };
    unlockNext(slots, target, nowIso);

    const newScore   = (gs.score ?? 0) + taskScore;
    const newPenalty = (gs.bonusPenalty ?? 0) + cohesion;
    const allDone    = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    const clearJudging = gs.judging?.slotIndex === target;

    tx.update(gsRef, {
      slots,
      score:        newScore,
      bonusPenalty: newPenalty,
      updatedAt:    nowIso,
      ...(clearJudging ? { judging: null } : {}),
    });
    if (allDone) tx.set(profRef, { status: 'finished', finishedAt: nowIso }, { merge: true });

    return { taskScore, cohesion, newScore, allDone };
  });

  // Free the station counter the team was occupying.
  await releaseTask(taskId, teamId);

  return { success: true, passed, ...result };
});

// ─── stationCallHelp ──────────────────────────────────────────────────────────
// A station operator summons roaming staff (e.g. supplies, a dispute, a break).
// Writes a 'technical' admin alert tagged with the station so it surfaces in the
// shared alerts feed (soft chime, not the emergency siren).
export const stationCallHelp = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { taskId, station, message } = data as { taskId?: string; station?: string; message?: string };
  const nowIso = new Date().toISOString();
  const label  = station ? `Station ${station}` : (taskId ?? 'A station');
  await db.collection(`artifacts/${APP_ID}/public/data/adminAlerts`).add({
    type:         'station',
    kind:         'technical',
    teamId:       '',
    teamName:     label,
    memberNames:  [],
    captainPhone: '',
    message:      (message ?? '').trim() || `🛠️ ${label} needs assistance`,
    timestamp:    nowIso,
    acknowledged: false,
  });
  return { success: true };
});

// ─── setStationStatus ─────────────────────────────────────────────────────────
// Event Manager toggles a station 'active' | 'paused' | 'closed'. Paused/closed
// stations are excluded from routing (see routing/assignNextTask.ts).
export const setStationStatus = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { taskId, status } = data as { taskId?: string; status?: 'active' | 'paused' | 'closed' };
  if (!taskId || !['active', 'paused', 'closed'].includes(status ?? '')) {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and a valid status are required');
  }
  await db.doc(taskPath(taskId)).update({ status });
  return { success: true, taskId, status };
});

// ─── evacuateStation ──────────────────────────────────────────────────────────
// Force-majeure: a station closes while teams are on it. Releases every team whose
// active slot is this task back to the routing pool WITHOUT penalty: clears the
// slot's task assignment (restamping the clock), decrements the station counter,
// flags gameState.evacuatedFrom so the mobile can explain the change, and audits it.
export const evacuateStation = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { taskId } = data as { taskId?: string };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId is required');

  const nowIso = new Date().toISOString();
  const taskSnap = await db.doc(taskPath(taskId)).get();
  const stationTitle = taskSnap.exists ? ((taskSnap.data() as { title?: string }).title ?? taskId) : taskId;

  // Find every team whose active slot is this station.
  const gsSnap = await db.collectionGroup('gameState').get();
  const evacuated: string[] = [];

  for (const d of gsSnap.docs) {
    const gs = d.data() as { slots?: JudgeSlot[] };
    const slots = (gs.slots ?? []).map((s) => ({ ...s }));
    const idx = slots.findIndex((s) => s.status === 'active' && s.taskId === taskId);
    if (idx < 0) continue;

    const parts = d.ref.path.split('/');
    const teamId = parts[parts.indexOf('users') + 1];

    // Clear the assignment but keep the slot active (back to "assigning").
    slots[idx] = { ...slots[idx], taskId: undefined, taskTitle: undefined, startedAt: nowIso };
    await d.ref.update({ slots, evacuatedFrom: stationTitle, updatedAt: nowIso });

    await releaseTask(taskId, teamId);

    const profSnap = await db.doc(`${userPath(teamId)}/profile/team`).get();
    await writeAuditLog({
      teamId,
      teamName:   profSnap.exists ? (profSnap.data() as { name?: string }).name : undefined,
      operatorId: context.auth!.uid,
      actionType: 'evacuation',
      previousValue: taskId,
      newValue:   null,
      reason:     `Evacuated from "${stationTitle}"`,
    });
    evacuated.push(teamId);
  }

  return { success: true, taskId, evacuatedCount: evacuated.length, evacuated };
});

// ─── pushAnnouncement / deactivateAnnouncement ────────────────────────────────
// Global administrative broadcast (distinct from gamified flash missions). Persists
// until the admin deactivates it; teams dismiss locally per-device.
export const pushAnnouncement = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { message, messageHe, level } = data as {
    message?: string; messageHe?: string; level?: 'info' | 'warning' | 'critical';
  };
  if (!message || typeof message !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'message is required');
  }
  const lvl = ['info', 'warning', 'critical'].includes(level ?? '') ? level : 'info';
  const ref = await db.collection(`artifacts/${APP_ID}/public/data/announcements`).add({
    message,
    messageHe:  messageHe ?? message,
    level:      lvl,
    active:     true,
    createdAt:  new Date().toISOString(),
    operatorId: context.auth!.uid,
  });
  return { id: ref.id };
});

export const deactivateAnnouncement = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { id } = data as { id?: string };
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id is required');
  await db.doc(`artifacts/${APP_ID}/public/data/announcements/${id}`).update({ active: false });
  return { success: true };
});

// ─── adjustTeamScore ──────────────────────────────────────────────────────────
// Event Manager applies a manual fine (delta, usually negative) or a hard score
// override (setTo). Either way the previous + new values are audit-logged.
export const adjustTeamScore = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { teamId, kind, delta, setTo, reason } = data as {
    teamId?: string;
    kind?: 'fine' | 'score_override';
    delta?: number;
    setTo?: number;
    reason?: string;
  };
  if (!teamId || (kind !== 'fine' && kind !== 'score_override')) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and kind (fine|score_override) are required');
  }

  const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(gsRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    const gs = snap.data() as { score?: number };
    const prev = gs.score ?? 0;
    let next: number;
    if (kind === 'score_override') {
      next = Math.max(0, Math.round(Number(setTo) || 0));
    } else {
      next = Math.max(0, prev + Math.round(Number(delta) || 0));
    }
    tx.update(gsRef, { score: next, updatedAt: new Date().toISOString() });
    return { prev, next };
  });

  const profSnap = await db.doc(`${userPath(teamId)}/profile/team`).get();
  await writeAuditLog({
    teamId,
    teamName:      profSnap.exists ? (profSnap.data() as { name?: string }).name : undefined,
    operatorId:    context.auth!.uid,
    actionType:    kind,
    previousValue: result.prev,
    newValue:      result.next,
    reason:        reason ?? '',
  });

  return { success: true, previousScore: result.prev, newScore: result.next };
});

// ─── listAuditLogs ────────────────────────────────────────────────────────────
// Event-Manager-only view of the immutable action log (newest first).
export const listAuditLogs = functions.https.onCall(async (_data, context) => {
  assertJudge(context);
  const snap = await db.collection(`artifacts/${APP_ID}/auditLogs`).get();
  const ts = (x: Record<string, unknown>) => String(x.timestamp ?? '');
  const logs = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown>)
    .sort((a, b) => ts(b).localeCompare(ts(a)));
  return { logs };
});

// ─── updateLocation ───────────────────────────────────────────────────────────
// LEAN per-team location ping (called every 15–30s in transit). A single upsert,
// no extra reads/queries, so high call volume stays cheap. The admin heatmap reads
// artifacts/{appId}/public/data/teamLocations live.
export const updateLocation = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const { lat, lng, teamName, slotType } = data as {
    lat?: number; lng?: number; teamName?: string; slotType?: string;
  };
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'lat and lng must be numbers');
  }
  await db.doc(`artifacts/${APP_ID}/public/data/teamLocations/${context.auth.uid}`).set({
    teamId:    context.auth.uid,
    teamName:  teamName ?? null,
    lat,
    lng,
    slotType:  slotType ?? null,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true };
});
