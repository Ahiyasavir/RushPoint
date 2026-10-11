// ═══════════════════════════════════════════════════════════════════════════════
// Station-cap simulation of a REAL authored game, against the local emulator.
//
//   node scripts/emulator-exec.mjs "node scripts/simulate-station-caps.mjs <game.json> --teams=16"
//
// `simulate-run.mjs` proves the backend survives load on a synthetic course. This answers a
// different question about one authored game: with N teams on the course at once, is any
// station ever over its `maxConcurrentTeams`, is a team sent to a FREE station when another is
// full, and what does a team get when every station open to it is full?
//
// <game.json> is the stored game document (it carries answer keys, so keep it out of the repo).
// The game is copied into a throwaway creator through createGame + updateGame, and every team
// plays through the real callables. Occupancy is read straight from Firestore (Admin SDK) on a
// short interval, independently of what the callables report.
//
// Exits non-zero when a station was ever over its cap, a slot leaked, or a team did not finish.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { resolveEmulatorPorts } from './lib/emulatorPorts.mjs';

const PROJECT = 'rushpoint-pwa-7daaa';
const EMU = resolveEmulatorPorts(process.env);
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] || d;
const FILE = process.argv[2];
if (!FILE || FILE.startsWith('--')) {
  console.error('usage: node scripts/simulate-station-caps.mjs <game.json> [--teams=16] [--dwell=1500]');
  process.exit(2);
}
const TEAMS = Math.max(2, Number(arg('teams', '16')));
/** How long a team stays at a station before finishing it, so stations really overlap. */
const DWELL_MS = Math.max(0, Number(arg('dwell', '1500')));
const MAX_MS = Number(arg('max-minutes', '12')) * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _seed = 20261010;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

const source = JSON.parse(readFileSync(FILE, 'utf8'));
const allTasks = source.stages.flatMap((s) => s.tasks);
const taskById = new Map(allTasks.map((t) => [t.id, t]));
const capOf = (t) => (t.locationless ? Infinity : (t.maxConcurrentTeams ?? 3));
const short = (t) => (t?.title ?? '?').replace(/\s+/g, ' ').trim().slice(0, 34);

// The Functions emulator keeps worker processes per function and never retires one (about
// 100 MB each), so an unbounded fleet starves the machine and the emulator's own 60 s timeout
// then reads as a product failure. Teams still overlap AT stations: the dwell is spent outside
// a call. `--parallel` bounds only how many calls are in the air at once.
const PARALLEL = Math.max(1, Number(arg('parallel', '4')));
let inFlight = 0; const gate = [];
async function slot(fn) {
  if (inFlight >= PARALLEL) await new Promise((r) => gate.push(r));
  inFlight++;
  try { return await fn(); } finally { inFlight--; gate.shift()?.(); }
}
let transient = 0;
const pollErrors = [];

function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `caps-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${EMU.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', EMU.functions);
  return {
    auth,
    call: async (fn, data) => {
      for (let attempt = 0; ; attempt++) {
        try { return (await slot(() => httpsCallable(functions, fn)(data))).data; } catch (e) {
          const code = String(e?.code ?? '');
          // A bot outruns the per-minute budgets a person never reaches; wait the window out.
          if (code.includes('resource-exhausted') && attempt < 8) { await sleep(8000); continue; }
          if ((code.includes('unavailable') || code.includes('internal') || code.includes('deadline')) && attempt < 4) { transient++; await sleep(1000 * (attempt + 1)); continue; }
          throw e;
        }
      }
    },
  };
}

let violations = 0;
const audit = (label, ok, detail) => {
  console.log(`${ok ? 'OK       ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!ok) violations++;
};

// ── Independent occupancy monitor (Admin SDK, straight from Firestore) ───────
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${EMU.firestore}`;
const admin = (await import('firebase-admin')).default;
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const adb = admin.firestore();

const monitor = {
  samples: 0, peak: new Map(), over: [], counterDrift: 0, lastCounts: {}, lastOccupancy: new Map(),
  waitingPeak: 0, stop: false,
};
async function monitorLoop(runPath) {
  while (!monitor.stop) {
    const [runSnap, teamsSnap] = await Promise.all([adb.doc(runPath).get(), adb.collection(`${runPath}/teams`).get()]);
    const counts = runSnap.data()?.taskCounts ?? {};
    const occ = new Map();
    teamsSnap.forEach((d) => {
      for (const s of d.data().stages ?? []) for (const r of s.tasks ?? []) {
        if (r.status === 'assigned') occ.set(r.taskId, (occ.get(r.taskId) ?? 0) + 1);
      }
    });
    monitor.samples++;
    monitor.lastCounts = counts; monitor.lastOccupancy = occ;
    for (const t of allTasks) {
      const n = occ.get(t.id) ?? 0;
      const c = Number(counts[t.id] ?? 0);
      if (n > (monitor.peak.get(t.id) ?? 0)) monitor.peak.set(t.id, n);
      if (n > capOf(t) || (!t.locationless && c > capOf(t))) monitor.over.push(`${short(t)}: ${n} teams / counter ${c} / cap ${capOf(t)}`);
    }
    await sleep(400);
  }
}

// ── Playing one mission through the door its type really uses ────────────────
const playFailures = [];
const reviewQueue = [];
async function playTask(p, ctx, code, task) {
  const C = { ...ctx, taskId: task.id };
  const here = task.coordinates && !task.locationless
    ? { lat: task.coordinates.lat, lng: task.coordinates.lng, accuracyMeters: 5 } : {};
  if (here.lat !== undefined) await p.call('reportArrival', { ...C, ...here, code }).catch(() => undefined);
  switch (task.type) {
    case 'field': case 'self_report': case 'geofence':
      return p.call('completeTask', { ...C, ...here, code });
    case 'smart_station':
      // One code, or several codes each worth its own points (the marshal hands one out).
      return p.call('verifyStationCode', { ...C, teamId: p.uid, code: task.smart?.secretCode ?? task.answerOutcomes?.[0]?.accepts?.[0] ?? '' });
    case 'quiz': case 'numeric':
      return task.orderItems?.length
        ? p.call('submitTaskAnswer', { ...C, ...here, orderedAnswer: task.orderItems, code })
        : p.call('submitTaskAnswer', { ...C, ...here, answer: String(task.answers?.[0] ?? task.numericAnswer ?? ''), code });
    case 'photo': {
      const video = task.smart?.captureKind === 'video';
      const url = `https://firebasestorage.googleapis.com/v0/b/${PROJECT}.appspot.com/o/${encodeURIComponent(`runs/${ctx.runId}/teams/${p.uid}/${task.id}.${video ? 'mp4' : 'jpg'}`)}?alt=media`;
      // Marked BEFORE the call: a submission the server accepted but whose answer was lost on
      // the way back must wait for its review like any other, not be sent again.
      if (task.smart?.autoApprove !== true) p.awaitingReview.add(task.id);
      const res = await p.call('submitStationPhoto', { ...C, teamId: p.uid, photoUrl: url,
        ...(video ? { contentType: 'video/mp4', mediaDurationSec: (task.smart?.videoMinSeconds ?? 5) + 1 } : {}) })
        .finally(() => { if (p.awaitingReview.has(task.id)) reviewQueue.push({ teamId: p.uid, taskId: task.id, tries: 0 }); });
      if (!res?.autoApproved && !p.awaitingReview.has(task.id)) { p.awaitingReview.add(task.id); reviewQueue.push({ teamId: p.uid, taskId: task.id, tries: 0 }); }
      return res;
    }
    default:
      throw new Error(`no player for task type ${task.type}`);
  }
}

const events = { full: [], redirected: [], waits: [] };

async function playTeam(p, ctx, code, creator) {
  const t0 = Date.now();
  let waitingSince = null; let waitedMs = 0; let fullAnswers = 0; let stuckOn = new Map();
  const repeats = new Map();
  while (Date.now() - t0 < MAX_MS) {
    // A poll that fails is retried like a phone retries it; it is counted, never fatal.
    const state = await p.call('getMyTeamState', { code }).catch((e) => { pollErrors.push(`getMyTeamState ${e?.code}`); return null; });
    if (!state) { await sleep(2000); continue; }
    if (state?.team?.status === 'finished' || state?.team?.finishedAt) {
      return { finished: true, waitedMs, fullAnswers, state };
    }
    const recs = (state?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    const assigned = recs.find((r) => r.status === 'assigned');
    if (!assigned) {
      const res = await p.call('requestNextTask', { code }).catch((e) => { pollErrors.push(`requestNextTask ${e?.code}`); return null; });
      if (!res) { await sleep(2000); continue; }
      if (res?.reason === 'stationsFull') {
        fullAnswers++;
        if (waitingSince === null) {
          waitingSince = Date.now();
          events.full.push({ team: p.name, at: Date.now() - t0, snapshot: describeFull(recs) });
        }
        await sleep(1500 + rand() * 1000);
        continue;
      }
      if (res?.taskId && waitingSince !== null) {
        const w = Date.now() - waitingSince; waitedMs += w; waitingSince = null;
        events.waits.push({ team: p.name, ms: w, got: short(taskById.get(res.taskId)) });
      } else if (res?.taskId) {
        noteRedirect(p.name, recs, res.taskId);
      } else {
        await sleep(400);
      }
      continue;
    }
    if (waitingSince !== null) { waitedMs += Date.now() - waitingSince; waitingSince = null; }
    const task = taskById.get(assigned.taskId);
    // Sent and waiting for the marshal: the record stays `assigned` until the review lands.
    if (p.awaitingReview.has(task.id)) { await sleep(1200); continue; }
    await sleep(DWELL_MS * (0.6 + rand() * 0.8));
    try {
      const res = await playTask(p, ctx, code, task);
      // The same mission still in hand after an accepted submission means the bot is not
      // playing it the way a phone does. Say so once, and never hammer the door.
      const again = (repeats.get(task.id) ?? 0) + 1; repeats.set(task.id, again);
      if (again === 3) playFailures.push(`${short(task)} [${task.type}]: accepted but not completed — ${JSON.stringify(res)}`);
      if (again >= 3) await sleep(1500);
    } catch (e) {
      const n = (stuckOn.get(task.id) ?? 0) + 1; stuckOn.set(task.id, n);
      if (n === 1) playFailures.push(`${short(task)} [${task.type}]: ${e?.code ?? ''} ${e?.message ?? e}`);
      if (n >= 3) {
        // The mission cannot be played by a bot; a marshal lets the team through, as on the day.
        await creator.call('skipTaskForTeam', { ...ctx, teamId: p.uid, taskId: task.id }).catch(() => undefined);
      }
      await sleep(600);
    }
  }
  return { finished: false, waitedMs, fullAnswers };
}

/** Which of this team's open, unlocked stations were full in the monitor's last sample. */
function fullStations(recs) {
  const done = new Set(recs.filter((r) => r.status === 'completed' || r.status === 'skipped').map((r) => r.taskId));
  return recs.filter((r) => r.status === 'unassigned').map((r) => taskById.get(r.taskId)).filter((t) => t
    && !t.locationless && (t.unlockAfterTaskIds ?? []).every((id) => done.has(id))
    && (monitor.lastOccupancy.get(t.id) ?? 0) >= capOf(t));
}
const describeFull = (recs) => fullStations(recs).map((t) => `${short(t)} ${monitor.lastOccupancy.get(t.id) ?? 0}/${capOf(t)}`).join(' · ');
function noteRedirect(team, recs, gotId) {
  const full = fullStations(recs).filter((t) => t.id !== gotId);
  if (full.length === 0) return;
  const got = taskById.get(gotId);
  events.redirected.push(`${team}: ${full.map((t) => `"${short(t)}" full ${monitor.lastOccupancy.get(t.id)}/${capOf(t)}`).join(', ')}  →  sent to "${short(got)}" (${monitor.lastOccupancy.get(gotId) ?? 0}/${capOf(got) === Infinity ? '∞' : capOf(got)})`);
}

async function main() {
  console.log(`── station caps: "${source.title}" · ${TEAMS} teams · dwell ~${DWELL_MS}ms ──\n`);
  for (const s of source.stages) {
    console.log(`stage ${s.order + 1}: ${s.title}${s.requiredTaskCount ? `  (any ${s.requiredTaskCount} of ${s.tasks.length})` : ''}`);
    for (const t of s.tasks) console.log(`    cap ${String(t.locationless ? '∞' : capOf(t)).padStart(3)}  ${t.type.padEnd(13)} ${short(t)}`);
  }
  console.log('');

  const creator = makeParty('creator');
  const ownerUid = (await signInAnonymously(creator.auth)).user.uid;
  const { gameId } = await creator.call('createGame', { title: `${source.title} (caps sim)`, mode: source.mode ?? 'team' });
  // Player-facing media is irrelevant to routing and would only tie the copy to production files.
  const stages = source.stages.map((s) => ({ ...s, tasks: s.tasks.map(({ media, ...t }) => t) }));
  await creator.call('updateGame', { gameId, scoringPreset: source.scoringPreset, stages });
  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  const ctx = { ownerUid, gameId, runId };
  const runPath = `users/${ownerUid}/games/${gameId}/runs/${runId}`;
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  const teams = [];
  for (let i = 0; i < TEAMS; i++) {
    const p = makeParty(`team-${i + 1}`);
    p.name = `קבוצה ${i + 1}`;
    p.awaitingReview = new Set();
    p.uid = (await signInAnonymously(p.auth)).user.uid;
    await p.call('joinRun', { code: accessCode, displayName: p.name, memberNames: ['א', 'ב'] });
    teams.push(p);
  }
  const started = await creator.call('startTeams', { gameId, runId });
  audit(`all ${TEAMS} teams started`, started?.launched === TEAMS, JSON.stringify(started));

  const mon = monitorLoop(runPath);
  // The marshal: approves whatever waits for review, a moment after it arrives.
  let reviewing = true;
  const reviewer = (async () => {
    while (reviewing) {
      const item = reviewQueue.shift();
      if (!item) { await sleep(250); continue; }
      const { tries, ...sub } = item;
      await creator.call('reviewStationSubmission', { ...ctx, ...sub, approved: true }).catch((e) => {
        if (tries < 5) setTimeout(() => reviewQueue.push({ ...sub, tries: tries + 1 }), 1500);
        else playFailures.push(`review: ${e?.message}`);
      });
    }
  })();

  // What the organizer's console is given about a team that is waiting for a station.
  let waitingRow = null;
  const consoleProbe = (async () => {
    while (!monitor.stop && !waitingRow) {
      await sleep(1500);
      if (events.full.length === 0) continue;
      const res = await creator.call('listRunTeams', { gameId, runId }).catch(() => null);
      const rows = res?.teams ?? [];
      waitingRow = rows.find((r) => r.launched && !r.finished && r.waitingForStationSince) ?? null;
    }
  })();

  const results = await Promise.all(teams.map((p) => playTeam(p, ctx, accessCode, creator)));
  monitor.stop = true; reviewing = false;
  await Promise.all([mon, reviewer, consoleProbe]);

  // ── Verdicts ───────────────────────────────────────────────────────────────
  console.log('\n── peak occupancy per station (independent Firestore samples: ' + monitor.samples + ') ──');
  for (const t of allTasks) {
    const cap = capOf(t);
    console.log(`  ${String(monitor.peak.get(t.id) ?? 0).padStart(3)} / ${String(cap === Infinity ? '∞' : cap).padEnd(3)} ${(monitor.peak.get(t.id) ?? 0) >= cap ? 'FULL at peak' : '            '}  ${short(t)}`);
  }
  console.log('');
  audit('no station was ever over its cap', monitor.over.length === 0, [...new Set(monitor.over)].slice(0, 6).join(' | '));
  const reachedCap = allTasks.filter((t) => capOf(t) !== Infinity && (monitor.peak.get(t.id) ?? 0) >= capOf(t));
  audit('the simulation really filled stations (otherwise the check above proves nothing)', reachedCap.length > 0,
    `${reachedCap.length} stations hit their cap`);

  console.log(`\n── a station was full, the team was sent to a free one: ${events.redirected.length} times ──`);
  for (const line of events.redirected.slice(0, 8)) console.log('  ' + line);

  console.log(`\n── every station open to the team was full ("stationsFull"): ${events.full.length} times ──`);
  for (const e of events.full.slice(0, 8)) console.log(`  ${e.team} @${(e.at / 1000).toFixed(1)}s  full: ${e.snapshot || '(sample raced the release)'}`);
  console.log(`  waits that ended with a station: ${events.waits.length}` + (events.waits.length
    ? `, ${Math.min(...events.waits.map((w) => w.ms))}–${Math.max(...events.waits.map((w) => w.ms))}ms` : ''));
  for (const w of events.waits.slice(0, 5)) console.log(`  ${w.team} waited ${w.ms}ms → "${w.got}"`);

  const unfinished = results.filter((r) => !r.finished).length;
  audit('every team finished the course', unfinished === 0, `${unfinished} of ${TEAMS} unfinished`);
  audit('no mission needed a marshal to get the bot through', playFailures.length === 0, [...new Set(playFailures)].slice(0, 6).join(' | '));

  const runDoc = (await adb.doc(runPath).get()).data() ?? {};
  const leaked = Object.entries(runDoc.taskCounts ?? {}).filter(([, n]) => Number(n) !== 0);
  audit('every station counter is back to 0', leaked.length === 0, leaked.map(([id, n]) => `${short(taskById.get(id))}=${n}`).join(' | '));

  // ── Does waiting for a station stop the team's clock? ──────────────────────
  console.log('\n── the clock of the teams that waited ──');
  const board = await creator.call('refreshLeaderboard', { gameId, runId, publish: false }).catch(() => null);
  const entries = board?.rankings ?? board?.leaderboard ?? board?.entries ?? [];
  const teamDocs = await adb.collection(`${runPath}/teams`).get();
  const waited = results.map((r, i) => ({ r, p: teams[i] })).filter((x) => x.r.waitedMs > 0).sort((a, b) => b.r.waitedMs - a.r.waitedMs);
  let anyExcluded = false; let stationWaitTotal = 0;
  for (const { r, p } of waited.slice(0, 6)) {
    const d = teamDocs.docs.find((x) => x.id === p.uid)?.data() ?? {};
    const raw = d.startedAt && d.finishedAt ? Date.parse(d.finishedAt) - Date.parse(d.startedAt) : NaN;
    const taskExcluded = (d.stages ?? []).flatMap((s) => s.tasks ?? []).reduce((a, t) => a + (Number(t.excludedMs) || 0), 0);
    const entry = entries.find((e) => e.teamId === p.uid);
    const boardSec = entry?.durationSeconds ?? entry?.elapsedSeconds ?? null;
    const credited = Number.isFinite(raw) && boardSec != null ? raw / 1000 - boardSec : null;
    // A clock-pausing MISSION is credited too, so only credit beyond it can be the station wait.
    if (credited != null && credited * 1000 - taskExcluded - (Number(d.heldMs) || 0) > r.waitedMs * 0.5) anyExcluded = true;
    stationWaitTotal += Number(d.stationWaitMs) || 0;
    console.log(`  ${p.name}: waited ${(r.waitedMs / 1000).toFixed(1)}s for a station · raw race ${(raw / 1000).toFixed(1)}s · board ${boardSec ?? '?'}s · heldMs ${d.heldMs ?? 0} · mission excludedMs ${taskExcluded} · stationWaitMs ${d.stationWaitMs ?? 0}`);
  }
  if (waited.length === 0) console.log('  no team waited');
  else audit('waiting for a station comes off the waiting team\'s clock (station-wait-clock)', anyExcluded, `${stationWaitTotal}ms settled across the teams shown`);

  console.log('\n── what the console is given about a team waiting for a station (listRunTeams row) ──');
  if (waitingRow) {
    const { id, displayName, activeTaskId, ...rest } = waitingRow;
    console.log(`  ${displayName}: activeTaskId=${activeTaskId ?? null}; fields: ${Object.keys(rest).join(', ')}`);
    audit('the console row of a waiting team says it is waiting for a station', typeof waitingRow.waitingForStationSince === 'string', String(waitingRow.waitingForStationSince));
  } else console.log('  (no waiting team was caught by the probe)');

  console.log(`\ncalls retried after a transient emulator error: ${transient}; polls that failed outright and were retried on the next turn: ${pollErrors.length} ${[...new Set(pollErrors)].join(', ')}`);
  console.log(`\n${violations === 0 ? '✅ STATION CAPS HOLD' : `❌ ${violations} VIOLATION(S)`}`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
