// Field-bug hunt (7.10 evening): look for the CLASSES of bug the 7.10 QA and simulation found by
// hand, in the real screens, instead of for those exact bugs:
//   49/50  a browser that never answers (or refuses) a location request stalls a flow
//   51     hardware restarted on every refresh (camera, GPS watch)
//   52     a panel/map REMOUNTED by an unrelated change, losing what the person was doing
//   52/53  a map moving itself after the person moved it
//   56     something still running after the race is over (GPS, camera, timers)
//   57     a button that does nothing
// plus crashes, React warnings and loaders that never finish, on every screen visited.
//
//   npm run dev:all              (fresh, in another terminal)
//   node scripts/hunt-field-bugs.mjs            (HUNT_SHOTS=<dir> for screenshots, HUNT_ONLY=h1,h4)
//
// Every page gets probes (window.__probe): live GPS watches, camera opens/stops, live intervals,
// maps and videos REMOVED from the DOM. A finding is printed as FINDING with its evidence; the run
// ends with a JSON report. Exit code 1 when anything was found. Needs the dev stack and a browser.
import { chromium, devices } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { writeFileSync, mkdirSync } from 'node:fs';

const SHOTS = process.env.HUNT_SHOTS || './hunt-shots';
mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.HUNT_ONLY || '').split(',').filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findings = [];
const checks = [];
function check(id, name, pass, detail = '') {
  checks.push({ id, name, pass, detail });
  console.log(`${pass ? 'ok     ' : 'FINDING'}  [${id}] ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) findings.push({ id, name, detail });
}
function note(id, text) { console.log(`  ·  [${id}] ${text}`); }

const HERE = { lat: 31.7767, lng: 35.2345 };
const FAR = { lat: 31.7810, lng: 35.2400 }; // ~650 m

// ── Backend (organizer side only) ──
const app = initializeApp({ apiKey: 'emulator-key', projectId: 'rushpoint-pwa-7daaa', appId: 'hunt' }, 'hunt');
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fns = getFunctions(app); connectFunctionsEmulator(fns, '127.0.0.1', 5001);
const call = async (n, d) => (await httpsCallable(fns, n)(d)).data;
await signInWithEmailAndPassword(auth, 'creator@rushpoint.dev', 'test1234');
const ownerUid = auth.currentUser.uid;

const T = (id, title, type, extra = {}) => ({ id, title, type, coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 20, ...extra });
const LOCLESS = { locationless: true, triggerMode: 'locationless' };
async function makeRun(title, stages) {
  const { gameId } = await call('createGame', { title, mode: 'individual' });
  await call('updateGame', { gameId, scoringPreset: 'fixed_points_speed', stages });
  const { runId, accessCode } = await call('launchRun', { gameId });
  return { gameId, runId, accessCode };
}

// ── Browser + probes ──
const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const PROBE = ({ here, geoMode }) => {
  const P = window.__probe = { geoMode, here, watches: new Map(), watchStarts: 0, gcp: 0, gum: 0, gumStops: 0, liveTracks: 0,
    intervals: new Set(), mapsRemoved: 0, videosRemoved: 0, wake: 0, errors: [] };
  // Geolocation: 'ok' answers with P.here; 'never' never answers; 'deny' refuses.
  const g = navigator.geolocation;
  const fix = () => ({ coords: { latitude: P.here.lat, longitude: P.here.lng, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: 0 }, timestamp: Date.now() });
  const refuse = (err) => err && err({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  let wid = 0;
  Object.defineProperty(g, 'getCurrentPosition', { configurable: true, value: (okf, err) => {
    P.gcp++;
    if (P.geoMode === 'ok') setTimeout(() => okf(fix()), 50);
    else if (P.geoMode === 'deny') setTimeout(() => refuse(err), 50);
  } });
  Object.defineProperty(g, 'watchPosition', { configurable: true, value: (okf, err) => {
    const id = ++wid; P.watchStarts++;
    const tick = () => { if (P.geoMode === 'ok') okf(fix()); };
    const h = setInterval(tick, 1000);
    P.watches.set(id, h);
    if (P.geoMode === 'ok') setTimeout(tick, 30); else if (P.geoMode === 'deny') setTimeout(() => refuse(err), 50);
    return id;
  } });
  Object.defineProperty(g, 'clearWatch', { configurable: true, value: (id) => { const h = P.watches.get(id); if (h) clearInterval(h); P.watches.delete(id); } });
  // Camera.
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      P.gum++;
      const s = await orig(c);
      s.getTracks().forEach((t) => { P.liveTracks++; const st = t.stop.bind(t); t.stop = () => { if (t.readyState === 'live') { P.gumStops++; P.liveTracks--; } st(); }; });
      return s;
    };
  }
  // Intervals that are never cleared pile up.
  const si = window.setInterval.bind(window); const ci = window.clearInterval.bind(window);
  window.setInterval = (...a) => { const id = si(...a); P.intervals.add(id); return id; };
  window.clearInterval = (id) => { P.intervals.delete(id); return ci(id); };
  // Wake lock.
  if (navigator.wakeLock) { const r = navigator.wakeLock.request.bind(navigator.wakeLock); navigator.wakeLock.request = (...a) => { P.wake++; return r(...a); }; }
  // Remounts: a map or video element LEAVING the document.
  const watchDom = () => new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.removedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches?.('.maplibregl-map') || n.querySelector?.('.maplibregl-map')) P.mapsRemoved++;
      if (n.matches?.('video') || n.querySelector?.('video')) P.videosRemoved++;
    }
  }).observe(document, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchDom); else watchDom();
};
const probe = (page) => page.evaluate(() => { const P = window.__probe; return { watchStarts: P.watchStarts, liveWatches: P.watches.size, gcp: P.gcp, gum: P.gum, gumStops: P.gumStops, liveTracks: P.liveTracks, intervals: P.intervals.size, mapsRemoved: P.mapsRemoved, videosRemoved: P.videosRemoved, wake: P.wake }; });
const setGeo = (page, mode) => page.evaluate((m) => { window.__probe.geoMode = m; }, mode);
const moveTo = (page, here) => page.evaluate((h) => { window.__probe.here = h; }, here);

const pages = [];
function track(page, label) {
  page.__label = label; page.__errors = []; page.__warn = [];
  page.on('pageerror', (e) => page.__errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/WebChannelConnection|Failed to load resource|net::ERR|favicon|maptiler|tile|ERR_NAME_NOT_RESOLVED|status of 4\d\d|clipboard copy failed/i.test(t)) page.__errors.push('console: ' + t.slice(0, 300));
    if (/same key|Maximum update depth|Cannot update a component|unmounted component|Rendered (fewer|more) hooks|act\(/i.test(t)) page.__warn.push(t.slice(0, 300));
  });
  pages.push(page);
  return page;
}
async function crashed(page) { return (await page.getByText('משהו השתבש').count().catch(() => 0)) > 0; }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});

async function player(code, label, { here = HERE, geoMode = 'ok', device = 'Pixel 7' } = {}) {
  const ctx = await browser.newContext({ ...devices[device], locale: 'he-IL', permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(PROBE, { here, geoMode });
  const page = track(await ctx.newPage(), label);
  await page.goto(`http://localhost:5181/?code=${code}`);
  await page.getByTestId('join-name').waitFor({ timeout: 40000 });
  await page.getByTestId('join-name').fill(label);
  await page.getByTestId('join-submit').click();
  await page.getByTestId('join-submit').waitFor({ state: 'detached', timeout: 40000 });
  return page;
}
async function staff(run, { mobile = false } = {}) {
  const { pin } = await call('inviteStaff', { ownerUid, gameId: run.gameId, runId: run.runId, name: 'Hunt Staff' });
  const ctx = await browser.newContext(mobile ? { ...devices['Pixel 7'], locale: 'he-IL' } : { viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  await ctx.addInitScript(PROBE, { here: HERE, geoMode: 'ok' });
  const page = track(await ctx.newPage(), mobile ? 'staff-phone' : 'staff-desk');
  await page.goto('http://localhost:5181/?staff');
  await page.getByPlaceholder('השם שלכם').fill('Hunt Staff');
  await page.getByPlaceholder('קוד צוות').fill(pin);
  await page.getByRole('button', { name: 'התחברות' }).click();
  await sleep(4000);
  return page;
}
async function console_(run, { mobile = false } = {}) {
  const ctx = await browser.newContext(mobile ? { ...devices['Pixel 7'], locale: 'he-IL' } : { viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  await ctx.addInitScript(PROBE, { here: HERE, geoMode: 'ok' });
  const page = track(await ctx.newPage(), mobile ? 'console-phone' : 'console');
  await page.goto('http://localhost:5180/');
  await page.getByPlaceholder('you@example.com').fill('creator@rushpoint.dev');
  await page.getByPlaceholder('••••••••').fill('test1234');
  await page.getByRole('button', { name: /כניסה/ }).last().click();
  await sleep(3000);
  await page.goto(`http://localhost:5180/run/${run.gameId}/${run.runId}`);
  await sleep(5000);
  return page;
}
async function waitText(page, re, timeout = 20000) {
  return page.getByText(re).first().waitFor({ timeout }).then(() => true).catch(() => false);
}
// A marker's screen position, by kind: the player's active mission marker is the first marker with
// an aria-label; for the other maps, every marker centre.
const markerCentres = (page) => page.evaluate(() => {
  const map = [...document.querySelectorAll('.maplibregl-map')].find((m) => m.clientWidth > 0);
  // Relative to the map's own box, so a page that scrolls or reflows around the map is not read as
  // the map moving.
  const o = map?.getBoundingClientRect();
  return [...(map?.querySelectorAll('.maplibregl-marker') ?? [])].map((m) => { const r = m.getBoundingClientRect(); return [Math.round(r.x + r.width / 2 - o.x), Math.round(r.y + r.height / 2 - o.y)]; });
});
async function dragMap(page, dx, dy) {
  const box = await page.locator('.maplibregl-canvas').filter({ visible: true }).first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 3;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8); await sleep(30); }
  await page.mouse.up();
}
async function touchDrag(page, dx, dy, fingers = 1) {
  const box = await page.locator('.maplibregl-canvas').filter({ visible: true }).first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 3;
  const cdp = await page.context().newCDPSession(page);
  const tp = (type, px, py) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : Array.from({ length: fingers }, (_, k) => ({ x: px + k * 60, y: py, id: k })) });
  await tp('touchStart', x, y);
  for (let i = 1; i <= 10; i++) { await tp('touchMove', x + (dx * i) / 10, y + (dy * i) / 10); await sleep(30); }
  await tp('touchEnd');
}
const near = (a, b, tol = 3) => a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

// ═════════════════════════════════════════════════════════════════════════════
// H1 · the player's phone sitting on a located mission: what churns while nobody touches it?
// H2 · the player moves the map; does it come back on its own while GPS and polls tick? (53 class)
// ═════════════════════════════════════════════════════════════════════════════
if (want('h1') || want('h2')) {
  try {
    const run = await makeRun('Hunt H1', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-far', 'משימה רחוקה', 'field', { coordinates: FAR })] },
    ]);
    const A = await player(run.accessCode, 'ציד א');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await waitText(A, 'משימה רחוקה', 30000);
    await A.locator('.maplibregl-canvas').first().waitFor({ timeout: 20000 });
    await sleep(5000);
    const p0 = await probe(A);
    // An announcement + a second team joining = the kind of refresh that happens all the time.
    await call('pushAnnouncement', { ownerUid, gameId: run.gameId, runId: run.runId, title: 'בדיקה', message: 'הודעה לכולם' });
    const B = await player(run.accessCode, 'ציד ב');
    for (let i = 0; i < 10; i++) { await moveTo(A, { lat: HERE.lat + i * 0.00002, lng: HERE.lng }); await sleep(3000); }
    const p1 = await probe(A);
    await shot(A, 'h1-player-idle');
    if (want('h1')) {
      check('h1', 'player: the GPS watch is not restarted while the phone sits on a mission', p1.watchStarts === p0.watchStarts, `watchStarts ${p0.watchStarts}→${p1.watchStarts}`);
      check('h1', 'player: at most 2 live GPS watches (PlayScreen + distance badge)', p1.liveWatches <= 2, `live=${p1.liveWatches}`);
      note('h1', `live GPS watches while on a located mission: ${p1.liveWatches} (CLAUDE.md promises ONE)`);
      check('h1', 'player: the map is not rebuilt during 30 s of refreshes', p1.mapsRemoved === p0.mapsRemoved, `mapsRemoved ${p0.mapsRemoved}→${p1.mapsRemoved}`);
      check('h1', 'player: live intervals do not pile up', p1.intervals - p0.intervals <= 2, `intervals ${p0.intervals}→${p1.intervals}`);
    }
    if (want('h2')) {
      // Mouse drag (desktop-like) and then touch drag (a phone): does the map snap back?
      for (const [kind, fn] of [['mouse', dragMap], ['touch', touchDrag]]) {
        const before = await markerCentres(A);
        await fn(A, -120, 140);
        await sleep(800);
        const moved = await markerCentres(A);
        const didMove = before[0] && moved[0] && !near(before[0], moved[0], 10);
        if (!didMove) { note('h2', `${kind} drag did not move the player map (before=${JSON.stringify(before[0])} after=${JSON.stringify(moved[0])})`); continue; }
        for (let i = 0; i < 8; i++) { await moveTo(A, { lat: HERE.lat + 0.0002 + i * 0.00003, lng: HERE.lng + i * 0.00002 }); await sleep(2500); }
        const later = await markerCentres(A);
        await shot(A, `h2-player-after-${kind}-drag`);
        check('h2', `player map stays where the person ${kind}-dragged it while GPS and polls tick (53 class)`, near(moved[0], later[0], 4),
          `after drag=${JSON.stringify(moved[0])} 20s later=${JSON.stringify(later[0])}`);
      }
    }
    for (const p of [A, B]) check('h1', `${p.__label}: no crash / page errors / React warnings`, !(await crashed(p)) && p.__errors.length === 0 && p.__warn.length === 0, [...p.__errors, ...p.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h1', 'H1/H2 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H3 · cameras open once: the in-app photo camera and the video recorder, idle through refreshes
// ═════════════════════════════════════════════════════════════════════════════
if (want('h3')) {
  try {
    const run = await makeRun('Hunt H3', [
      { id: 's0', order: 0, title: 'תמונה', tasks: [T('t-photo', 'משימת תמונה', 'photo', { ...LOCLESS, smart: { autoApprove: true } })] },
      { id: 's1', order: 1, title: 'וידאו', isFinal: true, tasks: [T('t-video', 'משימת וידאו', 'photo', { ...LOCLESS, captureKind: 'video', smart: { autoApprove: true } })] },
    ]);
    const A = await player(run.accessCode, 'מצלמה');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await waitText(A, 'משימת תמונה', 30000);
    await A.getByTestId('photo-take').first().click({ timeout: 10000 });
    await A.locator('video').first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(2500);
    const c0 = await probe(A);
    for (let i = 0; i < 3; i++) { await call('pushAnnouncement', { ownerUid, gameId: run.gameId, runId: run.runId, title: 'בדיקה', message: `רענון ${i}` }); await sleep(6000); }
    const c1 = await probe(A);
    await shot(A, 'h3-photo-camera');
    check('h3', 'photo camera: not reopened while the team state refreshes', c1.gum === c0.gum && c1.gumStops === c0.gumStops && c1.liveTracks > 0, `before=${JSON.stringify({ gum: c0.gum, stops: c0.gumStops })} after=${JSON.stringify({ gum: c1.gum, stops: c1.gumStops, live: c1.liveTracks })}`);
    check('h3', 'photo camera: the <video> is not rebuilt', c1.videosRemoved === c0.videosRemoved, `videosRemoved ${c0.videosRemoved}→${c1.videosRemoved}`);
    // Leave the camera: every track must be stopped.
    await A.keyboard.press('Escape').catch(() => {});
    await A.getByRole('button', { name: /סגירה|ביטול|חזרה/ }).first().click({ timeout: 3000 }).catch(() => {});
    await sleep(1500);
    const c2 = await probe(A);
    check('h3', 'photo camera: closing it stops the camera', c2.liveTracks === 0, `liveTracks=${c2.liveTracks}`);
    for (const p of [A]) check('h3', `${p.__label}: no crash / page errors / React warnings`, !(await crashed(p)) && p.__errors.length === 0 && p.__warn.length === 0, [...p.__errors, ...p.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h3', 'H3 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H3b · the video recorder and the voice recorder: the camera/mic opens once through refreshes, and is
// turned OFF when the mission goes away under it (a staff skip while the camera is open).
// ═════════════════════════════════════════════════════════════════════════════
const teamIdOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rushpoint.session') || '{}').teamId ?? null; } catch { return null; } });
if (want('h3b')) {
  try {
    const run = await makeRun('Hunt H3b', [
      { id: 's0', order: 0, title: 'וידאו', tasks: [T('t-video', 'משימת וידאו', 'photo', { ...LOCLESS, smart: { captureKind: 'video', autoApprove: true } })] },
      { id: 's1', order: 1, title: 'קול', tasks: [T('t-audio', 'משימת קול', 'photo', { ...LOCLESS, smart: { captureKind: 'audio', autoApprove: true } })] },
      { id: 's2', order: 2, title: 'סוף', isFinal: true, tasks: [T('t-end', 'משימה אחרונה', 'self_report', LOCLESS)] },
    ]);
    const A = await player(run.accessCode, 'מקליטה');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    const teamId = await teamIdOf(A);
    note('h3b', `teamId=${teamId}`);
    if (await waitText(A, 'משימת וידאו', 30000)) {
      await A.getByRole('button', { name: 'התחילו הקלטה' }).first().click({ timeout: 8000 }).catch((e) => note('h3b', 'open video: ' + String(e).slice(0, 100)));
      await sleep(3000);
      const v0 = await probe(A);
      for (let i = 0; i < 3; i++) { await call('pushAnnouncement', { ownerUid, gameId: run.gameId, runId: run.runId, title: 'בדיקה', message: `רענון ${i}` }); await sleep(6000); }
      const v1 = await probe(A);
      await shot(A, 'h3b-video-open');
      check('h3b', 'video camera: opened, and not reopened while the team state refreshes', v1.gum >= 1 && v1.gum === v0.gum && v1.liveTracks > 0, `before=${JSON.stringify({ gum: v0.gum, live: v0.liveTracks })} after=${JSON.stringify({ gum: v1.gum, live: v1.liveTracks })}`);
      // The staff skips the mission while the camera is open.
      await call('skipTaskForTeam', { ownerUid, gameId: run.gameId, runId: run.runId, teamId, taskId: 't-video' }).catch((e) => note('h3b', 'skip: ' + String(e).slice(0, 120)));
      const moved = await waitText(A, 'משימת קול', 30000);
      await sleep(3000);
      const v2 = await probe(A);
      check('h3b', 'video camera: turned off when the mission is skipped under it', moved && v2.liveTracks === 0, `moved=${moved} liveTracks=${v2.liveTracks}`);
      if (moved) {
        await A.getByRole('button', { name: 'התחילו הקלטה' }).first().click({ timeout: 8000 }).catch((e) => note('h3b', 'open mic: ' + String(e).slice(0, 100)));
        await sleep(2500);
        const a0 = await probe(A);
        await shot(A, 'h3b-audio-recording');
        await call('skipTaskForTeam', { ownerUid, gameId: run.gameId, runId: run.runId, teamId, taskId: 't-audio' }).catch((e) => note('h3b', 'skip audio: ' + String(e).slice(0, 120)));
        const moved2 = await waitText(A, 'משימה אחרונה', 30000);
        await sleep(3000);
        const a1 = await probe(A);
        check('h3b', 'microphone: turned off when the mission is skipped in the middle of a recording', moved2 && a1.liveTracks === 0, `opened=${a0.gum - v2.gum} liveDuring=${a0.liveTracks} liveAfter=${a1.liveTracks}`);
      }
    }
    check('h3b', `${A.__label}: no crash / page errors / React warnings`, !(await crashed(A)) && A.__errors.length === 0 && A.__warn.length === 0, [...A.__errors, ...A.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h3b', 'H3b ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H4/H5 · a browser that NEVER answers a location request, and one that REFUSES it:
// every flow must still move (49/50 class): first mission, a located check-in, "we're here",
// geofence, SOS, the "stuck" help, the next mission.
// ═════════════════════════════════════════════════════════════════════════════
for (const mode of ['never', 'deny']) {
  const id = mode === 'never' ? 'h4' : 'h5';
  if (!want(id)) continue;
  try {
    const run = await makeRun(`Hunt ${id}`, [
      { id: 's0', order: 0, title: 'בלי מיקום', tasks: [T('t-self', 'משימה בלי מיקום', 'self_report', LOCLESS)] },
      { id: 's1', order: 1, title: 'עם מיקום', tasks: [T('t-near', 'משימה קרובה', 'self_report', { coordinates: HERE })] },
      { id: 's2', order: 2, title: 'גדר', isFinal: true, tasks: [T('t-geo', 'משימת גדר', 'geofence', { coordinates: HERE, geofenceRadiusMeters: 60 })] },
    ]);
    const A = await player(run.accessCode, `מיקום ${mode}`, { geoMode: mode });
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    const first = await waitText(A, 'משימה בלי מיקום', 25000);
    check(id, `geo=${mode}: the first (locationless) mission loads`, first);
    if (first) {
      const t0 = Date.now();
      await A.getByTestId('task-field-checkin').first().click({ timeout: 10000 }).catch(() => {});
      const next = await waitText(A, 'משימה קרובה', 20000);
      check(id, `geo=${mode}: "mark complete" on a locationless mission moves on`, next, `${Date.now() - t0} ms`);
      await shot(A, `${id}-located`);
      // The located mission: whatever the app offers, pressing it must ANSWER within ~12 s.
      const before = await A.locator('body').innerText();
      const btn = A.getByTestId('task-check-arrival').or(A.getByTestId('task-field-checkin')).or(A.getByTestId('blocked-recheck')).first();
      const has = await btn.count();
      if (has) {
        const t1 = Date.now();
        await btn.click({ timeout: 5000 }).catch(() => {});
        await sleep(12000);
        const after = await A.locator('body').innerText();
        check(id, `geo=${mode}: the located mission's button answers (text changes) within 12 s`, after !== before, `${Date.now() - t1} ms`);
        const offersHelp = (await A.getByTestId('blocked-help').count()) + (await A.getByTestId('geofence-help').count()) + (await A.getByText(/מיקום|GPS/).count());
        note(id, `geo=${mode}: located mission shows location wording/help: ${offersHelp > 0}`);
        await shot(A, `${id}-located-after-press`);
      } else note(id, `geo=${mode}: no check-in button on the located mission`);
      // SOS must go out.
      await A.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click();
      await A.getByTestId('sos-message').fill(`SOS ${mode}`);
      const t2 = Date.now();
      await A.getByTestId('sos-send').click();
      const sos = await waitText(A, 'המארגנים קיבלו את ההתראה', 20000);
      check(id, `geo=${mode}: SOS is delivered`, sos, `${Date.now() - t2} ms`);
      await A.getByRole('button', { name: 'אישור', exact: true }).last().click().catch(() => {});
      // Route the team to the geofence mission from the server and see the screen ANSWER.
      await call('skipTaskForTeam', { ownerUid, gameId: run.gameId, runId: run.runId, teamId: (await A.evaluate(() => {
        for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k) || ''; const m = /"teamId":"([^"]+)"/.exec(v); if (m) return m[1]; }
        return null;
      })), taskId: 't-near' }).catch((e) => note(id, 'skip via callable failed: ' + String(e).slice(0, 120)));
      const geo = await waitText(A, 'משימת גדר', 30000);
      if (geo) {
        await sleep(12000);
        const status = await A.getByTestId('geofence-status').innerText().catch(() => '');
        const help = await A.getByTestId('geofence-help').count();
        const sealed = (await A.getByTestId('task-check-arrival').count()) + (await A.getByTestId('sealed-located').count());
        if (sealed) note(id, `geo=${mode}: the geofence mission is still sealed behind "I'm here" (covered by the located check above)`);
        else check(id, `geo=${mode}: the geofence mission tells the player something is wrong, and offers help`, help > 0 || /מיקום|GPS/.test(status), `status="${status.slice(0, 80)}" help=${help}`);
        await shot(A, `${id}-geofence`);
      } else note(id, `geo=${mode}: never reached the geofence mission`);
    }
    check(id, `geo=${mode}: no crash / page errors / React warnings`, !(await crashed(A)) && A.__errors.length === 0 && A.__warn.length === 0, [...A.__errors, ...A.__warn].slice(0, 3).join(' | '));
  } catch (e) { check(id, `H ${mode} ran`, false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H6 · what the person is in the middle of must survive the app refreshing around them (52 class):
// half-typed answers, a chat draft, on the phone, the staff app and the console.
// ═════════════════════════════════════════════════════════════════════════════
if (want('h6')) {
  try {
    const run = await makeRun('Hunt H6', [
      { id: 's0', order: 0, title: 'שאלה', tasks: [T('t-quiz', 'שאלה פתוחה', 'quiz', { ...LOCLESS, answers: ['ירושלים'] })] },
      { id: 's1', order: 1, title: 'מספר', isFinal: true, tasks: [T('t-num', 'שאלת מספר', 'numeric', { ...LOCLESS, numericAnswer: 7 })] },
    ]);
    const A = await player(run.accessCode, 'טיוטה');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await waitText(A, 'שאלה פתוחה', 30000);
    const S = await staff(run);
    const C = await console_(run);
    // Phone: a half-typed answer.
    await A.getByTestId('quiz-text-input').fill('ירוש');
    // Phone: chat draft in "more".
    // Staff + console: a chat draft.
    const stChat = S.getByPlaceholder(/כתבו (תשובה|הודעה)/).first();
    await S.getByText(/צ.אט/).first().click().catch(() => {});
    await sleep(1500);
    const stHas = await stChat.count();
    if (stHas) await stChat.fill('טיוטה של הצוות');
    const cChat = C.getByPlaceholder(/כתבו (תשובה|הודעה)/).first();
    const cHas = await cChat.count();
    if (cHas) await cChat.fill('טיוטה של המארגן');
    const p0 = { A: await probe(A), S: await probe(S), C: await probe(C) };
    // The world moves: an announcement, a team joins, an SOS from another team, a flash mission.
    await call('pushAnnouncement', { ownerUid, gameId: run.gameId, runId: run.runId, title: 'בדיקה', message: 'הודעה' });
    const B = await player(run.accessCode, 'טיוטה ב');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await B.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click().catch(() => {});
    await B.getByTestId('sos-message').fill('SOS טיוטות').catch(() => {});
    await B.getByTestId('sos-send').click().catch(() => {});
    await sleep(15000);
    const aVal = await A.getByTestId('quiz-text-input').inputValue().catch(() => null);
    check('h6', 'phone: a half-typed answer survives an announcement, a team joining and an SOS', aVal === 'ירוש', `value=${JSON.stringify(aVal)}`);
    if (stHas) { const v = await stChat.inputValue().catch(() => null); check('h6', 'staff app: a chat draft survives the same events', v === 'טיוטה של הצוות', `value=${JSON.stringify(v)}`); }
    else note('h6', 'staff app: no chat box found to type a draft into');
    if (cHas) { const v = await cChat.inputValue().catch(() => null); check('h6', 'console: a chat draft survives the same events', v === 'טיוטה של המארגן', `value=${JSON.stringify(v)}`); }
    else note('h6', 'console: no chat box visible on the first screen to type a draft into');
    const p1 = { S: await probe(S), C: await probe(C) };
    check('h6', 'staff app: no map rebuilt during the events', p1.S.mapsRemoved === p0.S.mapsRemoved, `${p0.S.mapsRemoved}→${p1.S.mapsRemoved}`);
    check('h6', 'console: no map rebuilt during the events', p1.C.mapsRemoved === p0.C.mapsRemoved, `${p0.C.mapsRemoved}→${p1.C.mapsRemoved}`);
    await shot(S, 'h6-staff'); await shot(C, 'h6-console'); await shot(A, 'h6-phone');
    for (const p of [A, B, S, C]) check('h6', `${p.__label}: no crash / page errors / React warnings`, !(await crashed(p)) && p.__errors.length === 0 && p.__warn.length === 0, [...p.__errors, ...p.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h6', 'H6 ran', false, String(e).slice(0, 300)); }
}

// H6b · the realistic version: the organizer and a marshal are typing a reply to an SOS when a
// second SOS, a new team and an announcement arrive. The half-written reply must survive.
if (want('h6b')) {
  try {
    const run = await makeRun('Hunt H6b', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-self', 'משימה בלי מיקום', 'self_report', LOCLESS)] },
    ]);
    const A = await player(run.accessCode, 'מצוקה א');
    const B = await player(run.accessCode, 'מצוקה ב');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    async function sos(p, text) {
      await p.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click();
      await p.getByTestId('sos-message').fill(text);
      await p.getByTestId('sos-send').click();
      await waitText(p, 'המארגנים קיבלו את ההתראה', 20000);
      await p.getByRole('button', { name: 'אישור', exact: true }).last().click().catch(() => {});
    }
    await sos(A, 'עזרה מקבוצה א');
    const S = await staff(run);
    const C = await console_(run);
    const boxes = {};
    for (const [tag, page] of [['staff', S], ['console', C]]) {
      await waitText(page, 'עזרה מקבוצה א', 20000);
      const nChat = await page.getByTestId('sos-chat').count();
      const clickRes = await page.getByTestId('sos-chat').first().click({ timeout: 8000 }).then(() => 'clicked').catch((e) => 'click failed: ' + String(e).slice(0, 160));
      note('h6b', `${tag}: sos-chat buttons=${nChat}, ${clickRes}`);
      await sleep(2000);
      const box = page.getByPlaceholder('כתבו תשובה לקבוצה').first();
      await box.waitFor({ timeout: 12000 }).catch(() => {});
      await shot(page, `h6b-${tag}-after-chat-click`);
      const opened = (await box.count()) > 0;
      check('h6b', `${tag}: the FIRST press on "chat with the team" (SOS card) opens a reply box`, opened, opened ? '' : 'nothing opened; see H11 for why');
      if (!opened) { await page.getByTestId('sos-chat').first().click().catch(() => {}); await box.waitFor({ timeout: 8000 }).catch(() => {}); }
      if (await box.count()) { await box.fill(`טיוטת ${tag} באמצע`); boxes[tag] = box; }
    }
    const p0 = { S: await probe(S), C: await probe(C) };
    await sos(B, 'עזרה מקבוצה ב');
    await call('pushAnnouncement', { ownerUid, gameId: run.gameId, runId: run.runId, title: 'בדיקה', message: 'הודעה' });
    const D = await player(run.accessCode, 'מצטרפת');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await sleep(15000);
    for (const [tag, page] of [['staff', S], ['console', C]]) {
      const box = boxes[tag]; if (!box) continue;
      const v = await box.inputValue().catch(() => null);
      check('h6b', `${tag}: a half-written SOS reply survives a second SOS, a new team and an announcement`, v === `טיוטת ${tag} באמצע`, `value=${JSON.stringify(v)}`);
      await shot(page, `h6b-${tag}`);
    }
    const p1 = { S: await probe(S), C: await probe(C) };
    check('h6b', 'console: no map rebuilt', p1.C.mapsRemoved === p0.C.mapsRemoved, `${p0.C.mapsRemoved}→${p1.C.mapsRemoved}`);
    check('h6b', 'staff: no map rebuilt', p1.S.mapsRemoved === p0.S.mapsRemoved, `${p0.S.mapsRemoved}→${p1.S.mapsRemoved}`);
    for (const p of [A, B, D, S, C]) check('h6b', `${p.__label}: no crash / page errors / React warnings`, !(await crashed(p)) && p.__errors.length === 0 && p.__warn.length === 0, [...p.__errors, ...p.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h6b', 'H6b ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H7 · the staff map (computer and phone): drag it, then teams move and a team joins. Does it stay?
// ═════════════════════════════════════════════════════════════════════════════
if (want('h7')) {
  try {
    const run = await makeRun('Hunt H7', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-far', 'משימה רחוקה', 'field', { coordinates: FAR })] },
    ]);
    const A = await player(run.accessCode, 'מפה א', { here: { lat: 31.7767, lng: 35.2300 } });
    const B = await player(run.accessCode, 'מפה ב', { here: { lat: 31.7767, lng: 35.2340 } });
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await sleep(8000);
    for (const mobile of [false, true]) {
      const S = await staff(run, { mobile });
      const tag = mobile ? 'phone' : 'desk';
      for (const loc of [S.getByRole('tab', { name: /מפה/ }), S.getByRole('button', { name: /מפה/ }), S.getByText(/מפת/)]) {
        if (await S.locator('.maplibregl-canvas').filter({ visible: true }).count()) break;
        await loc.first().scrollIntoViewIfNeeded().catch(() => {});
        await loc.first().click({ timeout: 3000 }).catch(() => {});
        await sleep(1500);
      }
      await sleep(4000);
      const hasMap = await S.locator('.maplibregl-canvas').filter({ visible: true }).count();
      if (!hasMap) { note('h7', `staff ${tag}: could not find the map`); await shot(S, `h7-staff-${tag}-nomap`); continue; }
      let m0 = await markerCentres(S);
      for (let i = 0; i < 20 && m0.length < 2; i++) { await sleep(1000); m0 = await markerCentres(S); }
      if (mobile) await touchDrag(S, -100, 80); else await dragMap(S, -150, 100);
      await sleep(1000);
      const m1 = await markerCentres(S);
      const p0 = await probe(S);
      for (let i = 0; i < 6; i++) { await moveTo(A, { lat: 31.7767 + i * 0.0001, lng: 35.2300 }); await sleep(3000); }
      const C3 = await player(run.accessCode, `מפה ג ${tag}`, { here: { lat: 31.7767, lng: 35.2380 } });
      await call('startTeams', { gameId: run.gameId, runId: run.runId });
      await sleep(25000);
      const m2 = await markerCentres(S);
      const p1 = await probe(S);
      await shot(S, `h7-staff-${tag}`);
      // Compare team B (did not move): its marker must stay where the drag left it.
      const bBefore = m1.find((p) => !near(p, m0[0], 2)) ? m1 : m1;
      const stays = m1.length >= 2 && m2.length >= 2 && m1.some((p) => m2.some((q) => near(p, q, 4)));
      check('h7', `staff map (${tag}): stays where the person dragged it while teams move and one joins`, stays, `afterDrag=${JSON.stringify(m1)} later=${JSON.stringify(m2)}`);
      check('h7', `staff map (${tag}): not rebuilt`, p1.mapsRemoved === p0.mapsRemoved, `${p0.mapsRemoved}→${p1.mapsRemoved}`);
      check('h7', `staff ${tag}: no crash / page errors / React warnings`, !(await crashed(S)) && S.__errors.length === 0 && S.__warn.length === 0, [...S.__errors, ...S.__warn].slice(0, 3).join(' | '));
      void bBefore; void C3;
    }
  } catch (e) { check('h7', 'H7 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H12 · the console's live team map ON A PHONE (the 52 video was filmed there): one- and two-finger
// drags, then teams move and a team joins. The map must stay where the organizer put it.
// ═════════════════════════════════════════════════════════════════════════════
if (want('h12')) {
  try {
    const run = await makeRun('Hunt H12', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-far', 'משימה רחוקה', 'field', { coordinates: FAR })] },
    ]);
    const A = await player(run.accessCode, 'טלפון א', { here: { lat: 31.7767, lng: 35.2300 } });
    const B = await player(run.accessCode, 'טלפון ב', { here: { lat: 31.7767, lng: 35.2340 } });
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await sleep(8000);
    const C = await console_(run, { mobile: true });
    await C.mouse.click(2, 2); // the first press is lost to issue 58; spend it on nothing
    await sleep(800);
    await C.getByText('קבוצות', { exact: true }).last().click().catch(() => {});
    await sleep(2500);
    const map = C.locator('.maplibregl-canvas').filter({ visible: true });
    for (let i = 0; i < 8 && !(await map.count()); i++) { await C.mouse.wheel(0, 500); await sleep(600); }
    if (!(await map.count())) { await C.locator('.maplibregl-map').first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(1500); }
    if (!(await map.count())) { note('h12', 'console phone: live map not found'); await shot(C, 'h12-nomap'); }
    else {
      await map.first().scrollIntoViewIfNeeded(); await sleep(1500);
      let m0 = await markerCentres(C);
      for (let i = 0; i < 20 && m0.length < 2; i++) { await sleep(1000); m0 = await markerCentres(C); }
      for (const fingers of [1, 2]) {
        const before = await markerCentres(C);
        await touchDrag(C, -90, 70, fingers);
        await sleep(1200);
        const after = await markerCentres(C);
        const moved = before[0] && after[0] && !near(before[0], after[0], 8);
        note('h12', `console phone: ${fingers}-finger drag ${moved ? 'moved' : 'did NOT move'} the map`);
        if (!moved) continue;
        const p0 = await probe(C);
        for (let i = 0; i < 5; i++) { await moveTo(A, { lat: 31.7767 + i * 0.0001, lng: 35.2300 }); await sleep(3000); }
        const D = await player(run.accessCode, `טלפון ${fingers}`, { here: { lat: 31.7767, lng: 35.2380 } });
        await call('startTeams', { gameId: run.gameId, runId: run.runId });
        await sleep(25000);
        const later = await markerCentres(C);
        const p1 = await probe(C);
        await shot(C, `h12-console-phone-${fingers}f`);
        const stays = after.some((p) => later.some((q) => near(p, q, 4)));
        check('h12', `console phone: the live map stays where a ${fingers}-finger drag put it while teams move and one joins`, stays, `afterDrag=${JSON.stringify(after)} later=${JSON.stringify(later)}`);
        check('h12', `console phone: the live map is not rebuilt (${fingers}-finger round)`, p1.mapsRemoved === p0.mapsRemoved, `${p0.mapsRemoved}→${p1.mapsRemoved}`);
        void D;
      }
    }
    check('h12', 'console phone: no crash / page errors / React warnings', !(await crashed(C)) && C.__errors.length === 0 && C.__warn.length === 0, [...C.__errors, ...C.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h12', 'H12 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H13 · a label that contradicts the state ("עצור 1 מתוך 1", "ריצה חיה" on a finished run): after the
// run ends, collect every line on the console, the staff app and the phone that still speaks of a
// live race. Printed for a human to judge; lines matching a known finding are flagged.
// ═════════════════════════════════════════════════════════════════════════════
if (want('h13')) {
  try {
    const run = await makeRun('Hunt H13', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-self', 'משימה בלי מיקום', 'self_report', LOCLESS)] },
    ]);
    const A = await player(run.accessCode, 'סוף');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await sleep(5000);
    const S = await staff(run);
    const SP = await staff(run, { mobile: true });
    const C = await console_(run);
    await call('finalizeRun', { ownerUid, gameId: run.gameId, runId: run.runId });
    await sleep(8000);
    for (const p of [C, S, SP]) { await p.reload(); await sleep(7000); }
    const LIVE = /ריצה חיה|פעיל|עכשיו|בזמן אמת|התחילו|הזניקו|ממתינ|ממשיכ|לייב|live/i;
    for (const [tag, p] of [['console', C], ['staff', S], ['staff-phone', SP], ['phone', A]]) {
      const lines = (await p.locator('body').innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
      const hits = [...new Set(lines.filter((l) => LIVE.test(l) && l.length < 120))];
      note('h13', `${tag} after the run ended: ${hits.length} live-sounding lines: ${JSON.stringify(hits.slice(0, 15))}`);
      await shot(p, `h13-${tag}-ended`);
    }
    // The staff app still offers live actions after the end: what does pressing one do?
    for (const [tag, p] of [['staff', S], ['staff-phone', SP]]) {
      const hold = p.getByRole('button', { name: 'עצירת הקבוצה' }).first();
      if (!(await hold.count())) { note('h13', `${tag}: no "hold the team" after the end`); continue; }
      const before = await p.locator('body').innerText();
      await hold.click().catch(() => {});
      await sleep(1200);
      await p.getByPlaceholder(/סיבה/).first().fill('בדיקה').catch(() => {});
      await p.getByRole('button', { name: 'עצירת הקבוצה', exact: true }).last().click().catch(() => {});
      await sleep(4000);
      const after = await p.locator('body').innerText();
      const added = after.split(/\n/).filter((l) => l.trim() && !before.includes(l.trim())).slice(0, 8);
      note('h13', `${tag}: pressed "hold the team" after the run ended; new text: ${JSON.stringify(added)}`);
      await shot(p, `h13-${tag}-hold-after-end`);
      check('h13', `${tag}: after the run ended, the staff app does not offer live actions (or says the run is over)`, false, 'still offers "עצירת הקבוצה"; see screenshot');
    }
  } catch (e) { check('h13', 'H13 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H14 · Hebrew laid out left-to-right (59 class): teams with ENGLISH names go through SOS, chat and
// the console; on every screen, an element with dir="auto" that holds a Hebrew sentence but
// resolved to LTR (its first strong letter was Latin) is reported with its text.
// ═════════════════════════════════════════════════════════════════════════════
const ltrHebrew = (page) => page.evaluate(() => [...document.querySelectorAll('[dir="auto"]')]
  .filter((e) => e.offsetParent !== null && getComputedStyle(e).direction === 'ltr')
  .map((e) => (e.innerText || e.value || '').trim())
  .filter((t) => /[\u0590-\u05FF].*\s.*[\u0590-\u05FF]/.test(t) && (t.match(/[\u0590-\u05FF]/g) || []).length > (t.match(/[A-Za-z]/g) || []).length)
  .map((t) => t.slice(0, 90)));
if (want('h14')) {
  try {
    const run = await makeRun('Hunt H14', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-q', 'שאלה', 'quiz', { ...LOCLESS, answers: ['כן'] }), T('t-far', 'משימה רחוקה', 'field', { coordinates: FAR })] },
    ]);
    const A = await player(run.accessCode, 'Team Alpha');
    const B = await player(run.accessCode, 'Blue Foxes');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await sleep(5000);
    await A.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click().catch(() => {});
    await A.getByTestId('sos-message').fill('Help, נתקענו ליד הגשר').catch(() => {});
    await A.getByTestId('sos-send').click().catch(() => {});
    await sleep(3000);
    await A.getByRole('button', { name: 'אישור', exact: true }).last().click().catch(() => {});
    // Wrong answers produce in-app messages, on the phone.
    await B.getByTestId('quiz-text-input').fill('OK לא').catch(() => {});
    await B.getByTestId('quiz-text-submit').click().catch(() => {});
    await sleep(3000);
    const S = await staff(run);
    const C = await console_(run);
    await C.mouse.click(2, 2); await sleep(800);
    await C.getByTestId('sos-chat').first().click().catch(() => {});
    await sleep(1500);
    await C.getByPlaceholder('כתבו תשובה לקבוצה').first().fill('OK, הצוות בדרך').catch(() => {});
    await C.getByPlaceholder('כתבו תשובה לקבוצה').first().press('Enter').catch(() => {});
    await sleep(4000);
    for (const p of [A, B, S, C]) {
      const bad = await ltrHebrew(p);
      // A message the PERSON wrote starting with a Latin word is their own text; app copy is not.
      note('h14', `${p.__label}: ${bad.length} Hebrew text block(s) laid out LTR: ${JSON.stringify(bad.slice(0, 8))}`);
    }
  } catch (e) { check('h14', 'H14 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H8 · dead buttons (57 class): on the staff app and the console, every visible, safe button must
// DO something (DOM change, network call, dialog, focus) within 2 s.
// ═════════════════════════════════════════════════════════════════════════════
const DANGER = /סיום|סיימו|מחיקה|מחק|יציאה|התנתק|הוצאה|הסרה|סגירה|סגור|לסגור|דילוג|עצירת|איפוס|ביטול הריצה|פרסום|חשיפת|התחילו|הזנק|הקמה מהירה|ניקוד|5\+|10\+|-5|-10|הדפסות|רענון/;
async function deadButtons(page, label, idPrefix) {
  const results = [];
  const handles = await page.locator('button:visible').all();
  let n = 0;
  for (const h of handles) {
    if (n >= 60) break;
    const name = ((await h.getAttribute('aria-label', { timeout: 2000 }).catch(() => null)) || (await h.innerText({ timeout: 2000 }).catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name || DANGER.test(name) || (await h.isDisabled({ timeout: 2000 }).catch(() => true))) continue;
    n++;
    // A tab or toggle that only changes its OWN state (aria-selected/pressed/expanded, its classes) did react.
    const sig = () => page.evaluate(() => document.body.innerText.length + ':' + document.body.innerHTML.length + ':' + document.querySelectorAll('*').length + ':' + [...document.querySelectorAll('[aria-selected="true"],[aria-pressed="true"],[aria-expanded="true"],[aria-current]')].map((e) => e.outerHTML.slice(0, 80)).join('|') + ':' + window.scrollY + ':' + location.href);
    let net = 0; const onReq = () => net++;
    page.on('request', onReq);
    const s0 = await sig();
    const clicked = await h.click({ timeout: 2000 }).then(() => true).catch(() => false);
    await sleep(1800);
    const s1 = await sig().catch(() => 'nav');
    page.off('request', onReq);
    if (!clicked) continue;
    const reacted = s0 !== s1 || net > 0;
    results.push({ name, reacted });
    if (!reacted) check(idPrefix, `${label}: the button "${name}" does nothing`, false);
    // Undo whatever opened.
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
  }
  note(idPrefix, `${label}: ${results.length} buttons pressed, ${results.filter((r) => !r.reacted).length} did nothing`);
  return results;
}
if (want('h8')) {
  try {
    const run = await makeRun('Hunt H8', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-far', 'משימה רחוקה', 'field', { coordinates: FAR }), T('t-self', 'משימה בלי מיקום', 'self_report', LOCLESS)] },
    ]);
    const A = await player(run.accessCode, 'כפתורים');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await A.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click().catch(() => {});
    await A.getByTestId('sos-message').fill('SOS כפתורים').catch(() => {});
    await A.getByTestId('sos-send').click().catch(() => {});
    await sleep(4000);
    const S = await staff(run);
    await deadButtons(S, 'staff app (computer)', 'h8');
    const C = await console_(run);
    await deadButtons(C, 'run console', 'h8');
    await deadButtons(A, 'player phone', 'h8');
    for (const p of [A, S, C]) check('h8', `${p.__label}: no crash / page errors after pressing everything`, !(await crashed(p)) && p.__errors.length === 0, p.__errors.slice(0, 3).join(' | '));
    // The same console, after the run is finished: buttons for things that no longer exist (57 class).
    await call('finalizeRun', { ownerUid, gameId: run.gameId, runId: run.runId }).catch((e) => note('h8', 'finalizeRun: ' + String(e).slice(0, 100)));
    await C.reload(); await sleep(6000);
    await deadButtons(C, 'run console after the run ended', 'h8');
    await S.reload(); await sleep(6000);
    await deadButtons(S, 'staff app after the run ended', 'h8');
  } catch (e) { check('h8', 'H8 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H9 · after the race (56 class): finish normally, and get ended by the organizer. GPS, camera,
// timers, wake lock: nothing keeps running on the final screen.
// ═════════════════════════════════════════════════════════════════════════════
if (want('h9')) {
  try {
    const run = await makeRun('Hunt H9', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-near', 'משימה קרובה', 'self_report', { coordinates: HERE, triggerMode: 'instant' })] },
    ]);
    const A = await player(run.accessCode, 'סיום רגיל');
    const B = await player(run.accessCode, 'סיום מארגן');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await waitText(A, 'משימה קרובה', 30000);
    await sleep(5000);
    const a0 = await probe(A);
    await A.getByTestId('task-field-checkin').first().click({ timeout: 10000 }).catch(() => {});
    const fin = await A.getByTestId('final-screen').waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    check('h9', 'finishing the last mission reaches the final screen', fin);
    await sleep(8000);
    const a1 = await probe(A);
    const a2 = await (async () => { await sleep(15000); return probe(A); })();
    check('h9', 'after finishing: no live GPS watch', a2.liveWatches === 0, `live=${a2.liveWatches}`);
    check('h9', 'after finishing: live intervals do not keep growing', a2.intervals <= a1.intervals, `intervals ${a0.intervals}→${a1.intervals}→${a2.intervals}`);
    check('h9', 'after finishing: no camera track open', a2.liveTracks === 0, `liveTracks=${a2.liveTracks}`);
    await call('finalizeRun', { ownerUid, gameId: run.gameId, runId: run.runId });
    const finB = await B.getByTestId('final-screen').waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
    check('h9', 'ended by the organizer: the phone reaches the final screen', finB);
    await sleep(8000);
    const b1 = await probe(B);
    check('h9', 'ended by the organizer: no live GPS watch', b1.liveWatches === 0, `live=${b1.liveWatches}`);
    await shot(A, 'h9-final-A'); await shot(B, 'h9-final-B');
    for (const p of [A, B]) check('h9', `${p.__label}: no crash / page errors / React warnings`, !(await crashed(p)) && p.__errors.length === 0 && p.__warn.length === 0, [...p.__errors, ...p.__warn].slice(0, 3).join(' | '));
  } catch (e) { check('h9', 'H9 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H11 · the page must not MOVE under a press. A click is delivered only when the button is still
// under the pointer at release; anything that collapses or appears on pointerdown (a banner hidden
// on "first interaction", a toast, a reflow) turns the first press into a dead click. Found 7.10:
// the console's "sounds are off" banner vanished on pointerdown, so the organizer's first press
// anywhere below it was lost (an SOS card's "chat with the team" included).
// ═════════════════════════════════════════════════════════════════════════════
async function pressShift(page, label, locator) {
  const el = locator.first();
  if (!(await el.count())) { note('h11', `${label}: nothing to press`); return; }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b0 = await el.boundingBox();
  if (!b0) return;
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await sleep(200);
  const b1 = await el.boundingBox();
  await page.mouse.move(b0.x + b0.width / 2 + 1, b0.y + b0.height / 2);
  await page.keyboard.press('Escape').catch(() => {});
  // Release far away from anything (outside the element's old box) so nothing is activated.
  await page.mouse.move(2, 2); await page.mouse.up();
  const dy = b1 ? Math.round(b1.y - b0.y) : null, dx = b1 ? Math.round(b1.x - b0.x) : null;
  check('h11', `${label}: the first press does not move the page under the pointer`, dy === 0 && dx === 0, `moved dx=${dx} dy=${dy}`);
}
if (want('h11')) {
  try {
    const run = await makeRun('Hunt H11', [
      { id: 's0', order: 0, title: 'שלב', isFinal: true, tasks: [T('t-far', 'משימה רחוקה', 'field', { coordinates: FAR }), T('t-self', 'משימה בלי מיקום', 'self_report', LOCLESS)] },
    ]);
    const A = await player(run.accessCode, 'לחיצה');
    await call('startTeams', { gameId: run.gameId, runId: run.runId });
    await A.getByRole('button', { name: 'שליחת קריאת מצוקה למארגנים' }).first().click().catch(() => {});
    await A.getByTestId('sos-message').fill('SOS לחיצה').catch(() => {});
    await A.getByTestId('sos-send').click().catch(() => {});
    await sleep(4000);
    // Fresh pages, no interaction yet: the FIRST press is the one at risk.
    const C = await console_(run);
    await pressShift(C, 'console: SOS card "chat with the team"', C.getByTestId('sos-chat'));
    const C2 = await console_(run);
    await pressShift(C2, 'console: the first panel button below the top', C2.locator('main button:visible').nth(8));
    const CP = await console_(run, { mobile: true });
    await pressShift(CP, 'console on a phone: SOS card "chat with the team"', CP.getByTestId('sos-chat'));
    const S = await staff(run);
    await pressShift(S, 'staff app (computer): SOS card button', S.getByTestId('sos-chat'));
    const S2 = await staff(run, { mobile: true });
    await pressShift(S2, 'staff app (phone): a team action', S2.locator('button:visible').nth(6));
    const P = await player(run.accessCode, 'לחיצה ב');
    await pressShift(P, 'player phone: the first mission button', P.getByTestId('task-field-checkin').or(P.getByTestId('task-check-arrival')));
  } catch (e) { check('h11', 'H11 ran', false, String(e).slice(0, 300)); }
}

// ═════════════════════════════════════════════════════════════════════════════
// H10 · every page visited: loaders that never finish, crash screens, errors.
// ═════════════════════════════════════════════════════════════════════════════
for (const p of pages) {
  const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth })).catch(() => null);
  if (ov) check('h10', `${p.__label}: the page is not wider than the screen`, ov.sw <= ov.w + 1, `scrollWidth=${ov.sw} viewport=${ov.w}`);
  const stuck = await p.getByText(/מכינים את המשימה|טוענים|טוען…/).count().catch(() => 0);
  if (stuck) {
    await sleep(15000);
    const still = await p.getByText(/מכינים את המשימה|טוענים|טוען…/).count().catch(() => 0);
    check('h10', `${p.__label}: no loader stuck for 15 s at the end of the hunt`, still === 0, `${still} loader(s) visible`);
  }
}

await browser.close();
writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ at: new Date().toISOString(), findings, checks }, null, 2));
console.log(`\n${findings.length === 0 ? 'NOTHING FOUND' : findings.length + ' FINDING(S)'} in ${checks.length} checks · report: ${SHOTS}/report.json`);
process.exit(findings.length ? 1 : 0);
