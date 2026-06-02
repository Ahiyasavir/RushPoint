// state.mjs — single source of truth (state.json): load, atomic save, init, recovery.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const GOAL_PHASES = [
  'structure', // 1. clean up project structure / organization
  'features',  // 2. improve existing features (smarter + more reliable)
  'ui',        // 3. polished, fast, attractive UI
  'social',    // 4. healthy, fair social sharing
  'admin',     // 5. better admin / control-room tooling
  'continuous' // 6. keep proposing the next most valuable improvement
];

// Product-first starter backlog. Each task carries the 5 scoring dimensions (0–5):
//   dims = { userImpact, adminImpact, reliability, productRisk, cleanupValue }
// plus engineering `risk`/`effort` (1–5) used for implementer model routing.
// The selector re-ranks, downgrades risky items into safe subtasks, and tops up with stronger
// product tasks when the backlog gets weak.
export function seedBacklog() {
  const t = (id, goal, title, dims, effort, risk, notes) => ({
    id, goal, title,
    dims: {
      userImpact: dims[0], adminImpact: dims[1], reliability: dims[2],
      productRisk: dims[3], cleanupValue: dims[4]
    },
    effort, risk, deps: [],
    source: 'seed', status: 'backlog', createdCycle: 0, notes: notes || ''
  });
  return [
    // 1) Smart stations & autonomous task verification
    t('P-001', 'stations', 'Autonomous station verification: scanning a station QR/code auto-validates the mission and advances the slot without a judge (server-authoritative, anti-cheat)', [5, 5, 4, 5, 0], 5, 4,
      'Flagship "smart" feature. Large — selector should downgrade to a safe first slice (e.g. server-side QR validation callable behind a flag) and build up.'),
    t('P-002', 'stations', 'Station operator console: live team queue with one-tap pass/fail + reason, reducing manual radio coordination on event day', [3, 5, 4, 4, 0], 4, 3,
      'Builds on getStationTeams/stationReleaseTeam.'),
    // 2) Access code management
    t('P-003', 'access', 'Admin access-code management page: generate, list, search, and revoke event codes with live claim/team status', [2, 5, 4, 4, 0], 4, 3,
      'Organizers currently have no UI to manage codes; seeded only via scripts.'),
    // 3) Game builder & station editor UX
    t('P-004', 'builder', 'Station/task editor in admin: create & edit stations (title/titleHe, location, difficulty, capacity, status) without seed scripts', [3, 5, 3, 4, 0], 5, 4,
      'Foundational for self-service event setup. Downgrade to edit-existing before create-new if needed.'),
    // 4) Admin control room & review queue
    t('P-005', 'admin', 'Control-room "needs attention" dashboard: SOS, timed-out teams, stalled stations, and pending reviews in one prioritized live view', [2, 5, 5, 4, 0], 3, 3,
      'Single pane of glass for the event manager.'),
    t('P-006', 'review', 'Judge review queue upgrade: sort pending check-ins by wait time with SLA/timeout warnings and clear next action', [3, 5, 4, 3, 0], 3, 3, ''),
    // 5) Social sharing & event reward
    t('P-007', 'social', 'Opt-in, fair post-event share card (feature-flagged, no dark patterns, never gates gameplay) celebrating the team result', [4, 2, 1, 2, 0], 3, 3,
      'Healthy visibility reward only; reviewer must reject anything manipulative.'),
    // 6) Team flow, matchmaking, scoring, gameplay
    t('P-008', 'gameplay', 'Harden matchmaking correctness: idempotent join, no double-match, correct loser re-queue, clear surfaced errors', [4, 3, 5, 4, 0], 3, 3, ''),
    t('P-009', 'gameplay', 'Player dashboard clarity: explicit next-step guidance + robust loading/empty/error states so teams always know what to do', [5, 1, 3, 3, 0], 3, 2, ''),
    t('P-010', 'gameplay', 'registerTeam robustness: validate input, handle duplicate/edge access codes, return clear typed error codes', [4, 3, 4, 3, 0], 3, 3, ''),
    // 7) Reliability, recovery, event-day robustness
    t('P-011', 'reliability', 'Mobile offline/recovery resilience: graceful reconnect + gameState resync after network loss during the event', [4, 2, 5, 4, 0], 4, 3, ''),
    t('P-012', 'reliability', 'Event-day readiness check: a script/page that verifies seed integrity, callable health, and config before doors open', [1, 4, 5, 4, 0], 3, 2, ''),
    // Cleanup — intentionally low-scoring; only chosen if it unblocks product work or fixes validation
    t('C-001', 'structure', 'Remove committed debug logs (firebase-debug.log, firestore-debug.log, .emulator-log.txt) and ensure they are gitignored', [0, 0, 1, 0, 4], 1, 1,
      'Pure cleanup; pick only when nothing product-facing is ready or it unblocks a product task.')
  ];
}

export function emptyState() {
  return {
    version: 1,
    startedAt: null,
    deadlineAt: null,
    lastUpdated: null,
    cycle: 0,
    status: 'idle', // idle | running | paused-ratelimit | done
    goalPhase: 'structure',
    rateLimit: { pausedUntil: null, consecutiveHits: 0 },
    current: null, // active task during a cycle (re-queued on recovery)
    queues: { backlog: [], done: [], blocked: [] },
    stats: { cyclesRun: 0, completed: 0, blocked: 0, revisions: 0, rateLimitPauses: 0 },
    history: [] // compact: { cycle, taskId, title, outcome, ts }
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export async function ensureDirs(dirs) {
  for (const d of dirs) if (!existsSync(d)) await mkdir(d, { recursive: true });
}

export async function loadState(statePath) {
  const raw = await readFile(statePath, 'utf8');
  return JSON.parse(raw);
}

// Atomic write: tmp file + rename, so a crash mid-write can't corrupt state.json.
export async function saveState(statePath, state) {
  state.lastUpdated = nowIso();
  const tmp = statePath + '.tmp';
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, statePath);
}

export async function initState(statePath, config) {
  const state = emptyState();
  state.startedAt = nowIso();
  state.deadlineAt = new Date(Date.now() + config.durationDays * 86400000).toISOString();
  state.status = 'running';
  state.queues.backlog = seedBacklog();
  await saveState(statePath, state);
  return state;
}

export function nextTaskId(state) {
  const all = [...state.queues.backlog, ...state.queues.done, ...state.queues.blocked];
  if (state.current) all.push(state.current);
  let max = 0;
  for (const t of all) {
    const n = parseInt(String(t.id || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return 'T-' + String(max + 1).padStart(4, '0');
}

export function isPastDeadline(state) {
  return state.deadlineAt && Date.now() >= new Date(state.deadlineAt).getTime();
}
