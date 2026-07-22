// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — browser-level, high-fidelity run simulation (change: browser-fidelity-simulation).
//
//   npm run simulate:browser                 (3 teams)
//   node scripts/simulate-browser-run.mjs --teams=5
//
// Unlike simulate-run.mjs (which drives the callable API directly), this plays N
// virtual teams through the REAL play-web UI in headless Chromium — one isolated
// BrowserContext per team, each with its own anonymous auth, a Pixel-7 mobile
// profile, and a STREAMED simulated GPS (jitter + drift, walking between stops).
// Every participant action goes through the rendered DOM (taps, forms, the file
// picker) — never a raw callable. It covers every task type, exercises the offline
// banner via a scripted connectivity blip, then runs the SAME integrity audit as
// `npm run simulate` (scripts/lib/run-audit.mjs) plus browser-only assertions
// (no uncaught page errors, no white-screen, every team reached the Final screen).
//
// Setup (creator/ops side) still uses callables — building the game and launching
// the run is not a "participant action". Requires the emulator running AND the
// play-web dev server (auto-spawned on :5181 if not already up).
//
// Deterministic: a seeded LCG (shared with simulate-run) drives all GPS jitter.
// Exits non-zero on ANY violation.
// ═══════════════════════════════════════════════════════════════════════════════
import { chromium, devices } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditRun } from './lib/run-audit.mjs';
import { makeRng, stepToward, jitterFix } from './lib/gpsRoute.mjs';

const PROJECT = 'rushpoint-pwa-7daaa';
// A tiny but VALID 1x1 JPEG. PhotoEntry is camera-capture only now (no free-text
// URL field): the sim sets these bytes on the hidden <input type=file> and lets
// the real compress+upload pipeline run against the Storage emulator, whose
// origin submitStationPhoto accepts in emulator mode (docs/wave-c).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkI' +
  'CQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);
const PLAY_URL = process.env.PLAY_URL || 'http://localhost:5181';
const PLAY_PORT = Number(new URL(PLAY_URL).port || 80);
const TEAMS = Math.max(1, Number((process.argv.find((a) => a.startsWith('--teams=')) ?? '').split('=')[1] || 3));
const WALK_M_PER_TICK = 15; // metres advanced per ~1s GPS tick

let violations = 0;
function audit(label, cond, detail) {
  console.log(`${cond ? 'OK  ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) violations++;
}

// ── Emulator party (creator/ops) — identical shape to simulate-run.mjs ────────
function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `bsim-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {
    auth,
    // Same transient-retry as e2e/simulate: absorb an emulator blip (max 2)
    // instead of aborting the whole run on one dropped gRPC stream.
    call: async (fn, data) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return (await httpsCallable(functions, fn)(data)).data;
        } catch (e) {
          const transient = e.code === 'functions/internal' || e.code === 'functions/unavailable';
          if (!transient || attempt >= 2) throw e;
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    },
    getDocAt: (path) => getDoc(doc(db, path)).then((s) => ({ exists: s.exists(), data: s.data() })),
  };
}

// ── Course geometry (Jerusalem hills). Field task sits at BASE (immediate
//    in-range check-in); the geofence finale is ~150 m away so teams actually
//    WALK into its radius over several GPS ticks. ───────────────────────────────
const BASE = { lat: 31.78, lng: 35.21 };
const at = (dN, dE) => ({ lat: BASE.lat + dN / 111_320, lng: BASE.lng + dE / 111_320 });

// One stage per task, so routing is deterministic (single option) and EVERY task
// type is exercised by every team. `gps`/`radius` mark the GPS-gated stops; the
// rest are locationless (done from anywhere). Answer keys live here — the driver
// gets them from the seed, NEVER by scraping the (sanitized) client payload.
const PLAN = [
  { id: 'bsim-field', type: 'field',         title: 'Field check-in', gps: at(0, 0), radius: 60, triggerMode: 'radius' },
  { id: 'bsim-self',  type: 'self_report',   title: 'Self report',    locationless: true },
  { id: 'bsim-code',  type: 'smart_station', title: 'Secret code',    locationless: true, secretCode: 'RUSH1' },
  { id: 'bsim-quiz',  type: 'quiz',          title: 'Quiz',           locationless: true, choices: ['Jerusalem', 'Haifa', 'Eilat'], answers: ['Jerusalem'] },
  { id: 'bsim-num',   type: 'numeric',       title: 'Numeric',        locationless: true, numericAnswer: 7, numericTolerance: 0 },
  { id: 'bsim-seq',   type: 'sequence',      title: 'Sequence',       locationless: true, steps: [{ id: 's1', prompt: 'First word?', answer: 'alpha' }, { id: 's2', prompt: 'Second word?', answer: 'bravo' }] },
  { id: 'bsim-photo', type: 'photo',         title: 'Photo',          locationless: true, autoApprove: true },
  { id: 'bsim-geo',   type: 'geofence',      title: 'Geofence finale', gps: at(120, 90), radius: 50, isFinal: true },
];
const planFor = (taskId) => PLAN.find((p) => p.id === taskId);

function buildStages() {
  return PLAN.map((p, i) => ({
    id: `bsim-stage-${i}`, order: i, title: p.title, ...(p.isFinal ? { isFinal: true } : {}),
    tasks: [{
      id: p.id, title: p.title, type: p.type,
      coordinates: p.gps ?? { lat: 0, lng: 0 },
      difficulty: 2, estimatedMinutes: 3, pointValue: 60, maxConcurrentTeams: TEAMS + 2,
      ...(p.locationless ? { locationless: true, triggerMode: 'locationless' } : {}),
      ...(p.triggerMode ? { triggerMode: p.triggerMode } : {}),
      ...(p.radius ? { geofenceRadiusMeters: p.radius } : {}),
      ...(p.choices ? { choices: p.choices } : {}),
      ...(p.answers ? { answers: p.answers } : {}),
      ...(p.numericAnswer != null ? { numericAnswer: p.numericAnswer, numericTolerance: p.numericTolerance ?? 0 } : {}),
      ...(p.steps ? { steps: p.steps } : {}),
      ...(p.secretCode || p.autoApprove ? { smart: { ...(p.secretCode ? { secretCode: p.secretCode } : {}), ...(p.autoApprove ? { autoApprove: true } : {}) } } : {}),
    }],
  }));
}

// ── Small async utils ─────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, { timeout = 30_000, interval = 400, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(interval);
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}
function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode > 0); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

// Ensure the play-web dev server is up; spawn it if not. Returns a cleanup fn.
async function ensurePlayServer() {
  if (await portOpen(PLAY_PORT)) { console.log(`play-web already serving on :${PLAY_PORT}`); return () => {}; }
  console.log(`booting play-web dev server on :${PLAY_PORT} …`);
  const child = spawn('npm', ['run', 'play'], { shell: true, stdio: 'ignore', detached: false });
  await waitUntil(() => httpOk(PLAY_URL), { timeout: 120_000, interval: 1000, label: 'play-web dev server' });
  console.log('play-web dev server ready.');
  return () => { try { child.kill(); } catch { /* already gone */ } };
}

// ── One virtual team: an isolated mobile context with a SYNTHETIC GPS position ──
// Playwright's CDP geolocation is unreliable here for the app's usage: a one-shot
// getCurrentPosition (maximumAge:0) times out with no stream (code 3) and gets
// POSITION_UNAVAILABLE during a stream (code 2) — and GeofenceAuto clears its
// watch on any error. So we bypass Chromium geolocation entirely: an exposed Node
// binding (__rushpointGeo) returns the team's current (jittered) position, and an
// init script re-implements getCurrentPosition/watchPosition/clearWatch on top of
// it. Fully deterministic — no CDP timing, no timeouts, no phantom errors.
async function makeTeam(browser, index) {
  const rng = makeRng(1000 + index * 7919);
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    locale: 'he-IL',
    permissions: ['geolocation'],
    geolocation: { latitude: BASE.lat, longitude: BASE.lng, accuracy: 10 },
  });

  // Node-side source of truth for this team's position, read by the exposed geo
  // binding (with realistic per-fix jitter).
  const geo = { here: { ...BASE } };
  await context.exposeFunction('__rushpointGeo', () => {
    const f = jitterFix(geo.here, rng, 8);
    return { latitude: f.lat, longitude: f.lng, accuracy: f.accuracy };
  });
  await context.addInitScript(() => {
    const g = navigator.geolocation;
    if (!g) return;
    const toPos = (c) => ({
      coords: { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy ?? 8,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    });
    const read = () => (typeof window.__rushpointGeo === 'function'
      ? Promise.resolve(window.__rushpointGeo()) : Promise.reject(new Error('no geo')));
    const watchers = new Map();
    let nextId = 1;
    const getCurrentPosition = (success, error) => {
      read().then((c) => success(toPos(c)), () => error && error({ code: 2, message: '' }));
    };
    const watchPosition = (success, error) => {
      const id = nextId++;
      const tick = () => read().then((c) => success(toPos(c)), () => error && error({ code: 2, message: '' }));
      tick();
      watchers.set(id, setInterval(tick, 800));
      return id;
    };
    const clearWatch = (id) => { const t = watchers.get(id); if (t) clearInterval(t); watchers.delete(id); };
    try {
      Object.defineProperty(g, 'getCurrentPosition', { configurable: true, writable: true, value: getCurrentPosition });
      Object.defineProperty(g, 'watchPosition', { configurable: true, writable: true, value: watchPosition });
      Object.defineProperty(g, 'clearWatch', { configurable: true, writable: true, value: clearWatch });
    } catch { /* leave native */ }
  });

  const pageErrors = [];
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const team = { index, context, page, pageErrors, consoleErrors, here: geo.here, target: { ...BASE }, offline: false, walking: false };
  const setHere = (p) => { geo.here = { ...p }; team.here = geo.here; };
  team.pushFix = (p) => { if (p) setHere(p); };
  team.setTarget = (p) => { team.target = p ? { ...p } : { ...BASE }; };
  // Node-side ticker: only MOVES the position while walking into a geofence. The
  // in-page watchPosition shim polls __rushpointGeo on its own, so there is no
  // CDP setGeolocation to race with.
  team.ticker = setInterval(() => {
    if (team.walking) setHere(stepToward(geo.here, team.target, WALK_M_PER_TICK));
  }, 700);
  team.stop = () => clearInterval(team.ticker);
  return team;
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

// ── Per-type play: satisfy the on-screen control from the seeded config ────────
async function satisfyTask(team, type, plan, taskId) {
  const { page } = team;
  switch (type) {
    case 'field':
    case 'self_report':
      // Position the team at the stop (field sits at BASE, within its radius);
      // synthetic geolocation makes the app's getCurrentPosition check-in resolve.
      team.pushFix(plan?.gps ?? BASE);
      await tid(page, 'task-field-checkin').click();
      return;
    case 'smart_station':
      await tid(page, 'task-code-input').fill(plan.secretCode);
      await tid(page, 'task-code-submit').click();
      return;
    case 'quiz':
      await page.locator(`[data-testid="quiz-choice"][data-choice="${plan.answers[0]}"]`).click();
      return;
    case 'numeric':
      await tid(page, 'numeric-input').fill(String(plan.numericAnswer));
      await tid(page, 'numeric-submit').click();
      return;
    case 'sequence': {
      // Answer whichever step is CURRENTLY shown (read its prompt), not a fixed
      // index — the component advances a step asynchronously after each accept, so
      // a fixed-order loop can submit the next answer against the old step index.
      for (let guard = 0; guard < plan.steps.length + 3; guard++) {
        if (await tid(page, 'final-screen').count()) return;
        const card = tid(page, 'task-card').first();
        if (!(await card.count()) || (await card.getAttribute('data-task-id')) !== taskId) return;
        const prompt = (await tid(page, 'sequence-prompt').innerText().catch(() => '')).trim();
        const step = plan.steps.find((s) => s.prompt === prompt);
        if (!step) { await sleep(400); continue; }
        await tid(page, 'sequence-input').fill(step.answer);
        await tid(page, 'sequence-submit').click();
        await waitUntil(async () => {
          if (await tid(page, 'final-screen').count()) return true;
          const c = tid(page, 'task-card').first();
          if (!(await c.count()) || (await c.getAttribute('data-task-id')) !== taskId) return true;
          return (await tid(page, 'sequence-prompt').innerText().catch(() => '')).trim() !== prompt;
        }, { timeout: 15_000, label: `sequence step progressed (${step.id})` });
      }
      return;
    }
    case 'geofence':
      // Start STREAMING: the ticker now walks us toward the radius and
      // GeofenceAuto auto-checks-in via watchPosition (no getCurrentPosition).
      team.setTarget(plan.gps);
      team.walking = true;
      audit(`geofence status rendered for team ${team.index + 1}`, (await tid(page, 'geofence-status').count()) > 0);
      return;
    default: {
      // photo (and any future capture type): PhotoEntry is camera-capture only now
      // — the old free-text `photo-url` field is gone (testids are photo-take /
      // photo-file / photo-submit). Drive the REAL capture: set a tiny valid JPEG on
      // the hidden file input, then submit. The compress+upload lands at the Storage
      // emulator origin; against the emulator submitStationPhoto accepts that origin
      // (requireStorageUrl allowLocalEmulator — see docs/wave-c), so the round-trip
      // succeeds exactly as a real phone would.
      await tid(page, 'photo-file').setInputFiles({
        name: `${taskId}.jpg`, mimeType: 'image/jpeg', buffer: TINY_JPEG,
      });
      await tid(page, 'photo-submit').click();
      return;
    }
  }
}

// Wait for the card to advance to a different task (or the Final screen).
async function waitForAdvance(page, prevId, timeout = 40_000) {
  return waitUntil(async () => {
    if (await tid(page, 'final-screen').count()) return true;
    const card = tid(page, 'task-card').first();
    if (!(await card.count())) return false;
    const id = await card.getAttribute('data-task-id').catch(() => null);
    return id != null && id !== prevId;
  }, { timeout, label: `advance from ${prevId}` });
}

// One team's full play-through: read the card, satisfy it, advance, repeat.
async function runTeam(team) {
  const { page } = team;
  let offlineDone = false;
  for (let turn = 0; turn < PLAN.length + 6; turn++) {
    if (await tid(page, 'final-screen').count()) return true;
    const card = tid(page, 'task-card').first();
    try {
      await card.waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      if (await tid(page, 'final-screen').count()) return true;
      continue; // routing spinner / lobby — re-poll
    }
    const type = await card.getAttribute('data-task-type');
    const taskId = await card.getAttribute('data-task-id');
    const plan = planFor(taskId);
    if (process.env.BSIM_DEBUG) console.log(`  [team ${team.index + 1}] turn ${turn}: type=${type} id=${taskId}`);

    // play-task-gating: a SEALED hidden-location card ships NO data-task-type — the
    // payload is just a clue + an arrival control (TaskRunner.tsx sealed branch).
    // Falling through to satisfyTask(type=null) would hit the photo default and
    // fail. Instead: walk to the spot and click the arrival control; the server
    // unseals the card (SAME task id, now with data-task-type), and the next loop
    // turn plays its real type. NOTE: the current PLAN ships no hidden-location
    // task, so this branch is defensive — it lets the sim gain one without a driver
    // rewrite (add a task with `hideLocation` + a `gps` in PLAN).
    if ((await card.getAttribute('data-task-sealed')) === 'true') {
      team.pushFix(plan?.gps ?? BASE);
      await tid(page, 'task-check-arrival').click().catch(() => {});
      await waitUntil(async () => {
        if (await tid(page, 'final-screen').count()) return true;
        const c = tid(page, 'task-card').first();
        if (!(await c.count())) return false;
        return (await c.getAttribute('data-task-sealed')) !== 'true';
      }, { timeout: 20_000, label: `arrival unseals ${taskId}` }).catch(() => {});
      continue;
    }

    // Scripted offline blip on team 0, once, mid-run — exercises the banner +
    // offline hardening, then reconnects and must still finish.
    if (team.index === 0 && !offlineDone && turn === 2) {
      offlineDone = true;
      const errsBefore = team.pageErrors.length;
      team.offline = true;
      await team.context.setOffline(true);
      await waitUntil(() => tid(page, 'offline-banner').count().then((n) => n > 0),
        { timeout: 15_000, label: 'offline banner' }).then(
        () => audit('offline banner shown while offline (team 1)', true),
        () => audit('offline banner shown while offline (team 1)', false));
      audit('no page error triggered by going offline (team 1)', team.pageErrors.length === errsBefore,
        team.pageErrors.slice(errsBefore).join(' | '));
      await sleep(2500);
      await team.context.setOffline(false);
      team.offline = false;
      await waitUntil(() => tid(page, 'offline-banner').count().then((n) => n === 0),
        { timeout: 15_000, label: 'offline banner cleared' }).catch(() => {});
    }

    try {
      await satisfyTask(team, type, plan, taskId);
    } catch (e) {
      if (process.env.BSIM_DEBUG) console.log(`  [team ${team.index + 1}] satisfyTask(${type}) threw: ${e.message}`);
    }
    try {
      await waitForAdvance(page, taskId);
    } catch {
      if (process.env.BSIM_DEBUG) {
        const msg = await tid(page, 'task-card').first().locator('..').innerText().catch(() => '(no card)');
        console.log(`  [team ${team.index + 1}] no advance from ${taskId}; card text: ${msg.replace(/\s+/g, ' ').slice(0, 160)}`);
        console.log(`  [team ${team.index + 1}] console errors: ${team.consoleErrors.slice(-3).join(' | ') || 'none'}`);
        await page.screenshot({ path: join(tmpdir(), `bsim-team${team.index + 1}-stall.png`) }).catch(() => {});
      }
    }
  }
  return (await tid(page, 'final-screen').count()) > 0;
}

async function main() {
  const t0 = Date.now();
  console.log(`── RushPoint browser-fidelity simulation — ${TEAMS} team(s) ──\n`);
  const stopPlay = await ensurePlayServer();

  // ── Creator/ops setup via callables (not a participant action) ──────────────
  const creator = makeParty('creator');
  const creatorCred = await signInAnonymously(creator.auth);
  const ownerUid = creatorCred.user.uid;
  const { gameId } = await creator.call('createGame', { title: `Browser Sim ${TEAMS}`, mode: 'individual' });
  await creator.call('updateGame', { gameId, scoringPreset: 'smart_weighted', stages: buildStages() });
  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  const browser = await chromium.launch({ headless: true });
  const teams = [];
  let cleanupErr;
  try {
    // Spin up all contexts, join each through the DOM, THEN start everyone.
    for (let i = 0; i < TEAMS; i++) teams.push(await makeTeam(browser, i));
    await Promise.all(teams.map(async (team) => {
      await team.page.goto(`${PLAY_URL}/?code=${accessCode}`);
      await team.pushFix(BASE);
      await tid(team.page, 'join-name').waitFor({ state: 'visible', timeout: 40_000 });
      await tid(team.page, 'join-name').fill(`Browser Team ${team.index + 1}`);
      await tid(team.page, 'join-submit').click();
      await tid(team.page, 'join-submit').waitFor({ state: 'detached', timeout: 40_000 });
    }));
    console.log(`all ${TEAMS} team(s) joined via the UI; launching…`);

    // Resolve each browser team's uid (teamId) so the photo task can address the
    // team's own Storage folder. listRunTeams maps our display names to ids.
    const { teams: joined } = await creator.call('listRunTeams', { gameId, runId });
    for (const team of teams) {
      team.uid = joined.find((j) => j.displayName === `Browser Team ${team.index + 1}`)?.id;
    }
    audit('every browser team resolved to a run team uid', teams.every((t) => t.uid), teams.map((t) => t.uid).join(','));

    const started = await creator.call('startTeams', { gameId, runId });
    audit(`startTeams launched all ${TEAMS} team(s)`, started?.launched === TEAMS, JSON.stringify(started));

    const finished = await Promise.all(teams.map((team) => runTeam(team).catch((e) => {
      console.error(`team ${team.index + 1} error: ${e.message}`);
      return false;
    })));
    finished.forEach((ok, i) => audit(`team ${i + 1} reached the Final screen through the UI`, ok));

    // ── Browser-only assertions ────────────────────────────────────────────────
    for (const team of teams) {
      audit(`team ${team.index + 1}: no uncaught page errors`, team.pageErrors.length === 0, team.pageErrors.join(' | '));
      const bodyText = await team.page.locator('body').innerText().catch(() => '');
      audit(`team ${team.index + 1}: no white-screen (body has content)`, bodyText.trim().length > 0);
    }

    // ── Shared run-integrity audit (same oracle as npm run simulate) ────────────
    const { teams: teamList } = await creator.call('listRunTeams', { gameId, runId });
    const states = await Promise.all(teamList.map(async (t) => {
      const d = await creator.getDocAt(`users/${ownerUid}/games/${gameId}/runs/${runId}/teams/${t.id}`);
      return { team: d.data };
    }));
    audit('every team doc readable for the audit', states.every((s) => s.team), `${states.length} of ${TEAMS}`);
    await auditRun({ creator, ownerUid, gameId, runId, states, audit });

    // Coverage: every seeded task type was actually completed by team 1.
    const t1 = states[0]?.team;
    const completedTypes = new Set((t1?.stages ?? []).flatMap((s) => s.tasks ?? [])
      .filter((tk) => tk.status === 'completed')
      .map((tk) => PLAN.find((p) => p.id === tk.taskId)?.type).filter(Boolean));
    const missing = PLAN.map((p) => p.type).filter((ty) => !completedTypes.has(ty));
    audit('every task type was exercised end-to-end', missing.length === 0, `missing: ${missing.join(',') || 'none'}`);
  } catch (e) {
    cleanupErr = e;
  } finally {
    for (const team of teams) team.stop?.();
    await browser.close().catch(() => {});
    stopPlay();
  }
  if (cleanupErr) { console.error('\n💥 Run error:', cleanupErr.message); violations++; }

  console.log(`\ntotal wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(violations === 0 ? '\n✅ BROWSER SIM CONSISTENT' : `\n❌ ${violations} VIOLATION(S)`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n💥 Uncaught error:', e); process.exit(1); });
