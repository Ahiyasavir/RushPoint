import * as functions from 'firebase-functions';
import { db } from './firebase';
import { assignNextTask, releaseTask, buildRecommendations, computeSkillRatio } from './routing/assignNextTask';
import {
  computeProductScore,
  clampScore,
  MAX_DESIGN_SCORE,
  MAX_PRESENTATION_SCORE,
} from './scoring/teneProducts';
import { calculateTaskScore } from './scoring/taskScore';

// â”€â”€â”€ Path + auth helpers for the judge flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';

const userPath = (teamId: string) => `artifacts/${APP_ID}/users/${teamId}`;
const taskPath = (taskId: string) => `artifacts/${APP_ID}/public/data/tasks/${taskId}`;

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
  type: 'green' | 'orange' | 'gold';
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
  if (completedIndex < 3) activate(completedIndex + 1);
  else if (completedIndex === 3) activate(4);
  else if (completedIndex === 4) { activate(5); activate(6); activate(7); }
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
  let activeSlotType: 'green' | 'orange' | 'gold' | undefined;

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

  return assignNextTask(teamId, { lat, lng }, completedTaskIds, resolvedTarget, skillRatio);
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

  // Build a map of userId → gameState for O(1) join
  const scoreMap: Record<string, { score: number; completedSlots: number }> = {};
  for (const doc of gsSnap.docs) {
    const parts = doc.ref.path.split('/');
    // path: artifacts/{appId}/users/{userId}/gameState/{docId}
    const userId = parts[parts.indexOf('users') + 1];
    const gs = doc.data() as { score?: number; slots?: { status: string }[] };
    scoreMap[userId] = {
      score: gs.score ?? 0,
      completedSlots: (gs.slots ?? []).filter((s) => s.status === 'completed').length,
    };
  }

  const teams = profileSnap.docs
    .filter((doc) => doc.id === 'team')          // only the profile/team document
    .map((doc) => {
      const parts = doc.ref.path.split('/');
      const userId = parts[parts.indexOf('users') + 1];
      const profile = doc.data() as {
        name: string; code: string; status: string;
        memberNames?: string[]; startedAt?: string;
      };
      return {
        id:             userId,
        name:           profile.name,
        code:           profile.code,
        status:         profile.status,
        memberNames:    profile.memberNames ?? [],
        startedAt:      profile.startedAt ?? null,
        score:          scoreMap[userId]?.score ?? 0,
        completedSlots: scoreMap[userId]?.completedSlots ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);          // highest score first

  return { teams };
});

// ─── skipTask ──────────────────────────────────────────────────────────────────
// Admin/judge escape hatch: skip a team's current task and advance them to the
// next one WITHOUT awarding points. The slot is marked 'skipped' (terminal but
// not 'completed'), so it never counts toward the score yet no longer blocks the
// team. Releases the claimed station slot and clears any pending judge state.
export const skipTask = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const { teamId } = data as { teamId: string };
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId is required');
  }

  const nowIso = new Date().toISOString();

  const { skippedTaskId, skippedIndex, allDone } = await db.runTransaction(async (tx) => {
    const gsRef   = db.doc(`${userPath(teamId)}/gameState/current`);
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
      earnedScore: 0,
    };

    // Unlock whatever the next objective would have been.
    unlockNext(slots, target, nowIso);

    // Unfreeze the mobile clock if the judge had this slot checked in.
    const clearJudging = gs.judging?.slotIndex === target;
    const done = slots.every((s) => s.status === 'completed' || s.status === 'skipped');

    tx.update(gsRef, {
      slots,
      updatedAt: nowIso,
      ...(clearJudging ? { judging: null } : {}),
    });

    if (done) {
      tx.set(profRef, { status: 'finished', finishedAt: nowIso }, { merge: true });
    }

    return { skippedTaskId: taskId, skippedIndex: target, allDone: done };
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

  return { success: true, skippedIndex, allDone };
});

// â”€â”€â”€ triggerLeaderboardFreeze â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ pushFlashMission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      const ci = d.data() as { teamId: string; taskId: string; timestamp?: string; arrivedAt?: string };

      const [profSnap, taskSnap] = await Promise.all([
        db.doc(`${userPath(ci.teamId)}/profile/team`).get(),
        db.doc(taskPath(ci.taskId)).get(),
      ]);

      return {
        checkInId: d.id,
        teamId:    ci.teamId,
        teamName:  profSnap.exists ? (profSnap.data() as { name: string }).name : ci.teamId,
        teamCode:  profSnap.exists ? (profSnap.data() as { code?: string }).code ?? '' : '',
        taskId:    ci.taskId,
        taskTitle: taskSnap.exists ? (taskSnap.data() as { title: string }).title : ci.taskId,
        timestamp: ci.timestamp ?? null,
        arrivedAt: ci.arrivedAt ?? null,
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
export const finalizeJudgeEvaluation = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const {
    teamId,
    checkInId,
    products = [],
    designScore = 0,
    presentationScore = 0,
    judgeNote = '',
  } = data as {
    teamId: string;
    checkInId: string;
    products: string[];
    designScore: number;
    presentationScore: number;
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
  const nowIso       = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const gsRef   = db.doc(`${userPath(teamId)}/gameState/current`);
    const ciRef   = db.doc(`${userPath(teamId)}/checkIns/${checkInId}`);
    const profRef = db.doc(`${userPath(teamId)}/profile/team`);

    const [gsSnap, ciSnap] = await Promise.all([tx.get(gsRef), tx.get(ciRef)]);
    if (!gsSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    }

    const gs    = gsSnap.data() as { slots: JudgeSlot[]; score: number; judging?: JudgingState | null };
    const slots = gs.slots.map((s) => ({ ...s }));

    // Target = the slot that was checked in, else lowest active slot.
    const target =
      gs.judging?.slotIndex ?? slots.findIndex((s) => s.status === 'active');

    if (target == null || target < 0 || !slots[target]) {
      throw new functions.https.HttpsError('failed-precondition', 'No slot available to finalize');
    }

    // Idempotent: slot already scored (e.g. double submit) â€” return current state.
    if (slots[target].status === 'completed') {
      return { newScore: gs.score, total: slots[target].earnedScore ?? 0, alreadyFinalized: true };
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
    const breakdown = { products, productScore, designScore: design, presentationScore: presentation, taskScore, total };

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

    const newScore  = (gs.score ?? 0) + total;
    // A team is done when no slot is still pending — completed or skipped both count as terminal.
    const allDone   = slots.every((s) => s.status === 'completed' || s.status === 'skipped');

    tx.update(gsRef, {
      slots,
      score:     newScore,
      judging:   null,       // unfreeze the mobile clock
      updatedAt: nowIso,
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

    return { newScore, total, breakdown, allDone, alreadyFinalized: false };
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// REGISTRATION (Tracer Bullet Step 1/2)
// Server-authoritative team registration. Replaces the client-side batch write so
// the access-code claim + profile + initial gameState are written atomically with
// the Admin SDK (clients cannot write gameState â€” see firestore.rules).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Initial 8-slot layout. startedAt must be a concrete value (Firestore forbids
// serverTimestamp() sentinels inside array elements) â€” server clock is authoritative.
function buildInitialSlots(nowIso: string): JudgeSlot[] {
  return [
    { index: 0, type: 'green',  status: 'active', startedAt: nowIso, taskId: 'task-green-001', taskTitle: 'Jerusalem Landmarks Photo Hunt' },
    { index: 1, type: 'green',  status: 'locked' },
    { index: 2, type: 'green',  status: 'locked' },
    { index: 3, type: 'green',  status: 'locked' },
    { index: 4, type: 'orange', status: 'locked' },
    { index: 5, type: 'gold',   status: 'locked' },
    { index: 6, type: 'gold',   status: 'locked' },
    { index: 7, type: 'gold',   status: 'locked' },
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
  if (validParticipants.length < 1) {
    throw new functions.https.HttpsError('invalid-argument', 'At least one participant is required');
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
