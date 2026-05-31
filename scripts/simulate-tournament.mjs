// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — 30-team tournament stress-test against the local emulator.
//
//   node scripts/simulate-tournament.mjs     (npm run simulate)
//
// Drives the REAL callable API end-to-end: dynamic station creation (upsertStation),
// priority routing (requestNextTask), matchmaking (joinMatchQueue/resolveMatch),
// crafting (getBasketZone/startCraftingTimer), operator completion (stationReleaseTeam),
// plus live Phase-3 disruptions (pause/close + evacuateStation, GPS-less SOS, global
// announcement, forced score ties). Ends with finalizeLeaderboard and a full report.
// ═══════════════════════════════════════════════════════════════════════════════
import admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const PROJECT_ID = 'race-to-tzion-2026';
const APP_ID = 'race-to-tzion-2026';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT_ID });
const adb = admin.firestore();
const pub = (c) => `artifacts/${APP_ID}/public/data/${c}`;
const userPath = (uid) => `artifacts/${APP_ID}/users/${uid}`;

// ── Route geometry (Motza → Gan HaKipod) ────────────────────────────────────────
const START = { lat: 31.7905, lng: 35.164 };
const FINISH = { lat: 31.8155, lng: 35.1875 };
const lerp = (a, b, t) => a + (b - a) * t;
// Deterministic pseudo-random (seeded) so runs are reproducible.
let _seed = 12345;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function routePoint(t) {
  const jitter = (rand() - 0.5) * 0.004;
  return { lat: +(lerp(START.lat, FINISH.lat, t) + jitter).toFixed(5), lng: +(lerp(START.lng, FINISH.lng, t) + jitter).toFixed(5) };
}

// ── Concurrency helper ───────────────────────────────────────────────────────────
async function pMap(items, fn, concurrency = 8) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// ── Client app per identity ──────────────────────────────────────────────────────
let _appN = 0;
function makeClient() {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT_ID, appId: 'emu' }, `sim-${_appN++}`);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fns = getFunctions(app); connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  return { app, auth, fns };
}
const call = (fns, name, data = {}) => httpsCallable(fns, name)(data).then((r) => r.data);

// ── Metrics / anomaly collectors ──────────────────────────────────────────────────
const M = {
  greenAssignments: {},      // taskId -> count
  goldAssignments: {},
  hintsUsed: 0,
  timeoutWarnings: [],       // teamIds whose lagging task exceeded maxDurationMinutes
  evacuated: [],
  gateViaDuel: 0,
  gateViaSkip: 0,
  anomalies: [],
  errors: [],
};
const anomaly = (m) => { M.anomalies.push(m); };
const errlog = (ctx, e) => { M.errors.push(`${ctx}: ${e.message || e}`); };

// ── Admin helpers ──────────────────────────────────────────────────────────────────
const readGs = (uid) => adb.doc(`${userPath(uid)}/gameState/current`).get().then((s) => (s.exists ? s.data() : null));

async function backdateActiveSlot(uid, minutesAgo) {
  const gs = await readGs(uid); if (!gs) return;
  const slots = gs.slots.map((s) => ({ ...s }));
  const idx = slots.findIndex((s) => s.status === 'active');
  if (idx < 0) return null;
  slots[idx].startedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  await adb.doc(`${userPath(uid)}/gameState/current`).update({ slots });
  return { idx, taskId: slots[idx].taskId };
}

async function clearCollection(path) {
  const snap = await adb.collection(path).get();
  const batch = adb.batch(); snap.docs.forEach((d) => batch.delete(d.ref)); await batch.commit();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════════
const N_TEAMS = 30;
const N_GREEN_STATIONS = 18;
const N_GOLD_STATIONS = 5;
const N_ZONES = 2; // orange (+ existing seeded zones)

async function reset() {
  console.info('› Resetting prior sim data…');
  // Clear any team registered under a SIM** code in a previous run (anon uids vary).
  const profs = await adb.collectionGroup('profile').get();
  for (const d of profs.docs) {
    if (d.id !== 'team') continue;
    const data = d.data();
    if (typeof data.code === 'string' && /^SIM\d+/.test(data.code)) {
      const parts = d.ref.path.split('/');
      const uid = parts[parts.indexOf('users') + 1];
      await adb.doc(`${userPath(uid)}/gameState/current`).delete().catch(() => {});
      await clearCollection(`${userPath(uid)}/checkIns`).catch(() => {});
      await d.ref.delete().catch(() => {});
    }
  }
  await clearCollection(pub('matchQueue')).catch(() => {});
  await clearCollection(pub('matches')).catch(() => {});
  // sim stations
  const tasks = await adb.collection(pub('tasks')).get();
  const tb = adb.batch();
  tasks.docs.forEach((d) => { if (d.id.startsWith('sim-')) tb.delete(d.ref); });
  await tb.commit();
}

async function seedCodes() {
  const batch = adb.batch();
  for (let i = 1; i <= N_TEAMS; i++) {
    const code = `SIM${String(i).padStart(2, '0')}`;
    batch.set(adb.doc(`artifacts/${APP_ID}/accessCodes/${code}`), { code, claimed: false, teamId: null, createdAt: new Date().toISOString() });
  }
  await batch.commit();
}

async function createStations(adminFns) {
  const mk = async (kind, type, t, i) => {
    const p = routePoint(t);
    const payload = kind === 'zone'
      ? { kind, id: `sim-zone-${i}`, title: `Sim Zone ${i}`, riddle: 'find it', coordinates: p, maxTeams: 4 }
      : { kind, id: `sim-${type}-${String(i).padStart(2, '0')}`, type, title: `Sim ${type} ${i}`,
          coordinates: p, difficulty: 2 + Math.floor(rand() * 7), pointValue: 100, estimatedMinutes: 8 + Math.floor(rand() * 10),
          maxConcurrentTeams: 3, maxDurationMinutes: 20, status: 'active' };
    await call(adminFns, 'upsertStation', payload);
    return payload.id;
  };
  const ids = { green: [], gold: [], zone: [] };
  for (let i = 0; i < N_GREEN_STATIONS; i++) ids.green.push(await mk('task', 'green', i / N_GREEN_STATIONS, i + 1));
  for (let i = 0; i < N_GOLD_STATIONS; i++)  ids.gold.push(await mk('task', 'gold', 0.85 + (i / N_GOLD_STATIONS) * 0.15, i + 1));
  for (let i = 0; i < N_ZONES; i++)          ids.zone.push(await mk('zone', 'orange', 0.7 + i * 0.05, i + 1));
  // Zero ALL station load counters (seeded + sim) so each run starts at clean capacity.
  const allTasks = await adb.collection(pub('tasks')).get();
  const b = adb.batch(); allTasks.docs.forEach((d) => b.update(d.ref, { currentTeamCount: 0 })); await b.commit();
  return ids;
}

// ── Team model ────────────────────────────────────────────────────────────────────
const PROFILES = [
  ...Array.from({ length: 10 }, () => 'fast'),
  ...Array.from({ length: 10 }, () => 'average'),
  ...Array.from({ length: 10 }, () => 'lagging'),
];
const factorFor = (p) => (p === 'fast' ? 0.5 : p === 'average' ? 1.0 : 2.6);

function makeTeams() {
  const teams = [];
  for (let i = 0; i < N_TEAMS; i++) {
    const memberCount = 4 + Math.floor(rand() * 4); // 4..7
    teams.push({
      n: i + 1,
      uid: `sim-team-${String(i + 1).padStart(2, '0')}`,
      code: `SIM${String(i + 1).padStart(2, '0')}`,
      name: `Sim Team ${i + 1}`,
      members: Array.from({ length: memberCount }, (_, k) => `Runner ${i + 1}.${k + 1}`),
      profile: PROFILES[i],
      client: makeClient(),
      pos: 0.0,
    });
  }
  return teams;
}

async function register(team) {
  await signInAnonymously(team.client.auth);
  team.uid = team.client.auth.currentUser.uid; // real uid the callables will see
  await call(team.client.fns, 'registerTeam', {
    code: team.code, teamName: team.name, captainPhone: `0500000${String(team.n).padStart(3, '0')}`,
    participants: team.members.map((m) => ({ name: m, age: String(10 + Math.floor(rand() * 5)) })),
    waiverAccepted: true,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Complete one routed slot (green/gold) ──────────────────────────────────────────
async function doRoutedSlot(team, adminFns, targetType, est) {
  const gs = await readGs(team.uid);
  const active = gs?.slots?.find((s) => s.status === 'active');
  if (!active) { anomaly(`${team.name}: no active slot for ${targetType}`); return; }

  // Use the slot's pre-assigned task if it has one (registerTeam pins slot 0 to
  // task-green-001); otherwise route a fresh station via requestNextTask.
  let taskId = active.taskId;
  if (!taskId) {
    team.pos = Math.min(1, team.pos + 0.12 + rand() * 0.05);
    const p = routePoint(team.pos);
    let res;
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await call(team.client.fns, 'requestNextTask', { lat: p.lat, lng: p.lng, targetType });
      if (res.taskId) break;
      await sleep(150); // station full — brief backoff
    }
    if (!res || !res.taskId) { anomaly(`${team.name}: no ${targetType} station available after retries`); return; }
    taskId = res.taskId;
  }
  const bucket = targetType === 'gold' ? M.goldAssignments : M.greenAssignments;
  bucket[taskId] = (bucket[taskId] || 0) + 1;

  // Simulate performance by backdating the slot's start.
  const factor = factorFor(team.profile);
  await backdateActiveSlot(team.uid, factor * (est || 12));
  // Lagging teams exceed the station's maxDurationMinutes → timeout warning condition.
  if (team.profile === 'lagging') {
    const taskDoc = (await adb.doc(`${pub('tasks')}/${taskId}`).get()).data();
    if (taskDoc && factor * (est || 12) > (taskDoc.maxDurationMinutes ?? 20)) M.timeoutWarnings.push({ team: team.name, taskId });
  }
  await call(adminFns, 'stationReleaseTeam', { teamId: team.uid, taskId, outcome: 'passed', note: `${team.profile} run` });
  // Average teams occasionally buy a hint (→ bonusPenalty).
  if (team.profile === 'average' && rand() < 0.5) {
    try { await call(team.client.fns, 'requestClueHint', {}); M.hintsUsed++; } catch (e) { /* hint may be locked */ }
  }
}

async function runGreenPhase(teams, adminFns) {
  console.info('› Green phase (3 routed missions per team, concurrent)…');
  await pMap(teams, async (team) => {
    for (let s = 0; s < 3; s++) {
      try { await doRoutedSlot(team, adminFns, 'green', 12); }
      catch (e) { errlog(`green ${team.name}`, e); }
    }
  }, 8);
}

async function runGatePhase(teams, adminFns) {
  console.info('› Gate phase (matchmaking duels)…');
  const cleared = new Set();
  let guard = 0;
  let queue = teams.filter((t) => !cleared.has(t.uid));
  while (queue.length > 1 && guard++ < 40) {
    const before = cleared.size;
    for (const t of queue) {
      if (cleared.has(t.uid)) continue;
      try {
        const r = await call(t.client.fns, 'joinMatchQueue', {});
        if (r.matched && r.matchId) {
          await call(adminFns, 'resolveMatch', { matchId: r.matchId, winnerId: t.uid });
          cleared.add(t.uid); M.gateViaDuel++;
        }
      } catch (e) { errlog(`gate ${t.name}`, e); }
    }
    queue = teams.filter((t) => !cleared.has(t.uid));
    if (cleared.size === before) break; // no progress — remaining can't be paired
  }
  // Straggler(s) with no opponent — authorized admin skip past the gate.
  for (const t of queue) {
    try { await call(adminFns, 'skipTask', { teamId: t.uid }); cleared.add(t.uid); M.gateViaSkip++; team_skipped.add(t.uid); }
    catch (e) { errlog(`gate-skip ${t.name}`, e); }
  }
}
const team_skipped = new Set(); // teams we authorized a skip for (state-machine audit)

async function runOrangeGoldPhase(teams, adminFns) {
  console.info('› Orange (find Tene + craft) + Gold phase…');
  await pMap(teams, async (team) => {
    // Orange: assign a zone + start the crafting clock (completes orange, unlocks gold).
    try {
      const z = await call(team.client.fns, 'getBasketZone', {});
      await call(team.client.fns, 'startCraftingTimer', { zoneId: z?.zoneId ?? z?.id });
    } catch (e) { errlog(`orange ${team.name}`, e); }
    // Gold: routed station + operator completion.
    try { await doRoutedSlot(team, adminFns, 'gold', 18); }
    catch (e) { errlog(`gold ${team.name}`, e); }
  }, 8);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISRUPTIONS
// ═══════════════════════════════════════════════════════════════════════════════
async function disruptionStationClose(teams, adminFns, greenIds) {
  console.info('› Disruption: 2 teams on "Station 5" which breaks down → evacuate (zero penalty)…');
  const victim = greenIds[4]; // "Station 5"
  const onStation = teams.slice(10, 12); // 2 specific teams

  // Place both teams actively ON the victim station (point their slot at it + bump load).
  for (const t of onStation) {
    const gs = await readGs(t.uid); if (!gs) continue;
    const slots = gs.slots.map((s) => ({ ...s }));
    const idx = slots.findIndex((s) => s.status === 'active');
    if (idx < 0) continue;
    slots[idx] = { ...slots[idx], taskId: victim, taskTitle: 'Station 5', startedAt: new Date().toISOString() };
    await adb.doc(`${userPath(t.uid)}/gameState/current`).update({ slots });
  }
  await adb.doc(`${pub('tasks')}/${victim}`).update({ currentTeamCount: onStation.length });
  const scoreBefore = {};
  for (const t of onStation) scoreBefore[t.uid] = (await readGs(t.uid))?.score ?? 0;

  // Pause → must be excluded from routing recommendations.
  await call(adminFns, 'setStationStatus', { taskId: victim, status: 'paused' });
  let excluded = true;
  try {
    const rec = await call(teams[0].client.fns, 'getRecommendedTasks', { lat: START.lat, lng: START.lng, targetType: 'green' });
    excluded = !(rec.recommendations || []).some((r) => r.taskId === victim);
  } catch (e) { errlog('recommend-after-pause', e); }

  // Close + evacuate the two teams (no penalty).
  await call(adminFns, 'setStationStatus', { taskId: victim, status: 'closed' });
  const ev = await call(adminFns, 'evacuateStation', { taskId: victim });
  M.evacuated = ev.evacuated || [];

  // Verify recovery: each team flagged evacuatedFrom, slot task cleared, score unchanged.
  let recovered = 0; let zeroPenalty = true;
  for (const t of onStation) {
    const gs = await readGs(t.uid);
    const active = gs?.slots?.find((s) => s.status === 'active');
    if (gs?.evacuatedFrom && (!active || !active.taskId)) recovered++;
    if ((gs?.score ?? 0) !== scoreBefore[t.uid]) zeroPenalty = false;
  }
  const counterAfter = (await adb.doc(`${pub('tasks')}/${victim}`).get()).data()?.currentTeamCount ?? -1;
  await call(adminFns, 'setStationStatus', { taskId: victim, status: 'active' }); // re-open the pool

  return { victim, excludedFromRouting: excluded, evacuatedCount: M.evacuated.length, recovered, expected: onStation.length, zeroPenalty, counterAfter };
}

async function disruptionSosNoGps(team) {
  console.info('› Disruption: SOS with no GPS (last-known fallback)…');
  // Team has a last-known position…
  await call(team.client.fns, 'updateLocation', { lat: 31.806, lng: 35.178, teamName: team.name });
  // …but the SOS payload omits coords.
  await call(team.client.fns, 'triggerSOS', { message: 'lost signal in the valley' });
  // Replicate the admin-map fallback: alert has no location, but teamLocations does.
  const alerts = (await adb.collection(pub('adminAlerts')).get()).docs.map((d) => d.data())
    .filter((a) => a.type === 'sos' && a.teamId === team.uid && !a.acknowledged);
  const loc = (await adb.doc(`${pub('teamLocations')}/${team.uid}`).get()).data();
  const alertHasGps = alerts.some((a) => a.location && typeof a.location.lat === 'number');
  const fallbackResolves = !alertHasGps && !!loc && typeof loc.lat === 'number';
  return { sosRaised: alerts.length > 0, alertHadGps: alertHasGps, lastKnownPresent: !!loc, fallbackResolves };
}

async function disruptionAnnouncement(adminFns) {
  console.info('› Disruption: global announcement broadcast…');
  await call(adminFns, 'pushAnnouncement', { message: 'SIM: severe weather — shelter at the gate', level: 'critical' });
  const snap = await adb.collection(pub('announcements')).where('active', '==', true).get();
  return { activeAnnouncements: snap.size, present: snap.docs.some((d) => (d.data().message || '').startsWith('SIM:')) };
}

// ── Forced tie (tests penalties → green-time → transit cascade) ─────────────────────
function makeTieSlots(greenDurMs, gapMs) {
  let cursor = Date.parse('2026-05-31T06:00:00.000Z');
  const types = ['green', 'green', 'green', 'gate', 'orange', 'gold'];
  return types.map((type, i) => {
    const dur = type === 'green' ? greenDurMs : 30_000;
    const startedAt = new Date(cursor).toISOString();
    const completedAt = new Date(cursor + dur).toISOString();
    cursor += dur + gapMs; // gap → transit time
    return { index: i, type, status: 'completed', startedAt, completedAt, taskId: `tie-${i}`, earnedScore: 0 };
  });
}

async function forceTie(teams) {
  console.info('› Forced 3-way+ score tie (penalties → green time → transit)…');
  // raw = score + 500 - penalty → keep constant at 2500.
  const specs = [
    { tag: 'T1', pen: 0,  green: 100_000, gap: 10_000 }, // wins on penalties
    { tag: 'T2', pen: 50, green: 100_000, gap: 10_000 }, // vs T3 on green time
    { tag: 'T3', pen: 50, green: 200_000, gap: 10_000 }, // vs T4 on transit
    { tag: 'T4', pen: 50, green: 200_000, gap: 60_000 },
  ];
  const startedAt = '2026-05-31T05:00:00.000Z';
  const craftingStartedAt = '2026-05-31T06:30:00.000Z'; // identical 90-min duration → identical Z
  const chosen = teams.slice(0, specs.length);
  const map = {};
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]; const t = chosen[i]; map[t.uid] = s.tag;
    await adb.doc(`${userPath(t.uid)}/gameState/current`).set({
      teamId: t.uid, score: 2000 + s.pen, bonusPenalty: s.pen, craftingStartedAt,
      slots: makeTieSlots(s.green, s.gap), updatedAt: new Date().toISOString(),
    }, { merge: true });
    await adb.doc(`${userPath(t.uid)}/profile/team`).set({ startedAt, status: 'finished' }, { merge: true });
  }
  return { expectedOrder: specs.map((s) => s.tag), map };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════════
function stats(counts) {
  const vals = Object.values(counts);
  if (vals.length === 0) return { used: 0, total: 0, min: 0, max: 0, mean: 0, stddev: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { used: vals.length, min: Math.min(...vals), max: Math.max(...vals), mean: +mean.toFixed(2), stddev: +Math.sqrt(variance).toFixed(2) };
}

async function validateStateMachine(teams) {
  const expectedTypes = ['green', 'green', 'green', 'gate', 'orange', 'gold'];
  let finished = 0; const issues = [];
  for (const t of teams) {
    const gs = await readGs(t.uid);
    if (!gs) { issues.push(`${t.name}: no gameState`); continue; }
    const slots = gs.slots ?? [];
    if (slots.length !== 6) issues.push(`${t.name}: ${slots.length} slots (expected 6)`);
    slots.forEach((s, i) => {
      if (s.index !== i) issues.push(`${t.name}: slot ${i} index=${s.index}`);
      if (s.type !== expectedTypes[i]) issues.push(`${t.name}: slot ${i} type=${s.type}`);
    });
    const terminal = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    if (terminal) finished++;
    // No locked slot before a terminal one (illegal bypass).
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].status !== 'locked' && slots[i - 1].status === 'locked') issues.push(`${t.name}: slot ${i} active while ${i - 1} locked (bypass)`);
    }
    // Any skip must have been authorized by the sim (we only skip via skipTask).
    slots.forEach((s) => { if (s.status === 'skipped' && !team_skipped.has(t.uid)) issues.push(`${t.name}: unauthorized skip at slot ${s.index}`); });
  }
  return { finished, issues };
}

async function main() {
  const t0 = Date.now();
  console.info('\n╔══════════════════════════════════════════════════╗');
  console.info('║   RushPoint — 30-team tournament stress-test     ║');
  console.info('╚══════════════════════════════════════════════════╝\n');

  const adminClient = makeClient();
  await signInAnonymously(adminClient.auth);
  const adminFns = adminClient.fns;

  await reset();
  await seedCodes();
  const stationIds = await createStations(adminFns);
  console.info(`  Stations: ${stationIds.green.length} green, ${stationIds.gold.length} gold, ${stationIds.zone.length} zone`);

  const teams = makeTeams();
  await pMap(teams, (t) => register(t).catch((e) => errlog(`register ${t.name}`, e)), 10);
  console.info(`  Registered ${teams.length} teams (members 4-7).`);

  // Disruption first (teams placed mid-field on the doomed station), then play on.
  const dStation = await disruptionStationClose(teams, adminFns, stationIds.green);
  const dSos = await disruptionSosNoGps(teams[7]);
  const dAnn = await disruptionAnnouncement(adminFns);

  await runGreenPhase(teams, adminFns);
  await runGatePhase(teams, adminFns);
  await runOrangeGoldPhase(teams, adminFns);

  // Force a tie on the first 4 teams, then finalize.
  const tie = await forceTie(teams);
  const sm = await validateStateMachine(teams);
  const fin = await call(adminFns, 'finalizeLeaderboard', {});
  const rankings = fin.rankings || [];

  // Verify tie-break ordering of the forced teams.
  const tieOrderActual = rankings.filter((r) => tie.map[r.teamId]).map((r) => tie.map[r.teamId]);
  const tieScores = rankings.filter((r) => tie.map[r.teamId]).map((r) => r.score);
  const tieScoresEqual = new Set(tieScores).size === 1;
  const tieOrderCorrect = JSON.stringify(tieOrderActual) === JSON.stringify(tie.expectedOrder);

  // ── Report ───────────────────────────────────────────────────────────────────
  const green = stats(M.greenAssignments);
  const gold = stats(M.goldAssignments);
  const reroutedFinished = M.evacuated.filter((uid) => true).length;

  console.info('\n\n════════════════════ GAME REPORT ════════════════════\n');

  const hottest = Object.entries(M.greenAssignments).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.info('1) ROUTING HEALTH & THROUGHPUT');
  console.info(`   Green: ${Object.values(M.greenAssignments).reduce((a, b) => a + b, 0)} completions across ${green.used} distinct stations`);
  console.info(`          load per station  min=${green.min} max=${green.max} mean=${green.mean} stddev=${green.stddev}`);
  console.info(`          hottest: ${hottest.map(([id, c]) => `${id}=${c}`).join(', ')}`);
  console.info(`   Gold:  ${Object.values(M.goldAssignments).reduce((a, b) => a + b, 0)} completions across ${gold.used} stations (stddev=${gold.stddev})`);
  const bottleneck = green.max > green.mean * 2 && green.max >= 5;
  const pinned = (M.greenAssignments['task-green-001'] || 0) >= teams.length * 0.6;
  console.info(`   Bottleneck detected: ${bottleneck ? 'YES — ' + green.max + ' on ' + (hottest[0] ? hottest[0][0] : '?') : 'no — load spread within 2× mean'}`);
  if (pinned) console.info(`   ⚠ Every team's first mission is hard-pinned to task-green-001 by registerTeam (not routed).`);
  console.info(`   Hints purchased (penalty path): ${M.hintsUsed}`);

  console.info('\n2) STATE-MACHINE INTEGRITY');
  console.info(`   Teams reaching terminal (all 6 slots): ${sm.finished}/${teams.length}`);
  console.info(`   Gate cleared via duel: ${M.gateViaDuel}, via authorized skip: ${M.gateViaSkip}`);
  console.info(`   Illegal bypasses / sequence errors: ${sm.issues.length}`);
  sm.issues.slice(0, 8).forEach((i) => console.info(`     - ${i}`));

  console.info('\n3) DISASTER RECOVERY');
  console.info(`   Station "${dStation.victim}" paused → excluded from routing: ${dStation.excludedFromRouting ? 'YES' : 'NO'}`);
  console.info(`   evacuateStation recovered ${dStation.recovered}/${dStation.expected} on-station team(s), zero penalty: ${dStation.zeroPenalty ? 'YES' : 'NO'}, load counter reset to ${dStation.counterAfter}`);
  console.info(`   SOS w/o GPS → last-known fallback resolves siren: ${dSos.fallbackResolves ? 'YES' : 'NO'} (alertHadGps=${dSos.alertHadGps}, lastKnown=${dSos.lastKnownPresent})`);
  console.info(`   Global announcement live in public stream: ${dAnn.present ? 'YES' : 'NO'} (${dAnn.activeAnnouncements} active)`);
  console.info(`   Forced tie — scores identical: ${tieScoresEqual ? 'YES (' + tieScores[0] + ')' : 'NO ' + JSON.stringify(tieScores)}`);
  console.info(`   Tie-break order ${tieOrderCorrect ? 'CORRECT' : 'WRONG'}: expected ${tie.expectedOrder.join(',')} got ${tieOrderActual.join(',')}`);
  console.info(`   (tier1 penalties → tier2 green-time → tier3 transit)`);

  console.info('\n   Final top 6:');
  rankings.slice(0, 6).forEach((r) => console.info(`     #${r.rank} ${r.teamName.padEnd(16)} score=${r.score} raw=${r.rawScore} slots=${r.completedSlots} pen=${r.tieBreak?.penalties}`));

  console.info('\n4) ACTIONABLE RECOMMENDATIONS');
  const recs = [];
  if (bottleneck) recs.push('Routing piled load on one station — add a geo-spread or capacity term so popular early stations do not saturate.');
  if (green.stddev > green.mean) recs.push('High green load variance — weight Φ(load) higher vs transit, or pre-assign teams to start zones to flatten the opening rush.');
  recs.push('Orange (find-the-Tene) is not routed (fixed zones) — consider load-balancing zones like stations if teams cluster at one Tene spot.');
  recs.push('Google Sheets write-back must stay debounced/off the hot path — never write per score change; the status mirror already batches, keep it that way under real load.');
  recs.push('Matchmaking can strand an odd last team (no opponent) — add a timed auto-advance or a sanctioned solo-clear so a judge skip is not required at scale.');
  if (M.errors.length) recs.push(`Investigate ${M.errors.length} callable error(s) surfaced during the run (see below).`);
  if (M.timeoutWarnings.length) recs.push(`${M.timeoutWarnings.length} lagging task(s) exceeded maxDurationMinutes — the Judge timeout warning path is exercised; confirm operators act on it.`);
  recs.forEach((r, i) => console.info(`   ${i + 1}. ${r}`));

  if (M.errors.length) { console.info('\n   Errors:'); M.errors.slice(0, 12).forEach((e) => console.info(`     ! ${e}`)); }
  if (M.anomalies.length) { console.info('\n   Anomalies:'); M.anomalies.slice(0, 12).forEach((a) => console.info(`     ~ ${a}`)); }

  const pass = sm.issues.length === 0 && tieOrderCorrect && tieScoresEqual && dSos.fallbackResolves
    && dAnn.present && dStation.excludedFromRouting && dStation.recovered === dStation.expected && dStation.zeroPenalty;
  console.info(`\n════════════════════════════════════════════════════`);
  console.info(`RESULT: ${pass ? '✅ ALL CRITICAL CHECKS PASSED' : '⚠ SOME CHECKS NEED ATTENTION'}  ·  ${sm.finished}/${teams.length} finished  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.info(`════════════════════════════════════════════════════\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('SIM FAILED:', e); process.exit(1); });
