// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — browser regression for the 14.10 join failure (change: self-healing-entry).
//   npm run verify:auth-loss        (boots its own emulator suite via scripts/emulator-exec.mjs)
//   node scripts/browser-auth-loss.mjs   (against a running dev:all)
//
// What happened at המירוץ לציון: a phone opened the team's QR link, the code check succeeded with a
// valid sign-in, and seconds later the iPhone's stored Firebase user vanished (an empty IndexedDB read
// makes @firebase/auth sign the page out locally). The join then left with NO token, the server said
// "Sign in required", the screen said "check your reception", and every retry on that page failed.
// Reproduced on a real iPhone on 15.10 (investigations/2026-10-14-race-to-zion).
//
// The iOS trigger is intermittent, but its EFFECT is deterministic and is exactly what this script
// does: after the code check it wipes the stored Firebase user from IndexedDB AND localStorage (both
// places the app may keep it), waits for the SDK's poll to notice, then taps join. It reads the
// Authorization header of every callable the page sends, so it can tell:
//   - whether the join went out with a token at all (the race-day failure: it did not);
//   - whether it carried the SAME identity as the code check (anything else is a new identity, the
//     source of duplicate and ghost teams).
// It runs in WebKit (Safari's engine, iPhone profile) and Chromium. Exits non-zero on any violation.
// ═══════════════════════════════════════════════════════════════════════════════
import { webkit, chromium, devices } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolveEmulatorPorts, BASE_EMULATOR_PORTS, PORT_OFFSET_ENV } from './lib/emulatorPorts.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Screenshots of the screens this change adds, for the human check at 375 px (iPhone width).
// Off unless SHOTS_DIR is set: the gate needs the assertions, not the pictures.
const SHOTS_DIR = process.env.SHOTS_DIR || '';
async function shot(page, name) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: false }).catch(() => undefined);
}

const PROJECT = 'rushpoint-pwa-7daaa';
const EMU = resolveEmulatorPorts(process.env);
if (EMU.firestore !== BASE_EMULATOR_PORTS.firestore) {
  // Same reason as simulate-browser-run.mjs: play-web pins the DEFAULT emulator ports.
  console.error(`\n✖ browser-auth-loss cannot run with ${PORT_OFFSET_ENV} set (play-web pins the default ports).\n`);
  process.exit(1);
}
const PLAY_URL = process.env.PLAY_URL || 'http://localhost:5181';
const PLAY_PORT = Number(new URL(PLAY_URL).port || 80);
const ATTACH_CTA_HE = 'הצטרפות עם הטלפון הזה';
const WIPE_SETTLE_MS = 2500; // > 3 IndexedDB polls (800 ms) and 2 localStorage polls (1 s)

let violations = 0;
function audit(label, cond, detail) {
  console.log(`${cond ? 'OK  ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) violations++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, { timeout = 30_000, interval = 400, label = 'condition' } = {}) {
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
  if (await httpOk(PLAY_URL)) { console.log(`play-web already serving on ${PLAY_URL}`); return () => {}; }
  console.log(`booting play-web dev server on :${PLAY_PORT} …`);
  const child = spawn('npm', ['run', 'play'], { shell: true, stdio: 'ignore', detached: false });
  await waitUntil(() => httpOk(PLAY_URL), { timeout: 120_000, interval: 1000, label: 'play-web dev server' });
  return () => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
    } catch { /* already gone */ }
  };
}
async function waitForFunctions(timeoutMs = 180_000) {
  const url = `http://127.0.0.1:${EMU.functions}/${PROJECT}/us-central1/getJoinInfo`;
  const probe = () => new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume(); resolve(res.statusCode !== 404);
    });
    req.on('error', () => resolve(false));
    req.end(JSON.stringify({ data: { code: 'ZZZZZZ' } }));
  });
  if (await probe()) return;
  console.log('waiting for the Functions emulator to register its functions …');
  await waitUntil(probe, { timeout: timeoutMs, interval: 2000, label: 'functions registered' });
}
function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `authloss-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${EMU.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', EMU.functions);
  return { auth, call: async (fn, data) => (await httpsCallable(functions, fn)(data)).data };
}

// The uid inside a Firebase ID token (emulator tokens are unsigned JWTs; production ones are signed,
// but the payload is readable either way). null ⇒ no token at all: the race-day request.
function uidFromAuthHeader(h) {
  const m = /^Bearer\s+(.+)$/i.exec(h || '');
  if (!m) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8'));
    return payload.user_id || payload.sub || '?';
  } catch { return '?'; }
}

// Delete the stored Firebase user from BOTH places the app may keep it. This is the effect of the
// iOS glitch: the store reads empty, so the SDK's poll signs the page out with no network and no error.
async function wipeStoredSignIn(page) {
  return page.evaluate(async () => {
    const removed = [];
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('firebase:authUser:')) { localStorage.removeItem(k); removed.push(`ls:${k.slice(0, 24)}`); }
    }
    await new Promise((resolve) => {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(); return; }
        const tx = db.transaction(['firebaseLocalStorage'], 'readwrite');
        const store = tx.objectStore('firebaseLocalStorage');
        const all = store.getAll();
        all.onsuccess = () => {
          for (const row of all.result || []) {
            if (String(row.fbase_key).startsWith('firebase:authUser:')) { store.delete(row.fbase_key); removed.push(`idb:${String(row.fbase_key).slice(0, 24)}`); }
          }
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
    });
    return removed;
  });
}

// ── Scenario: the QR join with the stored sign-in wiped between code check and join ──────────────
async function joinAfterWipe(browserName, launcher, profile, ctx) {
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ ...profile, locale: 'he-IL' });
  const page = await context.newPage();
  const calls = []; // { name, uid } per callable request the page sends
  page.on('request', (req) => {
    // Never touch production: a dev server that was built against the live API would send these
    // joins to real users' data. Fail loudly instead.
    if (/rush-point\.com/.test(req.url())) { prodHit = req.url(); }
    const m = /\/us-central1\/([A-Za-z]+)$/.exec(req.url()) || /\/([A-Za-z]+)$/.exec(new URL(req.url()).pathname);
    if (req.method() !== 'POST' || !m) return;
    if (!['getJoinInfo', 'joinTeamAsDevice', 'joinRun', 'getMyTeamState'].includes(m[1])) return;
    calls.push({ name: m[1], uid: uidFromAuthHeader(req.headers()['authorization']) });
  });
  const tag = `[${browserName}]`;
  let prodHit = null;
  try {
    await page.goto(`${PLAY_URL}/?code=${ctx.accessCode}&join=${ctx.deviceJoinCode}`);
    const cta = page.getByRole('button', { name: ATTACH_CTA_HE });
    await cta.waitFor({ state: 'visible', timeout: 40_000 });
    await waitUntil(() => calls.some((c) => c.name === 'getJoinInfo'), { timeout: 20_000, label: 'code check' });
    const checkUid = calls.find((c) => c.name === 'getJoinInfo').uid;
    audit(`${tag} the code check carried a sign-in`, !!checkUid, String(checkUid));

    const removed = await wipeStoredSignIn(page);
    audit(`${tag} the stored sign-in was wiped (setup)`, removed.length > 0, removed.join(','));
    await sleep(WIPE_SETTLE_MS);

    await cta.click();
    // Done when the phone shows the team's waiting/play screen (joined), or a join error sentence
    // (refused). Not "the button went away": its label changes to "joining…" while the call is in flight.
    const outcome = await Promise.race([
      page.getByText(/נכנסתם,|ממתינים שהמארגן/).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'joined').catch(() => null),
      page.getByText(/בעיית חיבור|ההצטרפות נכשלה|ההתחברות/).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'error').catch(() => null),
    ]) || 'timeout';
    await sleep(500);
    const joinCalls = calls.filter((c) => c.name === 'joinTeamAsDevice');
    const firstJoin = joinCalls[0];
    const okJoin = joinCalls.find((c) => c.uid);
    const shown = (await page.locator('body').innerText()).split('\n').find((l) => /בעיית חיבור|ההצטרפות נכשלה|ההתחברות/.test(l)) ?? '';

    audit(`${tag} the join request carried a sign-in (race day: it did not)`, !!(firstJoin && firstJoin.uid) || !!okJoin,
      joinCalls.map((c) => c.uid ?? 'NO-TOKEN').join(' → ') || 'no join request');
    audit(`${tag} the join carried the SAME identity as the code check (no new identity)`, !!okJoin && okJoin.uid === checkUid,
      `check=${checkUid} join=${okJoin?.uid ?? 'none'}`);
    const screenText = outcome === 'timeout' ? (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 220) : '';
    audit(`${tag} the phone joined the team`, outcome === 'joined', `${outcome}${shown ? ' :: screen: ' + shown : ''}${screenText ? ' :: page: ' + screenText : ''}`);

    const after = await ctx.founder.call('getMyTeamState', { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
    const devicesNow = after?.team?.deviceUids ?? [];
    audit(`${tag} no request went to production`, !prodHit, prodHit ?? '');
    audit(`${tag} the server lists that identity as a phone of the team`, !!checkUid && devicesNow.includes(checkUid), devicesNow.join(','));
  } catch (e) {
    audit(`${tag} scenario ran to completion`, false, e.message);
  } finally {
    await browser.close();
  }
}

// ── Shared plumbing for the scenarios below ─────────────────────────────────────────────────────
// A fresh team per scenario, so phone slots from one scenario never fill another's team.
async function newTeam(ctx, label, memberNames = ['A', 'B', 'C', 'D', 'E', 'F']) {
  const founder = makeParty(`founder-${label}-${Date.now()}`);
  await signInAnonymously(founder.auth);
  await founder.call('joinRun', { code: ctx.accessCode, displayName: `Team ${label}`, memberNames });
  const state = await founder.call('getMyTeamState', { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
  return { founder, teamId: founder.auth.currentUser.uid, deviceJoinCode: state?.team?.deviceJoinCode };
}
async function teamDevices(ctx, team) {
  const s = await team.founder.call('getMyTeamState', { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
  return s?.team?.deviceUids ?? [];
}
// A phone: an isolated mobile context that records the identity on every callable it sends.
async function openPhone(launcher, profile) {
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ ...profile, locale: 'he-IL' });
  const page = await context.newPage();
  const phone = { browser, page, calls: [], prodHit: null };
  page.on('request', (req) => {
    if (/rush-point\.com/.test(req.url())) phone.prodHit = req.url();
    const m = /\/us-central1\/([A-Za-z]+)$/.exec(req.url());
    if (req.method() !== 'POST' || !m) return;
    phone.calls.push({ name: m[1], uid: uidFromAuthHeader(req.headers()['authorization']), at: Date.now() });
  });
  return phone;
}
// Join a team through the QR link, normally (no wipe). Returns the identity that joined.
async function attachNormally(phone, ctx, team) {
  await phone.page.goto(`${PLAY_URL}/?code=${ctx.accessCode}&join=${team.deviceJoinCode}`);
  const cta = phone.page.getByRole('button', { name: ATTACH_CTA_HE });
  await cta.waitFor({ state: 'visible', timeout: 40_000 });
  await cta.click();
  await phone.page.getByText(/נכנסתם,|ממתינים שהמארגן/).first().waitFor({ state: 'visible', timeout: 30_000 });
  await waitUntil(() => phone.calls.some((c) => c.name === 'getMyTeamState' && c.uid), { timeout: 20_000, label: 'first team state' });
  return phone.calls.find((c) => c.name === 'joinTeamAsDevice' && c.uid)?.uid ?? null;
}
const storedUserPresent = (page) => page.evaluate(async () => {
  if (Object.keys(localStorage).some((k) => k.startsWith('firebase:authUser:'))) return true;
  return new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(false); return; }
      const all = db.transaction(['firebaseLocalStorage'], 'readonly').objectStore('firebaseLocalStorage').getAll();
      all.onsuccess = () => { db.close(); resolve((all.result || []).some((r) => String(r.fbase_key).startsWith('firebase:authUser:'))); };
      all.onerror = () => { db.close(); resolve(false); };
    };
  });
});

// ── Scenario: the sign-in is wiped on the play screen (D51) ─────────────────────────────────────
// Race day: "reconnecting" until the end. Now: the same identity is put back, the next call carries
// it, and the stored copy is repaired.
async function midGameWipe(browserName, launcher, profile, ctx) {
  const tag = `[${browserName} mid-game]`;
  const phone = await openPhone(launcher, profile);
  try {
    const team = await newTeam(ctx, `mid-${browserName}`);
    const joinedUid = await attachNormally(phone, ctx, team);
    audit(`${tag} joined normally (setup)`, !!joinedUid, String(joinedUid));
    const removed = await wipeStoredSignIn(phone.page);
    audit(`${tag} the stored sign-in was wiped (setup)`, removed.length > 0, removed.join(','));
    await sleep(WIPE_SETTLE_MS);
    const since = Date.now();
    // The app refreshes team state at once on the browser's `online` event (participant-offline-continuity).
    await phone.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitUntil(() => phone.calls.some((c) => c.name === 'getMyTeamState' && c.at >= since), { timeout: 20_000, label: 'a poll after the wipe' });
    await sleep(1500);
    const after = phone.calls.filter((c) => c.name === 'getMyTeamState' && c.at >= since);
    audit(`${tag} every poll after the wipe carried the SAME identity`, after.length > 0 && after.every((c) => c.uid === joinedUid),
      after.map((c) => c.uid ?? 'NO-TOKEN').join(','));
    const body = await phone.page.locator('body').innerText();
    audit(`${tag} no signed-out card and no dead end`, !/התנתק מהקבוצה|הסנכרון נכשל/.test(body));
    audit(`${tag} the stored sign-in was repaired`, await storedUserPresent(phone.page));
    audit(`${tag} no request went to production`, !phone.prodHit, phone.prodHit ?? '');
  } catch (e) {
    audit(`${tag} scenario ran to completion`, false, e.message);
  } finally {
    await phone.browser.close();
  }
}

// ── Scenario: the sign-in is wiped and the page is RELOADED ─────────────────────────────────────
// A fresh page cannot get the old identity back (it is gone from memory too). Race day: a new
// identity, a new team, or a ghost. Now: the play screen sees it came back as someone else, offers
// "back to my team", and one tap puts the phone back in the SAME team.
async function reloadAfterWipe(browserName, launcher, profile, ctx) {
  const tag = `[${browserName} reload]`;
  const phone = await openPhone(launcher, profile);
  try {
    const team = await newTeam(ctx, `reload-${browserName}`);
    const joinedUid = await attachNormally(phone, ctx, team);
    audit(`${tag} joined normally (setup)`, !!joinedUid, String(joinedUid));
    await sleep(1000); // the first team state stores the device code in the session
    await wipeStoredSignIn(phone.page);
    await phone.page.reload();
    const card = phone.page.getByTestId('signedOut');
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    audit(`${tag} the phone says it was signed out of its team`, true);
    await shot(phone.page, `signedOut-${browserName.replace('/', '-')}`);
    const rejoin = phone.page.getByTestId('rejoin-team');
    audit(`${tag} a one-tap rejoin is offered`, await rejoin.isVisible());
    await rejoin.click();
    await phone.page.getByText(/נכנסתם,|ממתינים שהמארגן/).first().waitFor({ state: 'visible', timeout: 30_000 });
    const rejoinedUid = phone.calls.filter((c) => c.name === 'joinTeamAsDevice' && c.uid).pop()?.uid;
    const devicesNow = await teamDevices(ctx, team);
    audit(`${tag} back in the SAME team`, !!rejoinedUid && devicesNow.includes(rejoinedUid), `${rejoinedUid} in ${devicesNow.join(',')}`);
    audit(`${tag} no request went to production`, !phone.prodHit, phone.prodHit ?? '');
  } catch (e) {
    audit(`${tag} scenario ran to completion`, false, e.message);
  } finally {
    await phone.browser.close();
  }
}

// ── Scenario: a player signed in under the OLD storage loads the new version ─────────────────────
// The 14.10 build kept the user in IndexedDB; this change keeps it in localStorage first. A player
// signed in at deploy time must keep the same identity: the SDK finds the user in IndexedDB and
// migrates it. Simulated by moving the stored user into IndexedDB only, then reloading.
async function migrationFromIndexedDb(browserName, launcher, profile, ctx) {
  const tag = `[${browserName} migration]`;
  const phone = await openPhone(launcher, profile);
  try {
    const team = await newTeam(ctx, `migr-${browserName}`);
    const joinedUid = await attachNormally(phone, ctx, team);
    audit(`${tag} joined normally (setup)`, !!joinedUid, String(joinedUid));
    const moved = await phone.page.evaluate(async () => {
      const lsKey = Object.keys(localStorage).find((k) => k.startsWith('firebase:authUser:'));
      if (!lsKey) return 'already-in-idb';
      const value = JSON.parse(localStorage.getItem(lsKey));
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('firebaseLocalStorageDb', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['firebaseLocalStorage'], 'readwrite');
          tx.objectStore('firebaseLocalStorage').put({ fbase_key: lsKey, value });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      });
      localStorage.removeItem(lsKey);
      return 'moved-to-idb';
    });
    audit(`${tag} the user is now stored only in IndexedDB (setup)`, true, moved);
    const since = Date.now();
    await phone.page.reload();
    await waitUntil(() => phone.calls.some((c) => c.name === 'getMyTeamState' && c.at >= since && c.uid), { timeout: 30_000, label: 'team state after reload' });
    await sleep(1500);
    const after = phone.calls.filter((c) => c.name === 'getMyTeamState' && c.at >= since);
    audit(`${tag} the same identity after loading the new version`, after.length > 0 && after.every((c) => c.uid === joinedUid),
      after.map((c) => c.uid ?? 'NO-TOKEN').join(','));
    const body = await phone.page.locator('body').innerText();
    audit(`${tag} no signed-out card`, !/התנתק מהקבוצה/.test(body));
    audit(`${tag} no request went to production`, !phone.prodHit, phone.prodHit ?? '');
  } catch (e) {
    audit(`${tag} scenario ran to completion`, false, e.message);
  } finally {
    await phone.browser.close();
  }
}

// ── Scenario: a FULL team on the add-a-phone path (D05) ─────────────────────────────────────────
// 14.10: "the team is full" was shown as "check the device code", and people re-typed a code that
// was right. A team declared with one member takes 3 phones (max(3, members)); the 4th must read
// that the team is full.
async function teamFullMessage(browserName, launcher, profile, ctx) {
  const tag = `[${browserName} team full]`;
  const phone = await openPhone(launcher, profile);
  try {
    const team = await newTeam(ctx, `full-${browserName}`, ['A']);
    for (let i = 0; i < 2; i++) {
      const extra = makeParty(`extra-${browserName}-${i}-${Date.now()}`);
      await signInAnonymously(extra.auth);
      await extra.call('joinTeamAsDevice', { code: ctx.accessCode, teamCode: team.deviceJoinCode });
    }
    await phone.page.goto(`${PLAY_URL}/?code=${ctx.accessCode}&join=${team.deviceJoinCode}`);
    const cta = phone.page.getByRole('button', { name: ATTACH_CTA_HE });
    await cta.waitFor({ state: 'visible', timeout: 40_000 });
    await cta.click();
    const full = phone.page.getByText('בקבוצה הזו כבר יש את מספר הטלפונים המרבי');
    const seen = await full.first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    const body = await phone.page.locator('body').innerText();
    audit(`${tag} the phone reads that the team is full`, seen);
    audit(`${tag} it is NOT told to check the device code`, !/בדקו את קוד המכשירים/.test(body));
    await full.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await shot(phone.page, `team-full-${browserName.replace('/', '-')}`);
  } catch (e) {
    audit(`${tag} scenario ran to completion`, false, e.message);
  } finally {
    await phone.browser.close();
  }
}

async function main() {
  const t0 = Date.now();
  console.log('── RushPoint browser regression: sign-in wiped mid-join (14.10) ──\n');
  const stopPlay = await ensurePlayServer();
  try {
    await waitForFunctions();
    const creator = makeParty('creator');
    await signInAnonymously(creator.auth);
    const { gameId } = await creator.call('createGame', { title: 'Auth loss regression', mode: 'team' });
    await creator.call('updateGame', {
      gameId,
      stages: [{
        id: 'al-s1', order: 0, title: 'Stage', isFinal: true,
        tasks: [{ id: 'al-t1', title: 'Done', type: 'self_report', coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 3, pointValue: 10, maxConcurrentTeams: 50, locationless: true, triggerMode: 'locationless' }],
      }],
    });
    const { runId, accessCode } = await creator.call('launchRun', { gameId });

    // The team's first phone joins (a normal join, as on race day), with enough members for spare phone slots.
    const founder = makeParty('founder');
    await signInAnonymously(founder.auth);
    await founder.call('joinRun', { code: accessCode, displayName: 'Regression Team', memberNames: ['A', 'B', 'C', 'D', 'E', 'F'] });
    const ownerUid = creator.auth.currentUser.uid;
    const state = await founder.call('getMyTeamState', { ownerUid, gameId, runId });
    const deviceJoinCode = state?.team?.deviceJoinCode;
    const teamId = founder.auth.currentUser.uid;
    console.log(`game=${gameId} run=${runId} code=${accessCode} deviceJoinCode=${deviceJoinCode}\n`);
    if (!deviceJoinCode) throw new Error('setup: the team has no deviceJoinCode');

    const ctx = { creator, founder, ownerUid, gameId, runId, accessCode, deviceJoinCode, teamId };
    const browsers = [
      ['webkit/iPhone', webkit, devices['iPhone 15'] ?? devices['iPhone 14']],
      ['chromium/Pixel', chromium, devices['Pixel 7']],
    ];
    for (const [name, launcher, profile] of browsers) {
      await joinAfterWipe(name, launcher, profile, ctx);
      await midGameWipe(name, launcher, profile, ctx);
      await reloadAfterWipe(name, launcher, profile, ctx);
      await migrationFromIndexedDb(name, launcher, profile, ctx);
      await teamFullMessage(name, launcher, profile, ctx);
    }
  } finally {
    stopPlay();
  }
  console.log(`\n${violations === 0 ? '✅ SIGN-IN LOSS RECOVERED' : `✖ ${violations} VIOLATION(S)`} (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(violations === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
