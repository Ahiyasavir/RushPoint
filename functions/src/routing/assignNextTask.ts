// ─── Smart Routing — generic task pool within a Stage ────────────────────────
//
// Operates on the tasks inside a single Stage (Stage.tasks[]). Called when a
// team's active stage has multiple tasks and the system must pick the best one.
// If the stage has only one task, the caller should skip routing and assign directly.
//
// Priority(team, task) = 0.5·Φ − 0.3·TransitNorm + 0.2·Ω
//   Φ            = station availability  (1=empty, 0=full)
//   TransitNorm  = walking distance, normalised to 30-min cap
//   Ω            = adaptive difficulty match (team strength ↔ task difficulty)

import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';
import { db } from '../firebase';
import {
  haversineKm, isValidCoord, isReleased, isExpired, isUnlocked,
  isHotZoneActive, isWithinHotZoneRadius, isTaskAssignable,
} from '@rushpoint/shared';
import type { Task, GeoPoint, TaskRecommendation, HotZone, TaskStatusOverrides } from '@rushpoint/shared';

// Additive routing bonus (change: hot-zone-routing-bias) applied to a candidate
// task whose location is inside an ACTIVE hot zone, so teams tend to be routed
// there while the multiplier is live. Additive — not a hard filter: it dominates
// close contests (load/transit/skill deltas are usually < this) but a badly
// loaded or far in-zone task can still lose to a great out-of-zone one.
export const HOT_ZONE_ROUTING_BONUS = 0.35;

// Runtime counter path for a task within a run
// (stored as a flat map on the Run doc: run.taskCounts[taskId])
const runPath = (ownerUid: string, gameId: string, runId: string) =>
  `users/${ownerUid}/games/${gameId}/runs/${runId}`;


// ─── Priority sub-formulas ────────────────────────────────────────────────────

function loadFactor(task: Task, taskCounts: Record<string, number>): number {
  // WO Fix 4: a locationless task has no physical station to fill — it's always at
  // full availability. Use a constant here (NOT cap=Infinity, which makes
  // (Infinity-current)/Infinity → NaN and poisons priorityScore).
  if (task.locationless) return 1;
  const cap = task.maxConcurrentTeams ?? 3;
  const current = taskCounts[task.id] ?? 0;
  return cap > 0 ? Math.max(0, (cap - current) / cap) : 0;
}

function transitMinutes(teamLocation: GeoPoint, task: Task): number {
  // A locationless (general) task can be done from wherever the team is.
  if (task.locationless) return 0;
  // Hidden-location task (WO-3): its priority must NOT encode distance, or the
  // secret spot is triangulable by polling recommendations from many points.
  // Treat it like a coords-unavailable task — a constant transit, no gradient.
  if (task.hideLocation) return 5;
  if (!task.coordinates || !isValidCoord(task.coordinates.lat, task.coordinates.lng)) return 5;
  // Bad client `teamLocation` (WO-5 layer 1): out-of-range / NaN coords would make
  // haversineKm throw LocationError and escape as an opaque INTERNAL. Fall back to
  // the coords-unavailable constant so the internal routing path never 500s.
  if (!isValidCoord(teamLocation.lat, teamLocation.lng)) return 5;
  return haversineKm(teamLocation, task.coordinates) * 12; // 5 km/h walking
}

// Adaptive difficulty (change: adaptive-difficulty-routing): route a team toward
// tasks whose difficulty matches its MEASURED STRENGTH, which is `−skillRatio`
// (skillRatio is negative when the team is faster than estimate). So a strong
// team targets a positive normalizedDifficulty (the hard tasks) and a slow team a
// negative one (the easy tasks) — the direction creators expect. A team with no
// history (skillRatio 0) targets 0, which makes the term a per-task constant that
// cancels between candidates of the same difficulty: no preference before there
// is any evidence.
function adaptiveDifficultyMatch(skillRatio: number, difficulty: number): number {
  const normalizedDifficulty = (difficulty - 5) / 5; // 1→-0.8 … 5→0 … 10→+1
  return 1 - Math.abs(-skillRatio - normalizedDifficulty);
}

// The hot-zone bonus for a single candidate: HOT_ZONE_ROUTING_BONUS when the
// zone is active at `nowMs` and this task has a real location inside its radius,
// else 0. Locationless tasks have no coordinates to test → never bonused.
function hotZoneBonus(task: Task, hotZone: HotZone | null | undefined, nowMs: number): number {
  if (task.locationless) return 0;
  if (!task.coordinates) return 0;
  if (!isHotZoneActive(hotZone, nowMs)) return 0;
  return isWithinHotZoneRadius(hotZone, task.coordinates) ? HOT_ZONE_ROUTING_BONUS : 0;
}

// ONE formula for every scoring preset (change: adaptive-difficulty-routing):
// station load, walking distance AND the adaptive difficulty fit against the
// team's measured pace. There is deliberately no `skillAware` gate any more —
// adaptation is always on, so a fixed_points_speed / time_only run adapts too.
// Keeping the former smart_weighted 0.5/0.3/0.2 weights everywhere also keeps the
// additive HOT_ZONE_ROUTING_BONUS (0.35) at the exact scale it was tuned against.
// An active hot zone adds that bonus for in-zone tasks
// (change: hot-zone-routing-bias) so teams tend to be routed into it.
export function priorityScore(
  task: Task,
  teamLocation: GeoPoint,
  skillRatio: number,
  taskCounts: Record<string, number>,
  hotZone?: HotZone | null,
  nowMs: number = Date.now(),
): number {
  const transitNorm = Math.min(transitMinutes(teamLocation, task), 30) / 30;
  const zoneBonus = hotZoneBonus(task, hotZone, nowMs);
  return (
    0.5 * loadFactor(task, taskCounts) -
    0.3 * transitNorm +
    0.2 * adaptiveDifficultyMatch(skillRatio, task.difficulty ?? 5) +
    zoneBonus
  );
}


// ─── Skill ratio ─────────────────────────────────────────────────────────────
// Historical performance ratio S_i ∈ [-1, 1].
// Negative = consistently faster than estimate; positive = slower.

type SlotSummary = {
  taskId?: string;
  startedAt?: string;
  completedAt?: string;
  actualMinutes?: number;
  // Pause-clock tasks (change: pause-clock-tasks): present on a record whose task
  // was authored `pausesTimer` (stamped even when the span is 0). Its measured
  // duration is DELIBERATION, not pace, so it must not feed the ratio at all.
  excludedMs?: number;
};

export async function computeSkillRatio(
  completedTasks: SlotSummary[],
  gameTasks: Task[],
): Promise<number> {
  const taskMap = new Map(gameTasks.map((t) => [t.id, t]));
  const measurable = completedTasks.filter(
    (s) => s.taskId
      // pause-clock-tasks: drop a paused record from the pace sample entirely.
      // Subtracting its excluded time would give actual ≈ 0 and make the team look
      // superhuman (routed the hardest work left); leaving it in would give
      // actual >> estimate and make it look slow. Both are wrong, so it simply is
      // not evidence. An all-paused sample falls through to the neutral 0 below —
      // the same value a team has before its first task.
      && s.excludedMs == null
      && (s.actualMinutes != null || (s.startedAt && s.completedAt)),
  );
  if (measurable.length === 0) return 0;

  let total = 0, count = 0;
  for (const s of measurable) {
    const task = taskMap.get(s.taskId!);
    if (!task || task.estimatedMinutes <= 0) continue;
    const actual = s.actualMinutes ??
      (new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime()) / 60_000;
    if (!Number.isFinite(actual)) continue; // garbage timestamps must not poison the ratio
    total += Math.max(-1, Math.min(1, (actual - task.estimatedMinutes) / task.estimatedMinutes));
    count++;
  }
  return count > 0 ? total / count : 0;
}


// ─── Read task runtime counters from the Run doc ──────────────────────────────

async function getRunRouting(
  ownerUid: string,
  gameId: string,
  runId: string,
): Promise<{
  taskCounts: Record<string, number>;
  launchedAt?: string;
  hotZone?: HotZone | null;
  taskStatusOverrides?: TaskStatusOverrides;
}> {
  const snap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  if (!snap.exists) return { taskCounts: {} };
  const data = snap.data() as {
    taskCounts?: Record<string, number>;
    launchedAt?: string;
    hotZone?: HotZone | null;
    taskStatusOverrides?: TaskStatusOverrides;
  };
  return {
    taskCounts: data.taskCounts ?? {},
    launchedAt: data.launchedAt,
    hotZone: data.hotZone ?? null,
    // Live task availability (change: live-task-pause). Rides along on a read that
    // already happens, so honouring an operator pause costs no extra Firestore call.
    taskStatusOverrides: data.taskStatusOverrides,
  };
}


// ─── Recommendation list (read-only, no Firestore writes) ────────────────────

export async function buildRecommendations(
  teamLocation: GeoPoint,
  tasks: Task[],
  completedTaskIds: string[],
  skillRatio: number,
  ownerUid: string,
  gameId: string,
  runId: string,
  limit = 5,
): Promise<TaskRecommendation[]> {
  const { taskCounts, launchedAt, hotZone, taskStatusOverrides } = await getRunRouting(ownerUid, gameId, runId);
  const nowMs = Date.now();

  const candidates = tasks.filter((t) => {
    if (completedTaskIds.includes(t.id)) return false;
    // Availability = run override, else the template status, else active
    // (change: live-task-pause). One shared rule for all three filters below.
    if (!isTaskAssignable(t, taskStatusOverrides)) return false;
    // Scheduled-release gate: a not-yet-released task is not a candidate.
    if (!isReleased(t, launchedAt, nowMs)) return false;
    // Task expiry gate (change: task-expiry): a closed task is never handed out.
    if (isExpired(t, launchedAt, nowMs)) return false;
    // Unlockable tasks (change: unlockable-tasks): unmet prerequisites hide it.
    if (!isUnlocked(t, completedTaskIds)) return false;
    // WO Fix 4: locationless tasks are uncapped — skip the cap exclusion.
    if (!t.locationless && (taskCounts[t.id] ?? 0) >= (t.maxConcurrentTeams ?? 3)) return false;
    return true;
  });

  return candidates
    .map((task) => ({
      task,
      priority: priorityScore(task, teamLocation, skillRatio, taskCounts, hotZone, nowMs),
      distanceKm:
        // WO-3: a hidden-location task reports distance 0 so getRecommendedTasks
        // never leaks how close the secret spot is. WO-5: a bad `teamLocation`
        // (out-of-range/NaN) resolves to 0 instead of throwing in haversineKm.
        !task.hideLocation && !task.locationless && task.coordinates &&
        isValidCoord(task.coordinates.lat, task.coordinates.lng) &&
        isValidCoord(teamLocation.lat, teamLocation.lng)
          ? haversineKm(teamLocation, task.coordinates)
          : 0,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
    .map(({ task, priority, distanceKm }, idx) => ({
      taskId: task.id,
      taskIndex: tasks.indexOf(task),
      // play-task-gating (wave D): a hidden-location task's TITLE is part of what
      // the sealed stub withholds until the team has physically arrived
      // (sanitizeTaskForParticipant). getRecommendedTasks is participant-callable,
      // so echoing the title here would hand back exactly what getMyTeamState
      // just refused to send. Withhold it and flag the task instead — the same
      // reasoning as the WO-3 `distanceKm: 0` rule two lines up.
      ...(task.hideLocation ? { locationHidden: true } : { title: task.title }),
      priority: Math.round(priority * 1000) / 1000,
      estimatedMinutes: task.estimatedMinutes,
      difficulty: task.difficulty ?? 5,
      currentLoad:
        (task.maxConcurrentTeams ?? 3) > 0
          ? (taskCounts[task.id] ?? 0) / (task.maxConcurrentTeams ?? 3)
          : 0,
      distanceKm: Math.round(distanceKm * 100) / 100,
    }));
}


// ─── Contended-lock retry ─────────────────────────────────────────────────────
// Every assign/release transaction locks the ONE run doc, so a burst of teams
// completing simultaneously queues on that lock and Firestore may abort with
// "10 ABORTED: Transaction lock timeout" — which surfaced to players as an
// opaque INTERNAL (caught by scripts/simulate-run.mjs under 12 concurrent
// teams). The lock frees in milliseconds; a short jittered backoff + retry
// absorbs the burst instead of failing the player's completion.
export async function withLockRetry<T>(op: () => Promise<T>, attempts = 8): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (e) {
      const code = (e as { code?: number | string }).code;
      const msg = String((e as Error).message ?? '');
      // Contention surfaces as code-10 ABORTED (lock timeout) AND as the transient
      // gRPC codes 4 (DEADLINE_EXCEEDED), 13 (INTERNAL), 14 (UNAVAILABLE) under deep
      // run-doc lock queues — all the same "retry in ms" class. The message arm
      // catches SDK errors that carry no numeric `.code`. Kept narrow: NOT_FOUND (5)
      // and other terminal errors still rethrow raw (see the identity guard test).
      const contended =
        code === 10 || code === 4 || code === 13 || code === 14 ||
        /ABORTED|lock timeout|too much contention|deadline|unavailable|internal/i.test(msg);
      if (!contended) throw e;
      lastErr = e;
      // Jittered backoff with a wider ceiling: at ~20+ synchronized teams the
      // single run-doc lock queues deep, so more attempts + more jitter spread
      // the retries out instead of colliding on the same slot and failing.
      await new Promise((r) => setTimeout(r, 75 * (i + 1) + Math.random() * 300));
    }
  }
  // Retry budget exhausted while the run-doc lock stayed contended. Surface a
  // RETRIABLE HttpsError (wire code `functions/unavailable`) instead of letting
  // the raw code-10 ABORTED escape as an opaque INTERNAL — the latter reads to
  // players as a hard crash and trips scripts/simulate-run.mjs' crash-violation
  // detector, whereas `unavailable` is what the e2e call() retry treats as
  // transient. Keep `lastErr` as the cause for server logs.
  throw new functions.https.HttpsError(
    'unavailable',
    'The game is busy right now — please retry',
    { retriable: true, cause: String((lastErr as Error)?.message ?? lastErr) },
  );
}

// ─── "Why nothing was assigned" classification ───────────────────────────────
// When assignTask finds no eligible candidate, the caller needs to know WHY so
// the participant UI can distinguish a transient "station is full — wait and
// retry" from a terminal dead-end. Pure (no I/O) so it's unit-tested without the
// emulator. Mirrors the candidate filter in assignTask exactly.
//   'stationsFull' — an otherwise-eligible task exists but every one is at its
//                    maxConcurrentTeams cap (transient: a slot will free up).
//   'allLocked'    — the only remaining tasks are release-scheduled / unlock-gated.
//   'expired'      — the only remaining tasks have closed (task-expiry).
//   'none'         — no unassigned task exists at all in this pool.
export type NoAssignmentReason = 'stationsFull' | 'allLocked' | 'expired' | 'none';

export function classifyNoAssignment(
  tasks: Task[],
  completedTaskIds: string[],
  taskCounts: Record<string, number>,
  launchedAt: string | undefined,
  nowMs: number,
  // Live task availability (change: live-task-pause). Trailing and optional so every
  // existing call site and unit test keeps its arity; absent = template status only.
  taskStatusOverrides?: TaskStatusOverrides,
): NoAssignmentReason {
  const pool = tasks.filter(
    (t) => !completedTaskIds.includes(t.id) && isTaskAssignable(t, taskStatusOverrides),
  );
  if (pool.length === 0) return 'none';
  let anyCapBlocked = false;
  let anyLocked = false;
  let anyExpired = false;
  for (const t of pool) {
    if (!isReleased(t, launchedAt, nowMs) || !isUnlocked(t, completedTaskIds)) { anyLocked = true; continue; }
    if (isExpired(t, launchedAt, nowMs)) { anyExpired = true; continue; }
    // WO Fix 4: locationless tasks are uncapped — never mis-report them stationsFull.
    if (t.locationless) continue;
    const current = taskCounts[t.id] ?? 0;
    if (current >= (t.maxConcurrentTeams ?? 3)) { anyCapBlocked = true; }
  }
  if (anyCapBlocked) return 'stationsFull';
  if (anyLocked) return 'allLocked';
  if (anyExpired) return 'expired';
  return 'none';
}

// ─── Task assignment (atomically increments run.taskCounts[taskId]) ───────────

export async function assignTask(
  teamLocation: GeoPoint,
  tasks: Task[],
  completedTaskIds: string[],
  skillRatio: number,
  ownerUid: string,
  gameId: string,
  runId: string,
): Promise<{ taskId?: string; taskIndex?: number; reason?: NoAssignmentReason }> {
  const runRef = db.doc(runPath(ownerUid, gameId, runId));

  // Read the live counts, pick a task, and claim its slot in ONE transaction so
  // two teams racing on the same stage can't both pass the cap check and blow
  // past maxConcurrentTeams (check-then-increment must be atomic). Retried on
  // run-doc lock contention (see withLockRetry).
  return withLockRetry(() => db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    const runData = snap.data() as {
      taskCounts?: Record<string, number>;
      launchedAt?: string;
      hotZone?: HotZone | null;
      taskStatusOverrides?: TaskStatusOverrides;
    } | undefined;
    const taskCounts = runData?.taskCounts ?? {};
    const launchedAt = runData?.launchedAt;
    const hotZone = runData?.hotZone ?? null;
    // Live task availability (change: live-task-pause) — read from the run doc this
    // transaction already holds, so an operator pause is enforced atomically with the
    // cap check and costs nothing extra.
    const taskStatusOverrides = runData?.taskStatusOverrides;
    const nowMs = Date.now();

    const candidates = tasks.filter((t) => {
      if (completedTaskIds.includes(t.id)) return false;
      if (!isTaskAssignable(t, taskStatusOverrides)) return false;
      // Scheduled-release gate: a not-yet-released task can't be assigned.
      if (!isReleased(t, launchedAt, nowMs)) return false;
      // Task expiry gate (change: task-expiry): a closed task can't be assigned.
      if (isExpired(t, launchedAt, nowMs)) return false;
      // Unlockable tasks (change: unlockable-tasks): locked tasks can't be assigned.
      if (!isUnlocked(t, completedTaskIds)) return false;
      // WO Fix 4: locationless tasks are uncapped — skip the cap exclusion.
      if (!t.locationless && (taskCounts[t.id] ?? 0) >= (t.maxConcurrentTeams ?? 3)) return false;
      return true;
    });

    if (candidates.length === 0) {
      const reason = classifyNoAssignment(tasks, completedTaskIds, taskCounts, launchedAt, nowMs, taskStatusOverrides);
      return { reason: reason === 'expired' ? 'none' : reason };
    }

    const chosen = candidates.sort(
      (a, b) =>
        priorityScore(b, teamLocation, skillRatio, taskCounts, hotZone, nowMs) -
        priorityScore(a, teamLocation, skillRatio, taskCounts, hotZone, nowMs),
    )[0];

    tx.update(runRef, {
      [`taskCounts.${chosen.id}`]: FieldValue.increment(1),
    });

    return { taskId: chosen.id, taskIndex: tasks.indexOf(chosen) };
  }));
}


// ─── Staff-directed claim of ONE specific task (staff-console-field-ops) ──────
//
// The force-assign counterpart to assignTask. Same transaction, same cap check,
// same counter — the ONLY difference is that the task is named by a marshal
// instead of chosen by priorityScore. Sharing the transaction shape is the whole
// point: station capacity is a physical constraint (only so much room at a real
// location) and the concurrent-claim invariant is guarded by the e2e
// station-contention scenario, so force-assign must not get its own weaker path.
//
// `override` relaxes ONLY the soft sequencing gates — unlock, scheduled release,
// expiry — which is precisely the "bypass a sequential blocker for this one team"
// the feature exists for. It deliberately does NOT relax:
//   • the capacity cap (physical, not authored), or
//   • paused/closed status (isTaskAssignable) — an operator took that stop out of
//     play for this run on purpose, and a second operator overriding it from the
//     field would silently undo a deliberate live-ops decision.
export async function claimSpecificTask(
  task: Task,
  completedTaskIds: string[],
  ownerUid: string,
  gameId: string,
  runId: string,
  override: boolean,
  launchedAt: string | undefined,
): Promise<{ ok: boolean; reason?: NoAssignmentReason }> {
  const runRef = db.doc(runPath(ownerUid, gameId, runId));

  return withLockRetry(() => db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    const runData = snap.data() as {
      taskCounts?: Record<string, number>;
      taskStatusOverrides?: TaskStatusOverrides;
    } | undefined;
    const taskCounts = runData?.taskCounts ?? {};
    const nowMs = Date.now();

    if (completedTaskIds.includes(task.id)) return { ok: false, reason: 'none' as const };
    // Never overridable — see the header.
    if (!isTaskAssignable(task, runData?.taskStatusOverrides)) return { ok: false, reason: 'none' as const };
    if (!override) {
      if (!isReleased(task, launchedAt, nowMs)) return { ok: false, reason: 'allLocked' as const };
      if (isExpired(task, launchedAt, nowMs)) return { ok: false, reason: 'expired' as const };
      if (!isUnlocked(task, completedTaskIds)) return { ok: false, reason: 'allLocked' as const };
    }
    // The cap check and the increment are in ONE transaction, exactly as in
    // assignTask — a check-then-increment split here would let two concurrent
    // force-assigns both pass a cap of 1.
    if (!task.locationless && (taskCounts[task.id] ?? 0) >= (task.maxConcurrentTeams ?? 3)) {
      return { ok: false, reason: 'stationsFull' as const };
    }

    tx.update(runRef, { [`taskCounts.${task.id}`]: FieldValue.increment(1) });
    return { ok: true };
  }));
}


// ─── Task release ─────────────────────────────────────────────────────────────
// Transactional for the same reason as assignTask: concurrent releases must not
// double-decrement past zero (a negative counter would free phantom slots).

export async function releaseTask(
  taskId: string,
  ownerUid: string,
  gameId: string,
  runId: string,
): Promise<void> {
  const runRef = db.doc(runPath(ownerUid, gameId, runId));
  await withLockRetry(() => db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) return;
    const data = snap.data() as { taskCounts?: Record<string, number> };
    const current = data.taskCounts?.[taskId] ?? 0;
    if (current > 0) {
      tx.update(runRef, { [`taskCounts.${taskId}`]: FieldValue.increment(-1) });
    }
  }));
}
