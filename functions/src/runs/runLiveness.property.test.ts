// run-gate-integrity: the LIVENESS property for a team's progress through a run.
//
// "Can a team get stuck?" is not a question a handful of examples answers: the rules interact —
// prerequisites, exclusive groups, partial stages, release / close windows, per-team time limits,
// organizer pause / close, single-mission skips, staff override assignments, send-team-back, and a
// creator editing the template while the run is live. So this generates thousands of seeded games
// and seeded event sequences, plays ONE team through them with the production decisions, and
// asserts after every event that the team's state is coherent (SAFETY), and at the end that once
// the organizers lift their pauses the team can always play to the finish (LIVENESS).
//
// Production code exercised directly: buildInitialStages, applyStageCompletion, healStrandedStage,
// applyTaskClosure, advanceTeamStateOnPoll (stage unlock + expiry / time-limit sweep),
// isRoutingCandidate, gateSatisfiedTaskIds, planTaskStatusChange, planTaskSkip, runStageTasks,
// planTeamRewind, scheduleRefusal, resolveExclusions. Mirrored (each marked MIRROR, kept minimal):
// the guard sequence of completeTaskForTeam, the write order of skipTaskForTeam, forceAssignTask
// and returnTeamTo — those live inside Firestore transactions.
//
// A failure prints the seed and the event log; rerun one with RUSHPOINT_LIVENESS_SEED=<n>.
// RUSHPOINT_LIVENESS_N=<count> and RUSHPOINT_LIVENESS_OFFSET=<first seed - 1> sweep a different range.
import { describe, test, expect } from 'vitest';
import {
  gateSatisfiedTaskIds, isUnlocked, scheduleRefusal, resolveExclusions, effectiveExclusiveGroups,
  planTaskStatusChange, planTaskSkip, runStageTasks, planTeamRewind, isTaskAssignable,
  validateUnlockGraph, requiredTaskCountProblem, maxCompletableTasks, isExpired, isReleased,
  releaseInstantMs, expiryInstantMs, playableTasks,
  type Game, type RunStageRecord, type RunTeam, type StationStatus, type Task,
} from '@rushpoint/shared';
import { applyStageCompletion } from './helpers';
import { applyTaskClosure, advanceTeamStateOnPoll, buildInitialStages, healStrandedStage, retiredNow, applySkipStage, applyRunClosures, heldTaskIdOf, shiftHeldMissionStart } from './index';
import { isRoutingCandidate, stationCap } from '../routing/assignNextTask';

const LAUNCH = '2026-03-01T09:00:00.000Z';
const L = Date.parse(LAUNCH);

// ── seeded RNG ──────────────────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <X>(xs: X[]): X => xs[Math.floor(next() * xs.length)],
    shuffle: <X>(xs: X[]): X[] => { const c = xs.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; },
  };
}
type R = ReturnType<typeof rng>;

// ── game generator: only games updateGame would ACCEPT ──────────────────────
function genGame(r: R): Game {
  const nStages = r.int(1, 3);
  const stages = [];
  for (let si = 0; si < nStages; si++) {
    const n = r.int(1, 6);
    const tasks: Task[] = [];
    for (let ti = 0; ti < n; ti++) {
      const id = `s${si}t${ti}`;
      const t: Record<string, unknown> = {
        id, title: id, type: 'field', difficulty: 5, estimatedMinutes: 5, pointValue: 10,
        // Some stations are physical and capped, so several teams contend for a slot.
        locationless: r.chance(0.5), maxConcurrentTeams: r.chance(0.05) ? 0 : r.int(1, 3), // 0: an imported file the Builder never clamped
      };
      if (ti > 0 && r.chance(0.4)) {
        const earlier = Array.from({ length: ti }, (_, j) => `s${si}t${j}`);
        t.unlockAfterTaskIds = r.shuffle(earlier).slice(0, r.int(1, Math.min(2, earlier.length)));
      }
      if (r.chance(0.12)) t.hidden = true;
      if (r.chance(0.2)) t.releaseAfterMinutes = r.int(5, 60);
      if (r.chance(0.2)) t.expiresAfterMinutes = ((t.releaseAfterMinutes as number | undefined) ?? 0) + r.int(5, 60);
      if (r.chance(0.08)) t.expiresAt = new Date(L + r.int(10, 120) * 60_000).toISOString();
      if (r.chance(0.1)) t.timeLimitMinutes = r.int(2, 15);
      if (r.chance(0.12)) t.smart = { enabled: true, attemptLimit: r.int(1, 3) };
      tasks.push(t as unknown as Task);
    }
    const stage: Record<string, unknown> = { id: `s${si}`, order: si, title: `S${si}`, tasks, isFinal: si === nStages - 1 };
    const playable = tasks.filter((t) => !t.hidden).map((t) => t.id);
    if (playable.length >= 2 && r.chance(0.45)) {
      const pool = r.shuffle(playable);
      const groups = [];
      let k = 0;
      while (k + 1 < pool.length && groups.length < 2) {
        const size = r.int(2, Math.min(3, pool.length - k));
        groups.push({ id: `g${si}_${groups.length}`, taskIds: pool.slice(k, k + size) });
        k += size;
        if (!r.chance(0.5)) break;
      }
      stage.exclusiveGroups = groups;
    }
    if (r.chance(0.15)) stage.releaseAfterMinutes = r.int(5, 90);
    if (r.chance(0.45)) {
      const ceiling = maxCompletableTasks(stage as never);
      if (ceiling > 0) stage.requiredTaskCount = r.int(1, ceiling);
    }
    stages.push(stage);
  }
  const game = { id: 'g', title: 'G', scoringPreset: 'fixed_points_speed', stages } as unknown as Game;
  for (const st of game.stages) {
    if (validateUnlockGraph({ tasks: st.tasks, requiredTaskCount: st.requiredTaskCount }).errors.length) throw new Error('generator bug: unlock graph');
    if (requiredTaskCountProblem(st)) throw new Error('generator bug: required count');
  }
  return game;
}

// ── the simulated run ───────────────────────────────────────────────────────
interface Sim {
  game: Game;
  /** The template as launched (never edited). */
  launchGame: Game;
  /** The team the current event acts on (one of `teams`). */
  team: RunTeam;
  teams: RunTeam[];
  /** run.taskCounts: station slots held, per mission. Must always equal who is holding what. */
  counts: Record<string, number>;
  overrides: Record<string, StationStatus>;
  now: number;
  log: string[];
}
const iso = (ms: number) => new Date(ms).toISOString();
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const activeIdx = (s: Sim) => s.team.stages.findIndex((st) => st.status === 'active');
const gameStageOf = (s: Sim, idx: number) => s.game.stages.find((g) => g.id === s.team.stages[idx].stageId);
const findTask = (s: Sim, id: string) => s.game.stages.flatMap((g) => g.tasks).find((t) => t.id === id);
function settleFinished(s: Sim) {
  if (s.team.stages.every((st) => st.status === 'completed')) s.team.status = 'finished';
}

function inc(s: Sim, id: string) { s.counts[id] = (s.counts[id] ?? 0) + 1; }
function dec(s: Sim, id: string) {
  // releaseTask clamps at zero, which would HIDE a double release in production — so here it fails.
  if ((s.counts[id] ?? 0) <= 0) fail(s, `slot for ${id} released more times than it was claimed`);
  s.counts[id] -= 1;
}
const capped = (s: Sim, t: Task) => !t.locationless && (s.counts[t.id] ?? 0) >= stationCap(t);

class Violation extends Error {}
function fail(s: Sim, msg: string): never { throw new Violation(`${msg}\n  log:\n    ${[...s.log.slice(0, 2), '…', ...s.log.slice(2).slice(-60)].join('\n    ')}`); }

/** getMyTeamState's poll + requestNextTask (assignNextInActiveStage), in order. */
async function poll(s: Sim) {
  await advanceTeamStateOnPoll({
    team: s.team, game: s.game, launchedAt: LAUNCH, nowMs: s.now, isController: true, taskStatusOverrides: s.overrides,
    persist: async () => undefined, release: async (id) => dec(s, id), onPersistError: () => undefined,
  });
  settleFinished(s);
  // MIRROR assignNextInActiveStage: a held team is parked before anything else runs.
  if (s.team.held === true) return;
  // stage unlock is covered by the poll above.
  const stages = clone(s.team.stages);
  const healed = healStrandedStage(stages, s.game, LAUNCH, iso(s.now), s.team.taskAttempts);
  if (healed.changed) { s.team.stages = stages; s.team.activeTaskId = heldTaskIdOf(stages); settleFinished(s); s.log.push(`heal ${s.team.id}`); healed.heldAssignedTaskIds.forEach((id) => dec(s, id)); }
  // The stage the heal just completed may have unlocked the next one (computeStageUnlock path).
  await advanceTeamStateOnPoll({
    team: s.team, game: s.game, launchedAt: LAUNCH, nowMs: s.now, isController: true, taskStatusOverrides: s.overrides,
    persist: async () => undefined, release: async (id) => dec(s, id), onPersistError: () => undefined,
  });
  const idx = activeIdx(s);
  if (idx < 0) return;
  const stageRec = s.team.stages[idx];
  if (stageRec.tasks.some((t) => t.status === 'assigned')) return;
  const gs = gameStageOf(s, idx);
  if (!gs) return;
  const sat = gateSatisfiedTaskIds(s.team.stages, s.game.stages);
  const cands = gs.tasks
    .filter((t) => stageRec.tasks.find((r) => r.taskId === t.id)?.status === 'unassigned')
    .filter((t) => isRoutingCandidate(t, sat, s.counts, LAUNCH, s.now, s.overrides));
  if (cands.length === 0) return;
  const t = cands[0];
  const rec = stageRec.tasks.find((r) => r.taskId === t.id)!;
  rec.status = 'assigned';
  rec.startedAt = iso(s.now);
  s.team.activeTaskId = t.id;
  inc(s, t.id);
  s.log.push(`${s.team.id} assign ${t.id}`);
}

/**
 * What the PHONE does, exactly: getMyTeamState on its poll, and requestNextTask only while it holds
 * nothing and its active stage still has an unassigned record (TaskRunner's routing effect). Used
 * by the drain, so the simulation cannot heal a team through a call the real app never makes.
 */
async function phone(s: Sim) {
  await advanceTeamStateOnPoll({
    team: s.team, game: s.game, launchedAt: LAUNCH, nowMs: s.now, isController: true, taskStatusOverrides: s.overrides,
    persist: async () => undefined, release: async (id) => dec(s, id), onPersistError: () => undefined,
  });
  settleFinished(s);
  const st = s.team.stages.find((x) => x.status === 'active');
  if (!st) return;
  if (st.tasks.some((t) => t.status === 'assigned')) return;
  if (!st.tasks.some((t) => t.status === 'unassigned')) return;
  await poll(s); // requestNextTask
}

/** MIRROR completeTaskForTeam's guard sequence + its exclusive-sibling retirement. */
function tryComplete(s: Sim): 'done' | string {
  if (s.team.held === true) return 'held'; // assertTeamNotHeld on every submission door
  const idx = activeIdx(s);
  if (idx < 0) return 'no active stage';
  const stages = clone(s.team.stages);
  const rec = stages[idx].tasks.find((t) => t.status === 'assigned');
  if (!rec) return 'nothing held';
  const gameTask = findTask(s, rec.taskId);
  // The phone renders a mission from its template content: a mission deleted from the game while
  // held reaches the phone with NO content, so the player cannot submit it at all.
  if (!gameTask) return 'noContent';
  const lim = gameTask.smart?.attemptLimit;
  if (typeof lim === 'number' && lim > 0 && (s.team.taskAttempts?.[rec.taskId] ?? 0) >= lim) return 'noAttempts';
  // The submission door (completeTask): time limit, then the shared schedule rule.
  if (gameTask?.timeLimitMinutes && rec.startedAt && s.now - Date.parse(rec.startedAt) >= gameTask.timeLimitMinutes * 60_000 + 5_000) return 'timeLimit';
  if (gameTask) { const refusal = scheduleRefusal(gameTask, LAUNCH, s.now, rec); if (refusal) return refusal; }
  if (gameTask && rec.gateOverride !== true && rec.status !== 'assigned' && !isUnlocked(gameTask, gateSatisfiedTaskIds(stages, s.game.stages))) return 'locked';
  const gs = s.game.stages.find((g) => g.id === stages[idx].stageId);
  const siblings = gs ? resolveExclusions({ tasks: runStageTasks(gs.tasks, stages[idx].tasks), exclusiveGroups: gs.exclusiveGroups }, rec.taskId) : [];
  if (rec.status !== 'assigned' && stages[idx].tasks.some((t) => t.status === 'completed' && siblings.includes(t.taskId))) return 'exclusiveTaken';
  rec.status = 'completed';
  rec.completedAt = iso(s.now);
  rec.earnedScore = 10;
  for (const t of stages[idx].tasks) {
    if (!siblings.includes(t.taskId) || t.status === 'completed' || t.status === 'skipped') continue;
    t.status = 'skipped';
    t.skipCause = 'exclusive';
  }
  const res = applyStageCompletion(stages, idx, s.game, LAUNCH, iso(s.now));
  s.team.stages = stages;
  s.team.activeTaskId = null;
  dec(s, rec.taskId);
  res.heldAssignedTaskIds.forEach((id) => dec(s, id));
  settleFinished(s);
  s.log.push(`${s.team.id} complete ${rec.taskId}`);
  return 'done';
}

function setStatus(s: Sim, taskId: string, next: StationStatus, r: R) {
  if (s.overrides[taskId] === 'closed' && next !== 'closed') { s.log.push(`refused reopen ${taskId}`); return; } // closedIsFinal
  const stage = s.game.stages.find((g) => g.tasks.some((t) => t.id === taskId));
  if (!stage) return;
  const plan = planTaskStatusChange({ taskId, stage, overrides: s.overrides, next });
  if (!plan.ok) return;
  if (plan.stageUnwinnable && !r.chance(0.5)) { s.log.push(`refused unwinnable ${next} ${taskId}`); return; }
  const from = plan.from;
  s.overrides = { ...s.overrides, [taskId]: next };
  s.log.push(`${next} ${taskId}${plan.stageUnwinnable ? ' (forced)' : ''}`);
  if (next === 'closed' && from !== 'closed') {
    // MIRROR closeTaskForAllTeams: every team, then the slots.
    const keep = s.team;
    for (const team of s.teams) {
      s.team = team;
      const stages = clone(team.stages);
      const out = applyTaskClosure(stages, s.game, taskId, LAUNCH, iso(s.now));
      if (!out.changed) continue;
      team.stages = stages;
      team.activeTaskId = heldTaskIdOf(stages);
      settleFinished(s);
      for (const id of new Set(out.releaseIds)) dec(s, id);
    }
    s.team = keep;
  }
}

/** MIRROR skipTaskForTeam. */
function skipOne(s: Sim, r: R) {
  const idx = activeIdx(s);
  if (idx < 0) return;
  const stages = clone(s.team.stages);
  const stageRec = stages[idx];
  const gs = s.game.stages.find((g) => g.id === stageRec.stageId);
  const open = stageRec.tasks.filter((t) => t.status === 'unassigned' || t.status === 'assigned');
  if (open.length === 0) return;
  const target = r.pick(open).taskId;
  const statusByTaskId: Record<string, 'unassigned' | 'assigned' | 'completed' | 'skipped'> = {};
  const skipCauseByTaskId: Record<string, unknown> = {};
  for (const t of stageRec.tasks) { statusByTaskId[t.taskId] = t.status; skipCauseByTaskId[t.taskId] = t.skipCause; }
  const plan = planTaskSkip({ stage: { tasks: runStageTasks(gs?.tasks, stageRec.tasks), exclusiveGroups: gs?.exclusiveGroups }, statusByTaskId, requiredTaskCount: stageRec.requiredTaskCount, skipCauseByTaskId, retiredTaskIds: retiredNow(stageRec, gs, s.game, LAUNCH, iso(s.now)) }, target);
  if (!plan.ok) fail(s, `skip refused for an open mission ${target}: ${plan.reason}`);
  const rec = stageRec.tasks.find((t) => t.taskId === target)!;
  rec.status = 'skipped';
  rec.skipCause = 'operator';
  delete rec.gateOverride;
  stageRec.requiredTaskCount = plan.requiredTaskCount;
  if (plan.heldSlot) dec(s, target);
  const res = applyStageCompletion(stages, idx, s.game, LAUNCH, iso(s.now));
  res.heldAssignedTaskIds.forEach((id) => dec(s, id));
  // The preview is planned on the run graph; a stage DELETED from the template is settled by the
  // retirement rule the plan does not model (the write is right, the confirmation text is not).
  if (plan.stageCompletes !== res.completed) fail(s, `skip preview said stageCompletes=${plan.stageCompletes}, the write did ${res.completed} (${target})`);
  s.team.stages = stages;
  s.team.activeTaskId = heldTaskIdOf(stages);
  settleFinished(s);
  s.log.push(`skip ${target}`);
}

/** MIRROR forceAssignTask (with override) — claimSpecificTask never overrides a pause/closure. */
function forceAssign(s: Sim, r: R) {
  if (s.team.held === true) return; // assertTeamNotHeld
  const idx = activeIdx(s);
  if (idx < 0) return;
  const open = s.team.stages[idx].tasks.filter((t) => t.status === 'unassigned');
  if (open.length === 0) return;
  const target = r.pick(open).taskId;
  const gameTask = findTask(s, target);
  if (!gameTask || !isTaskAssignable(gameTask, s.overrides)) return;
  if (capped(s, gameTask)) { s.log.push(`force refused full ${target}`); return; }
  inc(s, target);
  const stages = clone(s.team.stages);
  for (const t of stages[idx].tasks) if (t.status === 'assigned') { t.status = 'unassigned'; delete t.startedAt; delete t.gateOverride; dec(s, t.taskId); }
  const rec = stages[idx].tasks.find((t) => t.taskId === target)!;
  rec.status = 'assigned';
  rec.startedAt = iso(s.now);
  rec.gateOverride = true;
  s.team.stages = stages;
  s.team.activeTaskId = target;
  s.log.push(`force ${target}`);
}

/** MIRROR returnTeamTo. */
function rewind(s: Sim, r: R) {
  if (s.team.held === true) return; // assertTeamNotHeld
  const reached = s.team.stages.filter((st) => st.status !== 'locked');
  if (reached.length === 0) return;
  const st = r.pick(reached);
  const terminal = st.tasks.filter((t) => t.status === 'completed' || t.status === 'skipped');
  const target = r.chance(0.5) && terminal.length
    ? { kind: 'task' as const, taskId: r.pick(terminal).taskId }
    : { kind: 'stage' as const, stageId: st.stageId };
  const plan = planTeamRewind({ stages: s.team.stages, gameStages: s.game.stages, target, teamScore: 0, teamStatus: s.team.status, closedTaskIds: Object.entries(s.overrides).filter(([, v]) => v === 'closed').map(([k]) => k) });
  if (!plan.ok) { s.log.push(`rewind refused ${JSON.stringify(target)} ${plan.reason}`); return; }
  const stages = plan.stages;
  if (plan.assignTaskId) {
    const gt = findTask(s, plan.assignTaskId);
    if (gt && isTaskAssignable(gt, s.overrides) && !capped(s, gt)) {
      const rec = stages[plan.targetStageIdx].tasks.find((t) => t.taskId === plan.assignTaskId);
      if (rec) { rec.status = 'assigned'; rec.startedAt = iso(s.now); rec.gateOverride = true; inc(s, plan.assignTaskId); }
    }
  }
  plan.releaseTaskIds.forEach((id) => dec(s, id));
  let idx = plan.targetStageIdx;
  while (idx >= 0 && idx < stages.length && stages[idx].status === 'active') {
    const res = applyStageCompletion(stages, idx, s.game, LAUNCH, iso(s.now));
    res.heldAssignedTaskIds.forEach((id) => dec(s, id));
    if (!res.completed) break;
    idx += 1;
  }
  s.team.stages = stages;
  s.team.activeTaskId = stages.find((x) => x.status === 'active')?.tasks.find((t) => t.status === 'assigned')?.taskId ?? null;
  s.team.status = stages.every((x) => x.status === 'completed') ? 'finished' : 'active';
  s.log.push(`rewind ${JSON.stringify(target)}`);
}

/** MIRROR submitTaskAnswer / verifyStationCode with a WRONG answer on the held mission. */
function wrongAnswer(s: Sim) {
  if (s.team.held === true) return;
  const idx = activeIdx(s);
  if (idx < 0) return;
  const rec = s.team.stages[idx].tasks.find((t) => t.status === 'assigned');
  if (!rec) return;
  const gt = findTask(s, rec.taskId);
  const limit = gt?.smart?.attemptLimit;
  const used = s.team.taskAttempts?.[rec.taskId] ?? 0;
  if (typeof limit === 'number' && limit > 0 && used >= limit) { s.log.push(`${s.team.id} no attempts left on ${rec.taskId}`); return; }
  s.team.taskAttempts = { ...(s.team.taskAttempts ?? {}), [rec.taskId]: used + 1 };
  s.log.push(`${s.team.id} wrong on ${rec.taskId} (${used + 1}/${limit ?? '∞'})`);
}

/** MIRROR skipStage. */
function skipWholeStage(s: Sim) {
  const idx = activeIdx(s);
  if (idx < 0) return;
  const stages = clone(s.team.stages);
  const out = applySkipStage(stages, idx, s.game, LAUNCH, iso(s.now), 'op');
  s.team.stages = stages;
  s.team.activeTaskId = null;
  out.heldTaskIds.forEach((id) => dec(s, id));
  settleFinished(s);
  s.log.push(`${s.team.id} skipStage ${stages[idx].stageId}`);
}

/** MIRROR checkOutTask: the player walks away from the mission in hand. */
function checkOut(s: Sim) {
  if (s.team.held === true) return; // assertTeamNotHeld
  const idx = activeIdx(s);
  if (idx < 0) return;
  const rec = s.team.stages[idx].tasks.find((t) => t.status === 'assigned');
  if (!rec) return;
  rec.status = 'unassigned';
  delete rec.gateOverride;
  s.team.activeTaskId = null;
  dec(s, rec.taskId);
  s.log.push(`${s.team.id} checkOut ${rec.taskId}`);
}

/** MIRROR setTeamHold. While held, nothing automatic may take the mission in the team's hands. */
function toggleHold(s: Sim) {
  const team = s.team;
  if (team.held !== true) {
    team.held = true;
    team.heldAt = iso(s.now);
    s.log.push(`${team.id} held`);
  } else {
    const added = Math.max(0, s.now - Date.parse(team.heldAt ?? iso(s.now)));
    const shifted = shiftHeldMissionStart(team.stages, added);
    if (shifted) team.stages = shifted;
    team.held = false;
    delete team.heldAt;
    s.log.push(`${team.id} resumed after ${added / 60_000}m`);
  }
}

/** MIRROR joinRun for a late joiner on a started run. */
function lateJoin(s: Sim, r: R) {
  if (s.teams.length >= 4) return;
  const id = `t${s.teams.length}`;
  // A join that RACED a closure reads the overrides before it was written (run-gate-integrity):
  // the poll's missed-closure repair must catch it.
  const raced = r.chance(0.3);
  const fresh = buildInitialStages(clone(s.game));
  const stages = raced ? fresh : applyRunClosures(fresh, s.game, { taskStatusOverrides: s.overrides, launchedAt: LAUNCH }, iso(s.now));
  const team = { id, stages, status: 'active', launched: true, score: 0, activeTaskId: null } as unknown as RunTeam;
  s.teams.push(team);
  s.team = team;
  settleFinished(s);
  s.log.push(`join ${id}${raced ? ' (raced a closure)' : ''}`);
}

let uid = 0;
/** A creator editing the template while the run is live (updateGame accepts all of these). */
function editTemplate(s: Sim, r: R) {
  const g = clone(s.game);
  const kind = r.int(0, 10);
  const st = r.pick(g.stages);
  if (kind === 0 && st.tasks.length > 1) {
    const victim = r.pick(st.tasks).id;
    st.tasks = st.tasks.filter((t) => t.id !== victim);
    // updateGame refuses a dangling prerequisite (validateUnlockGraph), and the Builder prunes it
    // before saving (pruneDanglingPrerequisites), so a deletion always takes its gate entries along.
    for (const t of st.tasks) if (t.unlockAfterTaskIds) t.unlockAfterTaskIds = t.unlockAfterTaskIds.filter((x) => x !== victim);
    if (st.exclusiveGroups) st.exclusiveGroups = st.exclusiveGroups.map((x) => ({ ...x, taskIds: x.taskIds.filter((y) => y !== victim) }));
    if (typeof st.requiredTaskCount === 'number') st.requiredTaskCount = Math.min(st.requiredTaskCount, Math.max(1, maxCompletableTasks(st)));
    s.log.push(`edit: delete ${victim}`);
  } else if (kind === 1) {
    // Reorder stages (only the `order` values move — team records keep their own order).
    const orders = r.shuffle(g.stages.map((x) => x.order));
    g.stages.forEach((x, i) => { x.order = orders[i]; });
    s.log.push('edit: reorder stages');
  } else if (kind === 2) {
    const id = `${st.id}new${++uid}`;
    st.tasks.push({ id, title: id, type: 'field', difficulty: 5, estimatedMinutes: 5, pointValue: 10, locationless: true } as unknown as Task);
    s.log.push(`edit: add ${id}`);
  } else if (kind === 3 && g.stages.length > 1) {
    const victim = r.pick(g.stages).id;
    g.stages = g.stages.filter((x) => x.id !== victim);
    g.stages[g.stages.length - 1].isFinal = true;
    s.log.push(`edit: delete stage ${victim}`);
  } else if (kind === 5 && st.tasks.length > 1) {
    // Add a prerequisite on a LATER mission (keeps the graph acyclic, as updateGame requires),
    // possibly on a mission some team is holding right now.
    const i = r.int(1, st.tasks.length - 1);
    const dep = st.tasks[r.int(0, i - 1)].id;
    const t = st.tasks[i];
    t.unlockAfterTaskIds = [...new Set([...(t.unlockAfterTaskIds ?? []), dep])];
    s.log.push(`edit: ${t.id} now waits for ${dep}`);
  } else if (kind === 6) {
    // Push a mission's release later (its window must stay valid: release < expiry).
    const t = r.pick(st.tasks);
    const later = Math.round((s.now - L) / 60_000) + r.int(5, 40);
    if (typeof t.expiresAfterMinutes === 'number' && t.expiresAfterMinutes <= later) t.expiresAfterMinutes = later + 10;
    if (t.expiresAt) delete t.expiresAt;
    t.releaseAfterMinutes = later;
    s.log.push(`edit: ${t.id} released at ${later}m`);
  } else if (kind === 7 && st.tasks.length >= 2) {
    // Group two missions that are in no group yet as alternatives.
    const grouped = new Set((st.exclusiveGroups ?? []).flatMap((g2) => g2.taskIds));
    const free = st.tasks.filter((t) => !grouped.has(t.id)).map((t) => t.id);
    if (free.length >= 2) {
      const pair = r.shuffle(free).slice(0, 2);
      st.exclusiveGroups = [...(st.exclusiveGroups ?? []), { id: `eg${++uid}`, taskIds: pair }];
      if (typeof st.requiredTaskCount === 'number') st.requiredTaskCount = Math.min(st.requiredTaskCount, Math.max(1, maxCompletableTasks(st)));
      s.log.push(`edit: group ${pair.join('/')}`);
    }
  } else if (kind === 8) {
    // Bench a mission mid-run (runs already launched keep their records).
    const t = r.pick(st.tasks);
    t.hidden = !t.hidden;
    if (typeof st.requiredTaskCount === 'number') st.requiredTaskCount = Math.min(st.requiredTaskCount, Math.max(1, maxCompletableTasks(st)));
    s.log.push(`edit: ${t.hidden ? 'bench' : 'unbench'} ${t.id}`);
  } else if (kind === 9) {
    const ceiling = maxCompletableTasks(st);
    if (ceiling > 0) { st.requiredTaskCount = r.int(1, ceiling); s.log.push(`edit: ${st.id} requires ${st.requiredTaskCount}`); }
  } else if (kind === 10) {
    // Pull a mission's close time in (it stays after its release).
    const t = r.pick(st.tasks);
    const rel = typeof t.releaseAfterMinutes === 'number' ? t.releaseAfterMinutes : 0;
    t.expiresAfterMinutes = Math.max(rel + 1, Math.round((s.now - L) / 60_000) + r.int(0, 10));
    s.log.push(`edit: ${t.id} closes at ${t.expiresAfterMinutes}m`);
  } else {
    // Insert a stage at the front of the order.
    g.stages.forEach((x) => { x.order += 1; });
    const n = ++uid;
    g.stages.unshift({ id: `ins${n}`, order: 0, title: 'ins', tasks: [{ id: `ins${n}t`, title: 'x', type: 'field', difficulty: 5, estimatedMinutes: 5, pointValue: 10, locationless: true } as unknown as Task] } as never);
    s.log.push('edit: insert stage');
  }
  s.game = g;
}

// ── invariants ──────────────────────────────────────────────────────────────
function assertSafe(s: Sim) {
  const keep = s.team;
  const holders: Record<string, number> = {};
  for (const team of s.teams) {
    s.team = team;
    assertTeamSafe(s);
    for (const st of team.stages) for (const t of st.tasks) if (t.status === 'assigned') holders[t.taskId] = (holders[t.taskId] ?? 0) + 1;
  }
  s.team = keep;
  for (const id of new Set([...Object.keys(holders), ...Object.keys(s.counts)])) {
    if ((holders[id] ?? 0) !== (s.counts[id] ?? 0)) fail(s, `slot count for ${id} is ${s.counts[id] ?? 0} but ${holders[id] ?? 0} team(s) hold it`);
    const t = findTask(s, id);
    if (t && !t.locationless && (holders[id] ?? 0) > stationCap(t)) fail(s, `${id} held by ${holders[id]} teams over its cap ${t.maxConcurrentTeams}`);
  }
}

function assertTeamSafe(s: Sim) {
  const stages = s.team.stages;
  const active = stages.map((st, i) => (st.status === 'active' ? i : -1)).filter((i) => i >= 0);
  if (active.length > 1) fail(s, `two active stages: ${active}`);
  stages.forEach((st, i) => {
    const assigned = st.tasks.filter((t) => t.status === 'assigned');
    if (assigned.length > 1) fail(s, `stage ${st.stageId} holds ${assigned.length} missions`);
    if (assigned.length && st.status !== 'active') fail(s, `a held mission in a ${st.status} stage ${st.stageId}`);
    if (active.length && i < active[0] && st.status !== 'completed') fail(s, `stage ${st.stageId} before the active one is ${st.status}`);
    const req = st.requiredTaskCount;
    if (req !== undefined && (!Number.isInteger(req) || req < 0)) fail(s, `requiredTaskCount ${req} on ${st.stageId}`);
    if (st.status === 'completed') {
      const done = st.tasks.filter((t) => t.status === 'completed').length;
      const allTerminal = st.tasks.every((t) => t.status === 'completed' || t.status === 'skipped');
      if (!allTerminal) fail(s, `completed stage ${st.stageId} still has open records`);
      const sum = st.tasks.reduce((n, t) => n + (t.earnedScore ?? 0), 0);
      if ((st.earnedScore ?? 0) !== sum && !st.tasks.some((t) => t.status === 'skipped' && t.skipCause === 'operator' && (t.earnedScore ?? 0) > 0)) {
        fail(s, `completed stage ${st.stageId} total ${st.earnedScore} but its records sum to ${sum}`);
      }
      void done;
    }
    // A pair counts only if it is a pair of alternatives BOTH at launch and in the template now,
    // judged on this team's records (runStageTasks): a group a creator edits mid-run (adds a member
    // the team already holds, deletes one) legitimately changes what the team may complete.
    const launchGs = s.launchGame.stages.find((g) => g.id === st.stageId);
    const nowGs = s.game.stages.find((g) => g.id === st.stageId);
    if (launchGs && nowGs) {
      const nowGroups = effectiveExclusiveGroups({ tasks: runStageTasks(nowGs.tasks, st.tasks).map((t) => ({ id: t.id })), exclusiveGroups: nowGs.exclusiveGroups });
      for (const grp of effectiveExclusiveGroups(launchGs)) {
        const won = st.tasks.filter((t) => grp.includes(t.taskId) && t.status === 'completed').map((t) => t.taskId);
        for (let a = 0; a < won.length; a++) for (let b = a + 1; b < won.length; b++) {
          if (nowGroups.some((g) => g.includes(won[a]) && g.includes(won[b]))) fail(s, `exclusive alternatives ${won[a]} and ${won[b]} both completed`);
        }
      }
    }
  });
  if ((s.team.status === 'finished') !== stages.every((st) => st.status === 'completed')) fail(s, 'finished flag disagrees with the stages');
  // activeTaskId is what the console, the holder count and the station map read: it must name
  // exactly the record the team holds, and nothing when it holds nothing.
  if ((s.team.activeTaskId ?? null) !== heldTaskIdOf(stages)) {
    fail(s, `activeTaskId ${s.team.activeTaskId} but the team holds ${heldTaskIdOf(stages)}`);
  }
}

/** Every instant at which some gate in the game changes. */
function nextInterestingInstant(s: Sim): number | null {
  const pts: number[] = [];
  for (const g of s.game.stages) {
    const rs = releaseInstantMs(g, LAUNCH); if (rs !== null) pts.push(rs);
    for (const t of g.tasks) {
      const a = releaseInstantMs(t, LAUNCH); if (a !== null) pts.push(a);
      const b = expiryInstantMs(t, LAUNCH); if (b !== null) pts.push(b);
    }
  }
  for (const st of s.team.stages) for (const t of st.tasks) {
    const tl = findTask(s, t.taskId)?.timeLimitMinutes;
    if (t.status === 'assigned' && tl && t.startedAt) pts.push(Date.parse(t.startedAt) + tl * 60_000 + 1);
  }
  const future = pts.filter((p) => p > s.now).sort((a, b) => a - b);
  return future.length ? future[0] + 1 : null;
}

async function drain(s: Sim) {
  // The organizers lift every pause they can (a closure is final).
  for (const [id, st] of Object.entries(s.overrides)) if (st === 'paused') s.overrides = { ...s.overrides, [id]: 'active' };
  for (const team of s.teams) if (team.held === true) { s.team = team; toggleHold(s); }
  s.log.push('— drain —');
  for (let round = 0; round < 400; round++) {
    let progressed = false;
    for (const team of s.teams) {
      if (team.status === 'finished') continue;
      s.team = team;
      const before = JSON.stringify(team.stages);
      // Twice: one requestNextTask can settle a stage and leave the next one to the following
      // call (production's client retries; see TaskRunner's routing backoff).
      await phone(s);
      await phone(s);
      assertSafe(s);
      if ((team.status as string) === 'finished') { progressed = true; continue; }
      const res = tryComplete(s);
      assertSafe(s);
      if (res === 'locked' || res === 'exclusiveTaken' || res === 'notReleased' || res === 'noContent' || res === 'noAttempts') {
        fail(s, `${team.id} holds a mission it cannot complete: ${res}`);
      }
      if (res === 'done' || JSON.stringify(team.stages) !== before) progressed = true;
    }
    if (s.teams.every((t) => t.status === 'finished')) return;
    if (progressed) continue;
    // Nothing moved this round: let time pass to the next gate.
    const next = nextInterestingInstant(s);
    if (next === null) {
      const stuck = s.teams.filter((t) => t.status !== 'finished').map((t) => {
        const st = t.stages.find((x) => x.status === 'active');
        return `${t.id}: stage ${st?.stageId ?? '(none active)'} ${JSON.stringify(st?.tasks.map((x) => [x.taskId, x.status, x.skipCause]) ?? t.stages.map((x) => [x.stageId, x.status]))}`;
      });
      fail(s, `STRANDED: nothing to play and nothing left to wait for — ${stuck.join(' | ')} counts ${JSON.stringify(s.counts)}`);
    }
    s.now = next;
  }
  fail(s, 'did not finish within 400 drain rounds');
}

async function play(seed: number) {
  const r = rng(seed);
  const game = genGame(r);
  const nTeams = r.int(1, 3);
  const teams = Array.from({ length: nTeams }, (_, i) =>
    ({ id: `t${i}`, stages: buildInitialStages(clone(game)), status: 'active', launched: true, score: 0, activeTaskId: null } as unknown as RunTeam));
  const s: Sim = { game, launchGame: clone(game), team: teams[0], teams, counts: {}, overrides: {}, now: L, log: [`seed ${seed}`, `game ${JSON.stringify(game.stages.map((g) => ({ id: g.id, req: g.requiredTaskCount, rel: g.releaseAfterMinutes, ex: g.exclusiveGroups?.map((x) => x.taskIds), t: g.tasks.map((t) => [t.id, t.unlockAfterTaskIds, t.hidden ? 'H' : '', t.releaseAfterMinutes, t.expiresAfterMinutes, t.expiresAt ? 'abs' : '', t.timeLimitMinutes, t.locationless ? '' : `cap${t.maxConcurrentTeams}`]) })))}`] };
  assertSafe(s);
  const steps = r.int(5, 60);
  for (let i = 0; i < steps; i++) {
    s.team = r.pick(s.teams);
    if ((s.team.status as string) === 'finished' && !r.chance(0.2)) continue;
    const roll = r.next();
    const allIds = s.game.stages.flatMap((g) => playableTasks(g).map((t) => t.id));
    // Automatic events (a poll, time passing) must never take a held team's mission.
    const auto = roll < 0.28 || (roll >= 0.46 && roll < 0.56);
    const heldBefore = auto ? s.teams.filter((t) => t.held === true).map((t) => [t, heldTaskIdOf(t.stages)] as const) : [];
    if (roll < 0.28) await poll(s);
    else if (roll < 0.46) { if (r.chance(0.3)) wrongAnswer(s); else tryComplete(s); }
    else if (roll < 0.56) { s.now += r.int(1, 25) * 60_000; s.log.push(`+time → ${(s.now - L) / 60_000}m`); }
    else if (roll < 0.63 && allIds.length) setStatus(s, r.pick(allIds), r.pick(['paused', 'active'] as StationStatus[]), r);
    else if (roll < 0.67 && allIds.length) setStatus(s, r.pick(allIds), 'closed', r);
    else if (roll < 0.72) skipOne(s, r);
    else if (roll < 0.76) skipWholeStage(s);
    else if (roll < 0.81) forceAssign(s, r);
    else if (roll < 0.85) rewind(s, r);
    else if (roll < 0.89) checkOut(s);
    else if (roll < 0.92) { if (r.chance(0.5)) toggleHold(s); else lateJoin(s, r); }
    else editTemplate(s, r);
    for (const [t, id] of heldBefore) {
      if (id && heldTaskIdOf(t.stages) !== id) fail(s, `${t.id} lost ${id} to an automatic step while on a staff hold`);
    }
    assertSafe(s);
  }
  await drain(s);
}

describe('run liveness: no combination of rules and live ops strands a team', () => {
  const only = process.env.RUSHPOINT_LIVENESS_SEED;
  const N = Number(process.env.RUSHPOINT_LIVENESS_N ?? 3000);
  test(`${only ? `seed ${only}` : `${N} seeded games`} — every team can play to the finish`, async () => {
    const offset = Number(process.env.RUSHPOINT_LIVENESS_OFFSET ?? 0);
    const seeds = only ? [Number(only)] : Array.from({ length: N }, (_, i) => offset + i + 1);
    const failures: string[] = [];
    for (const seed of seeds) {
      try { await play(seed); } catch (e) {
        failures.push(e instanceof Violation ? e.message : `seed ${seed}: ${(e as Error).stack}`);
        if (failures.length >= 5) break;
      }
    }
    // Denominator printed on purpose: "0 failures" means nothing without how many were played.
    console.log(`run liveness: ${seeds.length} games played, ${failures.length} failing`);
    expect(failures, failures.join('\n\n')).toEqual([]);
  }, 600_000);
});

// Silence "unused" on helpers kept for reading the log.
void isExpired; void isReleased;
