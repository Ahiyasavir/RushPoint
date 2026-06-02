#!/usr/bin/env node
// supervisor.mjs — RushPoint Autopilot: a persistent external supervisor that runs Claude Opus 4.8 in
// repeated work cycles for five days. It selects the next task, has one agent implement it and another
// review it, validates, persists progress, pauses on rate limits, and resumes from disk after restart.
//
// Usage:
//   node autopilot/supervisor.mjs init     # seed state/ + starter backlog, set the 5-day deadline
//   node autopilot/supervisor.mjs run      # start / resume the autonomous loop (same command)
//   node autopilot/supervisor.mjs status   # print a snapshot without touching the loop

import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOAL_PHASES, emptyState, initState, loadState, saveState, ensureDirs,
  nextTaskId, isPastDeadline, nowIso, seedBacklog
} from './lib/state.mjs';
import { runClaude, RateLimitError } from './lib/claude.mjs';
import { pickImplementerModel } from './lib/route.mjs';
import { rankBacklog, scoreTask, isCleanup, isProduct, productShare } from './lib/score.mjs';
import * as git from './lib/git.mjs';
import { runValidation } from './lib/validate.mjs';
import { writeMirrors, appendDecision, ensureDecisionLogHeader } from './lib/files.mjs';
import { ingestInbox, addInboxTask, ensureInbox } from './lib/inbox.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(__dirname, 'state');
const HANDOFF_DIR = path.join(STATE_DIR, 'handoff');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const PROMPT_DIR = path.join(__dirname, 'prompts');
const INBOX_DIR = path.join(__dirname, 'inbox');
const LOCK_PATH = path.join(STATE_DIR, 'supervisor.lock');

const config = JSON.parse(await readFile(path.join(__dirname, 'config.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[autopilot ${new Date().toISOString()}]`, ...a);

// ---------- prompt rendering ----------
async function renderPrompt(name, vars) {
  let tpl = await readFile(path.join(PROMPT_DIR, `${name}.md`), 'utf8');
  for (const [k, v] of Object.entries(vars)) tpl = tpl.replaceAll(`{{${k}}}`, String(v));
  return tpl;
}

function fmtTasks(tasks, max = 30) {
  if (!tasks.length) return '(none)';
  return tasks.slice(0, max).map((t) =>
    `- ${t.id} [${t.goal}] ${t.title} (risk ${t.risk}/effort ${t.effort})` +
    (t.blockReason ? ` — blocked: ${t.blockReason}` : '')
  ).join('\n');
}

// Normalize the 5 scoring dimensions coming from the selector (clamped 0–5).
function normDims(d) {
  const g = (k) => Math.max(0, Math.min(5, Number((d || {})[k]) || 0));
  return {
    userImpact: g('userImpact'), adminImpact: g('adminImpact'), reliability: g('reliability'),
    productRisk: g('productRisk'), cleanupValue: g('cleanupValue')
  };
}

// Ranked candidate list (with scores + one-line reasons) for the cycle log and the selector prompt.
function fmtRanked(ranked, max = 12) {
  return ranked.slice(0, max).map((x, i) =>
    `${i + 1}. ${x.task.id} ${x.task.userRequested ? '★[USER REQUEST — MUST PICK FIRST]' : `[${x.cleanup ? 'cleanup' : 'product'}]`} score=${x.total} — ${x.task.title}\n` +
    `     why: ${x.task.userRequested ? 'the user explicitly asked for this' : x.reason}` + (x.task.risk ? ` · risk ${x.task.risk}/5 effort ${x.task.effort}/5` : '')
  ).join('\n');
}

async function readHandoff(file) {
  const p = path.join(HANDOFF_DIR, file);
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, 'utf8');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch { return null; }
}

async function clearHandoff() {
  await rm(HANDOFF_DIR, { recursive: true, force: true });
  await mkdir(HANDOFF_DIR, { recursive: true });
}

// ---------- one Claude role invocation ----------
async function invokeRole(name, vars, modelOverride) {
  const prompt = await renderPrompt(name, vars);
  const model = modelOverride || config.models?.[name] || config.model;
  log(`→ claude (${name} · ${model})`);
  const res = await runClaude({ prompt, cwd: REPO_ROOT, config, label: name, model });
  if (!res.ok) log(`  (${name} returned is_error; continuing to inspect handoff)`);
  return res;
}

// ---------- a single improvement cycle ----------
async function runCycle(state) {
  state.cycle += 1;
  state.stats.cyclesRun += 1;
  await clearHandoff();
  log(`===== Cycle ${state.cycle} =====`);

  // INBOX: pull in any tasks the user dropped since last cycle. They go to the FRONT of the backlog
  // and (via score.mjs userBoost) outrank everything, so a user request is always picked next.
  const userTasks = await ingestInbox(INBOX_DIR, state, state.cycle).catch((e) => { log('inbox read error:', e.message); return []; });
  if (userTasks.length) {
    for (const ut of userTasks) {
      const dup = [...state.queues.backlog, ...state.queues.done, ...state.queues.blocked].some((t) => t.id === ut.id);
      if (!dup) state.queues.backlog.unshift(ut);
    }
    state.stats.userTasksIngested = (state.stats.userTasksIngested || 0) + userTasks.length;
    log(`📥 Ingested ${userTasks.length} USER task(s) from inbox — they take priority:`);
    for (const ut of userTasks) log(`   • ${ut.id} [${ut.goal}] ${ut.title}`);
    await saveState(STATE_PATH, state);
  }

  // Rank the backlog with the product-first scoring model and PRINT the top 5 candidates.
  const ranked = rankBacklog(state.queues.backlog, config);
  const share = productShare(state.queues.backlog);
  const productCount = state.queues.backlog.filter(isProduct).length;
  const weakBacklog = share < config.scoring.minProductShare || productCount < config.scoring.minProductTasks;
  log(`Top candidate tasks (product-first; ${Math.round(share * 100)}% product, ${productCount} product task(s)):`);
  for (const line of fmtRanked(ranked, 5).split('\n')) log('  ' + line);
  if (weakBacklog) log('Backlog is weak on product value — selector will generate stronger product tasks.');

  const weakNote = weakBacklog
    ? `\n## BACKLOG IS WEAK (only ${Math.round(share * 100)}% product, ${productCount} product tasks)\n` +
      `Before selecting, you MUST add several strong, concrete, product-facing tasks to "newBacklog" ` +
      `(smart stations, admin/control-room, access codes, game builder, review queue, social, gameplay, ` +
      `reliability) so at least 70% of the backlog is product work. Then select the best product task.\n`
    : '';

  // 1) SELECT --------------------------------------------------------------
  await invokeRole('selector', {
    CANDIDATES: fmtRanked(ranked) || '(backlog empty)',
    WEAK_BACKLOG: weakNote,
    DONE: fmtTasks(state.queues.done),
    BLOCKED: fmtTasks(state.queues.blocked),
    NEXT_ID: nextTaskId(state),
    HANDOFF_PATH: path.join('autopilot', 'state', 'handoff', 'selection.json').replaceAll('\\', '/')
  });

  const selection = await readHandoff('selection.json');
  if (!selection?.selected) {
    log('Selector produced no task. Skipping cycle.');
    return { outcome: 'no-task' };
  }

  // Merge any newly proposed backlog tasks (dedup by id/title).
  if (Array.isArray(selection.newBacklog)) {
    for (const nt of selection.newBacklog) {
      const exists = [...state.queues.backlog, ...state.queues.done, ...state.queues.blocked]
        .some((t) => t.id === nt.id || t.title === nt.title);
      if (!exists && nt.title) {
        state.queues.backlog.push({
          id: nt.id || nextTaskId(state), goal: nt.goal || 'gameplay', title: nt.title,
          dims: normDims(nt.dims), risk: nt.risk ?? 3, effort: nt.effort ?? 3, deps: nt.deps || [],
          source: 'selector', status: 'backlog', createdCycle: state.cycle, notes: nt.notes || ''
        });
      }
    }
  }

  // Resolve the chosen task object (reuse existing backlog item if id matches, else create).
  const sel = selection.selected;
  let task = state.queues.backlog.find((t) => t.id === sel.id || t.title === sel.title);
  if (!task) {
    task = { id: sel.id || nextTaskId(state), goal: sel.goal || 'gameplay', title: sel.title,
      dims: normDims(sel.dims), risk: sel.risk ?? 3, effort: sel.effort ?? 3, deps: [],
      source: 'selector', status: 'backlog', createdCycle: state.cycle, notes: '' };
  }

  // HARD GUARANTEE: if the user has pending inbox tasks, one of them is ALWAYS worked on next —
  // even if the selector ignored it. Pick the earliest pending user task and (if the selector's
  // spec was for a different task) synthesize the spec from the user's own description.
  const pendingUser = state.queues.backlog
    .filter((t) => t.userRequested)
    .sort((a, b) => (a.userTaskSeq || 0) - (b.userTaskSeq || 0) || String(a.id).localeCompare(String(b.id)));
  if (pendingUser.length && !task.userRequested) {
    const forced = pendingUser[0];
    log(`⚑ Overriding selector — pending USER task ${forced.id} takes priority over ${task.id}.`);
    if (sel.id !== forced.id && sel.title !== forced.title) {
      // selector didn't spec this one → carry the user's request straight through as the spec
      sel.acceptanceCriteria = forced.acceptanceCriteria || [];
      sel.implementationHints = forced.implementationHints || [];
      sel.rationale = `User-requested via inbox. ${forced.notes || ''}`.trim();
      sel.whyBeatAlternatives = 'Direct user request — always takes priority.';
      sel.visibleValue = forced.title;
      sel.dims = forced.dims;
      sel.goal = forced.goal;
      sel.risk = forced.risk;
      sel.effort = forced.effort;
      sel.downgradedFrom = null;
    }
    task = forced;
  }

  // enrich with this cycle's spec
  task.goal = sel.goal || task.goal;
  if (sel.dims) task.dims = normDims(sel.dims);
  task.risk = sel.risk ?? task.risk;
  task.effort = sel.effort ?? task.effort;
  task.acceptanceCriteria = sel.acceptanceCriteria || [];
  task.implementationHints = sel.implementationHints || [];
  task.rationale = sel.rationale || '';
  task.whyBeatAlternatives = sel.whyBeatAlternatives || '';
  task.visibleValue = sel.visibleValue || '';
  task.safeToContinue = sel.safeToContinue !== false;
  task.downgradedFrom = sel.downgradedFrom || null;
  task.status = 'in-progress';
  const taskScore = scoreTask(task, config);
  task.score = taskScore.total;
  log(`Selected ${task.id} (score ${taskScore.total}, ${isCleanup(task) ? 'cleanup' : 'product'}): ${task.title}`);

  // remove from backlog, set as current (so recovery can re-queue it)
  state.queues.backlog = state.queues.backlog.filter((t) => t !== task && t.id !== task.id);
  state.current = task;
  await saveState(STATE_PATH, state);

  // Decide the implementer model for THIS task (Sonnet only for low-risk engineering).
  const route = pickImplementerModel(task, config);
  task.implementerModel = route.model;
  task.implementerTier = route.tier;
  task.implementerReason = route.reason;
  log(`Implementer model → ${route.tier.toUpperCase()} (${route.model}) — ${route.reason}`);

  // 2) SNAPSHOT + IMPLEMENT/REVIEW loop -----------------------------------
  // Work happens directly on the integration branch; we snapshot HEAD and, on any non-approval,
  // reset --hard back to it. No cycle branches (those raced with the implementer's own git in a
  // shared worktree and let unreviewed commits leak onto main).
  await git.ensureOnIntegration(REPO_ROOT, config.git.integrationBranch);
  const baseSha = await git.revParse(REPO_ROOT, 'HEAD');
  task.baseSha = baseSha;
  await saveState(STATE_PATH, state);

  const taskJson = JSON.stringify({
    id: task.id, title: task.title, goal: task.goal,
    acceptanceCriteria: task.acceptanceCriteria, implementationHints: task.implementationHints,
    rationale: task.rationale, downgradedFrom: task.downgradedFrom
  }, null, 2);

  let verdict = 'reject';
  let review = null;
  let impl = null;
  let attempt = 0;
  let validation = { ok: false, summary: 'not run' };
  let revisionBlock = '';

  while (attempt <= config.cycle.maxReviseAttempts) {
    // IMPLEMENT (model chosen by risk/category routing above)
    await invokeRole('implementer', {
      TASK_JSON: taskJson,
      CYCLE_BRANCH: config.git.integrationBranch,
      REVISION_BLOCK: revisionBlock,
      HANDOFF_PATH: path.join('autopilot', 'state', 'handoff', 'implementation.json').replaceAll('\\', '/')
    }, route.model);
    impl = await readHandoff('implementation.json');

    // Make sure we're back on the integration branch (the implementer may have switched branches)
    // and capture any uncommitted work it left behind. All commits accumulate on integration and
    // are rolled back to baseSha if the cycle isn't approved.
    await git.checkoutIntegrationKeepingWork(REPO_ROOT, config.git.integrationBranch);
    const autoCommitted = await git.commitAllIfDirty(REPO_ROOT, `${config.git.commitPrefix}: ${task.id} ${task.title}`);
    if (autoCommitted) log('Captured implementer changes on integration branch.');

    // VALIDATE (deterministic)
    log('Running validation…');
    validation = await runValidation(config, REPO_ROOT);
    log(`Validation: ${validation.summary}`);

    // REVIEW (independent agent)
    await invokeRole('reviewer', {
      TASK_JSON: taskJson,
      IMPL_REPORT: JSON.stringify(impl || { summary: 'no handoff written' }, null, 2),
      VALIDATION: validation.summary + '\n' + validation.results.map((r) => `${r.name}: ${r.ok ? 'ok' : r.tail}`).join('\n'),
      INTEGRATION_BRANCH: config.git.integrationBranch,
      HANDOFF_PATH: path.join('autopilot', 'state', 'handoff', 'review.json').replaceAll('\\', '/')
    });
    review = await readHandoff('review.json');
    verdict = review?.verdict || 'reject';
    log(`Review verdict: ${verdict}`);

    if (verdict === 'approve' && validation.ok) break;
    if (verdict === 'reject') break;
    // verdict === 'revise' (or approve-but-validation-failed) → another bounded attempt
    attempt += 1;
    state.stats.revisions += 1;
    if (attempt > config.cycle.maxReviseAttempts) break;
    const fixes = (review?.requiredFixes || []).join('\n - ') || 'Address the reviewer reasons and fix failing validation.';
    revisionBlock = `## Reviewer requested changes (revision ${attempt})\nFix these precisely, then re-commit:\n - ${fixes}\n` +
      (validation.ok ? '' : `\nValidation is currently FAILING: ${validation.summary}. Make it pass.\n`);
    log(`Revision ${attempt} requested.`);
  }

  // 3) FINALIZE -----------------------------------------------------------
  const approved = verdict === 'approve' && validation.ok;
  // Did the cycle actually produce committed work? (HEAD moved past the snapshot.)
  const headSha = await git.revParse(REPO_ROOT, 'HEAD');
  const hasWork = headSha !== baseSha;
  const diffStat = hasWork ? (await git.diffAgainst(REPO_ROOT, baseSha)).trim() : '';
  const appImpact = impl?.appImpact || impl?.summary || '(no impact statement)';
  let outcome;
  if (approved && hasWork) {
    // Work is already committed on the integration branch — keep it.
    outcome = 'merged';
    // PROOF OF PROGRESS — mandatory product-delivery report.
    log('───── USER IMPACT SUMMARY ─────');
    log('  ' + (impl?.userImpactSummary || appImpact));
    log('───── WHAT IS NOW LIVE IN THE PRODUCT ─────');
    log('  ' + (impl?.nowLive || appImpact));
    log('───── WHAT A PLAYER SEES DIFFERENTLY ─────');
    log('  ' + (impl?.playerVisibleChange || '(implementer did not specify)'));
    log('───── FILE-LEVEL DIFF ─────');
    if (diffStat) for (const l of diffStat.split('\n')) log('  ' + l);
    task.status = 'done';
    task.doneCycle = state.cycle;
    state.queues.done.push(task);
    state.stats.completed += 1;
  } else if (approved && !hasWork) {
    // Approved but NOTHING was committed — the work didn't actually ship. Never mark this "done".
    task.noChangeAttempts = (task.noChangeAttempts || 0) + 1;
    if (task.noChangeAttempts >= config.scoring.maxAttemptsBeforeBlock) {
      task.status = 'blocked';
      task.blockReason = `produced no visible product change in ${task.noChangeAttempts} cycles — needs manual breakdown`;
      state.queues.blocked.push(task);
      state.stats.blocked += 1;
      outcome = 'blocked-no-change';
    } else {
      task.status = 'backlog';
      task.forceDowngrade = true;
      task.notes = (task.notes || '') + ` [retry ${task.noChangeAttempts}: shipped no visible change — BREAK INTO A SMALLER DELIVERABLE STEP that produces a user/admin-visible change this cycle]`;
      state.queues.backlog.unshift(task);
      outcome = 're-queued-smaller';
    }
  } else {
    // Not approved → roll the integration branch back to the pre-cycle snapshot (discard all commits).
    await git.resetHard(REPO_ROOT, baseSha);
    task.status = 'blocked';
    task.blockReason = verdict === 'reject'
      ? (review?.reasons?.join('; ') || 'rejected by reviewer')
      : `did not pass review/validation after ${config.cycle.maxReviseAttempts} revision(s); ${validation.summary}`;
    state.queues.blocked.push(task);
    state.stats.blocked += 1;
    outcome = 'blocked';
  }

  // advance goal phase if recommended and backlog of this phase is thin
  if (selection.recommendedPhase && selection.recommendedPhase !== state.goalPhase &&
      GOAL_PHASES.includes(selection.recommendedPhase)) {
    state.goalPhase = selection.recommendedPhase;
    log(`Advancing goal phase → ${state.goalPhase}`);
  }

  // record + persist
  state.current = null;
  state.history.push({ cycle: state.cycle, taskId: task.id, title: task.title, outcome, ts: nowIso() });
  await appendDecision(STATE_DIR, {
    cycle: state.cycle, ts: nowIso(), taskId: task.id, title: task.title, goalPhase: task.goal,
    rationale: task.rationale, downgradedFrom: task.downgradedFrom, validation: validation.summary,
    whyBeatAlternatives: task.whyBeatAlternatives, visibleValue: task.visibleValue,
    safeToContinue: task.safeToContinue,
    verdict, reviseAttempts: attempt, outcome,
    implementerModel: `${task.implementerTier} (${task.implementerModel}) — ${task.implementerReason}`,
    score: `${task.score} (${isCleanup(task) ? 'cleanup' : 'product'})`,
    proof: outcome === 'merged' ? {
      userImpact: impl?.userImpactSummary || appImpact,
      nowLive: impl?.nowLive || appImpact,
      playerSees: impl?.playerVisibleChange || '(unspecified)'
    } : null,
    evidence: outcome === 'merged' ? `${appImpact}\n\n    ${diffStat.replace(/\n/g, '\n    ')}` : null,
    notes: [impl?.notes, review?.riskNotes].filter(Boolean).join(' | ')
  });
  await writeMirrors(STATE_DIR, state);
  await saveState(STATE_PATH, state);
  log(`Cycle ${state.cycle} → ${outcome}`);
  return { outcome };
}

// ---------- rate-limit pause ----------
async function pauseForRateLimit(state, err) {
  state.rateLimit.consecutiveHits += 1;
  state.stats.rateLimitPauses += 1;
  const backoff = Math.min(
    config.rateLimit.baseCooldownMs * state.rateLimit.consecutiveHits,
    config.rateLimit.maxCooldownMs
  );
  const wait = err.retryAfterMs && err.retryAfterMs > 0 ? err.retryAfterMs : backoff;
  state.rateLimit.pausedUntil = new Date(Date.now() + wait).toISOString();
  state.status = 'paused-ratelimit';

  // Roll the integration branch back to this cycle's snapshot (discard partial work) and re-queue.
  if (state.current) {
    if (state.current.baseSha) await git.resetHard(REPO_ROOT, state.current.baseSha).catch(() => {});
    state.current.status = 'backlog';
    state.queues.backlog.unshift(state.current);
    state.current = null;
  }
  await saveState(STATE_PATH, state);
  log(`RATE LIMIT — pausing ${Math.round(wait / 60000)} min (until ${state.rateLimit.pausedUntil}).`);
  await sleep(wait);
  state.status = 'running';
  await saveState(STATE_PATH, state);
}

// ---------- recovery on startup ----------
async function recover(state) {
  await git.ensureIntegrationBranch(REPO_ROOT, config.git.integrationBranch, config.git.baseBranch);
  if (state.current) {
    log(`Recovering interrupted cycle: rolling back + re-queuing ${state.current.id}`);
    // Discard any partial commits from the interrupted cycle by resetting to its snapshot.
    if (state.current.baseSha) await git.resetHard(REPO_ROOT, state.current.baseSha).catch(() => {});
    state.current.status = 'backlog';
    if (!state.queues.backlog.some((t) => t.id === state.current.id)) {
      state.queues.backlog.unshift(state.current);
    }
    state.current = null;
  }
  await git.ensureOnIntegration(REPO_ROOT, config.git.integrationBranch);
  // honor an outstanding rate-limit cooldown
  if (state.rateLimit.pausedUntil) {
    const wait = new Date(state.rateLimit.pausedUntil).getTime() - Date.now();
    if (wait > 0) { log(`Resuming after rate-limit cooldown (${Math.round(wait / 60000)} min)…`); await sleep(wait); }
    state.rateLimit.pausedUntil = null;
  }
  state.status = 'running';
  await saveState(STATE_PATH, state);
}

// ---------- top-level commands ----------
async function cmdInit() {
  await ensureDirs([STATE_DIR, HANDOFF_DIR]);
  if (existsSync(STATE_PATH)) {
    log('state.json already exists — refusing to overwrite. Delete autopilot/state/ to re-init.');
    return;
  }
  const state = await initState(STATE_PATH, config);
  await ensureDecisionLogHeader(STATE_DIR, state);
  await writeMirrors(STATE_DIR, state);
  log(`Initialized. Deadline: ${state.deadlineAt}. Backlog: ${state.queues.backlog.length} task(s).`);
  log('Start with: node autopilot/supervisor.mjs run');
}

// Replace the backlog with the fresh product-first seed, skipping anything already done/blocked.
// Preserves done/blocked history, stats, cycle counter, and the deadline.
async function cmdReprioritize() {
  if (!existsSync(STATE_PATH)) return log('No state yet. Run: node autopilot/supervisor.mjs init');
  const s = await loadState(STATE_PATH);
  const seenTitles = new Set([...s.queues.done, ...s.queues.blocked].map((t) => t.title));
  const fresh = seedBacklog().filter((t) => !seenTitles.has(t.title));
  const before = s.queues.backlog.length;
  s.queues.backlog = fresh;
  await saveState(STATE_PATH, s);
  await writeMirrors(STATE_DIR, s);
  log(`Reprioritized backlog: ${before} → ${fresh.length} product-first task(s) (done/blocked preserved).`);
  await cmdRoute();
}

async function cmdRoute() {
  if (!existsSync(STATE_PATH)) return log('No state yet. Run: node autopilot/supervisor.mjs init');
  const s = await loadState(STATE_PATH);
  const ranked = rankBacklog(s.queues.backlog, config);
  console.log(`\nProduct-first ranking (${Math.round(productShare(s.queues.backlog) * 100)}% product):\n`);
  ranked.forEach((x, i) => console.log(`  ${i + 1}. ${x.task.id} [${x.cleanup ? 'cleanup' : 'product'}] score=${x.total} — ${x.task.title}\n      ${x.reason}`));
  const rows = s.queues.backlog.map((t) => ({ t, r: pickImplementerModel(t, config) }));
  const sonnet = rows.filter((x) => x.r.tier === 'sonnet');
  const opus = rows.filter((x) => x.r.tier === 'opus');
  console.log(`\nImplementer model routing for ${rows.length} backlog task(s):\n`);
  console.log(`── SONNET (low-risk engineering) — ${sonnet.length} task(s) ──`);
  for (const { t, r } of sonnet) console.log(`  ${t.id} [${t.goal}] ${t.title}\n      → ${r.reason}`);
  if (!sonnet.length) console.log('  (none)');
  console.log(`\n── OPUS (product/UX/arch/admin/social/stations or higher-risk) — ${opus.length} task(s) ──`);
  for (const { t, r } of opus) console.log(`  ${t.id} [${t.goal}] ${t.title}\n      → ${r.reason}`);
  console.log('\nSelector + Reviewer always run on Opus.\n');
}

async function cmdStatus() {
  if (!existsSync(STATE_PATH)) return log('No state yet. Run: node autopilot/supervisor.mjs init');
  const s = await loadState(STATE_PATH);
  log(`status=${s.status} cycle=${s.cycle} phase=${s.goalPhase}`);
  log(`deadline=${s.deadlineAt} (${isPastDeadline(s) ? 'PASSED' : 'active'})`);
  log(`queues: backlog=${s.queues.backlog.length} done=${s.queues.done.length} blocked=${s.queues.blocked.length}`);
  const userPending = s.queues.backlog.filter((t) => t.userRequested);
  if (userPending.length) {
    log(`★ ${userPending.length} USER task(s) pending (built before auto tasks):`);
    for (const t of userPending) log(`   • ${t.id} ${t.title}`);
  }
  if (s.current?.userRequested) log(`★ currently building USER task ${s.current.id}: ${s.current.title}`);
  log(`stats:`, JSON.stringify(s.stats));
  const running = existsSync(LOCK_PATH) && pidAlive((() => { try { return JSON.parse(readFileSync(LOCK_PATH, 'utf8')).pid; } catch { return 0; } })());
  log(`supervisor process: ${running ? 'RUNNING' : 'not running'}`);
  if (s.rateLimit.pausedUntil) log(`rate-limit paused until ${s.rateLimit.pausedUntil}`);
}

// True if a process with this pid is currently alive.
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }      // no signal sent; just checks existence
  catch (e) { return e.code === 'EPERM'; }          // EPERM = exists but not ours; ESRCH = gone
}

// Single-instance guard: refuse to start a 2nd supervisor on the same repo (two running = a git
// race that corrupts cycles — we hit this once). Returns true if the lock was acquired.
async function acquireLock() {
  if (existsSync(LOCK_PATH)) {
    try {
      const prev = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
      if (prev.pid && prev.pid !== process.pid && pidAlive(prev.pid)) {
        log(`REFUSING TO START: another supervisor is already running (pid ${prev.pid}, since ${prev.started}).`);
        log('Stop it first, or delete autopilot/state/supervisor.lock if you are sure it is dead.');
        return false;
      }
      log(`Found a stale lock (pid ${prev.pid} is not running) — taking over.`);
    } catch { /* unreadable lock → overwrite */ }
  }
  await writeFile(LOCK_PATH, JSON.stringify({ pid: process.pid, started: nowIso() }), 'utf8');
  const release = () => {
    try {
      if (existsSync(LOCK_PATH)) {
        const l = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
        if (l.pid === process.pid) rmSync(LOCK_PATH);
      }
    } catch { /* ignore */ }
  };
  process.on('exit', release);
  process.on('SIGINT', release);
  process.on('SIGTERM', release);
  return true;
}

async function cmdRun() {
  if (!existsSync(STATE_PATH)) { log('No state. Run init first.'); return; }
  await ensureDirs([STATE_DIR, HANDOFF_DIR]);
  await ensureInbox(INBOX_DIR);
  if (!(await acquireLock())) return;
  let state = await loadState(STATE_PATH);

  // graceful shutdown — state is already flushed each step, this just records intent
  let stopping = false;
  process.on('SIGINT', async () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('SIGINT — finishing safely; state is on disk. Press Ctrl+C again to force.');
  });

  await recover(state);

  while (!isPastDeadline(state) && !stopping) {
    try {
      await runCycle(state);
    } catch (err) {
      if (err instanceof RateLimitError) {
        await pauseForRateLimit(state, err);
        continue;
      }
      // Non-fatal cycle error: roll back to snapshot, re-queue, keep the run alive.
      log('Cycle error:', err.message);
      if (state.current?.baseSha) await git.resetHard(REPO_ROOT, state.current.baseSha).catch(() => {});
      await git.ensureOnIntegration(REPO_ROOT, config.git.integrationBranch).catch(() => {});
      if (state.current) {
        state.current.status = 'backlog';
        state.queues.backlog.unshift(state.current);
        state.current = null;
      }
      await saveState(STATE_PATH, state);
      await sleep(15000);
      continue;
    }
    state.rateLimit.consecutiveHits = 0;
    await saveState(STATE_PATH, state);
    await sleep(config.cycle.cooldownBetweenCyclesMs);
  }

  state.status = 'done';
  await saveState(STATE_PATH, state);
  await writeMirrors(STATE_DIR, state);
  log(isPastDeadline(state) ? '5-day deadline reached. Run complete.' : 'Stopped. Resume with: node autopilot/supervisor.mjs run');
}

// Drop a task into the inbox from the CLI (works while the loop is running — picked up next cycle).
//   node autopilot/supervisor.mjs add "make the leaderboard pulse when a team is overtaken"
async function cmdAdd() {
  const text = process.argv.slice(3).join(' ').trim();
  if (!text) {
    log('Usage: node autopilot/supervisor.mjs add "<what you want built>"');
    log('  Optional first lines inside a longer task:  goal: ui   risk: 2   effort: 2');
    process.exit(1);
  }
  await ensureInbox(INBOX_DIR);
  const file = await addInboxTask(INBOX_DIR, text);
  log(`📥 Queued user task → ${path.relative(REPO_ROOT, file)}`);
  log('It will be picked up at the start of the next cycle and built before any auto task.');
  if (existsSync(LOCK_PATH) && pidAlive(JSON.parse(readFileSync(LOCK_PATH, 'utf8')).pid || 0)) {
    log('A supervisor is running — it will ingest this automatically.');
  } else {
    log('No supervisor running — start it with:  node autopilot/supervisor.mjs run');
  }
}

// ---------- entry ----------
const cmd = process.argv[2] || 'run';
try {
  if (cmd === 'init') await cmdInit();
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'route') await cmdRoute();
  else if (cmd === 'reprioritize') await cmdReprioritize();
  else if (cmd === 'add') await cmdAdd();
  else if (cmd === 'run' || cmd === 'resume') await cmdRun();
  else { log(`Unknown command "${cmd}". Use: init | run | status | add "task" | route | reprioritize`); process.exit(1); }
} catch (err) {
  log('Fatal:', err.stack || err.message);
  process.exit(1);
}
