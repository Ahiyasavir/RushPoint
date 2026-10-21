// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — STRESS for the 14.10 join failure: the same wipe, many times, at many moments.
//   STRESS_ROUNDS=40 node scripts/emulator-exec.mjs "node scripts/browser-auth-loss-stress.mjs"
//
// browser-auth-loss.mjs proves recovery once, with the stored sign-in wiped at ONE moment (2.5 s after
// the code check, before the tap). On iPhones the loss is intermittent and lands whenever it lands, so
// one moment is not the claim we need. Every round here is a FRESH phone (new browser context, empty
// storage), alternating WebKit (iPhone 15 profile) and Chromium (Pixel 7), alternating the two ways a
// phone got in on 14.10 (169 tokenless requests: 57 joinRun = founding a team through the form, 112
// joinTeamAsDevice = a second phone through the team QR), and wiping at a different moment each time:
//
//   beforeTap   N ms after the code check (0..4 s), then tap         (the reproduced iPhone case)
//   inFlight    tap, then wipe 0..400 ms later, while the join is on the wire
//   twice       wipe before the tap AND again while the join is in flight
//   storm       wipe every 300 ms from the code check until the phone is in (a page that keeps losing it)
//
// Each round must end with: the phone in a team, every join request carrying a token, the identity
// the server lists for the team being the one the page holds, and exactly ONE team founded per
// founding round (a second team from the same phone is the 14.10 duplicate). Exits non-zero on any
// violation, and prints the rounds per mode and per browser so a pass shows what it covered.
// ═══════════════════════════════════════════════════════════════════════════════
import { webkit, chromium, devices } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { resolveEmulatorPorts, BASE_EMULATOR_PORTS, PORT_OFFSET_ENV } from './lib/emulatorPorts.mjs';

const PROJECT = 'rushpoint-pwa-7daaa';
const EMU = resolveEmulatorPorts(process.env);
if (EMU.firestore !== BASE_EMULATOR_PORTS.firestore) {
  console.error(`\n✖ the stress cannot run with ${PORT_OFFSET_ENV} set (play-web pins the default ports).\n`);
  process.exit(1);
}
const PLAY_URL = process.env.PLAY_URL || 'http://localhost:5181';
const ROUNDS = Math.max(4, Number(process.env.STRESS_ROUNDS) || 40);
const ATTACH_CTA_HE = 'הצטרפות עם הטלפון הזה';
const JOIN_CTA_HE = 'הצטרפו למירוץ';
const IN_RE = /נכנסתם,|ממתינים שהמארגן/;
const ERR_RE = /בעיית חיבור|ההצטרפות לא עברה|ההצטרפות נכשלה|התנתק|יותר מדי|היו הרבה ניסיונות/;
const MODES = ['beforeTap', 'inFlight', 'twice', 'storm'];

let violations = 0;
const tally = {}; // `${browser}|${path}|${mode}` → { ok, bad }
function audit(label, cond, detail) {
  if (!cond) { violations++; console.log(`VIOLATION  ${label}${detail ? ' :: ' + detail : ''}`); }
  return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = Number(process.env.STRESS_SEED) || 20261021;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
async function waitUntil(fn, { timeout = 30_000, interval = 300, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(interval);
  }
}
function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode > 0); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}
async function ensurePlayServer() {
  if (await httpOk(PLAY_URL)) return () => {};
  const child = spawn('npm', ['run', 'play'], { shell: true, stdio: 'ignore', detached: false });
  await waitUntil(() => httpOk(PLAY_URL), { timeout: 120_000, interval: 1000, label: 'play-web dev server' });
  return () => {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
    } catch { /* already gone */ }
  };
}
async function waitForFunctions(timeoutMs = 180_000) {
  const url = `http://127.0.0.1:${EMU.functions}/${PROJECT}/us-central1/getJoinInfo`;
  const probe = () => new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode !== 404); });
    req.on('error', () => resolve(false));
    req.end(JSON.stringify({ data: { code: 'ZZZZZZ' } }));
  });
  if (await probe()) return;
  await waitUntil(probe, { timeout: timeoutMs, interval: 2000, label: 'functions registered' });
}
function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `stress-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${EMU.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', EMU.functions);
  return { auth, call: async (fn, data) => (await httpsCallable(functions, fn)(data)).data };
}
function uidFromAuthHeader(h) {
  const m = /^Bearer\s+(.+)$/i.exec(h || '');
  if (!m) return null;
  try { const p = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8')); return p.user_id || p.sub || '?'; }
  catch { return '?'; }
}
// The same wipe as browser-auth-loss.mjs: both places the app may keep the Firebase user.
async function wipeStoredSignIn(page) {
  return page.evaluate(async () => {
    let n = 0;
    for (const k of Object.keys(localStorage)) if (k.startsWith('firebase:authUser:')) { localStorage.removeItem(k); n++; }
    await new Promise((resolve) => {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(); return; }
        const tx = db.transaction(['firebaseLocalStorage'], 'readwrite');
        const store = tx.objectStore('firebaseLocalStorage');
        const all = store.getAll();
        all.onsuccess = () => { for (const row of all.result || []) if (String(row.fbase_key).startsWith('firebase:authUser:')) { store.delete(row.fbase_key); n++; } };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
    });
    return n;
  }).catch(() => 0);
}

async function round(i, ctx, launchers) {
  const [browserName, launcher, profile] = launchers[i % launchers.length];
  const onlyPath = process.env.STRESS_ONLY_PATH;
  const path = onlyPath || (Math.floor(i / launchers.length) % 2 === 0 ? 'attach' : 'found');
  const mode = MODES[Math.floor(i / (launchers.length * 2)) % MODES.length];
  const key = `${browserName}|${path}|${mode}`;
  tally[key] ??= { ok: 0, bad: 0 };
  const tag = `[#${i + 1} ${browserName} ${path} ${mode}]`;

  // A fresh team per attach round, so phone slots never run out and every round is independent.
  let team = null;
  if (path === 'attach') {
    const f = makeParty(`founder-${i}-${Date.now()}`);
    await signInAnonymously(f.auth);
    await f.call('joinRun', { code: ctx.accessCode, displayName: `Stress ${i}`, memberNames: ['A', 'B', 'C', 'D'] });
    const s = await f.call('getMyTeamState', { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
    team = { founder: f, deviceJoinCode: s?.team?.deviceJoinCode };
  }
  const teamName = `Stress Found ${i}`;

  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ ...profile, locale: 'he-IL' });
  const page = await context.newPage();
  const calls = [];
  let prodHit = null;
  page.on('request', (req) => {
    if (/rush-point\.com/.test(req.url())) prodHit = req.url();
    const m = /\/us-central1\/([A-Za-z]+)$/.exec(req.url());
    if (req.method() !== 'POST' || !m) return;
    calls.push({ name: m[1], uid: uidFromAuthHeader(req.headers()['authorization']), at: Date.now() });
  });
  let stormTimer = null;
  let ok = true;
  try {
    const url = path === 'attach' ? `${PLAY_URL}/?code=${ctx.accessCode}&join=${team.deviceJoinCode}` : `${PLAY_URL}/?code=${ctx.accessCode}`;
    await page.goto(url);
    await waitUntil(() => calls.some((c) => c.name === 'getJoinInfo' && c.uid), { timeout: 40_000, label: 'code check' });
    if (mode === 'storm') stormTimer = setInterval(() => { void wipeStoredSignIn(page); }, 300);

    let cta;
    if (path === 'attach') {
      cta = page.getByRole('button', { name: ATTACH_CTA_HE });
    } else {
      // A link with the code lands on the code screen with "המשך"; the team form comes after it.
      // The app also moves past that screen BY ITSELF for a linked code, so the button can vanish
      // between "is it there" and the press. Press it only if it is still there, briefly.
      const cont = page.getByRole('button', { name: 'המשך' });
      if (await cont.isVisible().catch(() => false)) await cont.click({ timeout: 3000 }).catch(() => undefined);
      await page.getByTestId('join-team-name').fill(teamName, { timeout: 40_000 });
      // A team game asks for the members; the first member row may need "add member" to appear.
      if ((await page.getByTestId('join-member').count()) === 0) await page.getByRole('button', { name: /הוספת חבר/ }).click();
      await page.getByTestId('join-member').first().fill('Kid');
      cta = page.getByRole('button', { name: JOIN_CTA_HE });
    }
    await cta.waitFor({ state: 'visible', timeout: 40_000 });

    if (mode === 'beforeTap' || mode === 'twice') {
      await wipeStoredSignIn(page);
      await sleep(Math.floor(rand() * 4000));
    }
    await cta.click();
    if (mode === 'inFlight' || mode === 'twice') {
      await sleep(Math.floor(rand() * 400));
      await wipeStoredSignIn(page);
    }
    const outcome = await Promise.race([
      page.getByText(IN_RE).first().waitFor({ state: 'visible', timeout: 35_000 }).then(() => 'in').catch(() => null),
      page.getByText(ERR_RE).first().waitFor({ state: 'visible', timeout: 35_000 }).then(() => 'error').catch(() => null),
    ]) || 'timeout';
    if (stormTimer) { clearInterval(stormTimer); stormTimer = null; }
    const shown = outcome === 'in' ? '' : (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);

    const joinName = path === 'attach' ? 'joinTeamAsDevice' : 'joinRun';
    const joins = calls.filter((c) => c.name === joinName);
    ok = audit(`${tag} the phone got in`, outcome === 'in', `${outcome} :: ${shown}`) && ok;
    ok = audit(`${tag} every join request carried a token (14.10: none did)`, joins.length > 0 && joins.every((c) => !!c.uid),
      joins.map((c) => c.uid ?? 'NO-TOKEN').join(' → ')) && ok;
    const joinedUid = joins.find((c) => c.uid)?.uid ?? null;

    if (path === 'attach' && outcome === 'in') {
      const s = await team.founder.call('getMyTeamState', { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
      ok = audit(`${tag} the server lists the page's identity on the team`, !!joinedUid && (s?.team?.deviceUids ?? []).includes(joinedUid),
        `${joinedUid} in ${(s?.team?.deviceUids ?? []).join(',')}`) && ok;
    }
    if (path === 'found') {
      const rows = (await ctx.creator.call('listRunTeams', { gameId: ctx.gameId, runId: ctx.runId }))?.teams ?? [];
      const mine = rows.filter((r) => r.displayName === teamName);
      ok = audit(`${tag} exactly one team was founded (14.10: ghosts and duplicates)`, mine.length === 1, `${mine.length} teams named ${teamName}`) && ok;
      if (outcome === 'in') ok = audit(`${tag} the team is the page's identity`, mine.length === 1 && mine[0].id === joinedUid, `${mine[0]?.id} vs ${joinedUid}`) && ok;
    }
    ok = audit(`${tag} no request went to production`, !prodHit, prodHit ?? '') && ok;
  } catch (e) {
    const screen = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    const why = String(e.message).split(/\r?\n/).filter((l) => /intercepts|not visible|not stable|outside|waiting for|resolved to|retrying/.test(l)).slice(-5).join(' | ');
    ok = audit(`${tag} round ran to completion`, false, `${String(e.message).split(/\r?\n/)[0]} :: ${why} :: screen: ${screen}`) && false;
  } finally {
    if (stormTimer) clearInterval(stormTimer);
    await browser.close();
  }
  tally[key][ok ? 'ok' : 'bad']++;
  console.log(`${ok ? 'OK  ' : 'BAD '} ${tag}`);
}

async function main() {
  const t0 = Date.now();
  console.log(`── RushPoint stress: sign-in wiped at many moments, ${ROUNDS} fresh phones ──\n`);
  const stopPlay = await ensurePlayServer();
  try {
    await waitForFunctions();
    const creator = makeParty('creator');
    await signInAnonymously(creator.auth);
    const { gameId } = await creator.call('createGame', { title: 'Auth loss stress', mode: 'team' });
    await creator.call('updateGame', {
      gameId,
      stages: [{ id: 'st-s1', order: 0, title: 'Stage', isFinal: true,
        tasks: [{ id: 'st-t1', title: 'Done', type: 'self_report', coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 3, pointValue: 10, maxConcurrentTeams: 500, locationless: true, triggerMode: 'locationless' }] }],
    });
    const { runId, accessCode } = await creator.call('launchRun', { gameId });
    const ctx = { creator, ownerUid: creator.auth.currentUser.uid, gameId, runId, accessCode };
    const launchers = [
      ['webkit/iPhone', webkit, devices['iPhone 15'] ?? devices['iPhone 14']],
      ['chromium/Pixel', chromium, devices['Pixel 7']],
    ];
    for (let i = 0; i < ROUNDS; i++) await round(i, ctx, launchers);
  } finally {
    stopPlay();
  }
  console.log('\nrounds by browser | path | moment of the wipe:');
  for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(36)} ${v.ok} ok${v.bad ? `, ${v.bad} BAD` : ''}`);
  const total = Object.values(tally).reduce((a, v) => a + v.ok + v.bad, 0);
  const good = Object.values(tally).reduce((a, v) => a + v.ok, 0);
  console.log(`\n${violations === 0 ? `✅ ${good}/${total} PHONES GOT IN` : `✖ ${violations} VIOLATION(S), ${good}/${total} phones got in`} (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(violations === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
