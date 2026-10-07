// Live-ops UI walk-through (7.10): the scenarios a deploy check could not close without an
// ACTIVE run and several devices, played through the real screens against the local dev stack.
// Organizer = the local seed creator (creator-web console + callables), staff = play-web ?staff on
// a computer, players = two phone-sized pages with a synthetic GPS fix that counts its live watches.
// Covers: SOS → staff and console, chat both ways (badge, signed reply), "let them in", a flash
// mission for two teams, hold/resume, single-mission skip, a staff code without scoring, remove and
// restore a team, closing a mission a team holds, and ending the run (final screen + GPS stops).
//
//   npm run dev:all            (fresh, in another terminal)
//   npm run simulate:live-ops  (QA_SHOTS=<dir> keeps a screenshot per step)
//
// Exit code 1 on any failed check. Not part of a gate: it needs the dev stack and a browser.
import { chromium, devices } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const SHOTS = process.env.QA_SHOTS || '.';
const HERE = { lat: 31.7767, lng: 35.2345 };
const FAR = { lat: 31.7810, lng: 35.2400 }; // ~650 m away: needs "let them in"
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = initializeApp({ apiKey: 'emulator-key', projectId: 'rushpoint-pwa-7daaa', appId: 'liveops' }, 'liveops');
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fns = getFunctions(app); connectFunctionsEmulator(fns, '127.0.0.1', 5001);
const call = async (n, d) => (await httpsCallable(fns, n)(d)).data;
const cred = await signInWithEmailAndPassword(auth, 'creator@rushpoint.dev', 'test1234');
const ownerUid = cred.user.uid;

const { gameId } = await call('createGame', { title: 'UI QA 7.10', mode: 'individual' });
await call('updateGame', { gameId, scoringPreset: 'fixed_points_speed', stages: [
  { id: 's0', order: 0, title: 'שלב ראשון', tasks: [
    { id: 't-far', title: 'משימה רחוקה', type: 'field', coordinates: FAR, difficulty: 2, estimatedMinutes: 3, pointValue: 50, maxConcurrentTeams: 5 },
  ] },
  { id: 's1', order: 1, title: 'שלב אחרון', isFinal: true, tasks: [
    { id: 't-self', title: 'משימה בלי מיקום', type: 'self_report', coordinates: { lat: 0, lng: 0 }, locationless: true, triggerMode: 'locationless', difficulty: 1, estimatedMinutes: 2, pointValue: 30, maxConcurrentTeams: 5 },
    { id: 't-extra', title: 'משימה נוספת', type: 'self_report', coordinates: { lat: 0, lng: 0 }, locationless: true, triggerMode: 'locationless', difficulty: 1, estimatedMinutes: 2, pointValue: 30, maxConcurrentTeams: 5 },
  ] },
] });
const { runId, accessCode } = await call('launchRun', { gameId });
const { pin } = await call('inviteStaff', { ownerUid, gameId, runId, name: 'QA Staff' });
console.log(`game=${gameId} run=${runId} code=${accessCode} owner=${ownerUid}`);

const browser = await chromium.launch({ headless: true });
async function player(label) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL' });
  await ctx.addInitScript(({ here }) => {
    window.__watches = new Set();
    const pos = () => ({ coords: { latitude: here.lat, longitude: here.lng, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: 0 }, timestamp: Date.now() });
    const g = navigator.geolocation;
    Object.defineProperty(g, 'getCurrentPosition', { configurable: true, value: (okf) => setTimeout(() => okf(pos()), 50) });
    Object.defineProperty(g, 'watchPosition', { configurable: true, value: (okf) => { okf(pos()); const id = setInterval(() => okf(pos()), 1000); window.__watches.add(id); return id; } });
    Object.defineProperty(g, 'clearWatch', { configurable: true, value: (id) => { clearInterval(id); window.__watches.delete(id); } });
  }, { here: HERE });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.__console = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.__console.push(m.text().slice(0, 300)); });
  await page.goto(`http://localhost:5181/?code=${accessCode}`);
  await page.getByTestId('join-name').waitFor({ timeout: 40000 });
  await page.getByTestId('join-name').fill(label);
  await page.getByTestId('join-submit').click();
  await page.getByTestId('join-submit').waitFor({ state: 'detached', timeout: 40000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
const textOf = (page) => page.evaluate(() => document.body.innerText);

const A = await player('קבוצה א');
const B = await player('קבוצה ב');
await call('startTeams', { gameId, runId });
await sleep(4000);

// Staff on a computer.
const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
const S = await sctx.newPage();
S.__errors = [];
S.on('pageerror', (e) => S.__errors.push(String(e)));
await S.goto('http://localhost:5181/?staff');
await S.getByPlaceholder('השם שלכם').fill('QA Staff');
await S.getByPlaceholder('קוד צוות').fill(pin);
await S.getByRole('button', { name: 'התחברות' }).click();
const signedIn = await S.getByTestId('staff-topbar').waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
ok('staff signs in with a code (desktop layout)', signedIn);
await shot(S, '01-staff');

// ── P0: SOS reaches the staff window, chat opens from it, and the reply reaches the phone ──
try {
  await A.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click();
  await A.getByTestId('sos-message').fill('בדיקת SOS מקומית');
  await A.getByTestId('sos-send').click();
  await sleep(3000);
  await shot(A, '02-player-sos-sent');
  ok('the phone confirms the SOS was received', /המארגנים קיבלו את ההתראה/.test(await textOf(A)));
  await A.getByRole('button', { name: 'אישור', exact: true }).last().click().catch(() => {});
  const staffSees = await S.getByText('בדיקת SOS מקומית').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('SOS with a message appears on the staff screen', staffSees);
  await shot(S, '03-staff-sos');
  await S.getByTestId('sos-chat').first().click();
  await sleep(1500);
  const reply = S.getByPlaceholder('כתבו תשובה לקבוצה').first();
  const replyVisible = await reply.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  ok('"chat with the team" from the SOS opens a reply box', replyVisible);
  await shot(S, '04-staff-chat-open');
  if (replyVisible) {
    await reply.fill('תשובה מהמטה 123');
    await S.getByRole('button', { name: 'שליחה', exact: true }).first().click();
    await sleep(2500);
  }
  // The phone: open the drawer that holds the chat.
  await sleep(3000);
  ok('the phone badges the unread HQ reply', (await A.getByTestId('more-drawer-badge').count()) > 0);
  await A.getByTestId('more-drawer-toggle').click().catch(() => {});
  await sleep(600);
  console.log('A badge before opening:', await A.getByTestId('more-drawer-badge').count());
  await A.getByText('צ׳אט', { exact: true }).first().click().catch(() => {});
  console.log('A badge:', await A.getByTestId('more-drawer-badge').count(), 'A console:', JSON.stringify(A.__console.filter((x) => /chat|permission|denied|Firestore/i.test(x)).slice(0, 5)));
  const playerGetsReply = await A.getByText('תשובה מהמטה 123').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('the staff reply reaches the team phone', playerGetsReply);
  const signed = /QA Staff/.test(await textOf(A));
  ok('the reply is signed with the staff member name on the phone', signed);
  await shot(A, '05-player-chat');
  const box = A.getByPlaceholder('כתבו הודעה למארגנים').first();
  if (await box.isVisible().catch(() => false)) {
    await box.fill('הודעה מהקבוצה 456');
    await box.locator('xpath=ancestor::*[.//button][1]').getByRole('button').last().click().catch(async () => box.press('Enter'));
  }
  const staffGetsMsg = await S.getByText('הודעה מהקבוצה 456').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('a team message reaches the staff chat (two way)', staffGetsMsg);
  await shot(S, '06-staff-two-way');
} catch (e) { ok('SOS + chat flow ran', false, String(e).slice(0, 200)); }

// ── P0: let a stuck team into its located mission ──
try {
  const before = await textOf(B);
  ok('team B is held at a located mission it has not reached', /אני כאן|הגיעו|מ' מכאן/.test(before));
  await S.getByTestId('staff-team-tile').filter({ hasText: 'קבוצה ב' }).first().click();
  await sleep(1500);
  await shot(S, '07-staff-team-window');
  const letIn = S.getByTestId('staff-let-in').first();
  const hasLetIn = await letIn.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  ok('the team window offers "let them in"', hasLetIn);
  if (hasLetIn) {
    await letIn.click();
    await sleep(800);
    const confirm = S.getByRole('button', { name: /אישור|להכניס|כן/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await sleep(5000);
    await shot(B, '08-player-let-in');
    const after = await textOf(B);
    // A check-in mission: "I am here" must now go through from ~700 m away.
    await B.getByRole('button', { name: 'אני כאן' }).first().click().catch(() => {});
    const moved = await B.getByText('משימה בלי מיקום').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    ok('after "let them in", "I am here" completes the far mission and the team moves on', moved);
    await shot(B, '08b-player-after-checkin');
  }
  await S.keyboard.press('Escape').catch(() => {});
} catch (e) { ok('let-in flow ran', false, String(e).slice(0, 200)); }

// ── P1: a flash mission for two teams ("many", done by a button, no approval) ──
try {
  const scoreOf = async (page) => Number(((await textOf(page)).match(/ניקוד:\s*(\d+)/) || [])[1] ?? NaN);
  const a0 = await scoreOf(A); const b0 = await scoreOf(B);
  await call('pushFlashMission', { ownerUid, gameId, runId, title: 'בזק לשתיים', description: 'לחצו כשסיימתם', bonusPoints: 20, ttlSeconds: 600, claimMode: 'many', doneBy: 'button', requiresApproval: false });
  for (const [label, page] of [['A', A], ['B', B]]) {
    const sees = await page.getByTestId('flash-claim').first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    ok(`flash: team ${label} sees the flash mission`, sees);
    if (!sees) { await shot(page, `10-flash-missing-${label}`); continue; }
    await page.getByTestId('flash-claim').first().click();
    await page.getByTestId('flash-done').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.getByTestId('flash-done').first().click().catch(() => {});
    await sleep(4000);
  }
  await shot(A, '10-flash-A'); await shot(B, '10-flash-B');
  const a1 = await scoreOf(A); const b1 = await scoreOf(B);
  ok('flash: both teams got the bonus', a1 - a0 === 20 && b1 - b0 === 20, `A ${a0}→${a1}, B ${b0}→${b1}`);
} catch (e) { ok('flash flow ran', false, String(e).slice(0, 200)); }

// ── P1: hold and resume a team from the staff window ──
async function teamWindow(name) {
  await S.keyboard.press('Escape').catch(() => {});
  await sleep(500);
  await S.getByTestId('staff-team-tile').filter({ hasText: name }).first().click();
  await S.getByTestId('staff-window').first().waitFor({ timeout: 8000 });
}
async function confirmIfAsked() {
  await sleep(700);
  const dlg = S.getByRole('dialog').last();
  const btns = dlg.getByRole('button');
  const n = await btns.count().catch(() => 0);
  // A confirm dialog: press its primary (last non-cancel) button.
  for (let i = n - 1; i >= 0; i--) {
    const b = btns.nth(i);
    const label = (await b.innerText().catch(() => '')).trim();
    if (label && !/ביטול|סגירה|חזרה/.test(label) && (await b.isVisible().catch(() => false))) {
      const before = await S.getByRole('dialog').count();
      if (before > 1) { await b.click(); return label; }
      break;
    }
  }
  return null;
}
try {
  await teamWindow('קבוצה א');
  await S.getByRole('button', { name: 'עצירת הקבוצה' }).first().click();
  await sleep(800);
  await shot(S, '11-staff-hold-panel');
  // The hold panel may ask for a reason / confirm.
  await S.getByPlaceholder('כתבו סיבה קצרה').fill('בדיקה').catch(() => {});
  await S.getByRole('button', { name: 'עצירת הקבוצה', exact: true }).last().click();
  const held = await A.getByText('הצוות עצר אתכם').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('hold: the phone shows the staff hold', held);
  await shot(A, '12-player-held');
  await teamWindow('קבוצה א');
  await S.getByRole('button', { name: 'החזרת הקבוצה למשחק' }).first().click().catch(() => {});
  await confirmIfAsked();
  const resumed = await A.getByText('הצוות עצר אתכם').first().waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false);
  ok('resume: the hold notice goes away', resumed);
} catch (e) { ok('hold/resume flow ran', false, String(e).slice(0, 200)); }

// ── P1: skip a mission for one team ──
try {
  await teamWindow('קבוצה א');
  await S.getByRole('button', { name: 'דילוג על המשימה' }).first().click();
  await sleep(700);
  await S.getByRole('button', { name: 'דילוג על המשימה', exact: true }).last().click();
  const confirmed = 'clicked';
  await shot(S, '13-staff-skip');
  const moved = await A.getByText('משימה בלי מיקום').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('skip: the team moves on to the next mission', moved, `confirm=${confirmed}`);
  await shot(A, '14-player-after-skip');
} catch (e) { ok('skip flow ran', false, String(e).slice(0, 200)); }

// ── P1: a staff code without scoring sees no score buttons ──
try {
  const { pin: pin2 } = await call('inviteStaff', { ownerUid, gameId, runId, name: 'QA Limited', capabilities: ['chat', 'hold', 'safety'] });
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const S2 = await c2.newPage();
  await S2.goto('http://localhost:5181/?staff');
  await S2.getByPlaceholder('השם שלכם').fill('QA Limited');
  await S2.getByPlaceholder('קוד צוות').fill(pin2);
  await S2.getByRole('button', { name: 'התחברות' }).click();
  await S2.getByTestId('staff-topbar').waitFor({ timeout: 30000 });
  await S2.getByTestId('staff-team-tile').filter({ hasText: 'קבוצה א' }).first().click();
  await S2.getByTestId('staff-window').first().waitFor({ timeout: 8000 });
  await sleep(800);
  await shot(S2, '15-staff-limited');
  const t2 = await S2.getByTestId('staff-window').first().innerText();
  ok('limited staff: no +5/-5 score buttons', !/\+5|\+10|-5|-10/.test(t2), t2.slice(0, 120).replace(/\n/g, ' / '));
  ok('limited staff: can still hold the team', /עצירת הקבוצה/.test(t2));
  await c2.close();
} catch (e) { ok('limited staff flow ran', false, String(e).slice(0, 200)); }

// ── P1: remove a team and bring it back (organizer action), as the phone sees it ──
try {
  const teams = await call('listRunTeams', { ownerUid, gameId, runId });
  const bId = (teams?.teams ?? teams ?? []).find?.((t) => (t.name ?? t.displayName ?? '') === 'קבוצה ב')?.id;
  if (bId) {
    await call('setTeamRemoved', { ownerUid, gameId, runId, teamId: bId, removed: true });
    const removed = await B.getByTestId('team-removed').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    ok('remove: the phone shows the team was removed', removed);
    await shot(B, '16-player-removed');
    await call('setTeamRemoved', { ownerUid, gameId, runId, teamId: bId, removed: false });
    const back = await B.getByTestId('team-removed').first().waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false);
    ok('restore: the phone is back in the game', back);
  } else ok('remove/restore: found team B', false, JSON.stringify(teams).slice(0, 200));
} catch (e) { ok('remove/restore flow ran', false, String(e).slice(0, 200)); }

// ── Organizer console (creator-web): chat from an SOS card, and closing a mission a team holds ──
try {
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const C = await cctx.newPage();
  C.__errors = [];
  C.on('pageerror', (e) => C.__errors.push(String(e)));
  await C.goto('http://localhost:5180/');
  await C.getByPlaceholder('you@example.com').fill('creator@rushpoint.dev');
  await C.getByPlaceholder('••••••••').fill('test1234');
  await C.getByRole('button', { name: /כניסה/ }).last().click();
  await sleep(3000);
  await C.goto(`http://localhost:5180/run/${gameId}/${runId}`);
  await sleep(4000);
  // Team B raises an SOS; the console answers it in chat.
  await B.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click();
  await B.getByTestId('sos-message').fill('SOS לקונסולה');
  await B.getByTestId('sos-send').click();
  await sleep(2500);
  await B.getByRole('button', { name: 'אישור', exact: true }).last().click().catch(() => {});
  const consoleSees = await C.getByText('SOS לקונסולה').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('console: the SOS appears with its message', consoleSees);
  await shot(C, '20-console-sos');
  await C.getByTestId('sos-chat').first().click();
  await sleep(2000);
  const reply = C.getByPlaceholder('כתבו תשובה לקבוצה').first();
  const rv = await reply.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  ok('console: "chat with the team" from the SOS opens that team\'s reply box', rv);
  await shot(C, '21-console-chat');
  if (rv) {
    await reply.fill('המארגן עונה 789');
    await reply.press('Enter');
    await sleep(1000);
    if (await C.getByText('המארגן עונה 789').count() === 0) {
      await reply.locator('xpath=..').getByRole('button', { name: /שליחה/ }).first().click({ timeout: 5000 }).catch(() => {});
    }
  }
  await sleep(3000);
  await B.getByTestId('more-drawer-toggle').click().catch(() => {});
  await sleep(600);
  await B.getByText('צ׳אט', { exact: true }).first().click().catch(() => {});
  const bGets = await B.getByText('המארגן עונה 789').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok('console: the organizer reply reaches the team phone', bGets);
  await shot(B, '22-player-organizer-reply');
  await B.getByTestId('more-drawer-toggle').click().catch(() => {});

  // Close the mission team A is on; A moves on and is told.
  await C.getByRole('button', { name: /^משחק/ }).first().click().catch(() => {});
  await sleep(1500);
  const row = C.locator('li, tr, div').filter({ hasText: 'משימה בלי מיקום' }).filter({ has: C.getByRole('button', { name: 'סגירה', exact: true }) }).last();
  const hasClose = await row.getByRole('button', { name: 'סגירה', exact: true }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  ok('console: the live missions panel offers "close" for a mission', hasClose);
  await shot(C, '23-console-tasks');
  if (hasClose) {
    await row.getByRole('button', { name: 'סגירה', exact: true }).first().click();
    await sleep(800);
    await C.getByRole('button', { name: 'לסגור את המשימה' }).last().click().catch(() => {});
    const aMoved = await A.getByText('משימה נוספת').first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    ok('close: a team holding the closed mission moves to its next mission', aMoved);
    await shot(A, '24-player-after-close');
  }
  ok('console: no uncaught page errors', C.__errors.length === 0, C.__errors.slice(0, 2).join(' | '));
  await cctx.close();
} catch (e) { ok('console flow ran', false, String(e).slice(0, 220)); }

// ── P0: end the run mid-game; the phones show the end and stop GPS ──
try {
  const watchesBefore = await A.evaluate(() => window.__watches.size);
  ok('a player phone has a live GPS watch while playing', watchesBefore > 0, `watches=${watchesBefore}`);
  await call('finalizeRun', { gameId, runId });
  const fin = await A.getByTestId('final-screen').waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  ok('ending the run mid-game shows the final screen', fin);
  await sleep(2000);
  const watchesAfter = await A.evaluate(() => window.__watches.size);
  ok('the GPS watch stops once the run ended', watchesAfter === 0, `watches=${watchesAfter}`);
  await shot(A, '09-player-final');
} catch (e) { ok('end-run flow ran', false, String(e).slice(0, 200)); }

for (const [n, p] of [['A', A], ['B', B], ['staff', S]]) ok(`${n}: no uncaught page errors`, p.__errors.length === 0, p.__errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);
