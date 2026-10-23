// The iPhone join check (deploy checks, open since 15.10), in REAL Mobile Safari on an iOS Simulator.
// Runs on a GitHub macOS runner (.github/workflows/ios-sim-joins.yml) against PRODUCTION.
//
// Each round, in a fresh Safari session with its storage cleared:
//   1. open the team's QR link (?code=<run>&join=<team>) and wait for the attach button;
//   2. wipe the stored Firebase user (IndexedDB + localStorage), wait for the SDK's poll — the 14.10
//      iPhone failure, see scripts/browser-auth-loss.mjs — then tap join;
//   3. the phone must reach the team's waiting screen with the SAME stored identity it had before;
//   4. wipe again on the waiting screen and wait out a poll: still the same identity, no "signed out" text.
// Every wipe the app heals is reported to the API as authLost/reinstated, so the VPS join log
// (scripts/vps-join-funnel.sh) is the independent second witness of each round.
//
//   RUN_CODE=AT4GB7 ROUNDS=10 SIM_UDID=<udid> node scripts/ios-sim/ios-sim-joins.mjs
import { Builder, By, until } from 'selenium-webdriver';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const RUN_CODE = process.env.RUN_CODE;
const ROUNDS = Number(process.env.ROUNDS || 10);
const SIM_UDID = process.env.SIM_UDID;
const PLAY = 'https://player.rush-point.com';
const API = 'https://api.rush-point.com';
const OUT = process.env.OUT_DIR || 'ios-sim-out';
const ATTACH_CTA = /הצטרפות עם הטלפון הזה|Join with this phone/;
const JOINED = /נכנסתם,|ממתינים שהמארגן|You're in,/;
const SIGNED_OUT = /הטלפון התנתק מהמשחק|was signed out of the game|בעיית חיבור|ההצטרפות נכשלה/;
const WIPE_SETTLE_MS = 2500; // > 3 IndexedDB polls (800 ms) and 2 localStorage polls (1 s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// The web API key is public (it ships in every player bundle); read it from there, not from a secret.
async function publicApiKey() {
  const html = await (await fetch(PLAY)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const a of assets) {
    const m = (await (await fetch(PLAY + a)).text()).match(/AIza[0-9A-Za-z_-]{35}/);
    if (m) return m[0];
  }
  throw new Error('no API key in the player bundle');
}

// A team to attach to: founded by a throwaway anonymous player; its device code is read back.
async function newTeam(key, i) {
  const s = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' })).json();
  const call = async (name, data) => {
    const r = await fetch(`${API}/${name}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.idToken}`, Origin: PLAY },
      body: JSON.stringify({ data }) });
    const j = await r.json();
    if (j.error) throw new Error(`${name}: ${JSON.stringify(j.error)}`);
    return j.result;
  };
  await call('joinRun', { code: RUN_CODE, displayName: `iOS sim ${i}`, registrationData: {}, memberNames: [] });
  const st = await call('getMyTeamState', { code: RUN_CODE });
  const code = st?.team?.deviceJoinCode ?? st?.deviceJoinCode;
  if (!code) throw new Error('team has no device code');
  return code;
}

// ── in-page helpers (run inside Safari) ──
const CLEAR_ALL = `const done = arguments[arguments.length - 1];
  (async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    try { for (const d of (await indexedDB.databases())) indexedDB.deleteDatabase(d.name); } catch {}
    try { for (const r of (await navigator.serviceWorker.getRegistrations())) await r.unregister(); } catch {}
    try { for (const k of (await caches.keys())) await caches.delete(k); } catch {}
  })().then(() => done(true), () => done(false));`;

const STORED_UID = `const done = arguments[arguments.length - 1];
  const fromLs = Object.keys(localStorage).find((k) => k.startsWith('firebase:authUser:'));
  if (fromLs) { try { done(JSON.parse(localStorage.getItem(fromLs)).uid); } catch { done('ls?'); } }
  else {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => done(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); done(null); return; }
      const all = db.transaction(['firebaseLocalStorage']).objectStore('firebaseLocalStorage').getAll();
      all.onsuccess = () => { db.close(); const row = (all.result || []).find((r) => String(r.fbase_key).startsWith('firebase:authUser:')); done(row ? row.value.uid : null); };
      all.onerror = () => { db.close(); done(null); };
    };
  }`;

const WIPE_SIGN_IN = `const done = arguments[arguments.length - 1];
  const removed = [];
  for (const k of Object.keys(localStorage)) if (k.startsWith('firebase:authUser:')) { localStorage.removeItem(k); removed.push('ls'); }
  const req = indexedDB.open('firebaseLocalStorageDb');
  req.onerror = () => done(removed);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); done(removed); return; }
    const tx = db.transaction(['firebaseLocalStorage'], 'readwrite');
    const store = tx.objectStore('firebaseLocalStorage');
    const all = store.getAll();
    all.onsuccess = () => { for (const r of all.result || []) if (String(r.fbase_key).startsWith('firebase:authUser:')) { store.delete(r.fbase_key); removed.push('idb'); } };
    tx.oncomplete = () => { db.close(); done(removed); };
    tx.onerror = () => { db.close(); done(removed); };
  };`;

async function bodyText(d) { return d.executeScript('return document.body ? document.body.innerText : ""'); }
async function waitText(d, re, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (re.test(await bodyText(d).catch(() => ''))) return true; await sleep(500); }
  return false;
}

async function round(i, teamCode) {
  const r = { round: i, at: new Date().toISOString().slice(11, 19) + 'Z', teamCode, joined: false, sameIdAfterJoin: false, healedOnWaitScreen: false, note: '' };
  const caps = { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceType': 'iPhone' };
  if (SIM_UDID) caps['safari:deviceUDID'] = SIM_UDID;
  const d = await new Builder().usingServer('http://127.0.0.1:4444').withCapabilities(caps).build();
  try {
    await d.manage().setTimeouts({ script: 20000, pageLoad: 60000 });
    if (i === 1) r.ua = await d.executeScript('return navigator.userAgent');
    // A wiped phone: clear everything this origin could have kept from an earlier round.
    await d.get(`${PLAY}/terms`);
    await d.executeAsyncScript(CLEAR_ALL);
    await d.manage().deleteAllCookies();

    await d.get(`${PLAY}/?code=${RUN_CODE}&join=${teamCode}`);
    if (!(await waitText(d, ATTACH_CTA, 45000))) throw new Error('attach button never appeared');
    await sleep(1500); // the code check (getJoinInfo) has signed the page in by now
    const checkUid = await d.executeAsyncScript(STORED_UID);
    if (!checkUid) r.note += 'no stored sign-in before the wipe; ';

    const removed1 = await d.executeAsyncScript(WIPE_SIGN_IN);
    await sleep(WIPE_SETTLE_MS);
    const buttons = await d.findElements(By.css('button'));
    let clicked = false;
    for (const b of buttons) { if (ATTACH_CTA.test(await b.getText().catch(() => ''))) { await b.click(); clicked = true; break; } }
    if (!clicked) throw new Error('could not tap the attach button');

    const end = Date.now() + 40000;
    let outcome = 'timeout';
    while (Date.now() < end) {
      const t = await bodyText(d).catch(() => '');
      if (JOINED.test(t)) { outcome = 'joined'; break; }
      if (SIGNED_OUT.test(t)) { outcome = 'error: ' + (t.split('\n').find((l) => SIGNED_OUT.test(l)) || ''); break; }
      await sleep(500);
    }
    r.joined = outcome === 'joined';
    await sleep(1500);
    const joinUid = await d.executeAsyncScript(STORED_UID);
    r.sameIdAfterJoin = !!checkUid && joinUid === checkUid;
    if (!r.joined) r.note += `${outcome}; `;
    r.note += `wipe1=${removed1.join('+') || 'none'} check=${(checkUid || '-').slice(0, 6)} join=${(joinUid || '-').slice(0, 6)}; `;

    if (r.joined) {
      // The same failure on the waiting screen: the poll must keep working under the same identity.
      const removed2 = await d.executeAsyncScript(WIPE_SIGN_IN);
      await sleep(15000);
      const t = await bodyText(d);
      const afterUid = await d.executeAsyncScript(STORED_UID);
      r.healedOnWaitScreen = JOINED.test(t) && !SIGNED_OUT.test(t) && afterUid === checkUid;
      r.note += `wipe2=${removed2.join('+') || 'none'} after=${(afterUid || '-').slice(0, 6)}`;
    }
  } catch (e) {
    r.note += String(e.message || e).split('\n')[0].slice(0, 200);
  } finally {
    try { writeFileSync(`${OUT}/round-${i}.png`, await d.takeScreenshot(), 'base64'); } catch {}
    await d.quit().catch(() => {});
  }
  return r;
}

const key = await publicApiKey();
const results = [];
let teamCode = null;
for (let i = 1; i <= ROUNDS; i++) {
  if (i % 2 === 1) teamCode = await newTeam(key, i); // a team holds 3 phones: its founder + 2
  const r = await round(i, teamCode);
  results.push(r);
  console.log(JSON.stringify(r));
}
const n = (f) => results.filter(f).length;
const summary = [
  `## iPhone joins in Mobile Safari (iOS Simulator), run ${RUN_CODE}`,
  results[0]?.ua ? `\`${results[0].ua}\`` : '',
  '',
  `- joined: **${n((r) => r.joined)}/${ROUNDS}**`,
  `- same identity after the pre-join sign-in wipe: **${n((r) => r.sameIdAfterJoin)}/${ROUNDS}**`,
  `- healed a sign-in wipe on the waiting screen: **${n((r) => r.healedOnWaitScreen)}/${ROUNDS}**`,
  '',
  '| # | time (UTC) | team | joined | same id | healed | note |', '|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.round} | ${r.at} | ${r.teamCode} | ${r.joined ? 'yes' : 'NO'} | ${r.sameIdAfterJoin ? 'yes' : 'NO'} | ${r.healedOnWaitScreen ? 'yes' : 'NO'} | ${r.note.replace(/\|/g, '/')} |`),
].join('\n');
console.log('\n' + summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.joined && r.sameIdAfterJoin && r.healedOnWaitScreen) ? 0 : 1);
