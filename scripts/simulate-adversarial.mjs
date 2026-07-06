// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint v2 — ADVERSARIAL concurrent simulation against the local emulator.
//
//   npm run simulate:adversarial            (12 teams, ~40% cheaters)
//   node scripts/simulate-adversarial.mjs --teams=24 --cheaters=0.5
//
// The load sim (simulate-run.mjs) proves the system stays consistent when N HONEST
// teams play at once. The e2e suite proves each anti-cheat gate works in isolation
// (attempt limit, duplicate-submission idempotence, GPS distance, IDOR authz). NEITHER
// covers the dangerous middle ground: do the anti-cheat gates hold, AND do honest
// teams stay uncorrupted, when CHEATERS hammer the SAME shared stations concurrently?
// A cheater's rejected action must never corrupt a station counter an honest team
// needs, double a score, or crash a shared code path.
//
// Cheater repertoire (each cheater still finishes honestly, so the global invariants
// remain assertable — a leaked slot would then be a real bug, not a held one):
//   • BRUTE   — spams wrong quiz/numeric answers before the correct one
//   • SPOOF   — submits check-ins from far outside the geofence before walking in
//   • DUPE    — fires the same completeTask twice at once (replay / double-tap)
//   • IDOR    — tries to act on ANOTHER team's id mid-run
// Ends with the full consistency audit (every team finished · score conservation ·
// leaderboard oracle · live/final parity · every station counter back to 0 · no
// negative counters) PLUS a per-cheat rebuff tally. Exits non-zero on ANY violation.
//
// Deterministic: a seeded LCG drives all jitter + cheat scheduling.
// ═══════════════════════════════════════════════════════════════════════════════
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';

const PROJECT = 'rushpoint-pwa-7daaa';
const arg = (name, dflt) => {
  const raw = (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1];
  return raw === undefined ? dflt : raw;
};
const TEAMS = Math.max(3, Number(arg('teams', 12)));
const CHEAT_FRAC = Math.min(0.8, Math.max(0.1, Number(arg('cheaters', 0.4))));
const CONCURRENCY = 8;
const MAX_TURNS = 50;

// ── Seeded RNG (reproducible) ─────────────────────────────────────────────────
let _seed = 70570705;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

const latencySamples = new Map();
function recordLatency(fn, ms) {
  if (!latencySamples.has(fn)) latencySamples.set(fn, []);
  latencySamples.get(fn).push(ms);
}
let transientRetries = 0;

function makeParty(name) {
  const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `adv-${name}` }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {
    auth,
    // Returns { ok, data } | { ok:false, code } — never throws, so a cheater's
    // EXPECTED rejection is data, not an exception that aborts the run.
    call: async (fn, data) => {
      const t0 = Date.now();
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const res = (await httpsCallable(functions, fn)(data)).data;
            return { ok: true, data: res };
          } catch (e) {
            if (e.code === 'functions/internal' && attempt < 2) {
              transientRetries++; await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); continue;
            }
            return { ok: false, code: e.code ?? String(e), message: e.message };
          }
        }
      } finally {
        recordLatency(fn, Date.now() - t0);
      }
    },
    getDocAt: (path) => getDoc(doc(db, path)).then((s) => ({ exists: s.exists(), data: s.data() })),
  };
}

async function pMap(items, fn, concurrency = CONCURRENCY) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

let violations = 0;
function audit(label, cond, detail) {
  console.log(`${cond ? 'OK  ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) violations++;
}

// ── Course geometry (Jerusalem hills) ─────────────────────────────────────────
const BASE = { lat: 31.78, lng: 35.21 };
const at = (dLatM, dLngM) => ({ lat: BASE.lat + dLatM / 111_320, lng: BASE.lng + dLngM / 111_320 });
const jitter = (p, m = 8) => ({ lat: p.lat + ((rand() - 0.5) * 2 * m) / 111_320, lng: p.lng + ((rand() - 0.5) * 2 * m) / 111_320 });
const FAR = (p) => ({ lat: p.lat + 0.05, lng: p.lng + 0.05 }); // ~7km away — always outside any geofence

const STATIONS = [
  { id: 'adv-f1', coords: at(0, 0) },
  { id: 'adv-f2', coords: at(150, 100) },
  { id: 'adv-f3', coords: at(-120, 200) },
  { id: 'adv-f4', coords: at(220, -150) },
];
const FINALE = at(400, 400);

function buildStages() {
  const cap = Math.max(2, Math.ceil(TEAMS / 3)); // caps below the fleet → real contention
  return [
    {
      id: 'adv-stage-1', order: 0, title: 'Field stations', requiredTaskCount: 3,
      tasks: STATIONS.map((s, i) => ({
        id: s.id, title: `Station ${i + 1}`, type: 'field', triggerMode: 'radius',
        coordinates: s.coords, geofenceRadiusMeters: 60,
        difficulty: 2 + (i % 3), estimatedMinutes: 4, pointValue: 50 + 10 * i, maxConcurrentTeams: cap,
      })),
    },
    {
      id: 'adv-stage-2', order: 1, title: 'Answers',
      tasks: [
        { id: 'adv-quiz', title: 'Quiz', type: 'quiz', locationless: true, triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 60,
          maxConcurrentTeams: TEAMS + 1, choices: ['Jerusalem', 'Haifa', 'Eilat'], answers: ['Jerusalem'] },
        { id: 'adv-num', title: 'Numeric', type: 'numeric', locationless: true, triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 60,
          maxConcurrentTeams: TEAMS + 1, numericAnswer: 7, numericTolerance: 0 },
      ],
    },
    {
      id: 'adv-stage-3', order: 2, title: 'Finale', isFinal: true,
      tasks: [
        { id: 'adv-fin', title: 'Finish gate', type: 'field', triggerMode: 'radius', coordinates: FINALE,
          geofenceRadiusMeters: 60, difficulty: 2, estimatedMinutes: 3, pointValue: 100, maxConcurrentTeams: TEAMS + 1 },
      ],
    },
  ];
}

// Per-cheat rebuff counters — a cheat that is NEVER rebuffed (count stays 0 despite
// attempts) is itself a finding: the gate isn't firing under load.
const rebuff = { bruteRejected: 0, bruteAttempts: 0, spoofRejected: 0, spoofAttempts: 0, idorDenied: 0, idorAttempts: 0, dupeHandled: 0 };

// One team's play loop. `role` ∈ 'honest' | 'BRUTE' | 'SPOOF' | 'DUPE' | 'IDOR'.
// Cheaters attempt their exploit, assert it's rebuffed, THEN act honestly so they
// still finish (keeping the global invariants clean of self-inflicted leaks).
async function playTeam(team, ctx, code, role, victimTeamId) {
  const C = { ...ctx };
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const st = await team.call('getMyTeamState', { code });
    if (!st.ok) { if (st.code === 'functions/internal') continue; return { finished: false, turns: turn, err: st.code }; }
    if (st.data?.team?.status === 'finished') return { finished: true, turns: turn };

    const recs = (st.data?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    const assigned = recs.find((t) => t.status === 'assigned');
    if (!assigned) {
      const here = jitter(STATIONS[Math.floor(rand() * STATIONS.length)].coords, 30);
      await team.call('requestNextTask', { code, lat: here.lat, lng: here.lng });
      continue;
    }
    const id = assigned.taskId;

    // ── IDOR probe (once): call a teamId-honoring privileged callable
    // (verifyStationCode) with the VICTIM's teamId. Its IDOR guard
    // (index.ts: `teamId !== resolvedTeamId → permission-denied`) fires BEFORE any
    // task lookup, so the mismatch alone must be denied — regardless of the code.
    // (completeTask/submitTaskAnswer ignore a payload teamId entirely, so they are
    // the wrong target for an IDOR test — they act only on the caller's own team.)
    if (role === 'IDOR' && victimTeamId && turn === 0) {
      rebuff.idorAttempts++;
      const r = await team.call('verifyStationCode', { ...C, taskId: id, teamId: victimTeamId, code: 'X' });
      if (!r.ok && r.code === 'functions/permission-denied') rebuff.idorDenied++;
      else audit('IDOR cross-team verifyStationCode NOT denied', false, JSON.stringify(r));
    }

    if (id === 'adv-quiz') {
      if (role === 'BRUTE') {
        for (let k = 0; k < 4; k++) {
          rebuff.bruteAttempts++;
          const r = await team.call('submitTaskAnswer', { ...C, taskId: id, answer: k % 2 ? 'Haifa' : 'Eilat' });
          if (r.ok && r.data?.correct === false) rebuff.bruteRejected++;   // rejected as designed
          if (r.ok && r.data?.correct === true) audit('BRUTE wrong quiz answer WRONGLY accepted', false, JSON.stringify(r.data));
        }
      }
      await team.call('submitTaskAnswer', { ...C, taskId: id, answer: 'jerusalem' });
    } else if (id === 'adv-num') {
      if (role === 'BRUTE') {
        for (const bad of ['1', '999', '6']) {
          rebuff.bruteAttempts++;
          const r = await team.call('submitTaskAnswer', { ...C, taskId: id, answer: bad });
          if (r.ok && r.data?.correct === false) rebuff.bruteRejected++;
          if (r.ok && r.data?.correct === true) audit('BRUTE wrong numeric answer WRONGLY accepted', false, bad);
        }
      }
      await team.call('submitTaskAnswer', { ...C, taskId: id, answer: '7' });
    } else if (id === 'adv-fin' || STATIONS.some((s) => s.id === id)) {
      const target = id === 'adv-fin' ? FINALE : STATIONS.find((s) => s.id === id).coords;
      if (role === 'SPOOF') {
        rebuff.spoofAttempts++;
        const far = FAR(target);
        const r = await team.call('completeTask', { ...C, taskId: id, lat: far.lat, lng: far.lng });
        if (!r.ok) rebuff.spoofRejected++;                // rejected: too far
        else audit('SPOOF far-away check-in WRONGLY accepted', false, `${id} @ ${far.lat},${far.lng}`);
      }
      const spot = jitter(target, 15);
      if (role === 'DUPE') {
        // Fire the same completeTask TWICE at once (double-tap / replay).
        const [a, b] = await Promise.all([
          team.call('completeTask', { ...C, taskId: id, lat: spot.lat, lng: spot.lng }),
          team.call('completeTask', { ...C, taskId: id, lat: spot.lat, lng: spot.lng }),
        ]);
        if ([a, b].some((x) => x.ok)) rebuff.dupeHandled++; // at least one succeeds; idempotence checked in the audit
      } else {
        await team.call('completeTask', { ...C, taskId: id, lat: spot.lat, lng: spot.lng });
      }
    }
  }
  return { finished: false, turns: MAX_TURNS };
}

async function main() {
  const t0 = Date.now();
  const cheatCount = Math.floor(TEAMS * CHEAT_FRAC);
  console.log(`── RushPoint v2 ADVERSARIAL sim — ${TEAMS} teams (${cheatCount} cheaters) ──\n`);

  const creator = makeParty('adv-creator');
  const ccred = await signInAnonymously(creator.auth);
  const ownerUid = ccred.user.uid;

  const g = await creator.call('createGame', { title: `Adversarial ${TEAMS}`, mode: 'individual' });
  const gameId = g.data.gameId;
  await creator.call('updateGame', { gameId, scoringPreset: 'smart_weighted', stages: buildStages() });
  const lr = await creator.call('launchRun', { gameId });
  const { runId, accessCode } = lr.data;
  const ctx = { ownerUid, gameId, runId };
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  const teams = await pMap(Array.from({ length: TEAMS }, (_, i) => i), async (i) => {
    const p = makeParty(`adv-team-${i}`);
    const cred = await signInAnonymously(p.auth);
    await p.call('joinRun', { code: accessCode, displayName: `Adv Team ${i + 1}` });
    return { p, uid: cred.user.uid };
  });
  const started = await creator.call('startTeams', { gameId, runId });
  audit(`startTeams launched all ${TEAMS} teams`, started.data?.launched === TEAMS, JSON.stringify(started.data));

  // Assign roles: the first `cheatCount` teams cycle through the cheat repertoire;
  // the rest are honest. The IDOR cheater targets an honest victim's uid.
  const ROLES = ['BRUTE', 'SPOOF', 'DUPE', 'IDOR'];
  const victimUid = teams[TEAMS - 1].uid; // last team is honest → the IDOR victim
  const roleFor = (i) => (i < cheatCount ? ROLES[i % ROLES.length] : 'honest');

  const results = await pMap(teams, ({ p }, i) =>
    playTeam(p, ctx, accessCode, roleFor(i), roleFor(i) === 'IDOR' ? victimUid : null));

  const unfinished = results.filter((r) => !r.finished).length;
  audit('every team (honest + cheater) finished the course', unfinished === 0,
    `${unfinished} unfinished` + (unfinished ? ' :: ' + JSON.stringify(results.map((r, i) => [roleFor(i), r])) : ''));

  // ── Per-cheat rebuff tally: each attempted exploit must have been rebuffed. ───
  audit('BRUTE: every wrong answer rejected (correct:false)', rebuff.bruteAttempts > 0 && rebuff.bruteRejected === rebuff.bruteAttempts,
    `${rebuff.bruteRejected}/${rebuff.bruteAttempts}`);
  audit('SPOOF: every far-away check-in rejected', rebuff.spoofAttempts > 0 && rebuff.spoofRejected === rebuff.spoofAttempts,
    `${rebuff.spoofRejected}/${rebuff.spoofAttempts}`);
  audit('IDOR: every cross-team attempt denied', rebuff.idorAttempts > 0 && rebuff.idorDenied === rebuff.idorAttempts,
    `${rebuff.idorDenied}/${rebuff.idorAttempts}`);

  // ── Consistency audit (identical to the honest load sim) ─────────────────────
  const states = await pMap(teams, ({ p }) => p.call('getMyTeamState', { code: accessCode }));
  const broken = states.filter((st) => {
    const tasks = (st.data?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    return tasks.reduce((a, t) => a + (t.earnedScore ?? 0), 0) !== st.data?.team?.score;
  });
  audit('score conservation holds for every team (no double-count from DUPE)', broken.length === 0,
    broken.map((st) => st.data?.team?.displayName).join(',') || `${TEAMS} teams checked`);

  const teamIds = states.map((s) => s.data?.team?.id);
  const oracle = (label, rankings) => {
    const ids = (rankings ?? []).map((r) => r.teamId);
    audit(`${label}: one entry per team`, ids.length === TEAMS && new Set(ids).size === TEAMS && teamIds.every((id) => ids.includes(id)), `${ids.length} entries`);
    audit(`${label}: contiguous ranks from 1`, (rankings ?? []).every((r, i) => r.rank === i + 1));
    audit(`${label}: finite scores`, (rankings ?? []).every((r) => Number.isFinite(r.score)));
    audit(`${label}: non-increasing scores`, (rankings ?? []).every((r, i) => i === 0 || rankings[i - 1].score >= r.score));
  };
  const live = await creator.call('refreshLeaderboard', { gameId, runId, publish: false });
  oracle('live board', live.data?.rankings);
  const fin = await creator.call('finalizeRun', { gameId, runId });
  oracle('final board', fin.data?.rankings);
  audit('live/final ordering parity (no drift under chaos)',
    JSON.stringify((live.data?.rankings ?? []).map((r) => r.teamId)) === JSON.stringify((fin.data?.rankings ?? []).map((r) => r.teamId)));

  const runDoc = await creator.getDocAt(`users/${ownerUid}/games/${gameId}/runs/${runId}`);
  const counts = runDoc.data?.taskCounts ?? {};
  audit('no leaked station slots (all taskCounts back to 0)', Object.values(counts).every((v) => v === 0), JSON.stringify(counts));
  audit('no negative station counters (DUPE/SPOOF never underflowed)', Object.values(counts).every((v) => v >= 0), JSON.stringify(counts));

  // ── Latency ──
  const rows = [...latencySamples.entries()].map(([fn, arr]) => {
    const s = [...arr].sort((a, b) => a - b);
    return { fn, n: arr.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
  }).sort((a, b) => b.n - a.n).slice(0, 12);
  console.log('\n── Callable latency under adversarial load (emulator, ms) ──');
  for (const r of rows) console.log(`  ${r.fn.padEnd(22)} n=${String(r.n).padStart(4)}  p50=${String(r.p50).padStart(5)}  p95=${String(r.p95).padStart(5)}  max=${String(r.max).padStart(6)}`);

  console.log(`\ncheat rebuffs — brute ${rebuff.bruteRejected}/${rebuff.bruteAttempts} · spoof ${rebuff.spoofRejected}/${rebuff.spoofAttempts} · idor ${rebuff.idorDenied}/${rebuff.idorAttempts} · dupe handled ${rebuff.dupeHandled}`);
  console.log(`transient INTERNAL retries absorbed: ${transientRetries}`);
  console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(violations === 0 ? '\n✅ ADVERSARIAL SIM CONSISTENT — every cheat rebuffed, honest teams uncorrupted' : `\n❌ ${violations} VIOLATION(S)`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n💥 Uncaught error:', e.message); console.error(e); process.exit(1); });
