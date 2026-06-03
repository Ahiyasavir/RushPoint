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
import { SLOT_COUNT } from '@rushpoint/shared';
import {
  computeTransitPenalty,
  computeSprintPenalty,
  applyZScoreBonus,
  completionBonus,
  computeTieMetrics,
  compareForRanking,
  computeTimeBonus,
} from './scoring/calculateScore';

// â”€â”€â”€ Path + auth helpers for the judge flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

const userPath = (teamId: string) => `artifacts/${APP_ID}/users/${teamId}`;
const taskPath = (taskId: string) => `artifacts/${APP_ID}/public/data/tasks/${taskId}`;

// ─── Audit trail helper ───────────────────────────────────────────────────────
// Immutable record of every administrative action, for live dispute resolution.
// Written by Cloud Functions only (Admin SDK) at artifacts/{appId}/auditLogs/{id}.
interface AuditEntry {
  teamId: string;
  teamName?: string;
  operatorId: string;
  actionType: 'fine' | 'score_override' | 'manual_unlock' | 'evacuation' | 'skip' | 'cancel_checkin';
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
    sprintSecondsLate?: number;
    sprintPenalty?: number;
    note?: string;
    outcome?: 'passed' | 'failed' | 'left';
  };
}

interface JudgingState {
  slotIndex: number;
  checkInId: string;
  arrivedAt: string;
}

// ─── Station occupancy index (denormalized activeTaskId) ────────────────────────
// `getStationTeams` needs "which teams are currently ON station X". Rather than
// scanning every team's gameState on each operator poll (O(teams) per call), we
// keep a top-level `activeTaskId` mirror of the active slot's taskId on each
// gameState doc, maintained by this single onWrite trigger — so NO existing
// write path has to know about it. getStationTeams then queries the field
// directly. Loop-safe: it only writes when the derived value actually changed,
// so the self-triggered re-run is a no-op. Eventually consistent, which is fine
// for the operator's 15-second poll view.
export const syncActiveTaskId = functions.firestore
  .document('artifacts/{appId}/users/{userId}/gameState/{docId}')
  .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists) return; // doc deleted — nothing to mirror
    const data = after.data() as { slots?: JudgeSlot[]; activeTaskId?: string | null };
    const active = (data.slots ?? []).find((s) => s.status === 'active');
    const desired = active?.taskId ?? null;
    const current = data.activeTaskId ?? null;
    if (desired === current) return; // unchanged → skip write → breaks the loop
    await after.ref.update({ activeTaskId: desired });
  });

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
    const activeSlot = gs.slots.find((s) => s.status === 'active');
    // Idempotent: if the active slot already holds a task (e.g. a double-tap or a
    // retry after a dropped response), return it WITHOUT routing again — otherwise
    // assignNextTask would increment another station's load counter for nothing.
    if (activeSlot?.taskId) {
      return { taskId: activeSlot.taskId, alreadyAssigned: true };
    }
    activeSlotType = activeSlot?.type;
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
    launched: boolean;           // race started for this team (false = still waiting)
    launchAt: string | null;     // ISO countdown target when launched
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
      launched?: boolean;
      launchAt?: string;
    };
    const slots = gs.slots ?? [];
    const active = slots.find((s) => s.status === 'active') ?? null;
    const finished = slots.length > 0 && slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    scoreMap[userId] = {
      score: gs.score ?? 0,
      // Skipped slots count as progress too — a skipped team has advanced past
      // that stage, so it must not look "stuck" on the board (matches finalizeLeaderboard).
      completedSlots: slots.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
      stageIndex: active?.index ?? null,
      stageType:  active?.type ?? null,
      judging:    gs.judging != null,
      crafting:   gs.craftingStartedAt != null && active?.type === 'gold',
      finished,
      // Backward-compatible: a gameState with no `launched` field (seed/legacy)
      // counts as already launched, so only teams explicitly seeded false wait.
      launched:   gs.launched !== false,
      launchAt:   gs.launchAt ?? null,
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
        launched:       scoreMap[userId]?.launched ?? true,
        launchAt:       scoreMap[userId]?.launchAt ?? null,
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

// Average earned score across ALL teams' completed slots of a given stage TYPE.
// Used as the skip baseline when the skipped slot has no Firestore task to read
// (e.g. an unassigned green slot, or orange/gold before a station is claimed),
// so the award is matched to the stage rather than silently 0.
async function averageTypeScore(type: JudgeSlot['type'], fallback: number): Promise<number> {
  const snap = await db.collectionGroup('gameState').get();
  const scores: number[] = [];
  for (const d of snap.docs) {
    const gs = d.data() as { slots?: JudgeSlot[] };
    for (const s of gs.slots ?? []) {
      if (s.type === type && s.status === 'completed' && typeof s.earnedScore === 'number') {
        scores.push(s.earnedScore);
      }
    }
  }
  if (scores.length > 0) {
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  return fallback;
}

// Fixed stage baselines for a skip when no completion data and no task doc exist.
// Chosen to be fair and non-punitive: the gate equals winning the duel; orange
// (find-the-Tene) and the green/gold on-target sigmoid are modest "average mission".
const ORANGE_SKIP_BASELINE = 120;

/**
 * The points to award when an active slot is SKIPPED — smart and matched to the
 * exact station/stage being skipped (fixes "255 once, then 0"):
 *  • a slot with a real station task  → that task's average completion (or its
 *    own on-target sigmoid baseline);
 *  • gate (matchmaking, no task)      → the duel-win bonus (= winning the gate);
 *  • orange/gold/green without a task → the field's average for that stage type,
 *    falling back to a stage-appropriate baseline.
 */
async function skipAwardForSlot(slot: JudgeSlot): Promise<number> {
  if (slot.taskId) {
    const taskSnap = await db.doc(taskPath(slot.taskId)).get();
    const task = taskSnap.exists
      ? (taskSnap.data() as { difficulty?: number; estimatedMinutes?: number })
      : {};
    return averageTaskScore(slot.taskId, task.difficulty ?? 5, task.estimatedMinutes ?? 15);
  }
  switch (slot.type) {
    case 'gate':   return MATCH_WIN_BONUS;
    case 'orange': return averageTypeScore('orange', ORANGE_SKIP_BASELINE);
    case 'gold':   return averageTypeScore('gold', calculateTaskScore(5, 15, 15));
    default:       return averageTypeScore('green', calculateTaskScore(4, 15, 15));
  }
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

  // Station-aware award: matched to the exact stage being skipped (never a flat
  // 255 or a silent 0). See skipAwardForSlot.
  const skippedSlot = preSlots[preTarget];
  const awarded = await skipAwardForSlot(skippedSlot);

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
    reason:        `Skipped ${skippedSlot.type} slot ${skippedIndex} (awarded ${awarded})`,
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
export const listPendingArrivals = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  // Two-stage check-in: the arrival volunteer works the 'pending' queue (teams
  // that declared arrival), confirms each (→ 'arrived'), and only then does the
  // team show up in the judge's 'arrived' queue for scoring. Default 'pending'
  // keeps existing callers (the arrivals page) working.
  const requested = (data as { status?: string } | undefined)?.status;
  const status = requested === 'arrived' ? 'arrived' : 'pending';

  const snap = await db.collectionGroup('checkIns').where('status', '==', status).get();

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
// The ARRIVAL VOLUNTEER confirms the team physically arrived. Marks the check-in
// 'arrived' (which moves it out of the arrivals queue and INTO the judge's queue),
// records arrival time, and FREEZES the elapsed clock for the active slot on the
// mobile client (gameState.judging). Idempotent: re-running returns the freeze.
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
    // 'arrived' = confirmed by the arrival volunteer, now waiting for the judge.
    tx.update(ciRef, { arrivedAt: nowIso, status: 'arrived' });

    return { slotIndex, arrivedAt: nowIso, alreadyCheckedIn: false };
  });
});

// â”€â”€â”€ cancelCheckIn â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Volunteer/judge removes a team from the arrival queue (mistaken or duplicate
// check-in, team left, etc.). Marks the pending check-in rejected and unfreezes
// the team's mobile clock if this check-in was the one being judged. Idempotent.
export const cancelCheckIn = functions.https.onCall(async (data, context) => {
  assertJudge(context);

  const { teamId, checkInId, reason } = data as { teamId?: string; checkInId?: string; reason?: string };
  if (!teamId || !checkInId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and checkInId are required');
  }

  const nowIso = new Date().toISOString();

  const result = await db.runTransaction(async (tx) => {
    const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
    const ciRef = db.doc(`${userPath(teamId)}/checkIns/${checkInId}`);

    const ciSnap = await tx.get(ciRef);
    if (!ciSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Check-in not found');
    }
    const ci = ciSnap.data() as { status?: string };

    const gsSnap = await tx.get(gsRef);
    const gs = gsSnap.exists ? (gsSnap.data() as { judging?: JudgingState | null }) : null;
    const wasJudging = !!gs?.judging && gs.judging.checkInId === checkInId;

    // Mark the check-in rejected (kept for history rather than hard-deleted).
    if (ci.status !== 'rejected') {
      tx.update(ciRef, { status: 'rejected', cancelledAt: nowIso });
    }
    // Unfreeze the mobile clock only if THIS check-in held the freeze.
    if (wasJudging) {
      tx.update(gsRef, { judging: null, updatedAt: nowIso });
    }

    return { wasJudging };
  });

  await writeAuditLog({
    teamId,
    operatorId: context.auth?.uid ?? 'unknown',
    actionType: 'cancel_checkin',
    reason: reason ?? '',
  });

  return { ok: true, ...result };
});

// â”€â”€â”€ finalizeJudgeEvaluation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Atomic write that scores the basket, completes the slot, unfreezes the clock,
// and transitions the team to their next objective.
const COHESION_PENALTY_PER_MEMBER = 100;
// Tene crafting window (20 min) + sprint-to-judge budget (90 s). The hard
// arrival deadline is craftingStart + CRAFTING + SPRINT (see finalize sprint penalty).
const CRAFTING_DURATION_MS = 20 * 60 * 1000;
const SPRINT_BUDGET_MS     = 90 * 1000;

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

    const gs    = gsSnap.data() as { slots: JudgeSlot[]; score: number; bonusPenalty?: number; judging?: JudgingState | null; craftingStartedAt?: string };
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

    const ci = ciSnap.exists ? (ciSnap.data() as { taskId?: string; taskTitle?: string; timestamp?: string }) : {};

    // Sprint penalty (gold slot only): the team must reach the judging queue by
    // craftingStart + 20min + 90s. Leaving early just carries the unused crafting
    // time as travel budget — the hard deadline is the same. Lateness is measured
    // from when they declared arrival (the check-in timestamp).
    let sprintPenalty = 0;
    let secondsLate = 0;
    if (slots[target].type === 'gold' && gs.craftingStartedAt) {
      const deadlineMs = new Date(gs.craftingStartedAt).getTime() + (CRAFTING_DURATION_MS + SPRINT_BUDGET_MS);
      const arrivalMs  = ci.timestamp ? new Date(ci.timestamp).getTime()
        : gs.judging?.arrivedAt ? new Date(gs.judging.arrivedAt).getTime()
        : Date.now();
      secondsLate   = Math.max(0, Math.round((arrivalMs - deadlineMs) / 1000));
      sprintPenalty = computeSprintPenalty(secondsLate);
    }

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
      sprintSecondsLate: secondsLate, sprintPenalty,
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
    const newPenalty   = (gs.bonusPenalty ?? 0) + cohesionPenalty + sprintPenalty;
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
// 4 orange (find the Tene), 5 gold (fill the Tene + judging). Slot 0 is pre-seeded
// with a starting task so the dashboard skips the "stand by" screen on first load;
// slots 1-2 are assigned on unlock by the load-balancing router (requestNextTask,
// auto-invoked by the mobile dashboard). startedAt must be a concrete value
// (Firestore forbids serverTimestamp() sentinels inside array elements).
function buildInitialSlots(nowIso: string): JudgeSlot[] {
  return [
    // Slot 0 is active but UNASSIGNED — registerTeam routes it via assignNextTask
    // (load-balanced from the race start) so 30 teams spread across green stations
    // instead of all piling onto a hard-pinned task-green-001.
    { index: 0, type: 'green',  status: 'active', startedAt: nowIso },
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
    waiverVersion,
  } = data as {
    code: string;
    teamName: string;
    captainPhone: string;
    participants: { name: string; age: string }[];
    waiverAccepted?: boolean;
    waiverVersion?: string;
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
      waiverAccepted:   true,
      // Record which waiver version was accepted + when — consent trail for a
      // real event. Falls back to 'unversioned' for older clients.
      waiverVersion:    (waiverVersion ?? '').trim() || 'unversioned',
      waiverAcceptedAt: nowIso,
      status:           'registered',
      createdAt:        nowIso,
    });

    tx.set(gsRef, {
      teamId:       uid,
      slots:        buildInitialSlots(nowIso),
      score:        0,
      bonusPenalty: 0,
      // Teams WAIT after registering — the admin launches them (with a countdown),
      // which assigns the first mission. Until then the dashboard shows a standby
      // screen and no mission is routed. (launchTeams flips this to true.)
      launched:     false,
      updatedAt:    nowIso,
    });

    // Claim the code: canonical `status` lifecycle + legacy `claimed`/`teamId`.
    tx.update(codeRef, {
      claimed: true, teamId: uid,
      status: 'used', assignedTeamId: uid, usedAt: nowIso,
    });

    return { teamId: uid, teamName: name, alreadyRegistered: false };
  });
  // NOTE: the first green mission is NOT routed here anymore — it's assigned by
  // launchTeams when the admin starts the team, so registered teams stand by.
});

/** Route slot 0 to the least-loaded green station near the race start. */
async function routeFirstGreen(uid: string, nowIso: string): Promise<void> {
  try {
    const cfgSnap = await db.doc(`artifacts/${APP_ID}/public/data/raceConfig/current`).get();
    const start = cfgSnap.exists ? (cfgSnap.data() as { start?: { lat?: number; lng?: number } }).start : undefined;
    const loc = start && typeof start.lat === 'number' && typeof start.lng === 'number'
      ? { lat: start.lat, lng: start.lng }
      : { lat: 31.7905, lng: 35.164 };

    const res = await assignNextTask(uid, loc, [], 'green', 0);
    if (!res.taskId) return;

    const taskSnap = await db.doc(taskPath(res.taskId)).get();
    const taskTitle = taskSnap.exists ? (taskSnap.data() as { title?: string }).title : undefined;
    const gsRef = db.doc(`${userPath(uid)}/gameState/current`);
    const gsSnap = await gsRef.get();
    if (!gsSnap.exists) return;
    const gs = gsSnap.data() as { slots: JudgeSlot[] };
    const slots = gs.slots.map((s) => ({ ...s }));
    const idx = slots.findIndex((s) => s.status === 'active');
    if (idx >= 0 && !slots[idx].taskId) {
      slots[idx] = { ...slots[idx], taskId: res.taskId, ...(taskTitle ? { taskTitle } : {}) };
      await gsRef.update({ slots, updatedAt: nowIso });
    }
  } catch {
    /* no green station free at launch — slot 0 remains unassigned; requestNextTask will route it */
  }
}

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

// SLOT_COUNT is the shared single source of truth (imported from @rushpoint/shared).
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
// After losing a duel a team waits out this cooldown before re-entering the gate
// queue (gives them a breather + lets fresh opponents accumulate). The mobile
// GateCard shows the countdown and auto-rejoins when it elapses.
const GATE_COOLDOWN_SECONDS = 90;

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

// ─── startCraftingForTeam ─────────────────────────────────────────────────────
// Tene Distributor (volunteer) hands a team their basket and starts the 20-minute
// crafting clock for THEM — no QR scan. Same effect as startCraftingTimer but the
// caller is the volunteer (assertJudge) and the team is named explicitly. The
// mobile client beeps + starts the countdown the moment craftingStartedAt appears.
// Idempotent: returns the existing deadline if crafting already started.
export const startCraftingForTeam = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { teamId } = data as { teamId?: string };
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId is required');
  }
  const nowIso = new Date().toISOString();
  const gsRef  = db.doc(`${userPath(teamId)}/gameState/current`);

  return db.runTransaction(async (tx) => {
    const gsSnap = await tx.get(gsRef);
    if (!gsSnap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    const gs = gsSnap.data() as { craftingStartedAt?: string; matchStatus?: string; slots: JudgeSlot[] };

    if (gs.craftingStartedAt) {
      const deadlineAt = new Date(new Date(gs.craftingStartedAt).getTime() + CRAFTING_DURATION_SECONDS * 1000).toISOString();
      return { alreadyStarted: true, craftingStartedAt: gs.craftingStartedAt, deadlineAt };
    }

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

    const deadlineAt       = new Date(new Date(nowIso).getTime() + CRAFTING_DURATION_SECONDS * 1000).toISOString();
    const sprintDeadlineAt = new Date(new Date(deadlineAt).getTime() + SPRINT_BUDGET_SECONDS * 1000).toISOString();
    return { alreadyStarted: false, craftingStartedAt: nowIso, deadlineAt, sprintDeadlineAt };
  });
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

  const gs        = gsSnap.data() as { score?: number; matchStatus?: string; gateCooldownUntil?: string | null };
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

  // Post-loss cooldown: a team that just lost must wait out GATE_COOLDOWN_SECONDS
  // before re-entering the queue. Tell the client how long is left so it can
  // count down and retry automatically.
  if (gs.gateCooldownUntil) {
    const remainingMs = new Date(gs.gateCooldownUntil).getTime() - Date.now();
    if (remainingMs > 0) {
      return { matched: false, status: 'cooldown', cooldownUntil: gs.gateCooldownUntil, cooldownSeconds: Math.ceil(remainingMs / 1000) };
    }
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
    batch.set(db.doc(`${userPath(teamId)}/gameState/current`),   { matchStatus: 'matched', gateCooldownUntil: null, updatedAt: nowIso }, { merge: true });
    batch.set(db.doc(`${userPath(opponent.id)}/gameState/current`), { matchStatus: 'matched', gateCooldownUntil: null, updatedAt: nowIso }, { merge: true });
    await batch.commit();
    return { matched: true, matchId: matchRef.id, opponentName: oppData.teamName, opponentScore: oppData.score };
  }

  await queueColl.doc(teamId).set({ teamId, teamName, score: teamScore, joinedAt: nowIso, status: 'waiting' });
  await db.doc(`${userPath(teamId)}/gameState/current`).update({ matchStatus: 'waiting', gateCooldownUntil: null, updatedAt: nowIso });
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

  // Is the loser the LAST team still at the gate? If nobody else could ever pair
  // with them (no other team is actively at the gate slot), make them solo-clear
  // instead of looping in an empty queue forever.
  const loserIsLast = await isLastAtGate(loserId);

  const cooldownUntil = new Date(Date.now() + GATE_COOLDOWN_SECONDS * 1000).toISOString();

  const batch = db.batch();
  batch.update(matchRef, { winnerId, loserId, resolvedAt: nowIso });
  // Winner: bonus + advance.
  batch.update(winnerRef, {
    score: (winnerGs?.score ?? 0) + MATCH_WIN_BONUS,
    matchStatus: 'won',
    updatedAt: nowIso,
  });
  batch.set(queueColl.doc(winnerId), { status: 'resolved' }, { merge: true });

  if (loserIsLast) {
    // Sanctioned solo-clear: the loser is the only team left at the gate, so there
    // is no one to rematch against. Award the gate bonus and advance them too.
    batch.set(db.doc(`${userPath(loserId)}/gameState/current`), {
      score: loserScore + MATCH_WIN_BONUS, matchStatus: 'bypassed', gateCooldownUntil: null, updatedAt: nowIso,
    }, { merge: true });
    batch.set(queueColl.doc(loserId), { status: 'resolved' }, { merge: true });
    await batch.commit();
    await completeGateSlot(winnerId, nowIso);
    await completeGateSlot(loserId, nowIso);
    await writeAuditLog({
      teamId: loserId, teamName: loserName, operatorId: context.auth!.uid,
      actionType: 'manual_unlock', reason: 'Sanctioned solo-clear (last team at gate, lost duel — no rematch possible)',
    });
    return { success: true, winnerId, loserId, bonusAwarded: MATCH_WIN_BONUS, loserSoloCleared: true };
  }

  // Loser: 90-second cooldown, THEN they may re-enter the queue. We stamp
  // gateCooldownUntil and leave them OUT of the waiting queue for now; the mobile
  // GateCard counts down and calls joinMatchQueue when it elapses, and
  // sweepMatchQueue is the server-side safety net.
  batch.set(db.doc(`${userPath(loserId)}/gameState/current`), {
    matchStatus: 'lost', gateCooldownUntil: cooldownUntil, updatedAt: nowIso,
  }, { merge: true });
  batch.set(queueColl.doc(loserId), { status: 'cooldown', cooldownUntil }, { merge: true });
  await batch.commit();

  // Only the winner clears the gate → activates find-the-Tene (orange slot 4).
  await completeGateSlot(winnerId, nowIso);

  return { success: true, winnerId, loserId, bonusAwarded: MATCH_WIN_BONUS, loserCooldownUntil: cooldownUntil };
});

/**
 * True when `teamId` is the only team whose gate (matchmaking) slot is still the
 * active objective — i.e. there is no possible opponent left to duel. Used to
 * auto-pass the last team through the gate instead of looping them in an empty queue.
 */
async function isLastAtGate(teamId: string): Promise<boolean> {
  const gsSnap = await db.collectionGroup('gameState').get();
  for (const doc of gsSnap.docs) {
    const parts = doc.ref.path.split('/');
    const uid = parts[parts.indexOf('users') + 1];
    if (uid === teamId) continue;
    const gs = doc.data() as { slots?: JudgeSlot[] };
    // Another team is also at the gate → a rematch is possible, not the last.
    if (gs.slots?.[GATE_SLOT_INDEX]?.status === 'active') return false;
  }
  return true;
}

// ─── sweepMatchQueue (sanctioned solo-clear) ──────────────────────────────────
// Any team left waiting at the gate longer than maxWaitSeconds (default 5 min)
// with no opponent is auto-advanced past the gate — no manual judge step. Awards
// the standard gate bonus so a lone team isn't penalised for the lack of a rival.
// Idempotent and safe to run on a timer (admin UI / scheduler).
export const sweepMatchQueue = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const maxWaitSeconds = Number((data ?? {}).maxWaitSeconds) > 0 ? Number((data as { maxWaitSeconds: number }).maxWaitSeconds) : 300;
  const nowMs  = Date.now();
  const nowIso = new Date().toISOString();
  const queueColl = db.collection(`artifacts/${APP_ID}/public/data/matchQueue`);
  const waiting = await queueColl.where('status', '==', 'waiting').get();

  const cleared: string[] = [];
  for (const d of waiting.docs) {
    const e = d.data() as { teamId?: string; joinedAt?: string };
    const teamId = e.teamId || d.id;
    const joinedMs = e.joinedAt ? new Date(e.joinedAt).getTime() : nowMs;
    if (nowMs - joinedMs < maxWaitSeconds * 1000) continue; // not stranded long enough yet

    const gsRef  = db.doc(`${userPath(teamId)}/gameState/current`);
    const gsSnap = await gsRef.get();
    if (!gsSnap.exists) { await queueColl.doc(teamId).set({ status: 'resolved' }, { merge: true }); continue; }
    const gs = gsSnap.data() as { slots?: JudgeSlot[]; score?: number };
    // Only solo-clear when the gate slot is genuinely the active objective.
    if (gs.slots?.[GATE_SLOT_INDEX]?.status !== 'active') {
      await queueColl.doc(teamId).set({ status: 'resolved' }, { merge: true });
      continue;
    }
    await gsRef.update({ score: (gs.score ?? 0) + MATCH_WIN_BONUS, matchStatus: 'bypassed', updatedAt: nowIso });
    await completeGateSlot(teamId, nowIso);
    await queueColl.doc(teamId).set({ status: 'resolved' }, { merge: true });
    await writeAuditLog({
      teamId, operatorId: context.auth!.uid, actionType: 'manual_unlock',
      reason: `Sanctioned solo-clear at gate (waited > ${maxWaitSeconds}s, no opponent)`,
    });
    cleared.push(teamId);
  }
  return { success: true, cleared, count: cleared.length };
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
    routeTargetMinutes?: number; // T_expected — sum of assigned slots' expected durations
    timeBonus: number;
    metrics: ReturnType<typeof computeTieMetrics>;
  }

  // ── Route Target (T_expected): per team, sum the expected duration of each of
  // the 6 assigned slots. Fetch every referenced task once and build a duration
  // map (expectedDurationMinutes, falling back to estimatedMinutes).
  const allTaskIds = new Set<string>();
  for (const gs of Object.values(gsMap)) {
    for (const s of gs.slots) if (s.taskId) allTaskIds.add(s.taskId);
  }
  const taskDurationMap: Record<string, number> = {};
  if (allTaskIds.size > 0) {
    const refs = [...allTaskIds].map((id) => db.doc(taskPath(id)));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const td = snap.data() as { expectedDurationMinutes?: number; estimatedMinutes?: number };
      taskDurationMap[snap.id] = td.expectedDurationMinutes ?? td.estimatedMinutes ?? 0;
    }
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
    // T_expected — personal route baseline (only meaningful once finished).
    const routeTargetMinutes = gs.slots.reduce(
      (sum, s) => sum + (s.taskId ? (taskDurationMap[s.taskId] ?? 0) : 0),
      0,
    );
    // Dynamic difficulty-adjusted time bonus (capped, never negative).
    const timeBonus = allDone && durationMinutes != null && routeTargetMinutes > 0
      ? computeTimeBonus(routeTargetMinutes, durationMinutes)
      : 0;
    const bonus    = allDone ? 500 : 0;
    const rawScore = Math.max(0, gs.score + bonus - (gs.bonusPenalty ?? 0));
    const metrics  = computeTieMetrics(gs.slots, gs.bonusPenalty ?? 0);
    return { teamId, teamName: prof.name, rawScore, finalScore: rawScore, completedSlots, finishedAt: prof.finishedAt, durationMinutes, routeTargetMinutes, timeBonus, metrics };
  }).filter(Boolean) as TeamResult[];

  // Apply Z-Score to finished teams.
  const finishedDurations = results.filter((r) => r.durationMinutes != null).map((r) => r.durationMinutes as number);
  for (const r of results) {
    if (r.durationMinutes != null) {
      // Z-Score normalises against the field; the difficulty-adjusted time bonus
      // is added on top so a team on a harder route isn't disadvantaged.
      r.finalScore = applyZScoreBonus(r.rawScore, r.durationMinutes, finishedDurations) + r.timeBonus;
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
    routeTargetMinutes: r.routeTargetMinutes ?? null, // T_expected (difficulty baseline)
    timeBonus:       r.timeBonus,                      // difficulty-adjusted fairness bonus
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

  // Basket lock: once a judge has checked the team in (judging active), the Tene
  // contents are frozen — the team can no longer add/remove products. The judge
  // grades against the physical basket as presented at check-in.
  const gsRef = db.doc(`${userPath(uid)}/gameState/current`);
  const saved = await db.runTransaction(async (tx) => {
    const gsSnap = await tx.get(gsRef);
    const gs = gsSnap.data() as { judging?: JudgingState | null } | undefined;
    if (gs?.judging) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Basket is locked — the judge has already checked you in.',
      );
    }
    tx.set(gsRef, { teneSelection: productIds, updatedAt: new Date().toISOString() }, { merge: true });
    return productIds;
  });
  return { teneSelection: saved };
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
    // Indexed lookup via the activeTaskId mirror (maintained by syncActiveTaskId),
    // instead of scanning every team's gameState on each poll.
    db.collectionGroup('gameState').where('activeTaskId', '==', taskId).get(),
    db.doc(taskPath(taskId)).get(),
  ]);

  const teams = await Promise.all(
    gsSnap.docs.map(async (doc) => {
      const parts  = doc.ref.path.split('/');
      const userId = parts[parts.indexOf('users') + 1];
      const gs     = doc.data() as { slots?: JudgeSlot[] };
      const active = (gs.slots ?? []).find((s) => s.status === 'active');
      // Guard against a stale index (team moved off before the mirror caught up).
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
  const { teamId, taskId, missingMembers = 0, passed = true, outcome, note } = data as {
    teamId?: string; taskId?: string; missingMembers?: number; passed?: boolean;
    outcome?: 'passed' | 'failed' | 'left'; note?: string;
  };
  if (!teamId || !taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and taskId are required');
  }
  // Outcome is explicit ('passed' | 'failed' | 'left') or derived from the legacy
  // `passed` flag. Only a pass scores; failed/left advance the team with no award.
  const finalOutcome: 'passed' | 'failed' | 'left' = outcome ?? (passed ? 'passed' : 'failed');
  const didPass  = finalOutcome === 'passed';
  const trimmedNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const missing  = Math.max(0, Math.floor(Number(missingMembers) || 0));
  const cohesion = didPass ? missing * STATION_COHESION_PENALTY : 0;
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
    if (didPass) {
      const difficulty = task.difficulty ?? 5;
      const estMins    = task.estimatedMinutes ?? 15;
      const startMs    = slots[target].startedAt ? new Date(slots[target].startedAt!).getTime() : Date.now() - estMins * 60_000;
      const actualMins = (Date.now() - startMs) / 60_000;
      taskScore = calculateTaskScore(difficulty, actualMins, estMins);
    }

    slots[target] = {
      ...slots[target],
      status:      didPass ? 'completed' : 'skipped',
      completedAt: nowIso,
      earnedScore: taskScore,
      scoreBreakdown: {
        products: [], productScore: 0, designScore: 0, presentationScore: 0,
        taskScore, total: taskScore, missingMembers: missing, cohesionPenalty: cohesion,
        outcome: finalOutcome, ...(trimmedNote ? { note: trimmedNote } : {}),
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

  // Audit the operator's verdict (outcome + any note) for dispute resolution.
  const profForLog = await db.doc(`${userPath(teamId)}/profile/team`).get();
  await writeAuditLog({
    teamId,
    teamName:   profForLog.exists ? (profForLog.data() as { name?: string }).name : undefined,
    operatorId: context.auth!.uid,
    actionType: 'skip',
    previousValue: result.newScore - result.taskScore,
    newValue:   result.newScore,
    reason: `Station ${taskId}: ${finalOutcome}` +
      (missing ? `, ${missing} missing` : '') +
      (trimmedNote ? ` — "${trimmedNote}"` : ''),
  });

  return { success: true, passed: didPass, outcome: finalOutcome, ...result };
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

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TEAM MANAGEMENT — create / delete teams from the admin Teams page.
// Lets an organiser pre-create a team (with its own access code + Auth identity +
// seeded gameState) and remove a team entirely (profile, gameState, check-ins,
// access-code release, Auth user, and any public traces). Admin-gated.
// ═══════════════════════════════════════════════════════════════════════════════

/** Generate a short, human-friendly access code (e.g. "TEAM7Q"). Avoids easily
 *  confused chars (0/O, 1/I). Caller ensures uniqueness against accessCodes. */
function randomCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function uniqueAccessCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    const snap = await db.doc(`artifacts/${APP_ID}/accessCodes/${code}`).get();
    if (!snap.exists) return code;
  }
  // Extremely unlikely — fall back to a timestamp-salted code.
  return randomCode(8);
}

// ─── adminDeleteTeam ──────────────────────────────────────────────────────────
// Remove a team entirely: private docs (profile/gameState/checkIns/assignments),
// public traces (teamLocations, matchQueue), release its access code, and delete
// the Auth user. Idempotent — missing pieces are skipped.
export const adminDeleteTeam = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { teamId } = data as { teamId?: string };
  if (!teamId) throw new functions.https.HttpsError('invalid-argument', 'teamId is required');

  // Capture identity (name + code) before deletion for the audit log + code release.
  const profSnap = await db.doc(`${userPath(teamId)}/profile/team`).get();
  const prof = profSnap.exists ? (profSnap.data() as { name?: string; code?: string }) : {};

  // Delete private sub-collections.
  for (const col of ['profile', 'gameState', 'checkIns', 'assignments']) {
    const snap = await db.collection(`${userPath(teamId)}/${col}`).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  // Public traces keyed by teamId.
  await db.doc(`artifacts/${APP_ID}/public/data/teamLocations/${teamId}`).delete().catch(() => {});
  await db.doc(`artifacts/${APP_ID}/public/data/matchQueue/${teamId}`).delete().catch(() => {});

  // Prune the team from the precomputed leaderboard so the deletion shows up
  // immediately — the board is a snapshot written by finalize/freeze and would
  // otherwise keep listing a deleted team until the next finalize.
  const lbRef = db.doc(`artifacts/${APP_ID}/public/data/leaderboard/current`);
  await lbRef.get().then((snap) => {
    if (!snap.exists) return;
    const data = snap.data() as { rankings?: { teamId: string }[] };
    const current = data.rankings ?? [];
    if (!current.some((r) => r.teamId === teamId)) return;
    // Drop the entry and re-number ranks 1..N (entries stay in their order).
    const rankings = current
      .filter((r) => r.teamId !== teamId)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return lbRef.set(
      { rankings, updatedAt: new Date().toISOString() },
      { merge: true },
    );
  }).catch(() => {});

  // Release the access code so it can be reused.
  if (prof.code) {
    await db.doc(`artifacts/${APP_ID}/accessCodes/${prof.code}`)
      .set({ claimed: false, teamId: null }, { merge: true }).catch(() => {});
  }

  // Delete the Auth user (anonymous or minted).
  await admin.auth().deleteUser(teamId).catch(() => {});

  await writeAuditLog({
    teamId, teamName: prof.name, operatorId: context.auth!.uid,
    actionType: 'manual_unlock', reason: `Admin deleted team "${prof.name ?? teamId}"`,
  });

  return { success: true, teamId, releasedCode: prof.code ?? null };
});

// ─── adminCreateCode ──────────────────────────────────────────────────────────
// Pre-generate an access code WITHOUT creating a team. The team registers itself
// when it enters the code in the mobile app (registerTeam claims + seeds it).
// Optional `label` (e.g. a team name hint) is stored on the code for the admin's
// reference; `code` lets the admin pick a custom code, else one is generated.
// Build the canonical fields for a fresh, unused access code.
function newCodeDoc(code: string, label: string | null, gameId: string | null, createdBy: string) {
  return {
    code,
    status: 'unused' as const,
    gameId: gameId || null,
    label: label || null,
    claimed: false,        // legacy mirror of status === 'used'
    teamId: null,          // legacy
    assignedTeamId: null,
    usedAt: null,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

export const adminCreateCode = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { code: requested, label, gameId } = (data ?? {}) as { code?: string; label?: string; gameId?: string };

  let code = (requested ?? '').trim().toUpperCase();
  if (code) {
    const existing = await db.doc(`artifacts/${APP_ID}/accessCodes/${code}`).get();
    if (existing.exists) {
      throw new functions.https.HttpsError('already-exists', `Access code ${code} already exists`);
    }
  } else {
    code = await uniqueAccessCode();
  }

  const doc = newCodeDoc(code, (label ?? '').trim() || null, (gameId ?? '').trim() || null, context.auth!.uid);
  await db.doc(`artifacts/${APP_ID}/accessCodes/${code}`).set(doc);

  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: `Created access code ${code}${label ? ` (${label})` : ''}`,
  });

  return { success: true, code, label: doc.label };
});

// ─── listAccessCodes ──────────────────────────────────────────────────────────
// Admin: every access code with its lifecycle status, for the management table.
export const listAccessCodes = functions.https.onCall(async (_data, context) => {
  assertJudge(context);
  const snap = await db.collection(`artifacts/${APP_ID}/accessCodes`).get();
  const codes = snap.docs.map((d) => {
    const c = d.data() as Record<string, unknown>;
    // Derive status for legacy docs that predate the `status` field.
    const status = (c.status as string) ?? (c.claimed ? 'used' : 'unused');
    return {
      code:           (c.code as string) ?? d.id,
      status,
      gameId:         (c.gameId as string) ?? null,
      label:          (c.label as string) ?? null,
      assignedTeamId: (c.assignedTeamId as string) ?? (c.teamId as string) ?? null,
      createdAt:      (c.createdAt as string) ?? null,
      usedAt:         (c.usedAt as string) ?? null,
      createdBy:      (c.createdBy as string) ?? null,
    };
  }).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return { codes };
});

// ─── adminBulkCreateCodes ─────────────────────────────────────────────────────
// Admin: generate N unique codes at once (no duplicates), optionally for a game.
export const adminBulkCreateCodes = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { count, gameId, label } = (data ?? {}) as { count?: number; gameId?: string; label?: string };
  const n = Math.max(1, Math.min(200, Math.round(Number(count) || 0)));
  if (!n) throw new functions.https.HttpsError('invalid-argument', 'count (1–200) is required');

  const created: string[] = [];
  const seen = new Set<string>();
  const batch = db.batch();
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    let code = await uniqueAccessCode();
    while (seen.has(code)) { code = randomCode(8); } // guard intra-batch collisions
    seen.add(code);
    batch.set(
      db.doc(`artifacts/${APP_ID}/accessCodes/${code}`),
      newCodeDoc(code, (label ?? '').trim() || null, (gameId ?? '').trim() || null, context.auth!.uid),
    );
    created.push(code);
  }
  await batch.commit();

  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: `Bulk-created ${created.length} access codes${gameId ? ` for game ${gameId}` : ''}`,
  });
  return { success: true, count: created.length, codes: created };
});

// ─── adminRevokeCode ──────────────────────────────────────────────────────────
// Admin: revoke or delete an UNUSED code. `delete:true` removes the doc; otherwise
// the code is marked 'revoked' (kept for the audit trail). Used codes are refused.
export const adminRevokeCode = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { code: raw, delete: hardDelete } = (data ?? {}) as { code?: string; delete?: boolean };
  const code = (raw ?? '').trim().toUpperCase();
  if (!code) throw new functions.https.HttpsError('invalid-argument', 'code is required');

  const ref = db.doc(`artifacts/${APP_ID}/accessCodes/${code}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', `Access code ${code} not found`);
  const c = snap.data() as { status?: string; claimed?: boolean };
  const status = c.status ?? (c.claimed ? 'used' : 'unused');
  if (status === 'used') {
    throw new functions.https.HttpsError('failed-precondition', 'A used code cannot be revoked or deleted');
  }

  if (hardDelete) await ref.delete();
  else await ref.update({ status: 'revoked' });

  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: `${hardDelete ? 'Deleted' : 'Revoked'} access code ${code}`,
  });
  return { success: true, code, deleted: hardDelete === true };
});

// ─── launchTeams ──────────────────────────────────────────────────────────────
// Staged start: registered teams stand by until the admin launches them. Launching
// stamps a `launchAt` (now + countdownSeconds) and flips `launched:true`; the
// mobile app shows a 10→0 countdown to launchAt and then reveals the first mission
// (assigned here via routeFirstGreen, with the elapsed clock starting at launchAt
// so every launched team's race begins at the same moment). Idempotent per team:
// a team already launched is skipped.
const LAUNCH_COUNTDOWN_SECONDS = 10;

export const launchTeams = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { teamIds, countdownSeconds } = (data ?? {}) as {
    teamIds?: string[];
    countdownSeconds?: number;
  };
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'teamIds (non-empty array) is required');
  }
  const countdown = Math.max(0, Math.min(120, Math.round(Number(countdownSeconds) || LAUNCH_COUNTDOWN_SECONDS)));
  const nowMs    = Date.now();
  const launchAt = new Date(nowMs + countdown * 1000).toISOString();

  const launched: string[] = [];
  for (const teamId of teamIds) {
    const gsRef = db.doc(`${userPath(teamId)}/gameState/current`);
    // eslint-disable-next-line no-await-in-loop
    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(gsRef);
      if (!snap.exists) return false;
      const gs = snap.data() as { launched?: boolean; slots?: JudgeSlot[] };
      if (gs.launched === true) return false; // already launched — skip
      const slots = (gs.slots ?? []).map((s) => ({ ...s }));
      // The race clock for slot 0 starts when the countdown ends, so leaving
      // early/late before launch doesn't affect timing — all teams start fair.
      const activeIdx = slots.findIndex((s) => s.status === 'active');
      if (activeIdx >= 0) slots[activeIdx] = { ...slots[activeIdx], startedAt: launchAt };
      tx.update(gsRef, { launched: true, launchAt, slots, updatedAt: new Date(nowMs).toISOString() });
      return true;
    });
    if (ok) {
      launched.push(teamId);
      // Assign the opening green mission during the countdown so it's ready at 0.
      // eslint-disable-next-line no-await-in-loop
      await routeFirstGreen(teamId, launchAt);
    }
  }

  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: `Launched ${launched.length} team(s) with a ${countdown}s countdown`,
  });

  return { success: true, launched, count: launched.length, launchAt, countdownSeconds: countdown };
});

// ═══════════════════════════════════════════════════════════════════════════════
// RACE BUILDER (admin) — design the route + stations in-app, persisted to Firestore.
// Stations reuse the tasks (green/gold) + basketZones (orange) collections; the
// framing geometry lives in raceConfig/current. All gated to admins (assertJudge).
// ═══════════════════════════════════════════════════════════════════════════════

interface GeoPointIn { lat?: unknown; lng?: unknown }
function asGeoPoint(p: GeoPointIn | undefined, label: string): { lat: number; lng: number } {
  if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', `${label} must be { lat, lng } numbers`);
  }
  return { lat: p.lat, lng: p.lng };
}

// ─── saveRaceConfig ───────────────────────────────────────────────────────────
// Upsert the editable race framing: start/finish/gate/center/zoom + route waypoints.
export const saveRaceConfig = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const d = (data ?? {}) as {
    start?: GeoPointIn; finish?: GeoPointIn; gate?: GeoPointIn; center?: GeoPointIn;
    zoom?: number; routeWaypoints?: GeoPointIn[];
  };
  const nowIso = new Date().toISOString();
  const config = {
    start:  asGeoPoint(d.start, 'start'),
    finish: asGeoPoint(d.finish, 'finish'),
    gate:   asGeoPoint(d.gate, 'gate'),
    center: asGeoPoint(d.center, 'center'),
    zoom:   typeof d.zoom === 'number' ? d.zoom : 13.5,
    routeWaypoints: Array.isArray(d.routeWaypoints)
      ? d.routeWaypoints.map((w, i) => asGeoPoint(w, `routeWaypoints[${i}]`))
      : [],
    updatedAt: nowIso,
  };
  await db.doc(`artifacts/${APP_ID}/public/data/raceConfig/current`).set(config, { merge: true });
  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: 'Saved race config (Race Builder)',
  });
  return { success: true };
});

// ─── upsertStation ────────────────────────────────────────────────────────────
// Create or update a station: a green/gold `task` or an orange `basketZone`. New
// stations get a Firestore auto-id; counters default on create and are preserved
// on update. Whitelists fields so the client can't write arbitrary data.
export const upsertStation = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const d = (data ?? {}) as Record<string, unknown>;
  const kind = d.kind === 'zone' ? 'zone' : d.kind === 'task' ? 'task' : null;
  if (!kind) throw new functions.https.HttpsError('invalid-argument', "kind must be 'task' or 'zone'");

  const col = kind === 'zone'
    ? `artifacts/${APP_ID}/public/data/basketZones`
    : `artifacts/${APP_ID}/public/data/tasks`;
  const id = typeof d.id === 'string' && d.id ? d.id : db.collection(col).doc().id;
  const ref = db.doc(`${col}/${id}`);
  const existing = await ref.get();
  const isNew = !existing.exists;
  const coordinates = asGeoPoint(d.coordinates as GeoPointIn, 'coordinates');
  const str = (v: unknown, fb = '') => (typeof v === 'string' ? v : fb);
  const num = (v: unknown, fb: number) => (typeof v === 'number' && !Number.isNaN(v) ? v : fb);

  if (kind === 'task') {
    const type = d.type === 'gold' ? 'gold' : 'green';
    const payload: Record<string, unknown> = {
      id,
      type,
      title:        str(d.title, id),
      titleHe:      str(d.titleHe),
      description:  str(d.description),
      descriptionHe: str(d.descriptionHe),
      coordinates,
      locationHint: str(d.locationHint),
      difficulty:   num(d.difficulty, 5),
      pointValue:   num(d.pointValue, 100),
      estimatedMinutes: num(d.estimatedMinutes, 15),
      maxConcurrentTeams: num(d.maxConcurrentTeams, 3),
      maxDurationMinutes: num(d.maxDurationMinutes, 30),
      photoRequired: d.photoRequired === true,
      isActive:     d.isActive !== false,
      status:       ['active', 'paused', 'closed'].includes(str(d.status)) ? str(d.status) : 'active',
    };
    // Smart-station config: sanitize client input, persist the secret code
    // separately (never on the public task doc), and store the safe rest.
    const { config: smart, expectedCode } = sanitizeSmartConfig(d.smart);
    if (smart) {
      payload.smart = smart;
      await db.doc(`artifacts/${APP_ID}/stationSecrets/${id}`).set(
        { expectedCode: expectedCode ?? null, taskId: id }, { merge: true },
      );
    } else {
      payload.smart = admin.firestore.FieldValue.delete(); // demote back to a plain station
    }
    if (isNew) { payload.currentTeamCount = 0; payload.qrCode = `QR-${id}`; }
    await ref.set(payload, { merge: true });
  } else {
    const payload: Record<string, unknown> = {
      id,
      name:     str(d.title ?? d.name, id),
      nameHe:   str(d.titleHe ?? d.nameHe),
      riddle:   str(d.riddle),
      riddleHe: str(d.riddleHe),
      coordinates,
      maxTeams: num(d.maxTeams, 3),
    };
    if (isNew) { payload.currentTeamCount = 0; }
    await ref.set(payload, { merge: true });
  }

  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: `${isNew ? 'Created' : 'Updated'} ${kind} station ${id} (Race Builder)`,
  });
  return { success: true, id, kind };
});

// ─── deleteStation ────────────────────────────────────────────────────────────
// Delete a station. Refuses if any team is actively on it (suggest evacuateStation).
export const deleteStation = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { id, kind } = (data ?? {}) as { id?: string; kind?: 'task' | 'zone' };
  if (!id || (kind !== 'task' && kind !== 'zone')) {
    throw new functions.https.HttpsError('invalid-argument', "id and kind ('task'|'zone') are required");
  }

  if (kind === 'task') {
    const gsSnap = await db.collectionGroup('gameState').get();
    const inUse = gsSnap.docs.some((dc) => {
      const gs = dc.data() as { slots?: JudgeSlot[] };
      return (gs.slots ?? []).some((s) => s.status === 'active' && s.taskId === id);
    });
    if (inUse) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'A team is active on this station — evacuate it first, then delete.',
      );
    }
  }

  const col = kind === 'zone'
    ? `artifacts/${APP_ID}/public/data/basketZones`
    : `artifacts/${APP_ID}/public/data/tasks`;
  await db.doc(`${col}/${id}`).delete();
  await db.doc(`artifacts/${APP_ID}/stationSecrets/${id}`).delete().catch(() => undefined);
  await writeAuditLog({
    teamId: '', operatorId: context.auth!.uid, actionType: 'manual_unlock',
    reason: `Deleted ${kind} station ${id} (Race Builder)`,
  });
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// SMART STATIONS — self-running stations with rich config + verification modes.
// A smart station is a normal `task` carrying a `smart` config; the secret
// `expectedCode` lives in stationSecrets/{taskId} (server-only), never on the
// public task doc. Teams complete via code_verification / photo_upload /
// manual_judge; the last two queue into stationReviews for admin approval.
// ═══════════════════════════════════════════════════════════════════════════════

// Sanitize builder input into a client-safe smart config + the secret code.
// Returns { config: null } when the input is not an enabled smart config (so the
// station is treated as a plain station / demoted).
function sanitizeSmartConfig(input: unknown): {
  config: Record<string, unknown> | null;
  expectedCode: string | null;
} {
  if (!input || typeof input !== 'object') return { config: null, expectedCode: null };
  const s = input as Record<string, unknown>;
  if (s.enabled !== true) return { config: null, expectedCode: null };
  const vt = ['manual_judge', 'code_verification', 'photo_upload'].includes(String(s.verificationType))
    ? String(s.verificationType) : 'manual_judge';
  const str  = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const numU = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);
  const boolU = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const expectedCode = vt === 'code_verification' ? (str(s.expectedCode)?.trim() ?? null) : null;
  const config: Record<string, unknown> = {
    enabled: true,
    verificationType: vt,
    longInstructions:   str(s.longInstructions),
    longInstructionsHe: str(s.longInstructionsHe),
    extraInfo:          str(s.extraInfo),
    mediaUrl:           str(s.mediaUrl),
    imageUrl:           str(s.imageUrl),
    adminNotes:         str(s.adminNotes),
    timeLimitSeconds:   numU(s.timeLimitSeconds),
    canSkip:            boolU(s.canSkip),
    geofenceRadiusMeters: numU(s.geofenceRadiusMeters),
    codeInputLabel:     str(s.codeInputLabel),
    hasCode:            vt === 'code_verification' ? !!expectedCode : undefined,
    autoCompleteOnSuccess: boolU(s.autoCompleteOnSuccess),
    attemptLimit:       numU(s.attemptLimit),
    hintCount:          numU(s.hintCount),
    photoReviewRequired: boolU(s.photoReviewRequired),
    needsAdminApproval:  boolU(s.needsAdminApproval),
    allowRetry:          boolU(s.allowRetry),
    showIntroScreen:         boolU(s.showIntroScreen),
    showSuccessScreen:       boolU(s.showSuccessScreen),
    showFailureScreen:       boolU(s.showFailureScreen),
    showPendingReviewScreen: boolU(s.showPendingReviewScreen),
    showHintsOverTime:       boolU(s.showHintsOverTime),
  };
  Object.keys(config).forEach((k) => config[k] === undefined && delete config[k]);
  return { config, expectedCode };
}

// Complete the team's currently-active slot for `taskId` (sigmoid task score +
// advance + release counter) — the smart-station equivalent of a station "pass".
// Mirrors stationReleaseTeam's success path.
async function completeSmartStation(teamId: string, taskId: string): Promise<{ taskScore: number; allDone: boolean }> {
  const taskSnap = await db.doc(taskPath(taskId)).get();
  const task = taskSnap.exists ? (taskSnap.data() as { difficulty?: number; estimatedMinutes?: number }) : {};
  const nowIso = new Date().toISOString();
  const result = await db.runTransaction(async (tx) => {
    const gsRef   = db.doc(`${userPath(teamId)}/gameState/current`);
    const profRef = db.doc(`${userPath(teamId)}/profile/team`);
    const gsSnap  = await tx.get(gsRef);
    if (!gsSnap.exists) throw new functions.https.HttpsError('not-found', 'Game state not found for team');
    const gs    = gsSnap.data() as { slots: JudgeSlot[]; score?: number };
    const slots = gs.slots.map((s) => ({ ...s }));
    const target = slots.findIndex((s) => s.status === 'active' && s.taskId === taskId);
    if (target < 0) throw new functions.https.HttpsError('failed-precondition', 'Team is not active at this station');

    const difficulty = task.difficulty ?? 5;
    const estMins    = task.estimatedMinutes ?? 15;
    const startMs    = slots[target].startedAt ? new Date(slots[target].startedAt!).getTime() : Date.now() - estMins * 60_000;
    const actualMins = (Date.now() - startMs) / 60_000;
    const taskScore  = calculateTaskScore(difficulty, actualMins, estMins);

    slots[target] = {
      ...slots[target], status: 'completed', completedAt: nowIso, earnedScore: taskScore,
      scoreBreakdown: { products: [], productScore: 0, designScore: 0, presentationScore: 0, taskScore, total: taskScore },
    };
    unlockNext(slots, target, nowIso);
    const allDone = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    tx.update(gsRef, { slots, score: (gs.score ?? 0) + taskScore, updatedAt: nowIso });
    if (allDone) tx.set(profRef, { status: 'finished', finishedAt: nowIso }, { merge: true });
    return { taskScore, allDone };
  });
  await releaseTask(taskId, teamId);
  return result;
}

// ─── submitStationCode (team) ─────────────────────────────────────────────────
// Validates the team's entered code against the server-only secret. The correct
// code is NEVER returned. Auto-completes the station on success when configured.

// Haversine distance (km) between two lat/lng points — mirrors routing/assignNextTask.ts.
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export const submitStationCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const teamId = context.auth.uid;
  const { taskId, code, lat, lng } = (data ?? {}) as { taskId?: string; code?: string; lat?: number; lng?: number };
  if (!taskId || typeof code !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and code are required');
  }
  const [taskSnap, secretSnap] = await Promise.all([
    db.doc(taskPath(taskId)).get(),
    db.doc(`artifacts/${APP_ID}/stationSecrets/${taskId}`).get(),
  ]);
  const taskData = taskSnap.exists
    ? (taskSnap.data() as {
        smart?: { verificationType?: string; autoCompleteOnSuccess?: boolean; geofenceRadiusMeters?: number };
        coordinates?: { latitude: number; longitude: number };
      })
    : undefined;
  const smart = taskData?.smart;
  if (!smart || smart.verificationType !== 'code_verification') {
    throw new functions.https.HttpsError('failed-precondition', 'This station does not use code verification');
  }

  // Geofence enforcement: when a radius is configured and the station has coordinates,
  // require the caller's GPS and reject submissions made outside the radius.
  const radiusMetres = smart.geofenceRadiusMeters;
  if (typeof radiusMetres === 'number' && radiusMetres > 0 && taskData?.coordinates) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new functions.https.HttpsError('failed-precondition', 'Location required', { code: 'location-required' });
    }
    const distKm = haversineKm(lat, lng, taskData.coordinates.latitude, taskData.coordinates.longitude);
    if (distKm * 1000 > radiusMetres) {
      throw new functions.https.HttpsError('failed-precondition', 'Too far from the station', {
        code: 'too-far',
        distanceMetres: Math.round(distKm * 1000),
        radiusMetres,
      });
    }
  }
  const expected = secretSnap.exists ? String((secretSnap.data() as { expectedCode?: string }).expectedCode ?? '') : '';
  const correct  = expected.trim().length > 0 && code.trim().toLowerCase() === expected.trim().toLowerCase();

  if (correct && smart.autoCompleteOnSuccess !== false) {
    const res = await completeSmartStation(teamId, taskId);
    return { correct: true, completed: true, ...res };
  }
  return { correct, completed: false };
});

// ─── requestStationReview (team) ──────────────────────────────────────────────
// photo_upload / manual_judge: queue a pending submission for admin review.
export const requestStationReview = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const teamId = context.auth.uid;
  const { taskId, photoUrl } = (data ?? {}) as { taskId?: string; photoUrl?: string };
  if (!taskId) throw new functions.https.HttpsError('invalid-argument', 'taskId is required');

  const [taskSnap, profSnap] = await Promise.all([
    db.doc(taskPath(taskId)).get(),
    db.doc(`${userPath(teamId)}/profile/team`).get(),
  ]);
  const taskData = taskSnap.exists ? (taskSnap.data() as { title?: string; smart?: { verificationType?: string } }) : {};
  const vt = taskData.smart?.verificationType;
  if (vt !== 'photo_upload' && vt !== 'manual_judge') {
    throw new functions.https.HttpsError('failed-precondition', 'This station does not use review-based verification');
  }
  const nowIso = new Date().toISOString();
  const ref = db.collection(`artifacts/${APP_ID}/public/data/stationReviews`).doc();
  await ref.set({
    id: ref.id, teamId,
    teamName:  profSnap.exists ? ((profSnap.data() as { name?: string }).name ?? null) : null,
    taskId,    taskTitle: taskData.title ?? null,
    verificationType: vt, status: 'pending',
    photoUrl: typeof photoUrl === 'string' && photoUrl ? photoUrl : null,
    submittedAt: nowIso,
  });
  return { success: true, submissionId: ref.id };
});

// ─── reviewStationSubmission (admin) ──────────────────────────────────────────
// Approve → completes the station for the team (scores + advances). Reject →
// marks rejected (the mobile app lets the team retry when allowRetry is set).
export const reviewStationSubmission = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { submissionId, approve, rejectionReason } = (data ?? {}) as {
    submissionId?: string; approve?: boolean; rejectionReason?: string;
  };
  if (!submissionId) throw new functions.https.HttpsError('invalid-argument', 'submissionId is required');
  const ref  = db.doc(`artifacts/${APP_ID}/public/data/stationReviews/${submissionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Submission not found');
  const sub = snap.data() as { teamId: string; taskId: string; status: string };
  if (sub.status !== 'pending') throw new functions.https.HttpsError('failed-precondition', 'Submission already reviewed');
  const nowIso = new Date().toISOString();

  if (approve) {
    const res = await completeSmartStation(sub.teamId, sub.taskId);
    await ref.update({ status: 'approved', reviewedAt: nowIso, reviewedBy: context.auth!.uid });
    await writeAuditLog({
      teamId: sub.teamId, operatorId: context.auth!.uid, actionType: 'manual_unlock',
      reason: `Approved smart-station submission for ${sub.taskId}`,
    });
    return { success: true, approved: true, ...res };
  }
  await ref.update({
    status: 'rejected', reviewedAt: nowIso, reviewedBy: context.auth!.uid,
    rejectionReason: (rejectionReason ?? '').trim() || null,
  });
  return { success: true, approved: false };
});

// ─── listStationReviews (admin) ───────────────────────────────────────────────
export const listStationReviews = functions.https.onCall(async (data, context) => {
  assertJudge(context);
  const { status } = (data ?? {}) as { status?: string };
  let q: admin.firestore.Query = db.collection(`artifacts/${APP_ID}/public/data/stationReviews`);
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    q = q.where('status', '==', status);
  }
  const snap = await q.get();
  const reviews = snap.docs
    .map((d) => d.data())
    .sort((a, b) => String(b.submittedAt ?? '').localeCompare(String(a.submittedAt ?? '')));
  return { reviews };
});

// ─── Admin role provisioning (custom claims) ────────────────────────────────────
// Production judges/admins carry a Firebase Auth custom claim { role: 'admin' };
// firestore.rules and assertJudge both key off it. This callable grants/revokes
// that claim so the relaxed-on-emulator gate can be tightened for the real event.
//
// Authorization (first match wins):
//   • emulator                      → allowed (demo convenience)
//   • caller already has role:admin → allowed (an admin can mint more admins)
//   • caller is in the bootstrap allowlist → allowed (seeds the very first admin)
//
// Bootstrap allowlist comes from the RUSHPOINT_ADMIN_BOOTSTRAP env var
// (comma-separated UIDs and/or emails) — set it in functions/.env for the real
// project, then have the seed admin sign in once and call this to promote others.
const BOOTSTRAP_ADMINS = (process.env.RUSHPOINT_ADMIN_BOOTSTRAP ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const setAdminRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const callerEmail = (context.auth.token.email ?? '').toLowerCase();
  const callerIsAdmin = context.auth.token.role === 'admin';
  const callerBootstrapped =
    BOOTSTRAP_ADMINS.includes(context.auth.uid.toLowerCase()) ||
    (!!callerEmail && BOOTSTRAP_ADMINS.includes(callerEmail));

  if (!isEmulator && !callerIsAdmin && !callerBootstrapped) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only');
  }

  const { targetUid, email, makeAdmin = true } = (data ?? {}) as {
    targetUid?: string;
    email?: string;
    makeAdmin?: boolean;
  };
  if (!targetUid && !email) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid or email is required');
  }

  // Resolve the target user (by uid or email).
  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = targetUid
      ? await admin.auth().getUser(targetUid)
      : await admin.auth().getUserByEmail(email!);
  } catch {
    throw new functions.https.HttpsError('not-found', 'Target user not found');
  }

  // Merge so we don't clobber any unrelated claims; clear role on revoke.
  const claims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;
  if (makeAdmin) claims.role = 'admin';
  else delete claims.role;
  await admin.auth().setCustomUserClaims(userRecord.uid, claims);

  await writeAuditLog({
    teamId: '',
    operatorId: context.auth.uid,
    actionType: 'manual_unlock',
    previousValue: (userRecord.customClaims?.role as string) ?? null,
    newValue: makeAdmin ? 'admin' : null,
    reason: `${makeAdmin ? 'Granted' : 'Revoked'} admin role for ${userRecord.uid}`,
  });

  // The target must refresh their ID token (re-login or getIdToken(true)) before
  // the new claim takes effect on the client.
  return { success: true, uid: userRecord.uid, role: makeAdmin ? 'admin' : null };
});
