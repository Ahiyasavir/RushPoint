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
import { describe, test, expect } from 'vitest';
import {
  gateSatisfiedTaskIds, isUnlocked, scheduleRefusal, resolveExclusions, effectiveExclusiveGroups,
  planTaskStatusChange, planTaskSkip, runStageTasks, planTeamRewind, isTaskAssignable,
  validateUnlockGraph, requiredTaskCountProblem, maxCompletableTasks, isExpired, isReleased,
  releaseInstantMs, expiryInstantMs, playableTasks,
  type Game, type RunStageRecord, type RunTeam, type StationStatus, type Task,
} from '@rushpoint/shared';
import { applyStageCompletion } from './helpers';
import { applyTaskClosure, advanceTeamStateOnPoll, buildInitialStages, healStrandedStage, retiredNow } from './index';
import { isRoutingCandidate } from '../routing/assignNextTask';

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
        locationless: true, maxConcurrentTeams: 3,
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
  team: RunTeam;
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

class Violation extends Error {}
function fail(s: Sim, msg: string): never { throw new Violation(`${msg}\n  log:\n    ${s.log.slice(-40).join('\n    ')}`); }

/** getMyTeamState's poll + requestNextTask (assignNextInActiveStage), in order. */
async function poll(s: Sim) {
  await advanceTeamStateOnPoll({
    team: s.team, game: s.game, launchedAt: LAUNCH, nowMs: s.now, isController: false,
    persist: async () => undefined, release: async () => undefined, onPersistError: () => undefined,
  });
  settleFinished(s);
  // MIRROR assignNextInActiveStage: stage unlock is covered by the poll above.
  const stages = clone(s.team.stages);
  if (healStrandedStage(stages, s.game, LAUNCH, iso(s.now)).changed) { s.team.stages = stages; settleFinished(s); s.log.push('heal'); }
  // The stage the heal just completed may have unlocked the next one (computeStageUnlock path).
  await advanceTeamStateOnPoll({
    team: s.team, game: s.game, launchedAt: LAUNCH, nowMs: s.now, isController: false,
    persist: async () => undefined, release: async () => undefined, onPersistError: () => undefined,
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
    .filter((t) => isRoutingCandidate(t, sat, {}, LAUNCH, s.now, s.overrides));
  if (cands.length === 0) return;
  const t = cands[0];
  const rec = stageRec.tasks.find((r) => r.taskId === t.id)!;
  rec.status = 'assigned';
  rec.startedAt = iso(s.now);
  s.team.activeTaskId = t.id;
  s.log.push(`assign ${t.id}`);
}

/** MIRROR completeTaskForTeam's guard sequence + its exclusive-sibling retirement. */
function tryComplete(s: Sim): 'done' | string {
  const idx = activeIdx(s);
  if (idx < 0) return 'no active stage';
  const stages = clone(s.team.stages);
  const rec = stages[idx].tasks.find((t) => t.status === 'assigned');
  if (!rec) return 'nothing held';
  const gameTask = findTask(s, rec.taskId);
  // The submission door (completeTask): time limit, then the shared schedule rule.
  if (gameTask?.timeLimitMinutes && rec.startedAt && s.now - Date.parse(rec.startedAt) >= gameTask.timeLimitMinutes * 60_000 + 5_000) return 'timeLimit';
  if (gameTask) { const refusal = scheduleRefusal(gameTask, LAUNCH, s.now, rec); if (refusal) return refusal; }
  if (gameTask && rec.gateOverride !== true && !isUnlocked(gameTask, gateSatisfiedTaskIds(stages, s.game.stages))) return 'locked';
  const gs = s.game.stages.find((g) => g.id === stages[idx].stageId);
  const siblings = gs ? resolveExclusions(gs, rec.taskId) : [];
  if (stages[idx].tasks.some((t) => t.status === 'completed' && siblings.includes(t.taskId))) return 'exclusiveTaken';
  rec.status = 'completed';
  rec.completedAt = iso(s.now);
  rec.earnedScore = 10;
  for (const t of stages[idx].tasks) {
    if (!siblings.includes(t.taskId) || t.status === 'completed' || t.status === 'skipped') continue;
    t.status = 'skipped';
    t.skipCause = 'exclusive';
  }
  applyStageCompletion(stages, idx, s.game, LAUNCH, iso(s.now));
  s.team.stages = stages;
  s.team.activeTaskId = null;
  settleFinished(s);
  s.log.push(`complete ${rec.taskId}`);
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
    const stages = clone(s.team.stages);
    const out = applyTaskClosure(stages, s.game, taskId, LAUNCH, iso(s.now));
    if (out.changed) {
      s.team.stages = stages;
      if (out.wasHolding || s.team.activeTaskId === taskId) s.team.activeTaskId = null;
      settleFinished(s);
    }
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
  const res = applyStageCompletion(stages, idx, s.game, LAUNCH, iso(s.now));
  // The preview is planned on the run graph; a stage DELETED from the template is settled by the
  // retirement rule the plan does not model (the write is right, the confirmation text is not).
  if (plan.stageCompletes !== res.completed) fail(s, `skip preview said stageCompletes=${plan.stageCompletes}, the write did ${res.completed} (${target})`);
  s.team.stages = stages;
  if (s.team.activeTaskId === target) s.team.activeTaskId = null;
  settleFinished(s);
  s.log.push(`skip ${target}`);
}

/** MIRROR forceAssignTask (with override) — claimSpecificTask never overrides a pause/closure. */
function forceAssign(s: Sim, r: R) {
  const idx = activeIdx(s);
  if (idx < 0) return;
  const open = s.team.stages[idx].tasks.filter((t) => t.status === 'unassigned');
  if (open.length === 0) return;
  const target = r.pick(open).taskId;
  const gameTask = findTask(s, target);
  if (!gameTask || !isTaskAssignable(gameTask, s.overrides)) return;
  const stages = clone(s.team.stages);
  for (const t of stages[idx].tasks) if (t.status === 'assigned') { t.status = 'unassigned'; delete t.startedAt; delete t.gateOverride; }
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
    if (gt && isTaskAssignable(gt, s.overrides)) {
      const rec = stages[plan.targetStageIdx].tasks.find((t) => t.taskId === plan.assignTaskId);
      if (rec) { rec.status = 'assigned'; rec.startedAt = iso(s.now); rec.gateOverride = true; }
    }
  }
  let idx = plan.targetStageIdx;
  while (idx >= 0 && idx < stages.length && stages[idx].status === 'active') {
    if (!applyStageCompletion(stages, idx, s.game, LAUNCH, iso(s.now)).completed) break;
    idx += 1;
  }
  s.team.stages = stages;
  s.team.activeTaskId = stages.find((x) => x.status === 'active')?.tasks.find((t) => t.status === 'assigned')?.taskId ?? null;
  s.team.status = stages.every((x) => x.status === 'completed') ? 'finished' : 'active';
  s.log.push(`rewind ${JSON.stringify(target)}`);
}

/** A creator editing the template while the run is live (updateGame accepts all of these). */
function editTemplate(s: Sim, r: R) {
  const g = clone(s.game);
  const kind = r.int(0, 4);
  const st = r.pick(g.stages);
  if (kind === 0 && st.tasks.length > 1) {
    const victim = r.pick(st.tasks).id;
    st.tasks = st.tasks.filter((t) => t.id !== victim);
    // The Builder's save prunes a dangling prerequisite (pruneDanglingPrerequisites) — sometimes;
    // an older client or an import may not, so both shapes are played.
    if (r.chance(0.5)) for (const t of st.tasks) if (t.unlockAfterTaskIds) t.unlockAfterTaskIds = t.unlockAfterTaskIds.filter((x) => x !== victim);
    if (st.exclusiveGroups) st.exclusiveGroups = st.exclusiveGroups.map((x) => ({ ...x, taskIds: x.taskIds.filter((y) => y !== victim) }));
    if (typeof st.requiredTaskCount === 'number') st.requiredTaskCount = Math.min(st.requiredTaskCount, Math.max(1, maxCompletableTasks(st)));
    s.log.push(`edit: delete ${victim}`);
  } else if (kind === 1) {
    // Reorder stages (only the `order` values move — team records keep their own order).
    const orders = r.shuffle(g.stages.map((x) => x.order));
    g.stages.forEach((x, i) => { x.order = orders[i]; });
    s.log.push('edit: reorder stages');
  } else if (kind === 2) {
    const id = `${st.id}new${r.int(0, 999)}`;
    st.tasks.push({ id, title: id, type: 'field', difficulty: 5, estimatedMinutes: 5, pointValue: 10, locationless: true } as unknown as Task);
    s.log.push(`edit: add ${id}`);
  } else if (kind === 3 && g.stages.length > 1) {
    const victim = r.pick(g.stages).id;
    g.stages = g.stages.filter((x) => x.id !== victim);
    g.stages[g.stages.length - 1].isFinal = true;
    s.log.push(`edit: delete stage ${victim}`);
  } else {
    // Insert a stage at the front of the order.
    g.stages.forEach((x) => { x.order += 1; });
    g.stages.unshift({ id: `ins${r.int(0, 999)}`, order: 0, title: 'ins', tasks: [{ id: `ins${r.int(0, 999)}t`, title: 'x', type: 'field', difficulty: 5, estimatedMinutes: 5, pointValue: 10, locationless: true } as unknown as Task] } as never);
    s.log.push('edit: insert stage');
  }
  s.game = g;
}

// ── invariants ──────────────────────────────────────────────────────────────
function assertSafe(s: Sim) {
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
      void done;
    }
    const gs = s.game.stages.find((g) => g.id === st.stageId);
    if (gs) {
      for (const grp of effectiveExclusiveGroups(gs)) {
        const won = st.tasks.filter((t) => grp.includes(t.taskId) && t.status === 'completed').length;
        if (won > 1) fail(s, `exclusive group ${grp} completed ${won} times`);
      }
    }
  });
  if ((s.team.status === 'finished') !== stages.every((st) => st.status === 'completed')) fail(s, 'finished flag disagrees with the stages');
  if (s.team.activeTaskId) {
    const held = stages.flatMap((st) => st.tasks).find((t) => t.taskId === s.team.activeTaskId);
    if (!held || held.status !== 'assigned') fail(s, `activeTaskId ${s.team.activeTaskId} is not held`);
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
  s.log.push('— drain —');
  for (let i = 0; i < 400; i++) {
    // Twice: one requestNextTask can settle a stage and leave the next one to the following call
    // (production's client retries; see TaskRunner's routing backoff).
    await poll(s);
    await poll(s);
    assertSafe(s);
    if (s.team.status === 'finished') return;
    const res = tryComplete(s);
    assertSafe(s);
    if (res === 'done') continue;
    if (res === 'locked' || res === 'exclusiveTaken' || res === 'notReleased') {
      fail(s, `the team holds a mission it cannot complete: ${res}`);
    }
    // Nothing to do right now: let time pass to the next gate (or a little).
    const next = nextInterestingInstant(s);
    if (next === null && res === 'nothing held') {
      fail(s, `STRANDED: no mission to play, nothing left to wait for (stage ${s.team.stages[activeIdx(s)]?.stageId} records ${JSON.stringify(s.team.stages[activeIdx(s)]?.tasks.map((t) => [t.taskId, t.status, t.skipCause]))})`);
    }
    s.now = next ?? s.now + 60_000;
  }
  fail(s, 'did not finish within 400 drain steps');
}

async function play(seed: number) {
  const r = rng(seed);
  const game = genGame(r);
  const team = { id: 't', stages: buildInitialStages(clone(game)), status: 'active', launched: true, score: 0 } as unknown as RunTeam;
  const s: Sim = { game, team, overrides: {}, now: L, log: [`seed ${seed}`, `game ${JSON.stringify(game.stages.map((g) => ({ id: g.id, req: g.requiredTaskCount, rel: g.releaseAfterMinutes, ex: g.exclusiveGroups?.map((x) => x.taskIds), t: g.tasks.map((t) => [t.id, t.unlockAfterTaskIds, t.hidden ? 'H' : '', t.releaseAfterMinutes, t.expiresAfterMinutes, t.expiresAt ? 'abs' : '', t.timeLimitMinutes]) })))}`] };
  // Same as launchRun's late-joiner path: nothing to do on a fresh run.
  assertSafe(s);
  const steps = r.int(5, 40);
  for (let i = 0; i < steps && s.team.status !== 'finished'; i++) {
    const roll = r.next();
    const allIds = s.game.stages.flatMap((g) => playableTasks(g).map((t) => t.id));
    if (roll < 0.30) await poll(s);
    else if (roll < 0.50) tryComplete(s);
    else if (roll < 0.62) { s.now += r.int(1, 25) * 60_000; s.log.push(`+time → ${(s.now - L) / 60_000}m`); }
    else if (roll < 0.70 && allIds.length) setStatus(s, r.pick(allIds), r.pick(['paused', 'active'] as StationStatus[]), r);
    else if (roll < 0.75 && allIds.length) setStatus(s, r.pick(allIds), 'closed', r);
    else if (roll < 0.81) skipOne(s, r);
    else if (roll < 0.87) forceAssign(s, r);
    else if (roll < 0.92) rewind(s, r);
    else editTemplate(s, r);
    assertSafe(s);
  }
  await drain(s);
}

describe('run liveness: no combination of rules and live ops strands a team', () => {
  const only = process.env.RUSHPOINT_LIVENESS_SEED;
  const N = Number(process.env.RUSHPOINT_LIVENESS_N ?? 3000);
  test(`${only ? `seed ${only}` : `${N} seeded games`} — every team can play to the finish`, async () => {
    const seeds = only ? [Number(only)] : Array.from({ length: N }, (_, i) => i + 1);
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
