// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint v2 — concurrent load simulation against the local emulator.
//
//   npm run simulate               (12 teams)
//   node scripts/simulate-run.mjs --teams=30
//
// Drives the REAL v2 callable API only (no direct Firestore writes to game
// state): one creator builds a 3-stage game (station-capped field tasks →
// quiz/numeric answers → a geofenced finale), launches a run, and N anonymous
// teams play it CONCURRENTLY — racing station slots, submitting answers, and
// checking in with jittered GPS. Ends with a full consistency audit:
//   • every team finished
//   • per-team score conservation (Σ task earnedScore == team.score)
//   • leaderboard oracle on refreshLeaderboard AND finalizeRun (one entry per
//     team, contiguous ranks, finite non-increasing scores)
//   • live/final ordering parity (buildRankings can't drift)
//   • every run.taskCounts counter back to 0 (no leaked station slots)
// plus a per-callable latency table. Exits non-zero on ANY violation.
//
// Deterministic: a seeded LCG drives all jitter, so failures reproduce.
// ═══════════════════════════════════════════════════════════════════════════════
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';

const PROJECT = 'rushpoint-pwa-7daaa';
const TEAMS = Math.max(2, Number((process.argv.find((a) => a.startsWith('--teams=')) ?? '').split('=')[1] || 12));
const CONCURRENCY = 8;
const MAX_TURNS = 40; // safety cap per team (a stuck loop is itself a failure)

// ── Seeded RNG (reproducible) ───────────────────────────────────────────────
let _seed = 424242;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

// ── Emulator parties ─────────────────────────────────────────────────────────
const latencySamples = new Map();
function recordLatency(fn, ms) {
  if (!latencySamples.has(fn)) latencySamples.set(fn, []);
  latencySamples.get(fn).push(ms);
}

// Real phones retry a transient network/server blip — the sim does too (max 2,
// counted + reported: a NOISY retry tally is itself a finding, a hidden one isn't).
let transientRetries = 0;

function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `sim-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {
    auth,
    call: async (fn, data) => {
      const t0 = Date.now();
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            return (await httpsCallable(functions, fn)(data)).data;
          } catch (e) {
            if (e.code !== 'functions/internal' || attempt >= 2) throw e;
            transientRetries++;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        }
      } finally {
        recordLatency(fn, Date.now() - t0);
      }
    },
    getDocAt: (path) => getDoc(doc(db, path)).then((s) => ({ exists: s.exists(), data: s.data() })),
  };
}

let violations = 0;
function audit(label, cond, detail) {
  console.log(`${cond ? 'OK  ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) violations++;
}

// Bounded-concurrency map (same shape as the v1 simulator's pMap).
async function pMap(items, fn, concurrency = CONCURRENCY) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// ── Course geometry (Jerusalem hills) ────────────────────────────────────────
const BASE = { lat: 31.78, lng: 35.21 };
const at = (dLatM, dLngM) => ({ lat: BASE.lat + dLatM / 111_320, lng: BASE.lng + dLngM / 111_320 });
const jitter = (p, m = 8) => ({ lat: p.lat + ((rand() - 0.5) * 2 * m) / 111_320, lng: p.lng + ((rand() - 0.5) * 2 * m) / 111_320 });

const STATIONS = [
  { id: 'sim-f1', coords: at(0, 0) },
  { id: 'sim-f2', coords: at(150, 100) },
  { id: 'sim-f3', coords: at(-120, 200) },
  { id: 'sim-f4', coords: at(220, -150) },
];
const FINALE = at(400, 400);

function buildStages() {
  const cap = Math.max(2, Math.ceil(TEAMS / 3)); // caps stay LOWER than the fleet → real contention
  return [
    {
      id: 'sim-stage-1', order: 0, title: 'Field stations', requiredTaskCount: 3,
      tasks: STATIONS.map((s, i) => ({
        id: s.id, title: `Station ${i + 1}`, type: 'field', coordinates: s.coords,
        difficulty: 2 + (i % 3), estimatedMinutes: 4, pointValue: 50 + 10 * i, maxConcurrentTeams: cap,
      })),
    },
    {
      id: 'sim-stage-2', order: 1, title: 'Answers',
      tasks: [
        { id: 'sim-quiz', title: 'Quiz', type: 'quiz', locationless: true, triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 60,
          maxConcurrentTeams: TEAMS + 1, choices: ['Jerusalem', 'Haifa', 'Eilat'], answers: ['Jerusalem'] },
        { id: 'sim-num', title: 'Numeric', type: 'numeric', locationless: true, triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 60,
          maxConcurrentTeams: TEAMS + 1, numericAnswer: 7, numericTolerance: 0 },
      ],
    },
    {
      id: 'sim-stage-3', order: 2, title: 'Finale', isFinal: true,
      tasks: [
        { id: 'sim-fin', title: 'Finish gate', type: 'field', triggerMode: 'radius', coordinates: FINALE,
          geofenceRadiusMeters: 60, difficulty: 2, estimatedMinutes: 3, pointValue: 100, maxConcurrentTeams: TEAMS + 1 },
      ],
    },
  ];
}

// One team's play loop: read state → act on the assigned task → repeat.
async function playTeam(team, ownerUid, gameId, runId, code) {
  const C = { ownerUid, gameId, runId };
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const state = await team.call('getMyTeamState', { code });
    if (state?.team?.status === 'finished') return { finished: true, turns: turn };

    const recs = (state?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    const assigned = recs.find((t) => t.status === 'assigned');
    if (!assigned) {
      // No task in hand (e.g. lost a station race) — ask again from a jittered spot.
      const here = jitter(STATIONS[Math.floor(rand() * STATIONS.length)].coords, 30);
      await team.call('requestNextTask', { code, lat: here.lat, lng: here.lng });
      continue;
    }

    const id = assigned.taskId;
    if (id === 'sim-quiz') {
      // Wrong answer sometimes, then the right one — exercises the reject path.
      if (rand() < 0.3) await team.call('submitTaskAnswer', { ...C, taskId: id, answer: 'Haifa' });
      await team.call('submitTaskAnswer', { ...C, taskId: id, answer: 'jerusalem' });
    } else if (id === 'sim-num') {
      await team.call('submitTaskAnswer', { ...C, taskId: id, answer: '7' });
    } else if (id === 'sim-fin') {
      const spot = jitter(FINALE, 20);
      await team.call('completeTask', { ...C, taskId: id, lat: spot.lat, lng: spot.lng });
    } else {
      const station = STATIONS.find((s) => s.id === id);
      const spot = jitter(station?.coords ?? BASE, 15);
      await team.call('completeTask', { ...C, taskId: id, lat: spot.lat, lng: spot.lng });
    }
  }
  return { finished: false, turns: MAX_TURNS };
}

async function main() {
  const t0 = Date.now();
  console.log(`── RushPoint v2 load simulation — ${TEAMS} concurrent teams ──\n`);

  const creator = makeParty('sim-creator');
  const creatorCred = await signInAnonymously(creator.auth);
  const ownerUid = creatorCred.user.uid;

  const { gameId } = await creator.call('createGame', { title: `Load Sim ${TEAMS}`, mode: 'individual' });
  await creator.call('updateGame', { gameId, scoringPreset: 'smart_weighted', stages: buildStages() });
  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  // Join the whole fleet concurrently (bounded), then start everyone at once.
  const teams = await pMap(Array.from({ length: TEAMS }, (_, i) => i), async (i) => {
    const p = makeParty(`sim-team-${i}`);
    await signInAnonymously(p.auth);
    await p.call('joinRun', { code: accessCode, displayName: `Sim Team ${i + 1}` });
    return p;
  });
  const started = await creator.call('startTeams', { gameId, runId });
  audit(`startTeams launched all ${TEAMS} teams`, started?.launched === TEAMS, JSON.stringify(started));

  // Mid-run pressure from the ops side while teams play.
  const opsNoise = (async () => {
    await creator.call('refreshLeaderboard', { gameId, runId, publish: false });
    await creator.call('pushAnnouncement', { ownerUid, gameId, runId, title: 'Sim', message: 'Halfway there!' });
  })();

  const results = await pMap(teams, (p) => playTeam(p, ownerUid, gameId, runId, accessCode));
  await opsNoise;

  const unfinished = results.filter((r) => !r.finished).length;
  audit('every team finished the course', unfinished === 0, `${unfinished} unfinished of ${TEAMS}`);
  const avgTurns = (results.reduce((a, r) => a + r.turns, 0) / results.length).toFixed(1);
  console.log(`avg turns/team: ${avgTurns}`);

  // ── Consistency audit ────────────────────────────────────────────────────────
  // Score conservation per team.
  const states = await pMap(teams, (p) => p.call('getMyTeamState', { code: accessCode }));
  const broken = states.filter((st) => {
    const tasks = (st?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    return tasks.reduce((a, t) => a + (t.earnedScore ?? 0), 0) !== st?.team?.score;
  });
  audit('score conservation holds for every team', broken.length === 0,
    broken.map((st) => st?.team?.displayName).join(',') || `${TEAMS} teams checked`);

  const teamIds = states.map((s) => s?.team?.id);

  const oracle = (label, rankings) => {
    const ids = (rankings ?? []).map((r) => r.teamId);
    audit(`${label}: one entry per team`, ids.length === TEAMS && new Set(ids).size === TEAMS && teamIds.every((id) => ids.includes(id)), `${ids.length} entries`);
    audit(`${label}: contiguous ranks from 1`, (rankings ?? []).every((r, i) => r.rank === i + 1));
    audit(`${label}: finite scores`, (rankings ?? []).every((r) => Number.isFinite(r.score)));
    audit(`${label}: non-increasing scores`, (rankings ?? []).every((r, i) => i === 0 || rankings[i - 1].score >= r.score));
  };

  const live = await creator.call('refreshLeaderboard', { gameId, runId, publish: false });
  oracle('live board', live?.rankings);
  const fin = await creator.call('finalizeRun', { gameId, runId });
  oracle('final board', fin?.rankings);
  audit('live/final ordering parity (no drift)',
    JSON.stringify((live?.rankings ?? []).map((r) => r.teamId)) === JSON.stringify((fin?.rankings ?? []).map((r) => r.teamId)));

  // Station slots: every assignment was released → all counters back to 0.
  const runDoc = await creator.getDocAt(`users/${ownerUid}/games/${gameId}/runs/${runId}`);
  const counts = runDoc.data?.taskCounts ?? {};
  const leaked = Object.entries(counts).filter(([, v]) => v !== 0);
  audit('no leaked station slots (all taskCounts back to 0)', leaked.length === 0, JSON.stringify(counts));
  const negative = Object.entries(counts).filter(([, v]) => v < 0);
  audit('no negative station counters', negative.length === 0, JSON.stringify(negative));

  // ── Latency table ────────────────────────────────────────────────────────────
  const rows = [...latencySamples.entries()]
    .map(([fn, arr]) => {
      const s = [...arr].sort((a, b) => a - b);
      return { fn, n: arr.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
    })
    .sort((a, b) => b.n - a.n);
  console.log('\n── Callable latency under load (emulator, ms) ──');
  for (const r of rows) {
    console.log(`  ${r.fn.padEnd(24)} n=${String(r.n).padStart(4)}  p50=${String(r.p50).padStart(5)}  p95=${String(r.p95).padStart(5)}  max=${String(r.max).padStart(6)}`);
  }

  console.log(`\ntransient INTERNAL retries absorbed: ${transientRetries}`);
  audit('transient-error rate is sane (< 1 retry per team)', transientRetries < TEAMS, String(transientRetries));
  console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(violations === 0 ? '\n✅ LOAD SIM CONSISTENT' : `\n❌ ${violations} CONSISTENCY VIOLATION(S)`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n💥 Uncaught error:', e.message);
  console.error(e);
  process.exit(1);
});
