#!/usr/bin/env node
/**
 * Google Play phone-screenshot capture.
 *
 * Drives a REAL game through the REAL play-web UI (same machinery as
 * scripts/simulate-browser-run.mjs — synthetic GPS, DOM-driven join, real
 * callables) and screenshots the moments that sell the app on a store page.
 *
 * Requires the emulator suite running (npm run emulator). The play-web dev
 * server is booted automatically if it isn't already up.
 *
 *   node scripts/gen-play-screenshots.mjs            # Hebrew (app default)
 *   node scripts/gen-play-screenshots.mjs --lang=en  # English listing set
 *
 * Output → docs/play-store/assets/screenshots/<lang>/NN-name.png
 * Pixel 7 @ dSF 2.625 ⇒ 1080x2400, inside Play's 320–3840 px per-side bounds.
 *
 * Content is deliberately REAL Hebrew game copy, not seeded demo text — Play
 * screenshots showing placeholder strings read as unfinished.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeRng, stepToward, jitterFix } from './lib/gpsRoute.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'rushpoint-pwa-7daaa';
const PLAY_URL = process.env.PLAY_URL || 'http://localhost:5181';
const PLAY_PORT = Number(new URL(PLAY_URL).port || 80);
const LANG = (process.argv.find((a) => a.startsWith('--lang=')) ?? '').split('=')[1] === 'en' ? 'en' : 'he';
const OUT_DIR = join(ROOT, 'docs', 'play-store', 'assets', 'screenshots', LANG);

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkI' +
  'CQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);

// ── Real content, both languages ──────────────────────────────────────────────
const COPY = {
  he: {
    game: 'מרדף בעיר העתיקה',
    team: 'נמרי הכותל',
    members: ['יעל', 'איתי', 'נועה'],
    addMember: 'הוספת חבר',
    start: 'שער יפו — נקודת הזינוק',
    quiz: 'כמה שערים פתוחים יש כיום בחומת העיר העתיקה?',
    choices: ['שבעה', 'שמונה', 'אחד עשר'],
    answer: 'שבעה',
    photo: 'צלמו את כל הקבוצה מול מגדל דוד',
    final: 'הכותל המערבי — קו הסיום',
    annTitle: 'משימת בזק! 🔥',
    annBody: 'הקבוצה הראשונה שמגיעה לרחוב הקרדו מקבלת 50 נקודות בונוס.',
  },
  en: {
    game: 'Old City Chase',
    team: 'Wall Leopards',
    members: ['Yael', 'Itai', 'Noa'],
    addMember: 'Add member',
    start: 'Jaffa Gate — starting point',
    quiz: 'How many gates in the Old City wall are open today?',
    choices: ['Seven', 'Eight', 'Eleven'],
    answer: 'Seven',
    photo: 'Photograph the whole team in front of the Tower of David',
    final: 'The Western Wall — finish line',
    annTitle: 'Flash mission! 🔥',
    annBody: 'First team to reach the Cardo earns a 50 point bonus.',
  },
}[LANG];

// ── Course geometry — the opening stop sits ~220 m away so the map shows a real
//    route + distance badge before we walk in. ────────────────────────────────
const BASE = { lat: 31.7767, lng: 35.2295 };            // Jaffa Gate-ish
const at = (dN, dE) => ({ lat: BASE.lat + dN / 111_320, lng: BASE.lng + dE / 111_320 });
const START_AT = at(180, 130);
const FINAL_AT = at(-120, 240);

function buildStages() {
  const t = (over) => ({
    difficulty: 2, estimatedMinutes: 4, pointValue: 60, maxConcurrentTeams: 8, ...over,
  });
  return [
    { id: 'ps-s0', order: 0, title: COPY.start, tasks: [t({
      id: 'ps-field', title: COPY.start, type: 'field',
      coordinates: START_AT, geofenceRadiusMeters: 60, triggerMode: 'radius',
    })] },
    // Located (not locationless): a locationless task renders an empty "the map
    // appears once the task has a location" placeholder that eats the top third
    // of the frame — dead space in a store screenshot.
    { id: 'ps-s1', order: 1, title: COPY.quiz, tasks: [t({
      id: 'ps-quiz', title: COPY.quiz, type: 'quiz', coordinates: at(200, 160),
      choices: COPY.choices, answers: [COPY.answer],
    })] },
    { id: 'ps-s2', order: 2, title: COPY.photo, tasks: [t({
      id: 'ps-photo', title: COPY.photo, type: 'photo', coordinates: at(150, 200),
      smart: { autoApprove: true },
    })] },
    { id: 'ps-s3', order: 3, title: COPY.final, isFinal: true, tasks: [t({
      id: 'ps-geo', title: COPY.final, type: 'geofence',
      coordinates: FINAL_AT, geofenceRadiusMeters: 55,
    })] },
  ];
}

// ── utils ─────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, { timeout = 30_000, interval = 400, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(interval);
  }
}
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});
const httpOk = (url) => new Promise((resolve) => {
  const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode > 0); });
  req.on('error', () => resolve(false));
  req.setTimeout(2000, () => { req.destroy(); resolve(false); });
});

async function ensureEmulator() {
  // Auth (9099) and Storage (9199) matter too: the join uses Auth and the photo
  // task uploads to Storage — without them the run stalls late with a misleading
  // element timeout instead of failing fast here.
  const need = [['functions', 5001], ['firestore', 8080], ['auth', 9099], ['storage', 9199]];
  const missing = [];
  for (const [label, port] of need) if (!(await portOpen(port))) missing.push(`${label}:${port}`);
  if (missing.length) {
    throw new Error(`emulator not ready (${missing.join(', ')}) — start it first:  npm run emulator`);
  }
}
async function ensurePlayServer() {
  if (await portOpen(PLAY_PORT)) { console.log(`play-web already serving on :${PLAY_PORT}`); return () => {}; }
  console.log(`booting play-web dev server on :${PLAY_PORT} …`);
  const child = spawn('npm', ['run', 'play'], { shell: true, stdio: 'ignore' });
  await waitUntil(() => httpOk(PLAY_URL), { timeout: 120_000, interval: 1000, label: 'play-web dev server' });
  return () => {
    try {
      // shell:true means `child` is the shell, not Vite — a plain kill() leaves
      // the server orphaned (and orphans wedge the emulator). Kill the tree.
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    } catch { /* already gone */ }
  };
}

function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `shot-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return {
    auth,
    // Same transient-retry as simulate-browser-run: absorb an emulator blip
    // (max 2) instead of aborting the whole capture on one dropped gRPC stream.
    call: async (fn, data) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return (await httpsCallable(functions, fn)(data)).data;
        } catch (e) {
          const transient = e.code === 'functions/internal' || e.code === 'functions/unavailable';
          if (!transient || attempt >= 2) {
            throw new Error(`callable ${fn} failed: ${e.code ?? ''} ${e.message ?? e}`);
          }
          await sleep(300 * (attempt + 1));
        }
      }
    },
  };
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

let shotN = 0;
/** @param focusCard scroll the task card into view before capturing. */
async function shot(page, name, { settle = 900, focusCard = false } = {}) {
  if (focusCard) {
    await page.locator('[data-testid="task-card"]').first()
      .scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  }
  await sleep(settle);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${String(shotN).padStart(2, '0')}-${name}.png`);
}

async function main() {
  console.log(`── Play screenshots — ${LANG.toUpperCase()} ──\n`);
  await ensureEmulator();
  const stopPlay = await ensurePlayServer();
  // Everything after the server boots runs inside the try: a throw during setup
  // (callables, browser launch, context wiring) must NOT orphan a headless
  // Chromium or the Vite child — orphaned playtest processes are a known way to
  // wedge the emulator on this machine.
  let browser;
  let ticker;
  try {
  const creator = makeParty('creator');
  const cred = await signInAnonymously(creator.auth);
  const ownerUid = cred.user.uid;
  const { gameId } = await creator.call('createGame', {
    title: COPY.game,
    mode: 'team',
    description: LANG === 'he'
      ? 'מרדף קבוצתי בין שערי העיר העתיקה — משימות, ניווט וניקוד אוטומטי.'
      : 'A team chase through the Old City gates — tasks, navigation, automatic scoring.',
  });
  await creator.call('updateGame', { gameId, scoringPreset: 'smart_weighted', stages: buildStages() });
  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  browser = await chromium.launch({ headless: true });
  const rng = makeRng(4242);
  const geo = { here: { ...BASE } };
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    // Play caps phone screenshots at a 2:1 aspect ratio; Pixel 7's native
    // 1082x2202 is 2.035:1 and gets rejected. 432x864 @2.5 lands exactly
    // 1080x2160 — standard FHD+, inside the 320–3840 per-side bounds.
    viewport: { width: 432, height: 864 },
    deviceScaleFactor: 2.5,
    locale: LANG === 'he' ? 'he-IL' : 'en-US',
    permissions: ['geolocation'],
    geolocation: { latitude: BASE.lat, longitude: BASE.lng, accuracy: 10 },
  });
  await context.exposeFunction('__rushpointGeo', () => {
    const f = jitterFix(geo.here, rng, 8);
    return { latitude: f.lat, longitude: f.lng, accuracy: f.accuracy };
  });
  // Same synthetic-geolocation shim as the browser sim: CDP geolocation is
  // unreliable for this app's getCurrentPosition/watchPosition usage.
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
    try {
      Object.defineProperty(g, 'getCurrentPosition', { configurable: true, writable: true,
        value: (ok, err) => read().then((c) => ok(toPos(c)), () => err && err({ code: 2, message: '' })) });
      Object.defineProperty(g, 'watchPosition', { configurable: true, writable: true, value: (ok, err) => {
        const id = nextId++;
        const tick = () => read().then((c) => ok(toPos(c)), () => err && err({ code: 2, message: '' }));
        tick(); watchers.set(id, setInterval(tick, 800)); return id;
      } });
      Object.defineProperty(g, 'clearWatch', { configurable: true, writable: true,
        value: (id) => { const t = watchers.get(id); if (t) clearInterval(t); watchers.delete(id); } });
    } catch { /* leave native */ }
  });
  await context.addInitScript((lang) => {
    try { localStorage.setItem('rushpoint.lang', lang); } catch { /* ignore */ }
  }, LANG);

  const page = await context.newPage();
  const walker = { on: false, target: { ...BASE } };
  ticker = setInterval(() => {
    if (walker.on) geo.here = stepToward(geo.here, walker.target, 18);
  }, 700);

  {
    // ① Join screen ───────────────────────────────────────────────────────────
    page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`); });
    await page.goto(`${PLAY_URL}/?code=${accessCode}`, { waitUntil: 'domcontentloaded' });
    // Team mode: a team-name field plus a member list (join-name is solo-only).
    try {
      await tid(page, 'join-team-name').waitFor({ state: 'visible', timeout: 90_000 });
    } catch (e) {
      const body = await page.locator('body').innerText().catch(() => '(unreadable)');
      console.log(`\n  --- page text at failure ---\n${body.slice(0, 600)}\n  ---`);
      // Diagnostics go to the temp dir, never OUT_DIR — that folder is uploaded
      // to Play, so a debug frame must not be able to land in the shipped set.
      const dbg = join(tmpdir(), `rushpoint-debug-join-${LANG}.png`);
      await page.screenshot({ path: dbg });
      console.log(`  (debug frame: ${dbg})`);
      throw e;
    }
    await tid(page, 'join-team-name').fill(COPY.team);
    const members = tid(page, 'join-member');
    for (let i = 0; i < COPY.members.length; i++) {
      // Let a miss throw: swallowing it turned into an opaque fill() timeout.
      if (i >= (await members.count())) {
        await page.getByRole('button', { name: COPY.addMember }).click();
      }
      await members.nth(i).fill(COPY.members[i]);
    }
    await shot(page, 'join');

    await tid(page, 'join-submit').click();
    await tid(page, 'join-submit').waitFor({ state: 'detached', timeout: 60_000 });
    await creator.call('startTeams', { gameId, runId });

    // ② Navigation — first stop ~220 m away, so map + distance are meaningful ──
    await waitUntil(async () => (await tid(page, 'task-card').count()) > 0,
      { timeout: 60_000, label: 'first task card' });
    await shot(page, 'navigate', { settle: 4000 }); // let the lazy map chunk + tiles land

    // ③ Live ops — an organizer announcement landing mid-game ─────────────────
    await creator.call('pushAnnouncement', {
      ownerUid, gameId, runId,
      message: `${COPY.annTitle} ${COPY.annBody}`,
      messageHe: `${COPY.annTitle} ${COPY.annBody}`,
    }).catch((e) => console.log(`  (announcement skipped: ${e.message})`));
    await shot(page, 'announcement', { settle: 2500 });

    // walk into the opening stop and check in
    walker.target = START_AT; walker.on = true;
    await sleep(2500);
    geo.here = { ...START_AT };
    walker.on = false;
    await tid(page, 'task-field-checkin').click({ timeout: 30_000 });

    // ④ Quiz ──────────────────────────────────────────────────────────────────
    await waitUntil(async () => (await tid(page, 'quiz-choice').count()) > 0,
      { timeout: 60_000, label: 'quiz task' });
    await shot(page, 'quiz', { focusCard: true });
    await page.locator(`[data-testid="quiz-choice"][data-choice="${COPY.answer}"]`).click();

    // ⑤ Photo mission ─────────────────────────────────────────────────────────
    await waitUntil(async () => (await tid(page, 'photo-file').count()) > 0,
      { timeout: 60_000, label: 'photo task' });
    await shot(page, 'photo', { focusCard: true });
    await tid(page, 'photo-file').setInputFiles({ name: 'team.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
    await tid(page, 'photo-submit').click();

    // ⑥ Final screen ──────────────────────────────────────────────────────────
    walker.target = FINAL_AT; walker.on = true;
    await waitUntil(async () => (await tid(page, 'final-screen').count()) > 0,
      { timeout: 120_000, interval: 700, label: 'final screen' });
    walker.on = false;
    await shot(page, 'final', { settle: 3000 });

    console.log(`\n✅ ${shotN} screenshots → ${OUT_DIR}`);
  }
  } finally {
    if (ticker) clearInterval(ticker);
    if (browser) await browser.close().catch(() => {});
    stopPlay();
  }
}

main().catch((e) => { console.error('\n💥', e.message); process.exit(1); });
