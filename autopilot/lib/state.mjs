// state.mjs — single source of truth (state.json): load, atomic save, init, recovery.
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
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
  // CURATED for the `topographic-maps` branch (2026-06-02). That branch is ~feature-complete
  // (smart-station verification, access-code mgmt, station builder, station reviews, Tene, topo
  // maps, SOS hold-to-fire, wrapped — all ALREADY SHIPPED). So this backlog is deliberately scoped
  // to (a) the ONE genuinely-missing feature verified absent on this branch, and (b) visible
  // polish & hardening of EXISTING surfaces. Every task says "enhance existing X — do not rebuild".
  return [
    // === The one genuinely-missing feature (verified: no control-room / needs-attention view on this branch) ===
    t('F-CTRL', 'admin', 'Control-room "needs attention" dashboard: one prioritized live view of active SOS alerts, teams past their station time cap, paused/closed stations, and pending judge reviews', [2, 5, 5, 4, 0], 3, 3,
      'VERIFIED ABSENT on topographic-maps (no control-room/triage page exists). New admin page + nav entry for the manager role. Read-ONLY aggregation of EXISTING live sources (adminAlerts snapshot, listPendingArrivals, listTeams, task status + maxDurationMinutes) — add NO new gameState/score writes, reuse the existing acknowledge action. Bilingual EN/HE + RTL logical classes + the premium theme.'),

    // === Visible polish & hardening of EXISTING surfaces (low regression risk; enhance, never rebuild) ===
    t('H-DASH', 'gameplay', 'Player dashboard clarity: add explicit next-step guidance + robust loading / empty / error states so a team always knows what to do', [5, 1, 3, 3, 0], 3, 2,
      'POLISH the EXISTING apps/mobile/app/dashboard.tsx. Purely additive UI states; preserve every current behavior and the premium theme. EN/HE parity for any new strings.'),
    t('H-WRAP', 'ui', 'Race Wrapped polish: finish/animate the EXISTING wrapped summary screen (per-team stats, clean shareable layout) without changing how it is reached', [4, 1, 1, 2, 0], 2, 2,
      'apps/mobile/app/wrapped.tsx already exists (~187 lines) — ENHANCE it, do NOT rebuild. Keep it opt-in and non-manipulative.'),
    t('H-REG', 'gameplay', 'registerTeam resilience: validate input and return clear, typed, bilingual error messages for duplicate / claimed / invalid access codes', [4, 3, 4, 3, 0], 3, 3,
      'HARDEN the EXISTING registerTeam callable + the register/access-code screens. Preserve the atomic claim flow exactly; surface friendlier errors on the client.'),
    t('H-OFFLINE', 'reliability', 'Mobile reconnect UX: clear "reconnecting / back online" indicator and a gameState resync nudge after a network drop during the event', [4, 2, 5, 4, 0], 3, 3,
      'BUILD ON the existing offline persistence + useOfflineToast; add a VISIBLE connection-state indicator. Do not change Firestore wiring beyond what is needed for the indicator.'),
    t('H-A11Y', 'ui', 'Accessibility + EN/HE parity audit on the core player screens (access-code, register, dashboard, sos): touch targets, contrast, missing translations, RTL logical classes', [3, 1, 2, 2, 0], 3, 2,
      'Improve EXISTING screens only. Each cycle should ship a visible, checkable improvement (e.g. a fixed untranslated string or a corrected RTL layout), not a sweeping refactor.'),
    t('H-READY', 'reliability', 'Event-day readiness page (admin): one screen that checks seed integrity, callable health, and config and shows a green/red go-live checklist before doors open', [1, 4, 5, 4, 0], 3, 2,
      'New, self-contained admin page that READS existing data + pings existing callables. No changes to game logic.'),

    // === Cleanup — intentionally low-scoring; only if it unblocks the above or fixes validation ===
    t('C-001', 'structure', 'Remove any committed debug logs (firebase-debug.log, firestore-debug.log, .emulator-log.txt) and ensure they are gitignored', [0, 0, 1, 0, 4], 1, 1,
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

// Load state, tolerating a corrupt/truncated file: fall back to the last-good .bak so a single bad
// write (or a kill mid-rename on some FS) can never brick the loop into a crash-restart spiral.
export async function loadState(statePath) {
  const tryParse = async (p) => {
    const raw = await readFile(p, 'utf8');
    if (!raw || !raw.trim()) throw new Error('empty');
    return JSON.parse(raw);
  };
  try {
    return await tryParse(statePath);
  } catch (e) {
    const bak = statePath + '.bak';
    if (existsSync(bak)) {
      try {
        const recovered = await tryParse(bak);
        // promote the backup back to the primary so the next save chain is sane
        await writeFile(statePath, JSON.stringify(recovered, null, 2), 'utf8').catch(() => {});
        return recovered;
      } catch { /* fall through */ }
    }
    throw new Error(`state.json is unreadable and no usable backup exists (${e.message})`);
  }
}

// Atomic write: tmp file + rename, so a crash mid-write can't corrupt state.json. Also keep the
// previous good copy as state.json.bak (rolled forward only on a successful parse-able save) so
// loadState can always recover.
export async function saveState(statePath, state) {
  state.lastUpdated = nowIso();
  const tmp = statePath + '.tmp';
  const data = JSON.stringify(state, null, 2);
  // snapshot the current good file to .bak BEFORE we overwrite it
  if (existsSync(statePath)) {
    try { await copyFile(statePath, statePath + '.bak'); } catch { /* best effort */ }
  }
  await writeFile(tmp, data, 'utf8');
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
