// ═══════════════════════════════════════════════════════════════════════════════
// Load-simulate a REAL game against PRODUCTION — api.rush-point.com + real Firebase.
//
//   node scripts/simulate-prod.mjs --teams=120 --confirm-project=rushpoint-pwa-7daaa \
//        --plan=<plan.json> --owner-token=<custom token>
//
// ⚠️ THIS WRITES PRODUCTION DATA AND SPENDS PRODUCTION QUOTA. It refuses to start
// without --confirm-project matching the project the .env actually points at, for the
// same reason backfill-public-tasks.mjs does: a load simulator aimed at the wrong
// project is indistinguishable from an attack.
//
// WHY NOT simulate-run.mjs: that script hardwires connectAuthEmulator/Functions/
// Firestore to 127.0.0.1 and BUILDS ITS OWN synthetic game. Both are wrong here. The
// question this script answers is not "does the backend survive load" (simulate-run
// answers that) but "does THIS AUTHORED GAME survive THIS MANY REAL PARTICIPANTS on
// the REAL backend" — which means the real callable transport, the real upload route,
// the real station caps, and the real mission mix, including video.
//
// QUOTA IS THE POINT, NOT A SIDE EFFECT. Spark allows 50,000 reads / 20,000 writes a
// day. The run aborts at a configurable fraction of either ceiling and reports how far
// it got — "we ran out at N teams" is a RESULT, not a failure of the harness. Ops are
// read from the API's own fsops records (RUSHPOINT_FS_OPCOUNT=1 on the VPS), so the
// number is measured on the server, never inferred from call counts here.
//
// FAIL LOUD, NEVER SILENTLY SMALLER: every team that cannot finish is reported with
// the reason the server gave. A simulator that quietly drops stuck teams would report
// a clean run for a game no one can finish.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
// The SAME send verdict the shipped client applies (change: participant-read-budget).
// Modelling an unconditional 20s ping would measure a call pattern the app no longer has,
// and would overstate this run's read cost by ~3x.
import { shouldWritePin } from '@rushpoint/shared';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ── Args ─────────────────────────────────────────────────────────────────────
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const flag = (n) => process.argv.includes(`--${n}`);

const TEAMS = Math.max(1, Number(arg('teams', '120')));
const PLAN_PATH = arg('plan', '');
const OWNER_TOKEN = arg('owner-token', process.env.RUSHPOINT_OWNER_TOKEN ?? '');
const CONFIRM = arg('confirm-project', '');
const JOIN_CONCURRENCY = Math.max(1, Number(arg('join-concurrency', '12')));
const PLAY_CONCURRENCY = Math.max(1, Number(arg('play-concurrency', '24')));
/** Real seconds between a team's location pings. play-web's own cadence is 20s. */
const PING_INTERVAL_MS = Math.max(0, Number(arg('ping-ms', '20000')));
const DO_UPLOADS = arg('uploads', '1') !== '0';
/** Abort when EITHER measured total crosses its share of the Spark ceiling. */
const ABORT_READ_FRACTION = Number(arg('abort-reads', '0.7'));
const ABORT_WRITE_FRACTION = Number(arg('abort-writes', '0.7'));
/** Mirrors PING_MAX_SILENCE_MS in apps/play-web/src/lib/pingGate.ts. */
const PING_SAFETY_FLOOR_MS = 60_000;
const SPARK_READS = 50_000;
const SPARK_WRITES = 20_000;
const MAX_TURNS = Number(arg('max-turns', '60'));
const DRY_RUN = flag('dry-run');

if (!PLAN_PATH) {
  console.error('--plan=<plan.json> is required (produced by the VPS prepare step).');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));

// ── Environment: the SAME values the shipped play-web bundle carries ─────────
function readEnvFile(p) {
  const out = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnvFile('apps/play-web/.env');
const PROJECT = env.VITE_FIREBASE_PROJECT_ID;
const API_ORIGIN = (env.VITE_API_ORIGIN || '').trim();

if (!API_ORIGIN) {
  console.error('apps/play-web/.env has no VITE_API_ORIGIN — refusing to guess a backend.');
  process.exit(2);
}
if (CONFIRM !== PROJECT) {
  console.error(`REFUSING: --confirm-project=${CONFIRM || '<missing>'} does not match the project this .env points at (${PROJECT}).`);
  console.error('This script writes production data. Pass the project id explicitly.');
  process.exit(2);
}

console.log(`\n══ PRODUCTION load simulation ══`);
console.log(`project=${PROJECT}  api=${API_ORIGIN}  teams=${TEAMS}  uploads=${DO_UPLOADS}  ping=${PING_INTERVAL_MS}ms`);
console.log(`abort at ${(ABORT_READ_FRACTION * 100).toFixed(0)}% of ${SPARK_READS} reads / ${(ABORT_WRITE_FRACTION * 100).toFixed(0)}% of ${SPARK_WRITES} writes\n`);
if (DRY_RUN) { console.log('--dry-run: validated arguments and environment only. Nothing was called.'); process.exit(0); }

// ── Parties ──────────────────────────────────────────────────────────────────
const latency = new Map();
const errorTally = new Map();
let callCount = 0;

function makeParty(name) {
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: PROJECT,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app, API_ORIGIN);
  return {
    auth,
    call: async (fn, data) => {
      const t0 = Date.now();
      callCount++;
      try {
        return (await httpsCallable(functions, fn)(data)).data;
      } catch (e) {
        const key = `${fn}:${e.code ?? 'unknown'}`;
        errorTally.set(key, (errorTally.get(key) ?? 0) + 1);
        throw e;
      } finally {
        if (!latency.has(fn)) latency.set(fn, []);
        latency.get(fn).push(Date.now() - t0);
      }
    },
    idToken: () => auth.currentUser?.getIdToken(),
  };
}

async function pMap(items, fn, concurrency) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ── Deterministic jitter (seeded, so a failure reproduces) ───────────────────
let _seed = 20260828;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const mPerDegLat = 111_320;
const mPerDegLng = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
const jitter = (p, m) => ({
  lat: p.lat + ((rand() - 0.5) * 2 * m) / mPerDegLat,
  lng: p.lng + ((rand() - 0.5) * 2 * m) / mPerDegLng(p.lat),
});
const metresBetween = (a, b) => Math.hypot(
  (a.lat - b.lat) * mPerDegLat,
  (a.lng - b.lng) * mPerDegLng(a.lat),
);

// ── Teams WALK. They do not teleport. ───────────────────────────────────────
// This is not cosmetic. `updateLocation` writes the pin at most once a minute UNLESS
// the team moved beyond PIN_JUMP_METERS (75m), and keeps a history point per ~100m
// travelled. A simulator that jitters each team hundreds of metres per ping trips both
// rules every time and reports roughly the pre-optimisation write cost — measuring its
// own unrealism rather than the product. A real participant covers ~28m per 20s ping.
const WALK_SPEED_MPS = 1.4;
/** Metres a team advances per ping. Tied to the app's cadence, not to wall-clock. */
const STEP_M = WALK_SPEED_MPS * (PING_INTERVAL_MS > 0 ? PING_INTERVAL_MS / 1000 : 20);

/** Move `from` up to STEP_M metres toward `to`, with a little GPS noise. */
function walkToward(from, to) {
  if (!to) return jitter(from, 3);
  const d = metresBetween(from, to);
  if (d <= STEP_M) return jitter(to, 4);
  const f = STEP_M / d;
  return jitter({ lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f }, 3);
}

// ── A tiny real JPEG, so the upload route sees genuine bytes ─────────────────
// Uploads must be REAL: the point of this run is the upload path (streaming write,
// content-type allowlist, size cap, disk). A stubbed URL would test none of it.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
/** Pad to a realistic size so the streaming path and the disk write are exercised. */
function mediaBytes(kind) {
  const target = kind === 'video' ? 2 * 1024 * 1024 : 300 * 1024;
  return Buffer.concat([JPEG_1PX, Buffer.alloc(Math.max(0, target - JPEG_1PX.length), 0x20)]);
}

// The DECLARED content-type must match the mission's captureKind: submitStationPhoto
// rejects a mismatch with invalid-argument, and the upload route runs its own
// allowlist. Only a photo task accepts an omitted type (back-compat), so a video
// mission needs a real video type and a matching extension — the file-serving route
// derives Content-Type from the extension, not from what was declared on upload.
const MEDIA = {
  photo: { contentType: 'image/jpeg', ext: 'jpg' },
  video: { contentType: 'video/mp4', ext: 'mp4' },
  audio: { contentType: 'audio/webm', ext: 'webm' },
};

async function uploadMedia(party, path, kind) {
  const token = await party.idToken();
  const body = mediaBytes(kind);
  const { contentType } = MEDIA[kind] ?? MEDIA.photo;
  const res = await fetch(`${API_ORIGIN}/upload?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body,
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json().catch(() => ({}));
  return json.url ?? json.downloadURL ?? null;
}

// ── Answer key, taken from the authored template (server-secret to players) ──
const TASKS = new Map();
for (const s of plan.stages ?? []) for (const t of s.tasks ?? []) TASKS.set(t.id, t);
/** Missions that park a team on a human. listRunTeams reports only a COUNT, not which. */
const PHOTO_TASK_IDS = [...TASKS.values()].filter((t) => t.type === 'photo').map((t) => t.id);

/** Complete whatever task the server just handed this team. Returns a short verb. */
async function actOnTask(team, ctx, rec, uid, here) {
  const t = TASKS.get(rec.taskId);
  if (!t) throw new Error(`assigned unknown task ${rec.taskId}`);
  const spot = here ?? (t.coordinates ? jitter(t.coordinates, 6) : { lat: 31.8, lng: 35.19 });
  const C = { ...ctx, taskId: t.id };

  // Arrival first where the mission demands presence — the server is the judge.
  if (t.geofenceRadiusMeters || t.triggerMode === 'radius' || t.triggerMode === 'exact') {
    try { await team.call('reportArrival', { ...C, lat: spot.lat, lng: spot.lng }); } catch { /* server decides */ }
  }

  switch (t.type) {
    case 'quiz': {
      if (Array.isArray(t.orderItems) && t.orderItems.length) {
        await team.call('submitTaskAnswer', { ...C, orderedAnswer: [...t.orderItems] });
        return 'quiz(order)';
      }
      if (Array.isArray(t.answers) && t.answers.length) {
        await team.call('submitTaskAnswer', { ...C, answer: t.answers[0] });
        return 'quiz';
      }
      if (Array.isArray(t.steps) && t.steps.length) {
        for (const [i, st] of t.steps.entries()) {
          await team.call('submitSequenceStep', { ...C, stepIndex: i, answer: st.answer });
        }
        return 'quiz(steps)';
      }
      throw new Error(`quiz "${t.title}" has no answer key the sim can satisfy`);
    }
    case 'numeric':
      await team.call('submitTaskAnswer', { ...C, answer: String(t.numericAnswer ?? 0) });
      return 'numeric';
    case 'sequence':
      for (const [i, st] of (t.steps ?? []).entries()) {
        await team.call('submitSequenceStep', { ...C, stepIndex: i, answer: st.answer });
      }
      return 'sequence';
    case 'smart_station': {
      const code = t.smart?.secretCode ?? t.secretCode;
      await team.call('verifyStationCode', { ...C, teamId: uid, code });
      return 'station';
    }
    case 'photo': {
      const kind = t.smart?.captureKind ?? 'photo';
      const { contentType, ext } = MEDIA[kind] ?? MEDIA.photo;
      let url = null;
      if (DO_UPLOADS) {
        url = await uploadMedia(team, `runs/${ctx.runId}/teams/${uid}/${t.id}.${ext}`, kind);
      }
      if (!url) throw new Error('photo mission requires an upload and none was produced');
      await team.call('submitStationPhoto', { ...C, teamId: uid, photoUrl: url, contentType });
      return `photo(${kind})`;
    }
    case 'survey':
      await team.call('submitTaskAnswer', { ...C, answer: 'sim' });
      return 'survey';
    default:
      await team.call('completeTask', { ...C, lat: spot.lat, lng: spot.lng });
      return t.type;
  }
}

// ── Abort guard, driven by the SERVER's own measured ops ─────────────────────
let aborted = false;
let abortReason = '';
function abortIfOverBudget(ops) {
  if (aborted || !ops) return;
  if (ops.reads >= SPARK_READS * ABORT_READ_FRACTION) {
    aborted = true; abortReason = `reads ${ops.reads} crossed ${(ABORT_READ_FRACTION * 100).toFixed(0)}% of ${SPARK_READS}`;
  } else if (ops.writes >= SPARK_WRITES * ABORT_WRITE_FRACTION) {
    aborted = true; abortReason = `writes ${ops.writes} crossed ${(ABORT_WRITE_FRACTION * 100).toFixed(0)}% of ${SPARK_WRITES}`;
  }
  if (aborted) console.log(`\n🛑 ABORTING: ${abortReason}\n`);
}

// ── One team's whole game ────────────────────────────────────────────────────
async function playTeam(team, uid, ctx, code, stats) {
  let lastFixAt = 0;
  /** The last fix this device actually SENT — what the client-side gate compares against. */
  let lastSentFix = null;
  // Each team starts scattered around the start, then walks the course.
  let pos = jitter(plan.center ?? { lat: 31.805, lng: 35.185 }, 120);
  for (let turn = 0; turn < MAX_TURNS && !aborted; turn++) {
    const state = await team.call('getMyTeamState', ctx);
    if (state?.team?.status === 'finished') return { finished: true, turns: turn };

    // ONLY the active stage. Flattening every stage picks up a record in a stage the
    // team has not reached, and the server rightly answers "This stage is not active
    // yet" — a harness bug that reads exactly like a product bug in the error tally.
    const activeStages = (state?.team?.stages ?? []).filter((s) => s.status === 'active');
    const recs = activeStages.flatMap((s) => s.tasks ?? []);
    const assigned = recs.find((t) => t.status === 'assigned');

    // Location pings ride alongside play, at the app's own cadence, walking toward
    // whatever mission this team currently holds.
    const now = Date.now();
    if (PING_INTERVAL_MS === 0 || now - lastFixAt >= PING_INTERVAL_MS) {
      lastFixAt = now;
      const target = assigned ? TASKS.get(assigned.taskId)?.coordinates : null;
      pos = walkToward(pos, target);
      // The device TAKES a fix every cadence, but only SENDS it when the shared verdict
      // says a write would happen, or once the safety floor has elapsed — mirroring
      // apps/play-web/src/lib/pingGate.ts. Fixes not sent cost nothing at all.
      const verdict = shouldWritePin({
        fix: { lat: pos.lat, lng: pos.lng, accuracyMeters: 12 },
        lastFix: lastSentFix, nowMs: now,
      });
      const floorElapsed = !lastSentFix || (now - lastSentFix.atMs) >= PING_SAFETY_FLOOR_MS;
      stats.fixesTaken++;
      if (verdict.write || floorElapsed) {
        lastSentFix = { lat: pos.lat, lng: pos.lng, atMs: now };
        stats.pingsSent++;
        try { await team.call('updateLocation', { ...ctx, lat: pos.lat, lng: pos.lng, accuracyMeters: 12 }); }
        catch { /* a ping is never worth failing a team over */ }
      }
    }
    const pending = recs.find((t) => t.status === 'pending_review');
    if (pending) { stats.awaitingReview++; await sleep(1500); continue; }
    if (!assigned) {
      const r = await team.call('requestNextTask', { ...ctx, lat: pos.lat, lng: pos.lng }).catch((e) => ({ error: e.code }));
      if (r?.reason) stats.holds.set(r.reason, (stats.holds.get(r.reason) ?? 0) + 1);
      await sleep(400);
      continue;
    }
    try {
      // The team walks the rest of the way before acting — the server judges arrival.
      const dest = TASKS.get(assigned.taskId)?.coordinates;
      if (dest) pos = jitter(dest, 5);
      const verb = await actOnTask(team, ctx, assigned, uid, pos);
      stats.acts.set(verb, (stats.acts.get(verb) ?? 0) + 1);
    } catch (e) {
      stats.actErrors.push(`${assigned.taskId}: ${e.code ?? e.message}`);
      await sleep(600);
    }
  }
  return { finished: false, turns: MAX_TURNS };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  const owner = makeParty('prod-sim-owner');
  if (!OWNER_TOKEN) { console.error('--owner-token=<custom token> is required.'); process.exit(2); }
  const ownerCred = await signInWithCustomToken(owner.auth, OWNER_TOKEN);
  const ownerUid = ownerCred.user.uid;
  console.log(`owner signed in: ${ownerUid}`);

  const gameId = plan.gameId;
  const { runId, accessCode } = await owner.call('launchRun', { gameId });
  const ctx = { ownerUid, gameId, runId };
  console.log(`run launched: game=${gameId} run=${runId} code=${accessCode}\n`);

  const stats = { acts: new Map(), holds: new Map(), actErrors: [], awaitingReview: 0, fixesTaken: 0, pingsSent: 0 };

  console.log(`joining ${TEAMS} teams…`);
  const joined = await pMap(Array.from({ length: TEAMS }, (_, i) => i), async (i) => {
    const p = makeParty(`prod-sim-team-${i}`);
    const cred = await signInAnonymously(p.auth);
    await p.call('joinRun', { code: accessCode, displayName: `SIM ${i + 1}` });
    return { p, uid: cred.user.uid };
  }, JOIN_CONCURRENCY);
  console.log(`joined ${joined.length} teams`);

  const started = await owner.call('startTeams', { gameId, runId });
  console.log(`startTeams launched=${started?.launched}\n`);

  // A reviewer loop, because two missions in this game need a human. Without it the
  // teams that draw a photo mission would stall and the run would look broken for a
  // reason that has nothing to do with capacity.
  const reviewer = (async () => {
    while (!aborted) {
      try {
        const rows = await owner.call('listRunTeams', { gameId, runId });
        const waiting = (rows?.teams ?? []).filter((t) => (t.pendingReviews ?? 0) > 0);
        if (!waiting.length) { await sleep(3000); continue; }
        for (const row of waiting) {
          for (const taskId of PHOTO_TASK_IDS) {
            try {
              await owner.call('reviewStationSubmission', {
                ...ctx, teamId: row.id, taskId, approved: true,
              });
            } catch { /* not this task, or already reviewed — the next pass retries */ }
          }
        }
      } catch { await sleep(3000); }
      await sleep(1200);
    }
  })();

  const results = await pMap(joined, ({ p, uid }) => playTeam(p, uid, ctx, accessCode, stats), PLAY_CONCURRENCY);
  aborted = true;
  await reviewer.catch(() => {});

  // ── Report ────────────────────────────────────────────────────────────────
  const finished = results.filter((r) => r?.finished).length;
  console.log(`\n══ RESULT ══`);
  console.log(`teams finished: ${finished}/${TEAMS}`);
  console.log(`wall time: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
  console.log(`callables invoked (client-side count): ${callCount}`);
  if (stats.fixesTaken) {
    const saved = ((1 - stats.pingsSent / stats.fixesTaken) * 100).toFixed(0);
    console.log(`location fixes: ${stats.pingsSent} sent of ${stats.fixesTaken} taken (${saved}% withheld by the client gate)`);
  }
  if (abortReason) console.log(`ABORTED: ${abortReason}`);

  console.log('\nactions completed:');
  for (const [k, v] of [...stats.acts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
  if (stats.holds.size) {
    console.log('\nwhy teams were held (routing reason):');
    for (const [k, v] of [...stats.holds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
  }
  if (errorTally.size) {
    console.log('\ncallable errors:');
    for (const [k, v] of [...errorTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(46)} ${v}`);
  }
  if (stats.actErrors.length) {
    console.log(`\nfirst mission-action errors (${stats.actErrors.length} total):`);
    for (const e of stats.actErrors.slice(0, 15)) console.log(`  ${e}`);
  }

  const rows = [...latency.entries()].map(([fn, arr]) => {
    const s = [...arr].sort((a, b) => a - b);
    return { fn, n: s.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
  }).sort((a, b) => b.n - a.n);
  console.log('\n── callable latency against PRODUCTION (ms) ──');
  for (const r of rows) {
    console.log(`  ${r.fn.padEnd(24)} n=${String(r.n).padStart(5)}  p50=${String(r.p50).padStart(5)}  p95=${String(r.p95).padStart(6)}  max=${String(r.max).padStart(6)}`);
  }

  console.log(`\nrun: game=${gameId} run=${runId} code=${accessCode}`);
  console.log('(the run and its teams remain in production — delete the SIM game when finished)');
  process.exit(finished === TEAMS && !abortReason ? 0 : 1);
}

main().catch((e) => { console.error('\n💥', e?.message ?? e); console.error(e); process.exit(1); });
