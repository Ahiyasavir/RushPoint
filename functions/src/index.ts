// @ts-nocheck
import * as functions from 'firebase-functions';
import { db } from './firebase';
import { assignNextTask, releaseTask } from './routing/assignNextTask';
import {
  computeProductScore,
  clampScore,
  MAX_DESIGN_SCORE,
  MAX_PRESENTATION_SCORE,
} from './scoring/teneProducts';

// ─── Path + auth helpers for the judge flow ───────────────────────────────────

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
  status: 'locked' | 'active' | 'completed';
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
 * Mirrors the mobile gameStore rules: green[n]→green[n+1]; green[3]→orange;
 * orange→all three gold; gold→nothing further.
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

// ─── requestNextTask ──────────────────────────────────────────────────────────
// Called by the mobile app when a team completes a task and needs the next one.
// Returns { taskId } or { injectRiddle: true } if park is at capacity.
export const requestNextTask = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { teamId, lat, lng, completedTaskIds, targetType } = data as {
    teamId: string;
    lat: number;
    lng: number;
    completedTaskIds: string[];
    targetType: 'green' | 'gold';
  };

  if (context.auth.uid !== teamId) {
    throw new functions.https.HttpsError('permission-denied', 'Can only request for own team');
  }

  return assignNextTask(teamId, { lat, lng }, completedTaskIds, targetType);
});

// ─── checkOutTask ─────────────────────────────────────────────────────────────
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

// ─── triggerLeaderboardFreeze ─────────────────────────────────────────────────
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

// ─── pushFlashMission ─────────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════════
// JUDGE FLOW (Tracer Bullet Step 3)
// All three callables use the Admin SDK and therefore bypass Firestore rules,
// keeping score/gameState writes server-authoritative per the TECH_SPEC.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── listPendingArrivals ──────────────────────────────────────────────────────
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

// ─── checkInArrival ───────────────────────────────────────────────────────────
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

// ─── finalizeJudgeEvaluation ──────────────────────────────────────────────────
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

  // Authoritative scoring — never trust a total sent by the client.
  const productScore = computeProductScore(products);
  const design       = clampScore(designScore, MAX_DESIGN_SCORE);
  const presentation = clampScore(presentationScore, MAX_PRESENTATION_SCORE);
  const total        = productScore + design + presentation;
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

    // Idempotent: slot already scored (e.g. double submit) — return current state.
    if (slots[target].status === 'completed') {
      return { newScore: gs.score, total, alreadyFinalized: true };
    }

    const ci        = ciSnap.exists ? (ciSnap.data() as { taskId?: string; taskTitle?: string }) : {};
    const breakdown = { products, productScore, designScore: design, presentationScore: presentation, total };

    slots[target] = {
      ...slots[target],
      status:    'completed',
      taskId:    slots[target].taskId ?? ci.taskId,
      taskTitle: slots[target].taskTitle ?? ci.taskTitle,
      completedAt: nowIso,
      earnedScore: total,
      scoreBreakdown: breakdown,
    };

    // Transition: unlock the next objective and resume its clock.
    unlockNext(slots, target, nowIso);

    const newScore  = (gs.score ?? 0) + total;
    const allDone   = slots.every((s) => s.status === 'completed');

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

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION (Tracer Bullet Step 1/2)
// Server-authoritative team registration. Replaces the client-side batch write so
// the access-code claim + profile + initial gameState are written atomically with
// the Admin SDK (clients cannot write gameState — see firestore.rules).
// ═══════════════════════════════════════════════════════════════════════════════

// Initial 8-slot layout. startedAt must be a concrete value (Firestore forbids
// serverTimestamp() sentinels inside array elements) — server clock is authoritative.
function buildInitialSlots(nowIso: string): JudgeSlot[] {
  return [
    { index: 0, type: 'green',  status: 'active', startedAt: nowIso },
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

  // ── Validate input ───────────────────────────────────────────────────────────
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

    // Idempotent: this user already claimed this code — return success on retry.
    if (cd.claimed && cd.teamId && cd.teamId === uid) {
      return { teamId: uid, teamName: name, alreadyRegistered: true };
    }
    // Claimed by someone else — block.
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
