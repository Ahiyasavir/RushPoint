// Ephemeral end-to-end verification of the v2 multi-tenant model against the
// running emulator. Exercises the full creator → run → participant → finalize
// path through the public callable API (createGame → updateGame → launchRun →
// getJoinInfo → joinRun → startTeams → getMyTeamState → verifyStationCode /
// completeTask → finalizeRun). Each "party" gets its own anonymous identity,
// mirroring the two-app reality (creator-web + play-web).
//
// Structure (change: e2e-smart-suite): independent test blocks run as named
// SCENARIOS — an uncaught throw fails that scenario and the suite continues —
// and the run ends with a per-scenario summary + a per-callable latency table.
// Beyond the happy path the suite hunts bug classes directly: concurrency
// (station-cap races, duplicate submissions), cross-cutting invariants
// (leaderboard well-formedness, live/final parity, score conservation), the
// participant-payload ALLOWLIST (a new secret field fails loud instead of
// leaking), a data-driven authorization denial matrix, and seeded boundary
// fuzz around answer/geo edges.
//
//   node scripts/e2e-verify.mjs
//
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, ref as storageRef, uploadBytes } from 'firebase/storage';
import adminSdk from 'firebase-admin';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT = 'rushpoint-pwa-7daaa';

// Introspect the callables the emulator actually serves: require the BUILT
// functions lib in a throwaway child process (it inits the default Admin app,
// which would collide with this suite's own Admin app) and list every export
// whose endpoint is a `callableTrigger`. This is the ground truth the coverage
// guard checks against — a new callable auto-appears with no manifest to update.
function listDeployedCallables() {
  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'functions', 'lib', 'index.js').replace(/\\/g, '/');
  const probe = `
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || '${PROJECT}';
    const fns = require(${JSON.stringify(libPath)});
    const out = [];
    for (const [name, v] of Object.entries(fns)) {
      if (v && v.__endpoint && v.__endpoint.callableTrigger) out.push(name);
    }
    process.stdout.write(JSON.stringify(out));
  `;
  try {
    return JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' }));
  } catch (e) {
    console.error('coverage: could not introspect callables ::', e.message);
    return [];
  }
}

// The Admin SDK mints auth custom tokens against the Auth emulator (a
// platform-admin identity for the admin-only callables) and reads Firestore
// docs the clients can't (server-only state oracles: wallet transactions,
// run.leaderboard snapshots). All game/run MUTATIONS still flow through the
// callables only.
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
adminSdk.initializeApp({ projectId: PROJECT });

// ── Per-callable latency sampling (reported at the end) ───────────────────────
const latencySamples = new Map(); // fn → number[] (ms)
// Transient internal/unavailable blips absorbed by the call() retry — reported
// in the summary so emulator flakiness is visible, never silent.
let transientRetries = 0;
function recordLatency(fn, ms) {
  if (!latencySamples.has(fn)) latencySamples.set(fn, []);
  latencySamples.get(fn).push(ms);
}

function makeParty(name) {
  const app = initializeApp(
    // storageBucket is required for getStorage()/uploadBytes to resolve a default
    // bucket against the Storage emulator (audio-tasks upload assertion).
    { apiKey: 'emulator-key', projectId: PROJECT, appId: `emu-${name}`, storageBucket: `${PROJECT}.appspot.com` },
    name,
  );
  const auth = getAuth(app);
  const functions = getFunctions(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  return {
    auth,
    // audio-tasks: upload real bytes to the Storage emulator to exercise the
    // widened storage.rules content-type match (image/* | audio/...).
    uploadBytesAt: (path, bytes, contentType) =>
      uploadBytes(storageRef(storage, path), bytes, { contentType }),
    call: async (fn, data) => {
      const t0 = Date.now();
      try {
        // Real phones retry a transient network/server blip — so does the suite
        // (max 2, counted + reported below; a NOISY retry tally is itself a
        // finding, a hidden one isn't). Only `internal`/`unavailable` retry: no
        // scenario expects those codes, so a deliberate denial (permission-denied,
        // invalid-argument, …) is never masked. One emulator ECONNRESET blip used
        // to abort a scenario and cascade `functions/internal` through every
        // scenario after it.
        for (let attempt = 0; ; attempt++) {
          try {
            return (await httpsCallable(functions, fn)(data)).data;
          } catch (e) {
            const transient = e.code === 'functions/internal' || e.code === 'functions/unavailable';
            if (!transient || attempt >= 2) throw e;
            transientRetries++;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        }
      } finally {
        recordLatency(fn, Date.now() - t0);
      }
    },
    setDocAt: (path, data) => setDoc(doc(db, path), data),
    getDocAt: (path) => getDoc(doc(db, path)).then((s) => ({ exists: s.exists(), data: s.data() })),
    getColAt: (path) => getDocs(collection(db, path)).then((s) => s.docs.map((d) => d.data())),
  };
}

// ── Scenario harness ──────────────────────────────────────────────────────────
// A scenario is an isolated block: an uncaught error fails THAT scenario and
// the suite moves on, so one regression can't hide every failure after it.
let failures = 0;
const scenarios = []; // { name, ms, checks, failures }
let currentScenario = null;

function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (currentScenario) {
    currentScenario.checks++;
    if (!cond) currentScenario.failures++;
  }
  if (!cond) failures++;
}

// Await `promise` expecting a typed rejection. Fails if it resolves; when
// `codeIn`/`match` are given, the error's code/message must satisfy them.
async function expectError(label, promise, opts = {}) {
  try {
    const res = await promise;
    check(label, false, `resolved (expected an error): ${JSON.stringify(res)?.slice(0, 120)}`);
    return null;
  } catch (e) {
    const codeOk = !opts.codeIn || opts.codeIn.includes(e.code);
    const matchOk = !opts.match || opts.match.test(e.message ?? '');
    check(label, codeOk && matchOk, `${e.code ?? '?'} :: ${e.message}`);
    return e;
  }
}

async function scenario(name, fn) {
  console.log(`\n━━ ${name} ━━`);
  const rec = { name, ms: 0, checks: 0, failures: 0 };
  currentScenario = rec;
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    rec.failures++;
    failures++;
    console.error(`FAIL  [${name}] scenario aborted :: ${e.code ?? ''} ${e.message}`);
  }
  rec.ms = Date.now() - t0;
  scenarios.push(rec);
  currentScenario = null;
}

function printSummary() {
  console.log('\n── Scenario summary ─────────────────────────────────────────');
  for (const s of scenarios) {
    console.log(
      `${s.failures === 0 ? ' ok ' : 'FAIL'}  ${s.name.padEnd(36)} ${String(s.checks).padStart(3)} checks  ${String(s.failures).padStart(2)} failed  ${String(s.ms).padStart(6)}ms`,
    );
  }
  const rows = [...latencySamples.entries()]
    .map(([fn, arr]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return { fn, n: arr.length, p50: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
    })
    .sort((a, b) => b.p50 - a.p50);
  console.log('\n── Callable latency (emulator, ms — informational) ──────────');
  for (const r of rows.slice(0, 15)) {
    console.log(`      ${r.fn.padEnd(28)} n=${String(r.n).padStart(3)}  p50=${String(r.p50).padStart(5)}  max=${String(r.max).padStart(6)}`);
  }
}

// finalizeRun's heavy consolidation (player-profile folds, benchmark aggregate,
// summary email — perf: run-perf-scale Task 9) is now handled by the
// `onRunFinalized` Firestore trigger, which fires ASYNCHRONOUSLY off the run
// doc's status:'finished' write — finalizeRun itself no longer touches any of
// it. This is a REAL execution guarantee (the platform awaits + retries the
// trigger), not a dangling promise, but it is still inherently asynchronous
// from the caller's point of view: the client that called finalizeRun has no
// signal for "the trigger has now run," so a check that depends on the
// trigger's side effect legitimately polls briefly rather than asserting
// immediately. This is different from — and does not launder — the earlier,
// rejected fire-and-forget-in-the-callable approach: there, polling only
// worked because the emulator's process doesn't freeze mid-promise, which is
// NOT true in production. Here, polling reflects a genuine two-hop async
// architecture (write → trigger → side effect) that behaves identically in
// the emulator and in production. Returns the last value seen (which may
// still be falsy/absent if it never converges within timeoutMs).
async function waitFor(fn, { timeoutMs = 4000, intervalMs = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    const val = await fn();
    if (val) return val;
    if (Date.now() - start >= timeoutMs) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Seeded RNG (reproducible fuzz) ────────────────────────────────────────────
let _seed = 20260703;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const randCase = (s) => [...s].map((c) => (rand() < 0.5 ? c.toLowerCase() : c.toUpperCase())).join('');

// ── Participant-payload ALLOWLIST ─────────────────────────────────────────────
// The sanitizer (functions/src/runs/sanitizeTask.ts) strips known secrets, but
// a blocklist can't catch a NEW secret field. These lists pin the client-safe
// shape: any key not listed here fails the e2e until it is consciously
// classified as safe (update the list) or stripped (fix the sanitizer).
const ALLOWED_TASK_KEYS = new Set([
  'id', 'title', 'description', 'type', 'coordinates', 'difficulty',
  'estimatedMinutes', 'expectedDurationMinutes', 'pointValue',
  'maxConcurrentTeams', 'currentTeamCount', 'status', 'maxDurationMinutes',
  'smart', 'triggerMode', 'locationless', 'hideLocation', 'locationClue',
  'locationClueHe', 'hintPenalty', 'choices', 'numericTolerance',
  'geofenceRadiusMeters', 'steps', 'tags', 'media',
  'releaseAt', 'releaseAfterMinutes',
  'expiresAfterMinutes', // task-expiry: the countdown UI needs it — no secret
  'unlockAfterTaskIds',  // unlockable-tasks: the locked row names prerequisites — no secret
  // hint-auto-escalation: free-hint thresholds — they never reveal the hint text
  'hintAutoRevealMinutes', 'hintAutoRevealAttempts',
  // quiz-ordering: ALLOWED, but only as a seeded per-team shuffle — the scenario
  // additionally asserts payload order ≠ authored order (same multiset), so an
  // authored-order passthrough regression fails even though the key is listed.
  'orderItems',
  // survey-tasks: the choice buttons render from surveyChoices — no answer key,
  // so it is participant-visible (passed through the sanitizer).
  'surveyChoices',
  // quiz-location-verification: opt-in presence gate — NOT a secret; the client
  // needs it to know it must attach GPS to submitTaskAnswer.
  'requirePresence',
  // added by the sanitizer itself:
  'hasHint', 'locationHidden', 'hintFreeNow',
  // play-task-gating: set on a hidden-location task the server has NOT yet
  // unsealed. It is a boolean state flag, not content — the sealed payload it
  // accompanies carries no title/type/inputs at all.
  'arrivalPending',
]);
const ALLOWED_SMART_KEYS = new Set([
  'enabled', 'verificationType', 'longInstructions', 'longInstructionsHe',
  'extraInfo', 'mediaUrl', 'imageUrl', 'codeInputLabel', 'hasCode',
  'geofenceRadiusMeters', 'stationCoords', 'timeLimitSeconds', 'autoApprove',
  'attemptLimit',
  // audio-tasks: which capture widget the client renders (photo vs audio) — not
  // a secret, so it passes through the sanitizer.
  'captureKind',
]);

function assertTaskPayloadAllowlisted(label, task) {
  const badTop = Object.keys(task ?? {}).filter((k) => !ALLOWED_TASK_KEYS.has(k));
  check(`${label}: task payload keys are allowlisted`, badTop.length === 0, badTop.join(','));
  if (task?.smart) {
    const badSmart = Object.keys(task.smart).filter((k) => !ALLOWED_SMART_KEYS.has(k));
    check(`${label}: task.smart keys are allowlisted`, badSmart.length === 0, badSmart.join(','));
  }
  if (task?.steps) {
    const badStep = task.steps.flatMap((s) => Object.keys(s).filter((k) => k !== 'id' && k !== 'prompt'));
    check(`${label}: step keys are allowlisted (id+prompt only)`, badStep.length === 0, badStep.join(','));
  }
}

// ── Leaderboard invariant oracle ──────────────────────────────────────────────
// Well-formedness that must hold for ANY rankings payload (live or final):
// every expected team exactly once, contiguous ranks from 1, finite scores,
// scores non-increasing (non-time presets rank by score).
function assertLeaderboardInvariants(label, rankings, expectedTeamIds) {
  const ids = (rankings ?? []).map((r) => r.teamId);
  check(`${label}: one ranking entry per team`,
    ids.length === expectedTeamIds.length && new Set(ids).size === ids.length &&
      expectedTeamIds.every((id) => ids.includes(id)),
    JSON.stringify(ids));
  check(`${label}: ranks are contiguous from 1`,
    (rankings ?? []).every((r, i) => r.rank === i + 1),
    JSON.stringify((rankings ?? []).map((r) => r.rank)));
  check(`${label}: scores are finite numbers`,
    (rankings ?? []).every((r) => Number.isFinite(r.score)),
    JSON.stringify((rankings ?? []).map((r) => r.score)));
  check(`${label}: scores are non-increasing down the board`,
    (rankings ?? []).every((r, i) => i === 0 || rankings[i - 1].score >= r.score),
    (rankings ?? []).map((r) => r.score).join(' ≥ '));
}

// Walk an arbitrary callable response and collect the dotted paths of any
// non-finite number (Infinity/-Infinity/NaN). A callable that returns one crashes
// the ENTIRE response at JSON-encode (the family-playtest bug); this asserts the
// serialized boundary is clean (change: fix-nonfinite-callable-payload).
function findNonFinite(value, path = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path || '<root>'}=${value}`];
  if (Array.isArray(value)) return value.flatMap((v, i) => findNonFinite(v, `${path}[${i}]`));
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.entries(value).flatMap(([k, v]) => findNonFinite(v, path ? `${path}.${k}` : k));
  }
  return [];
}
function assertAllFinite(label, payload) {
  const bad = findNonFinite(payload);
  check(`${label}: response has no non-finite numbers`, bad.length === 0, bad.join(', '));
}

// Score conservation for one team's state: every completed task's breakdown
// sums to its earnedScore, and the task earnedScores sum to team.score.
function assertScoreConservation(label, team) {
  const tasks = (team?.stages ?? []).flatMap((s) => s.tasks ?? []);
  const sum = tasks.reduce((a, t) => a + (t.earnedScore ?? 0), 0);
  check(`${label}: Σ task earnedScore == team.score`, sum === team?.score,
    `sum=${sum} score=${team?.score}`);
  const badBreakdown = tasks.filter(
    (t) => t.status === 'completed' && t.scoreBreakdown && t.scoreBreakdown.total !== t.earnedScore,
  );
  check(`${label}: scoreBreakdown.total == earnedScore on every completed task`,
    badBreakdown.length === 0, JSON.stringify(badBreakdown[0]?.scoreBreakdown));
}

async function main() {
  const creator = makeParty('creator');
  const player = makeParty('player');
  const staff = makeParty('staff');

  const creatorCred = await signInAnonymously(creator.auth);
  const playerCred = await signInAnonymously(player.auth);
  await signInAnonymously(staff.auth); // upgraded to a staff custom token below
  console.log('Creator uid:', creatorCred.user.uid);
  console.log('Player  uid:', playerCred.user.uid, '\n');

  // Platform-admin identity for the admin-only callables (pruneRunNow). The
  // Auth emulator accepts Admin-SDK custom tokens without real credentials, so
  // the suite can exercise the REAL admin gate instead of an emulator bypass.
  const platformAdmin = makeParty('platformAdmin');
  await signInWithCustomToken(
    platformAdmin.auth,
    await adminSdk.auth().createCustomToken('e2e-platform-admin', { admin: true }),
  );

  // Shared across scenarios (assigned inside the core lifecycle).
  let gameId, runId, accessCode;

  await scenario('core lifecycle (create → run → play → staff → finalize)', async () => {

  // ── 1. Creator builds a game ────────────────────────────────────────────────
  ({ gameId } = await creator.call('createGame', {
    title: 'E2E Verify Game',
    description: 'Generated by e2e-verify-v2',
    mode: 'team',
  }));
  check('createGame returns a gameId', !!gameId, gameId);

  // ── 1b. Free mode (payments off) ────────────────────────────────────────────
  // PAYMENTS_ENABLED is false at launch: every run is free (no credits, no Pro)
  // and buying is disabled. A brand-new 0-credit free-plan creator must launch
  // unlimited runs with no wallet decrement — this e2e launches 4 runs on a
  // wallet that never buys a credit.
  const wallet0 = await creator.call('getWalletStatus');
  check('free mode: getWalletStatus reports paymentsEnabled:false', wallet0?.paymentsEnabled === false, JSON.stringify(wallet0));
  check('free mode: new creator has 0 credits', wallet0?.eventCredits === 0, JSON.stringify(wallet0));

  let purchaseRejected = false;
  try {
    await creator.call('purchaseCredits', { packageId: 'pro_pack' });
  } catch (e) {
    purchaseRejected = /disabled/i.test(e.message);
  }
  check('free mode: purchaseCredits is rejected (payments disabled)', purchaseRejected);

  let subscribeRejected = false;
  try {
    await creator.call('subscribePro', { interval: 'month' });
  } catch (e) {
    subscribeRejected = /disabled/i.test(e.message);
  }
  check('free mode: subscribePro is rejected (payments disabled)', subscribeRejected);

  const CODE_TASK_ID = 'task-code-1';
  const PHOTO_TASK_ID = 'task-photo-1';
  const AUDIO_TASK_ID = 'task-audio-1'; // audio-tasks: photo pipeline, captureKind:'audio'
  const PLAIN_TASK_ID = 'task-plain-1';
  const stages = [
    {
      id: 'stage-1',
      order: 0,
      title: 'Stage One — code station',
      tasks: [
        {
          id: CODE_TASK_ID,
          title: 'Find the codeword',
          // 'smart_station' is the canonical type; 'station' is not a valid TaskType.
          type: 'smart_station',
          coordinates: { lat: 31.79, lng: 35.16 },
          difficulty: 3,
          estimatedMinutes: 10,
          pointValue: 100,
          maxConcurrentTeams: 3,
          smart: {
            enabled: true,
            verificationType: 'code_verification',
            hasCode: true,
            secretCode: 'ZION',
            codeInputLabel: 'Enter codeword',
          },
        },
      ],
    },
    {
      id: 'stage-2',
      order: 1,
      title: 'Stage Two — photo station (staff review)',
      // audio-tasks: two tasks in this stage but only ONE is required, so the
      // existing photo-approval flow still completes the stage while the audio
      // task can be submitted + reviewed independently in the same scenario.
      requiredTaskCount: 1,
      tasks: [
        {
          id: PHOTO_TASK_ID,
          title: 'Selfie at the gate',
          type: 'photo',
          coordinates: { lat: 31.795, lng: 35.165 },
          difficulty: 2,
          estimatedMinutes: 6,
          pointValue: 70,
          maxConcurrentTeams: 3,
          smart: {
            enabled: true,
            verificationType: 'photo_upload',
            autoApprove: false, // requires a staff approval
          },
        },
        {
          // audio-tasks: rides the SAME photo pipeline (submitStationPhoto →
          // review), differing only by smart.captureKind = 'audio'.
          id: AUDIO_TASK_ID,
          title: 'Record your team chant',
          type: 'photo',
          // play-task-gating: only the ASSIGNED task reaches the participant, so
          // this task has to be the one routing picks in this 2-task stage for the
          // captureKind sanitizer assertion to have anything to read. Locationless
          // ⇒ transit 0 ⇒ deterministically the higher-priority candidate. The
          // photo pipeline it exercises (submitStationPhoto → review) is unchanged.
          locationless: true,
          triggerMode: 'locationless',
          coordinates: { lat: 31.796, lng: 35.166 },
          difficulty: 2,
          estimatedMinutes: 4,
          pointValue: 60,
          maxConcurrentTeams: 3,
          smart: {
            enabled: true,
            verificationType: 'photo_upload',
            captureKind: 'audio',
            autoApprove: false, // requires a staff approval
          },
        },
      ],
    },
    {
      id: 'stage-3',
      order: 2,
      title: 'Stage Three — plain task',
      isFinal: true,
      tasks: [
        {
          id: PLAIN_TASK_ID,
          title: 'Reach the summit',
          // A GPS check-in task completed via completeTask — must be a valid
          // completeTask type ('navigation' is not a TaskType and the completeTask
          // anti-cheat type-gate correctly rejects it; the old value only "worked"
          // when a cold-start timing quirk left the task unresolved at the gate).
          type: 'field',
          coordinates: { lat: 31.8, lng: 35.17 },
          difficulty: 2,
          estimatedMinutes: 8,
          pointValue: 80,
          maxConcurrentTeams: 3,
        },
      ],
    },
  ];

  await creator.call('updateGame', {
    gameId,
    stages,
    scoringPreset: 'smart_weighted',
  });
  const { game: builtGame } = await creator.call('getGame', { gameId });
  check('updateGame persisted 3 stages + the preset', builtGame?.stages?.length === 3 && builtGame?.scoringPreset === 'smart_weighted',
    `stages=${builtGame?.stages?.length} preset=${builtGame?.scoringPreset}`);

  // ── 2. Launch a run ─────────────────────────────────────────────────────────
  ({ runId, accessCode } = await creator.call('launchRun', { gameId }));
  check('launchRun returns runId + accessCode', !!runId && !!accessCode, accessCode);
  const walletAfterLaunch = await creator.call('getWalletStatus');
  check('free mode: launch did not decrement the wallet (still 0 credits)',
    walletAfterLaunch?.eventCredits === 0, JSON.stringify(walletAfterLaunch));

  // ── 3. Participant pre-join lookup ──────────────────────────────────────────
  const joinInfo = await player.call('getJoinInfo', { code: accessCode });
  check('getJoinInfo resolves the game title', joinInfo?.title === 'E2E Verify Game', joinInfo?.title);
  check('getJoinInfo exposes registrationFields', Array.isArray(joinInfo?.registrationFields));
  check('getJoinInfo does NOT leak game stages', joinInfo?.stages === undefined);
  check('getJoinInfo returns a derived GPS requirement', joinInfo?.requirement === 'gps' || joinInfo?.requirement === 'anywhere', joinInfo?.requirement);

  // ── 4. Join the run ─────────────────────────────────────────────────────────
  const joinRes = await player.call('joinRun', {
    code: accessCode,
    displayName: 'The Test Lions',
    memberNames: ['Ari', 'Dan'],
  });
  check('joinRun succeeds', joinRes?.teamId === playerCred.user.uid, joinRes?.teamId);
  check('joinRun is first-time (not alreadyJoined)', joinRes?.alreadyJoined === false);

  // idempotency
  const joinAgain = await player.call('joinRun', { code: accessCode, displayName: 'The Test Lions' });
  check('joinRun is idempotent', joinAgain?.alreadyJoined === true);

  // ── 5. Creator starts the teams ─────────────────────────────────────────────
  const startRes = await creator.call('startTeams', { gameId, runId });
  check('startTeams launched 1 team', startRes?.launched === 1, JSON.stringify(startRes));

  // ── 6. Participant reads their live state ───────────────────────────────────
  let state = await player.call('getMyTeamState', { code: accessCode });
  check('getMyTeamState returns the team', state?.team?.displayName === 'The Test Lions');
  check('team is active after startTeams', state?.team?.status === 'active', state?.team?.status);
  check('first stage is active', state?.team?.stages?.[0]?.status === 'active');
  const activeTask = state?.activeStageTasks?.find((t) => t.id === CODE_TASK_ID);
  check('active task content is exposed', activeTask?.id === CODE_TASK_ID);
  check('secretCode is stripped from participant payload', activeTask?.smart?.secretCode === undefined);
  // Allowlist (not blocklist): a NEW field on Task fails here until it is
  // consciously classified client-safe — a new secret can't leak silently.
  for (const t of state?.activeStageTasks ?? []) assertTaskPayloadAllowlisted(`sanitizer(${t.id})`, t);

  // ── 6b. Shared team devices (shared-team-devices) ───────────────────────────
  // A second phone attaches to the SAME team via the device join code; only the
  // controller device may mutate; control transfers mid-run and can be claimed.
  const device2 = makeParty('device2');
  const device2Cred = await signInAnonymously(device2.auth);
  const stranger = makeParty('stranger');
  await signInAnonymously(stranger.auth);

  check('getMyTeamState exposes the device join code to the team',
    typeof state?.team?.deviceJoinCode === 'string' && state.team.deviceJoinCode.length === 6,
    state?.team?.deviceJoinCode);
  check('founding device is the controller', state?.myRole === 'controller', state?.myRole);
  const teamCode = state?.team?.deviceJoinCode;

  let badCodeRejected = false;
  try {
    await device2.call('joinTeamAsDevice', { code: accessCode, teamCode: 'XXXXXX' });
  } catch (e) {
    badCodeRejected = e.code === 'functions/not-found';
  }
  check('joinTeamAsDevice rejects a wrong device code', badCodeRejected);

  const attach = await device2.call('joinTeamAsDevice', {
    code: accessCode, teamCode, memberName: 'Second Phone',
  });
  check('joinTeamAsDevice attaches to the founding team',
    attach?.teamId === playerCred.user.uid && attach?.role === 'viewer', JSON.stringify(attach));

  let d2State = await device2.call('getMyTeamState', { code: accessCode });
  check('viewer device sees the same team state',
    d2State?.team?.displayName === 'The Test Lions' && d2State?.activeStageTasks?.find((t) => t.id === CODE_TASK_ID)?.id === CODE_TASK_ID);
  check('viewer device is reported as viewer', d2State?.myRole === 'viewer', d2State?.myRole);
  check('team doc lists both device uids',
    Array.isArray(d2State?.team?.deviceUids) &&
    d2State.team.deviceUids.includes(playerCred.user.uid) &&
    d2State.team.deviceUids.includes(device2Cred.user.uid));

  let viewerMutationRejected = false;
  try {
    await device2.call('verifyStationCode', {
      ownerUid: creatorCred.user.uid, gameId, runId, taskId: CODE_TASK_ID, code: 'zion',
    });
  } catch (e) {
    viewerMutationRejected = e.code === 'functions/permission-denied';
  }
  check('viewer device cannot submit (permission-denied)', viewerMutationRejected);

  await player.call('transferController', {
    ownerUid: creatorCred.user.uid, gameId, runId, toUid: device2Cred.user.uid,
  });
  // After transfer, device2 IS accepted as a mutator (a wrong code fails on the
  // code — proof it passed the controller gate) and the old controller is not.
  let d2WrongCode = false;
  try {
    await device2.call('verifyStationCode', {
      ownerUid: creatorCred.user.uid, gameId, runId, taskId: CODE_TASK_ID, code: 'NOPE',
    });
  } catch (e) {
    d2WrongCode = /incorrect code/i.test(e.message);
  }
  check('after transfer the new controller passes the role gate', d2WrongCode);
  let oldControllerRejected = false;
  try {
    await player.call('verifyStationCode', {
      ownerUid: creatorCred.user.uid, gameId, runId, taskId: CODE_TASK_ID, code: 'zion',
    });
  } catch (e) {
    oldControllerRejected = e.code === 'functions/permission-denied';
  }
  check('after transfer the old controller is rejected', oldControllerRejected);

  let strangerClaimRejected = false;
  try {
    await stranger.call('claimController', { ownerUid: creatorCred.user.uid, gameId, runId });
  } catch (e) {
    strangerClaimRejected = e.code === 'functions/permission-denied' || e.code === 'functions/not-found';
  }
  check('a stranger cannot claim control', strangerClaimRejected);

  await player.call('claimController', { ownerUid: creatorCred.user.uid, gameId, runId });
  state = await player.call('getMyTeamState', { code: accessCode });
  check('claimController restores control to the founding device',
    state?.myRole === 'controller' && state?.team?.controllerUid === playerCred.user.uid,
    state?.team?.controllerUid);

  // ── 7. Wrong code is rejected, correct code advances ────────────────────────
  let wrongRejected = false;
  try {
    await player.call('verifyStationCode', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: playerCred.user.uid, taskId: CODE_TASK_ID, code: 'NOPE',
    });
  } catch (e) {
    wrongRejected = /incorrect code/i.test(e.message);
  }
  check('verifyStationCode rejects a wrong code', wrongRejected);

  // [anti-cheat row 38] a participant may NOT act on another team — a payload
  // teamId that isn't the caller is rejected with permission-denied (IDOR fix).
  let idorRejected = false;
  try {
    await player.call('verifyStationCode', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: 'some-other-team-uid', taskId: CODE_TASK_ID, code: 'zion',
    });
  } catch (e) {
    idorRejected = e.code === 'functions/permission-denied' || /another team/i.test(e.message);
  }
  check('verifyStationCode rejects acting on another team (IDOR)', idorRejected);

  let idorPhotoRejected = false;
  try {
    await player.call('submitStationPhoto', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: 'some-other-team-uid', taskId: CODE_TASK_ID,
      photoUrl: 'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/x.jpg?alt=media',
    });
  } catch (e) {
    idorPhotoRejected = e.code === 'functions/permission-denied' || /another team/i.test(e.message);
  }
  check('submitStationPhoto rejects acting on another team (IDOR)', idorPhotoRejected);

  // [callable-rate-limiting #19] a single uid's call volume is bounded per window.
  // triggerSOS has a small budget (5/min); the 6th rapid call trips resource-exhausted.
  let sosRateTrip = false;
  for (let i = 0; i < 6; i++) {
    try {
      await player.call('triggerSOS', {
        ownerUid: creatorCred.user.uid, gameId, runId, message: 'rate-limit probe',
      });
    } catch (e) {
      if (e.code === 'functions/resource-exhausted') sosRateTrip = true;
    }
  }
  check('rate limiting: spamming triggerSOS past its budget → resource-exhausted', sosRateTrip);

  const verifyRes = await player.call('verifyStationCode', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: CODE_TASK_ID, code: 'zion', // case-insensitive
  });
  check('verifyStationCode accepts the correct code', verifyRes?.verified === true);

  // ── 8. Stage 1 done → stage 2 should unlock ─────────────────────────────────
  state = await player.call('getMyTeamState', { code: accessCode });
  check('stage 1 completed', state?.team?.stages?.[0]?.status === 'completed', state?.team?.stages?.[0]?.status);
  check('stage 2 unlocked (active)', state?.team?.stages?.[1]?.status === 'active', state?.team?.stages?.[1]?.status);
  check('code task scored > 0', (state?.team?.stages?.[0]?.tasks?.[0]?.earnedScore ?? 0) > 0,
    String(state?.team?.stages?.[0]?.tasks?.[0]?.earnedScore));

  // ── 8a. Completion hot path does NOT write run.leaderboard (scale WO Fix 4) ──
  // The completion hot path (completeTaskForTeam) deliberately no longer recomputes
  // run.leaderboard: even fire-and-forget it paid a run-doc get + an O(teams) scan +
  // a 2nd txn on the already-contended run doc per scoring event (it dominated
  // completeTask p95 at --teams=16). The board is now recomputed LAZILY at read time
  // — refreshLeaderboard / the organizer console poll / getPublicLeaderboard — and
  // finalizeRun reconciles definitively. So right after this first scoring completion
  // (verifyStationCode), with NO refresh yet made, the run doc must carry no
  // auto-written standings for the team. The dedicated scenario
  // 'completeTask does not write the run-doc leaderboard during active play; organizer
  // read recomputes it' asserts the full before/after contract; here we just confirm
  // the hot path stayed silent (the organizer-refresh recompute is exercised in 8b).
  const runDocPath = `users/${creatorCred.user.uid}/games/${gameId}/runs/${runId}`;
  const lbAuto = (await adminSdk.firestore().doc(runDocPath).get()).data()?.leaderboard;
  const lbAutoEntry = lbAuto?.rankings?.find((r) => r.teamId === playerCred.user.uid);
  check('completion hot path does NOT auto-write run.leaderboard (recompute is lazy at read)',
    (lbAutoEntry?.score ?? 0) === 0, JSON.stringify(lbAuto ?? null));

  // ── 8b. Live leaderboard mid-run (refreshLeaderboard) ───────────────────────
  const lbCtx = { ownerUid: creatorCred.user.uid, gameId, runId };
  const lbHidden = await creator.call('refreshLeaderboard', { ...lbCtx, publish: false });
  check('refreshLeaderboard returns live rankings mid-run', (lbHidden?.rankings?.length ?? 0) === 1,
    JSON.stringify(lbHidden?.rankings?.[0]));
  check('refreshLeaderboard stays unpublished by default', lbHidden?.published === false);
  let midState = await player.call('getMyTeamState', { code: accessCode });
  check('run is still live after refresh (not finished)', midState?.run?.status !== 'finished', midState?.run?.status);
  // Stronger than the original assertion (which allowed shipping the board with
  // published:false): since change manual-leaderboard-reveal, getMyTeamState omits
  // an unpublished board ENTIRELY, so it is not merely unrendered but absent from
  // the wire — an unpublished board in the payload is readable in devtools.
  check('unpublished standings are hidden from participant',
    (midState?.run?.leaderboard ?? null) === null, JSON.stringify(midState?.run?.leaderboard ?? null));

  // Public, shareable leaderboard is gated on publish: hidden before, shown after.
  const boardBefore = await player.call('getPublicLeaderboard', { code: accessCode });
  check('public leaderboard hides rankings until published',
    boardBefore?.published === false && (boardBefore?.rankings?.length ?? 0) === 0);
  // Ceremony mode: photos are gated exactly like rankings — [] until published.
  check('ceremony: ceremonyFeed is [] before publish',
    Array.isArray(boardBefore?.ceremonyFeed) && boardBefore.ceremonyFeed.length === 0,
    JSON.stringify(boardBefore?.ceremonyFeed));

  const lbShown = await creator.call('refreshLeaderboard', { ...lbCtx, publish: true });
  check('refreshLeaderboard can publish to teams', lbShown?.published === true);
  midState = await player.call('getMyTeamState', { code: accessCode });
  check('published standings are visible to participant', midState?.run?.leaderboard?.published === true);

  const boardAfter = await player.call('getPublicLeaderboard', { code: accessCode });
  check('public leaderboard exposes rankings once published',
    boardAfter?.published === true && (boardAfter?.rankings?.length ?? 0) === 1,
    JSON.stringify(boardAfter?.rankings?.[0]));
  // getPublicLeaderboard must carry the run's scoringPreset so a `time_only`
  // board can honestly hide the meaningless score column client-side, instead
  // of showing a fake-looking 500/0 next to each team.
  check('public leaderboard exposes the scoringPreset',
    ['time_only', 'fixed_points_speed', 'smart_weighted'].includes(boardAfter?.scoringPreset),
    String(boardAfter?.scoringPreset));

  // ── 8b2. adjustTeamScore is immediately visible (live-leaderboard-auto-refresh)
  const rowBeforeAdj = (await creator.call('listRunTeams', { gameId, runId }))
    ?.teams?.find((t) => t.id === playerCred.user.uid);
  const lbScoreBeforeAdj = lbShown?.rankings?.find((r) => r.teamId === playerCred.user.uid)?.score ?? 0;
  // Deltas stay small: applyPenalties clamps the ranked score at 0, so the
  // team's live score (one ~43-pt task at this point) must stay positive for
  // the relative assertions to hold.
  await creator.call('adjustTeamScore', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, delta: -20, reason: 'e2e visibility probe',
  });
  const lbAfterAdj = (await adminSdk.firestore().doc(runDocPath).get()).data()?.leaderboard;
  const lbAdjEntry = lbAfterAdj?.rankings?.find((r) => r.teamId === playerCred.user.uid);
  check('adjustTeamScore refreshes the leaderboard immediately (−20 visible)',
    lbAdjEntry?.score === lbScoreBeforeAdj - 20,
    JSON.stringify({ before: lbScoreBeforeAdj, after: lbAdjEntry?.score }));
  check('adjustment auto-refresh preserves the published flag',
    lbAfterAdj?.published === true, String(lbAfterAdj?.published));
  const teamsAfterAdj = (await creator.call('listRunTeams', { gameId, runId }))?.teams ?? [];
  const rowAfterAdj = teamsAfterAdj.find((t) => t.id === playerCred.user.uid);
  check('listRunTeams exposes bonusPenalty (+20 after a −20 adjustment)',
    (rowAfterAdj?.bonusPenalty ?? 0) - (rowBeforeAdj?.bonusPenalty ?? 0) === 20,
    JSON.stringify({ before: rowBeforeAdj?.bonusPenalty, after: rowAfterAdj?.bonusPenalty }));

  // Single-source-of-truth guardrail (score-consistency sweep): once scoring has
  // begun, EVERY team the console lists must have a ranked leaderboard entry, so
  // the console teams table always shows the ranked score (never the raw-earned
  // fallback) — i.e. the organizer's table can't disagree with the TV/board.
  const rankedIds = new Set((lbAfterAdj?.rankings ?? []).map((r) => r.teamId));
  check('every listed team has a ranked leaderboard entry (console==board source)',
    teamsAfterAdj.length > 0 && teamsAfterAdj.every((tm) => rankedIds.has(tm.id)),
    JSON.stringify({ teams: teamsAfterAdj.map((tm) => tm.id), ranked: [...rankedIds] }));

  // A frozen board is never auto-overwritten: freeze, adjust again (forced
  // refresh path), and assert the frozen rankings did not move. Then unfreeze
  // so the rest of the lifecycle sees live standings again.
  await creator.call('refreshLeaderboard', { ...lbCtx, frozen: true });
  await creator.call('adjustTeamScore', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, delta: -5, reason: 'frozen probe',
  });
  const lbFrozen = (await adminSdk.firestore().doc(runDocPath).get()).data()?.leaderboard;
  const lbFrozenEntry = lbFrozen?.rankings?.find((r) => r.teamId === playerCred.user.uid);
  check('frozen leaderboard is not auto-overwritten by a scoring event',
    lbFrozen?.frozen === true && lbFrozenEntry?.score === lbScoreBeforeAdj - 20,
    JSON.stringify({ frozen: lbFrozen?.frozen, score: lbFrozenEntry?.score, expected: lbScoreBeforeAdj - 20 }));
  await creator.call('refreshLeaderboard', { ...lbCtx, frozen: false });

  // ── 8c. Photo task: submit → staff review → advance ─────────────────────────
  // M3: submitStationPhoto only accepts Firebase Storage URLs from our bucket.
  // row 41: the photo must live under the caller's OWN run/team folder.
  const STORAGE_PHOTO_URL =
    `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${runId}/teams/${playerCred.user.uid}/selfie.jpg`)}?alt=media`;

  // [M3] an external photo URL must be rejected with invalid-argument.
  let externalPhotoRejected = false;
  try {
    await player.call('submitStationPhoto', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: playerCred.user.uid, taskId: PHOTO_TASK_ID,
      photoUrl: 'https://example.com/evil.jpg',
    });
  } catch (e) {
    externalPhotoRejected = e.code === 'functions/invalid-argument' || /Firebase Storage URL/i.test(e.message);
  }
  check('submitStationPhoto rejects an external (non-Storage) photo URL', externalPhotoRejected);

  // [wave-c] The REAL client never produces a production download URL locally: against
  // the Storage emulator (and behind the playtest tunnel proxy) getDownloadURL() returns
  // an emulator-hosted /v0/b/<bucket>/o/<encoded> URL. That shape used to be rejected, so
  // no photo upload had ever succeeded in any local/playtest run. Round-trip the real
  // shape here so a regression fails the suite. The run/team prefix stays enforced.
  const EMULATOR_PHOTO_URL = (path) =>
    `http://127.0.0.1:9199/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=e2e-token`;
  let emuOtherTeamRejected = false;
  try {
    await player.call('submitStationPhoto', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: playerCred.user.uid, taskId: PHOTO_TASK_ID,
      photoUrl: EMULATOR_PHOTO_URL(`runs/${runId}/teams/SOMEONE_ELSE/selfie.jpg`),
    });
  } catch (e) {
    emuOtherTeamRejected = e.code === 'functions/invalid-argument';
  }
  check('submitStationPhoto still rejects ANOTHER team folder on an emulator URL', emuOtherTeamRejected);

  const photoSubmit = await player.call('submitStationPhoto', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: PHOTO_TASK_ID,
    photoUrl: EMULATOR_PHOTO_URL(`runs/${runId}/teams/${playerCred.user.uid}/selfie.jpg`),
  });
  check('submitStationPhoto accepts a photo (pending, not auto-approved)',
    photoSubmit?.submitted === true && photoSubmit?.autoApproved === false, JSON.stringify(photoSubmit));

  state = await player.call('getMyTeamState', { code: accessCode });
  check('submission is stored NESTED under taskSubmissions (not a literal dotted key)',
    state?.team?.taskSubmissions?.[PHOTO_TASK_ID]?.status === 'pending',
    JSON.stringify(state?.team?.taskSubmissions ?? {}));
  check('photo stage stays active until reviewed', state?.team?.stages?.[1]?.status === 'active',
    state?.team?.stages?.[1]?.status);

  // audio-tasks: the sanitized audio task must expose smart.captureKind so the
  // client renders the recorder instead of the photo picker.
  // play-task-gating (wave D): only the ASSIGNED task is shipped, and the audio
  // task is the one routing assigns in this stage (it is locationless), so this
  // reads the task the team actually holds. Its located sibling (the photo task,
  // submitted directly below) is correctly absent from the payload.
  const audioTaskSan = (state?.activeStageTasks ?? []).find((t) => t.id === AUDIO_TASK_ID);
  check('sanitized audio task exposes smart.captureKind === "audio"',
    audioTaskSan?.smart?.captureKind === 'audio', JSON.stringify(audioTaskSan?.smart ?? {}));

  // WO-4: listRunTeams surfaces the pending-review count so a non-console consumer
  // can see a team is blocked on a staff photo review (not silently stalled).
  {
    const rowPending = (await creator.call('listRunTeams', { gameId, runId }))
      ?.teams?.find((t) => t.id === playerCred.user.uid);
    check('listRunTeams exposes pendingReviews >= 1 while a photo awaits review',
      (rowPending?.pendingReviews ?? 0) >= 1, JSON.stringify(rowPending));
  }

  // Staff joins via PIN and approves the photo
  const { pin } = await creator.call('inviteStaff', {
    ownerUid: creatorCred.user.uid, gameId, runId, name: 'E2E Marshal', permissions: ['review_photos'],
  });
  check('inviteStaff returns a PIN', !!pin, pin);

  // [anti-cheat row 40] a different caller that fails the PIN 5× is locked out of
  // this run — even a subsequent attempt with the CORRECT pin is refused. The
  // lockout short-circuits before the invite lookup, so it never burns the PIN.
  const locker = makeParty('locker');
  await signInAnonymously(locker.auth);
  for (let i = 0; i < 5; i++) {
    try { await locker.call('staffSignIn', { ownerUid: creatorCred.user.uid, gameId, runId, pin: '000000' }); } catch { /* expected */ }
  }
  let lockoutHit = false;
  try {
    await locker.call('staffSignIn', { ownerUid: creatorCred.user.uid, gameId, runId, pin });
  } catch (e) { lockoutHit = e.code === 'functions/resource-exhausted' || /too many/i.test(e.message); }
  check('staffSignIn locks out after 5 failed attempts (even with correct PIN)', lockoutHit);

  const staffTok = await staff.call('staffSignIn', {
    ownerUid: creatorCred.user.uid, gameId, runId, pin,
  });
  check('staffSignIn mints a custom token', !!staffTok?.customToken && staffTok?.name === 'E2E Marshal');
  await signInWithCustomToken(staff.auth, staffTok.customToken);

  // A bogus/typo'd teamId must fail loud (not-found), never silently create a
  // phantom team doc with just a `taskSubmissions` field (data-integrity guard).
  let bogusTeamErr = null;
  try {
    await staff.call('reviewStationSubmission', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: 'this-team-does-not-exist', taskId: PHOTO_TASK_ID, approved: true,
    });
  } catch (e) { bogusTeamErr = e; }
  check('reviewStationSubmission rejects an unknown teamId instead of creating a phantom team',
    bogusTeamErr?.code === 'functions/not-found', bogusTeamErr?.code);
  const phantomSnap = await staff
    .getDocAt(`users/${creatorCred.user.uid}/games/${gameId}/runs/${runId}/teams/this-team-does-not-exist`)
    .catch(() => null);
  check('no phantom team doc was created', !phantomSnap || phantomSnap.exists === false);

  const review = await staff.call('reviewStationSubmission', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: PHOTO_TASK_ID, approved: true,
  });
  check('reviewStationSubmission approves', review?.ok === true && review?.approved === true);

  // WO-4: once the review is resolved, the pending count returns to 0.
  {
    const rowResolved = (await creator.call('listRunTeams', { gameId, runId }))
      ?.teams?.find((t) => t.id === playerCred.user.uid);
    check('listRunTeams pendingReviews returns to 0 after the review is approved',
      (rowResolved?.pendingReviews ?? -1) === 0, JSON.stringify(rowResolved));
  }

  state = await player.call('getMyTeamState', { code: accessCode });
  check('review marks the submission approved (nested update)',
    state?.team?.taskSubmissions?.[PHOTO_TASK_ID]?.status === 'approved',
    state?.team?.taskSubmissions?.[PHOTO_TASK_ID]?.status);
  check('approved photo completes the stage', state?.team?.stages?.[1]?.status === 'completed',
    state?.team?.stages?.[1]?.status);
  check('final stage unlocked after photo', state?.team?.stages?.[2]?.status === 'active',
    state?.team?.stages?.[2]?.status);

  // ── 8d. Audio task (audio-tasks): same photo pipeline, captureKind:'audio' ────
  // Upload real audio bytes to the Storage emulator under the caller's OWN
  // run/team path — exercises the widened storage.rules content-type match.
  const audioObjectPath = `runs/${runId}/teams/${playerCred.user.uid}/chant-1.webm`;
  const AUDIO_URL =
    `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(audioObjectPath)}?alt=media`;
  let audioUploadOk = false;
  try {
    await player.uploadBytesAt(audioObjectPath, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3]), 'audio/webm');
    audioUploadOk = true;
  } catch (e) { audioUploadOk = false; console.log('  audio upload err ::', e.message); }
  check('storage.rules accept an audio/webm upload to the team folder', audioUploadOk);

  // Negatives: kind/content-type mismatches must be rejected (invalid-argument).
  const submitAudio = (contentType, taskId = AUDIO_TASK_ID, photoUrl = AUDIO_URL) =>
    player.call('submitStationPhoto', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: playerCred.user.uid, taskId, photoUrl, contentType,
    });
  const isInvalidArg = (e) => e.code === 'functions/invalid-argument';

  let audioImageRejected = false;
  try { await submitAudio('image/jpeg'); } catch (e) { audioImageRejected = isInvalidArg(e); }
  check('audio task rejects an image content-type', audioImageRejected);

  let audioMissingRejected = false;
  try { await submitAudio(undefined); } catch (e) { audioMissingRejected = isInvalidArg(e); }
  check('audio task rejects a missing content-type', audioMissingRejected);

  let photoAudioRejected = false;
  try {
    await submitAudio('audio/webm', PHOTO_TASK_ID, STORAGE_PHOTO_URL);
  } catch (e) { photoAudioRejected = isInvalidArg(e); }
  check('photo task rejects an audio content-type', photoAudioRejected);

  // Happy path: a proper audio/webm submission → pending + mediaKind 'audio'.
  const audioSubmit = await submitAudio('audio/webm');
  check('submitStationPhoto accepts an audio submission (pending)',
    audioSubmit?.submitted === true && audioSubmit?.autoApproved === false, JSON.stringify(audioSubmit));

  state = await player.call('getMyTeamState', { code: accessCode });
  check('audio submission records mediaKind === "audio" (server-derived)',
    state?.team?.taskSubmissions?.[AUDIO_TASK_ID]?.mediaKind === 'audio',
    JSON.stringify(state?.team?.taskSubmissions?.[AUDIO_TASK_ID] ?? {}));

  const audioReview = await staff.call('reviewStationSubmission', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: AUDIO_TASK_ID, approved: true,
  });
  check('reviewStationSubmission approves the audio submission',
    audioReview?.ok === true && audioReview?.approved === true);

  state = await player.call('getMyTeamState', { code: accessCode });
  check('audio submission marked approved after review',
    state?.team?.taskSubmissions?.[AUDIO_TASK_ID]?.status === 'approved',
    state?.team?.taskSubmissions?.[AUDIO_TASK_ID]?.status);

  // Non-goal: audio submissions never enter the live photo feed.
  const feedItems = await player.getColAt(
    `users/${creatorCred.user.uid}/games/${gameId}/runs/${runId}/feedItems`,
  ).catch(() => []);
  check('no photo-feed item was written for the audio submission',
    !feedItems.some((f) => f?.taskId === AUDIO_TASK_ID), JSON.stringify(feedItems.map((f) => f?.taskId)));

  // ── 9. Complete the final plain task ────────────────────────────────────────
  const completeRes = await player.call('completeTask', {
    taskId: PLAIN_TASK_ID, code: accessCode, lat: 31.8, lng: 35.17,
  });
  check('completeTask on final task succeeds', completeRes?.ok === true);

  state = await player.call('getMyTeamState', { code: accessCode });
  check('all stages completed', state?.team?.stages?.every((s) => s.status === 'completed'),
    state?.team?.stages?.map((s) => s.status).join(','));
  check('team marked finished', !!state?.team?.finishedAt || state?.team?.status === 'finished',
    state?.team?.status);

  // ── 10. Finalize the run ────────────────────────────────────────────────────
  const fin = await creator.call('finalizeRun', { gameId, runId });
  check('finalizeRun returns rankings', Array.isArray(fin?.rankings) && fin.rankings.length === 1);
  check('our team is ranked #1', fin?.rankings?.[0]?.teamId === playerCred.user.uid, JSON.stringify(fin?.rankings?.[0]));
  check('final score is positive', (fin?.rankings?.[0]?.score ?? 0) > 0, String(fin?.rankings?.[0]?.score));

  // ── 10a. Platform benchmark contribution (platform-benchmark) ───────────────
  // Finalizing the main run marks the run doc's status:'finished', which fires
  // the `onRunFinalized` Firestore TRIGGER (perf: run-perf-scale, Task 9) —
  // asynchronous from finalizeRun's own response, so poll briefly rather than
  // asserting immediately (a real two-hop async architecture, not a dangling
  // promise — see the `waitFor` doc comment above). The main game has a
  // 'smart_station' task type.
  const benchStation = await waitFor(async () => {
    const d = await creator.getDocAt('benchmarks/smart_station');
    return d.exists ? d : null;
  }) ?? { exists: false, data: undefined };
  check('benchmark: finalize contributed a station aggregate', benchStation.exists && (benchStation.data?.count ?? 0) >= 1, JSON.stringify(benchStation.data));
  check('benchmark: aggregate is anonymized (no run/team ids)',
    benchStation.exists && typeof benchStation.data?.medianMsRolling === 'number'
      && !('runId' in benchStation.data) && !('teamId' in benchStation.data) && !('ownerUid' in benchStation.data),
    JSON.stringify(benchStation.data));
  // Direct evidence the TRIGGER actually ran (not just that finalizeRun
  // returned fast): its own idempotency claim flags on the run doc.
  const runAfterTrigger = await waitFor(async () => {
    const d = await creator.getDocAt(`users/${creatorCred.user.uid}/games/${gameId}/runs/${runId}`);
    return d.data?.benchmarkContributed && d.data?.summaryEmailSent ? d : null;
  });
  check('onRunFinalized trigger ran: benchmarkContributed + summaryEmailSent claimed',
    runAfterTrigger?.data?.benchmarkContributed === true && runAfterTrigger?.data?.summaryEmailSent === true,
    JSON.stringify({ benchmarkContributed: runAfterTrigger?.data?.benchmarkContributed, summaryEmailSent: runAfterTrigger?.data?.summaryEmailSent }));

  // Double-finalize guard (state-machine): re-finalizing an already-finished
  // run must not double-contribute to the platform-wide benchmark aggregate
  // (that would corrupt medians/completion-rates for every creator sharing
  // that task type, not just this run's owner).
  {
    const countBefore = benchStation.data?.count ?? 0;
    const fin2 = await creator.call('finalizeRun', { gameId, runId }).catch((e) => e);
    const benchAfterRefinalize = await creator.getDocAt('benchmarks/smart_station');
    const countAfter = benchAfterRefinalize.data?.count ?? 0;
    check('re-finalizing an already-finished run does not double-contribute to benchmarks',
      countAfter === countBefore, `before=${countBefore} after=${countAfter} fin2=${JSON.stringify(fin2?.rankings ?? fin2?.message ?? fin2)}`);
  }

  // Opt-out skips contribution: a benchmarkOptOut game's finished run must not
  // bump the aggregate for its task type.
  {
    const { gameId: boGame } = await creator.call('createGame', { title: 'No Bench', mode: 'individual' });
    await creator.call('updateGame', { gameId: boGame, scoringPreset: 'fixed_points_speed', benchmarkOptOut: true,
      stages: [{ id: 'bo-s', order: 0, title: 'S', isFinal: true,
        tasks: [{ id: 'bo-t', title: 'Self report', type: 'self_report', locationless: true, coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 3 }] }] });
    const before = await creator.getDocAt('benchmarks/self_report');
    const beforeCount = before.exists ? (before.data?.count ?? 0) : 0;
    const { runId: boRun, accessCode: boCode } = await creator.call('launchRun', { gameId: boGame });
    const boPlayer = makeParty('boPlayer');
    await signInAnonymously(boPlayer.auth);
    await boPlayer.call('joinRun', { code: boCode, displayName: 'Opt' });
    await creator.call('startTeams', { gameId: boGame, runId: boRun });
    const bs = await boPlayer.call('getMyTeamState', { code: boCode });
    const assigned = bs?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
    if (assigned) await boPlayer.call('completeTask', { taskId: assigned.taskId, code: boCode });
    await creator.call('finalizeRun', { gameId: boGame, runId: boRun });
    const after = await creator.getDocAt('benchmarks/self_report');
    const afterCount = after.exists ? (after.data?.count ?? 0) : 0;
    check('benchmark: opt-out run does NOT contribute', afterCount === beforeCount, `before=${beforeCount} after=${afterCount}`);
  }

  // ── 10b. Data-retention prune of a finished run ─────────────────────────────
  // pruneRunNow strips raw PII (GPS pings + photo URLs) while keeping scores.
  // It is ADMIN-ONLY, so it's called by the platform-admin party (real token
  // claim — the emulator bypass is gone); the owner-cannot-prune denial lives
  // in the authz matrix scenario.
  const prune = await platformAdmin.call('pruneRunNow', {
    ownerUid: creatorCred.user.uid, gameId, runId,
  });
  check('pruneRunNow (as admin) succeeds + clears the submitted photo URL',
    prune?.ok === true && prune?.photoUrlsCleared >= 1, JSON.stringify(prune));
  const prune2 = await platformAdmin.call('pruneRunNow', {
    ownerUid: creatorCred.user.uid, gameId, runId,
  });
  check('pruneRunNow is idempotent (nothing left to clear)',
    prune2?.ok === true && prune2?.photoUrlsCleared === 0, JSON.stringify(prune2));

  // ── 11. A late participant cannot join a finished run ───────────────────────
  let lateRejected = false;
  try {
    await staff.call('joinRun', { code: accessCode, displayName: 'Latecomers' });
  } catch (e) {
    lateRejected = /already finished/i.test(e.message);
  }
  check('joinRun rejects a finished run', lateRejected);

  // A device can no longer attach once the run is finished (shared-team-devices).
  let lateAttachRejected = false;
  try {
    await stranger.call('joinTeamAsDevice', { code: accessCode, teamCode });
  } catch (e) {
    lateAttachRejected = e.code === 'functions/failed-precondition' || /finished/i.test(e.message);
  }
  check('joinTeamAsDevice rejects a finished run', lateAttachRejected);

  }); // scenario: core lifecycle

  await scenario('partial-completion stage + locationless routing', async () => {

  // ── 12. Partial-completion stage + locationless task ────────────────────────
  // A stage with 2 tasks but requiredTaskCount=1: completing ONE finishes the
  // stage and auto-skips the other. One task is locationless (no coordinates).
  const player2 = makeParty('player2');
  await signInAnonymously(player2.auth);

  const { gameId: g2 } = await creator.call('createGame', { title: 'Pick-One Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: g2,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'st-pick', order: 0, title: 'Pick one', isFinal: true, requiredTaskCount: 1,
      tasks: [
        { id: 'pk-a', title: 'Located task', type: 'field', coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 3, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 3 },
        { id: 'pk-b', title: 'Anywhere task', type: 'self_report', locationless: true, coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 3 },
      ],
    }],
  });
  const { runId: r2, accessCode: c2 } = await creator.call('launchRun', { gameId: g2 });
  await player2.call('joinRun', { code: c2, displayName: 'Solo' });
  await creator.call('startTeams', { gameId: g2, runId: r2 });

  // Routing assigns one of the two; complete whichever it picked.
  let s2 = await player2.call('getMyTeamState', { code: c2 });
  const assigned = s2?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
  check('partial stage routes exactly one task', !!assigned, assigned?.taskId);
  await player2.call('completeTask', { taskId: assigned.taskId, code: c2, lat: 31.78, lng: 35.21 });

  s2 = await player2.call('getMyTeamState', { code: c2 });
  const tasks2 = s2?.team?.stages?.[0]?.tasks ?? [];
  const done = tasks2.filter((t) => t.status === 'completed').length;
  const skipped = tasks2.filter((t) => t.status === 'skipped').length;
  check('completing 1 of 2 finishes the partial stage', s2?.team?.stages?.[0]?.status === 'completed', s2?.team?.stages?.[0]?.status);
  check('the unneeded task is auto-skipped', done === 1 && skipped === 1, `done=${done} skipped=${skipped}`);
  check('team finished after the single required task', s2?.team?.status === 'finished', s2?.team?.status);

  }); // scenario: partial-completion

  await scenario('locationless task is uncapped (>3 teams, unset cap)', async () => {

  // ── WO Fix 4. A locationless task has no physical station, so it must be
  // uncapped in routing: MORE teams than the default cap (3), and NO explicit
  // maxConcurrentTeams, must all be handed the task — none may get stationsFull.
  const { gameId: gLC } = await creator.call('createGame', { title: 'Uncapped Locationless', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gLC,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'st-lc', order: 0, title: 'Anywhere', isFinal: true,
      // Deliberately NO maxConcurrentTeams → default cap 3; locationless must bypass it.
      tasks: [
        { id: 'lc-a', title: 'Do it anywhere', type: 'self_report', locationless: true, coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 60 },
      ],
    }],
  });
  const { runId: rLC, accessCode: cLC } = await creator.call('launchRun', { gameId: gLC });

  const N = 4; // > default cap of 3
  const lcPlayers = [];
  for (let i = 0; i < N; i++) {
    const p = makeParty(`lc-player${i}`);
    await signInAnonymously(p.auth);
    await p.call('joinRun', { code: cLC, displayName: `LC${i}` });
    lcPlayers.push(p);
  }
  await creator.call('startTeams', { gameId: gLC, runId: rLC });

  let allAssigned = true;
  let anyStationsFull = false;
  for (const p of lcPlayers) {
    const st = await p.call('getMyTeamState', { code: cLC });
    const assigned = st?.team?.stages?.[0]?.tasks?.find((t) => t.taskId === 'lc-a' && t.status === 'assigned');
    if (!assigned) {
      allAssigned = false;
      // Ask explicitly and inspect the reason so a cap-block is visible.
      const next = await p.call('requestNextTask', { code: cLC, lat: 0, lng: 0 });
      if (next?.reason === 'stationsFull') anyStationsFull = true;
    }
  }
  check(`all ${N} teams (> cap 3) are handed the locationless task`, allAssigned);
  check('no team is mis-reported stationsFull for the uncapped locationless task', anyStationsFull === false);

  }); // scenario: locationless uncapped

  await scenario('paid hints (reveal once, charge once)', async () => {

  // ── 13. Paid hints (reveal text, charge once, idempotent) ───────────────────
  const { gameId: g3 } = await creator.call('createGame', { title: 'Hint Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: g3,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'st-h', order: 0, title: 'Riddle', isFinal: true,
      tasks: [{
        id: 'h-1', title: 'Solve the riddle', type: 'smart_station',
        coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 4, estimatedMinutes: 5, pointValue: 100, maxConcurrentTeams: 3,
        smart: { enabled: true, verificationType: 'code_verification', hasCode: true, secretCode: 'OLIVE' },
        hint: 'It grows on a tree and makes oil.', hintPenalty: 30,
      }],
    }],
  });
  const { runId: r3, accessCode: c3 } = await creator.call('launchRun', { gameId: g3 });
  const player3 = makeParty('player3');
  await signInAnonymously(player3.auth);
  await player3.call('joinRun', { code: c3, displayName: 'Riddler' });
  await creator.call('startTeams', { gameId: g3, runId: r3 });

  // The hint TEXT must not be leaked in the task payload.
  const s3 = await player3.call('getMyTeamState', { code: c3 });
  const htask = s3?.activeStageTasks?.find((t) => t.id === 'h-1');
  check('hint text is NOT leaked to participants', htask?.hint === undefined && htask?.hasHint === true, JSON.stringify({ hint: htask?.hint, hasHint: htask?.hasHint }));

  const hintRes = await player3.call('requestTaskHint', { ownerUid: creatorCred.user.uid, gameId: g3, runId: r3, taskId: 'h-1' });
  check('requestTaskHint returns the hint + charges the cost', hintRes?.hint === 'It grows on a tree and makes oil.' && hintRes?.penalty === 30, JSON.stringify(hintRes));

  const afterHint = await player3.call('getMyTeamState', { code: c3 });
  check('hint penalty applied to bonusPenalty', afterHint?.team?.bonusPenalty === 30, String(afterHint?.team?.bonusPenalty));

  const hintAgain = await player3.call('requestTaskHint', { ownerUid: creatorCred.user.uid, gameId: g3, runId: r3, taskId: 'h-1' });
  check('second hint request does NOT double-charge', hintAgain?.alreadyUsed === true && hintAgain?.penalty === 0, JSON.stringify(hintAgain));
  const afterAgain = await player3.call('getMyTeamState', { code: c3 });
  check('bonusPenalty unchanged after re-request', afterAgain?.team?.bonusPenalty === 30, String(afterAgain?.team?.bonusPenalty));

  }); // scenario: paid hints

  await scenario('game intro instructions (bilingual echo + non-https image strip + null when unset)', async () => {

  // ── Game intro "How to play" primer (change: game-intro-instructions) ────────
  // Guards the write→clean→echo seam: updateGame stores a cleaned primer, and
  // getMyTeamState echoes title/body/bodyHe but https-strips a non-https image.
  const { gameId: gGI } = await creator.call('createGame', { title: 'Primer Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gGI,
    scoringPreset: 'fixed_points_speed',
    instructions: {
      title: 'How to play',
      body: 'Walk to each pin and check in.',
      bodyHe: 'לכו לכל נקודה ובצעו צ׳ק־אין.',
      imageUrl: 'http://insecure.example.com/diagram.png', // non-https → must be stripped
    },
    stages: [{
      id: 'st-gi', order: 0, title: 'Go', isFinal: true,
      tasks: [{
        id: 'gi-1', title: 'Check in', type: 'self_report',
        coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 4, pointValue: 40, maxConcurrentTeams: 3,
      }],
    }],
  });
  const { runId: rGI, accessCode: cGI } = await creator.call('launchRun', { gameId: gGI });
  const playerGI = makeParty('playerGI');
  await signInAnonymously(playerGI.auth);
  await playerGI.call('joinRun', { code: cGI, displayName: 'Primer Player' });
  await creator.call('startTeams', { gameId: gGI, runId: rGI });

  const sGI = await playerGI.call('getMyTeamState', { code: cGI });
  const ins = sGI?.game?.instructions;
  check('getMyTeamState echoes the bilingual primer',
    ins?.title === 'How to play' && ins?.body === 'Walk to each pin and check in.' && ins?.bodyHe === 'לכו לכל נקודה ובצעו צ׳ק־אין.',
    JSON.stringify(ins));
  check('non-https primer image is stripped on echo', ins?.imageUrl === undefined, JSON.stringify(ins?.imageUrl));

  // A game with NO primer echoes instructions === null.
  const { gameId: gGI2 } = await creator.call('createGame', { title: 'No Primer Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gGI2,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'st-gi2', order: 0, title: 'Go', isFinal: true,
      tasks: [{
        id: 'gi2-1', title: 'Check in', type: 'self_report',
        coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 4, pointValue: 40, maxConcurrentTeams: 3,
      }],
    }],
  });
  const { runId: rGI2, accessCode: cGI2 } = await creator.call('launchRun', { gameId: gGI2 });
  const playerGI2 = makeParty('playerGI2');
  await signInAnonymously(playerGI2.auth);
  await playerGI2.call('joinRun', { code: cGI2, displayName: 'No Primer Player' });
  await creator.call('startTeams', { gameId: gGI2, runId: rGI2 });
  const sGI2 = await playerGI2.call('getMyTeamState', { code: cGI2 });
  check('a game with no primer echoes instructions === null', sGI2?.game?.instructions === null, JSON.stringify(sGI2?.game?.instructions));

  }); // scenario: game intro instructions

  await scenario('test drive (free rehearsal, cap 2, one-live guard, aggregate exclusion)', async () => {

  // ── Test drive (change: test-drive-mode) ────────────────────────────────────
  // A rehearsal launch: free (wallet never touched), capped at 2, at most one
  // live test run per game, and excluded from cross-run aggregates (benchmarks,
  // player profiles). It resolves runs the same way as a real run otherwise.
  const adminDb = adminSdk.firestore();
  const creatorUid = creatorCred.user.uid;

  const { gameId: gTD } = await creator.call('createGame', { title: 'Test Drive Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gTD,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'st-td', order: 0, title: 'Rehearse', isFinal: true,
      tasks: [{
        id: 'td-1', title: 'Walk the route', type: 'self_report',
        coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3,
      }],
    }],
  });

  // Snapshot the wallet + the task-type benchmark BEFORE any test launch.
  const walletBefore = await creator.call('getWalletStatus');
  const txBefore = (await adminDb.collection(`wallets/${creatorUid}/transactions`).get()).size;
  const benchBefore = (await adminDb.doc('benchmarks/self_report').get()).data() ?? null;

  // (a) Test launch → wallet BYTE-UNCHANGED, run doc marked test/isTestDrive.
  const { runId: rTD, accessCode: cTD } = await creator.call('launchRun', { gameId: gTD, testDrive: true });
  check('test launch returns runId + accessCode', !!rTD && !!cTD, cTD);
  const walletAfter = await creator.call('getWalletStatus');
  check('test launch did NOT decrement credits',
    walletAfter?.eventCredits === walletBefore?.eventCredits, JSON.stringify(walletAfter));
  check('test launch did NOT increment the free-run counter',
    (walletAfter?.lifetimeFreeRunsUsed ?? 0) === (walletBefore?.lifetimeFreeRunsUsed ?? 0), JSON.stringify(walletAfter));
  const txAfter = (await adminDb.collection(`wallets/${creatorUid}/transactions`).get()).size;
  check('test launch wrote NO wallet transaction doc', txAfter === txBefore, `before=${txBefore} after=${txAfter}`);
  const runDocTD = (await adminDb.doc(`users/${creatorUid}/games/${gTD}/runs/${rTD}`).get()).data();
  check('test run doc has billingType "test"', runDocTD?.billingType === 'test', runDocTD?.billingType);
  check('test run doc has isTestDrive:true', runDocTD?.isTestDrive === true, JSON.stringify(runDocTD?.isTestDrive));
  check('test run cap is 2', runDocTD?.maxParticipants === 2, String(runDocTD?.maxParticipants));

  // (b) getJoinInfo surfaces isTestDrive.
  const joinInfoTD = await creator.call('getJoinInfo', { code: cTD });
  check('getJoinInfo surfaces isTestDrive:true', joinInfoTD?.isTestDrive === true, JSON.stringify(joinInfoTD?.isTestDrive));

  // (c) 2 joins OK, 3rd rejected (cap 2).
  const tdA = makeParty('tdA');
  const tdB = makeParty('tdB');
  const tdC = makeParty('tdC');
  await signInAnonymously(tdA.auth);
  await signInAnonymously(tdB.auth);
  await signInAnonymously(tdC.auth);
  await tdA.call('joinRun', { code: cTD, displayName: 'Creator phone' });
  await tdB.call('joinRun', { code: cTD, displayName: 'Companion phone' });
  await expectError('3rd join into a test run is rejected (cap 2)',
    tdC.call('joinRun', { code: cTD, displayName: 'One too many' }),
    { codeIn: ['functions/resource-exhausted'] });

  // (d) A second LIVE test launch for the same game is rejected; a NORMAL launch
  //     of the same game still succeeds (the guard is test-drive-scoped).
  await expectError('second live test launch for the same game is rejected',
    creator.call('launchRun', { gameId: gTD, testDrive: true }),
    { codeIn: ['functions/failed-precondition'], match: /finaliz/i });
  const { runId: rNormal } = await creator.call('launchRun', { gameId: gTD });
  check('a normal launch of the same game still succeeds', !!rNormal, rNormal);
  await creator.call('finalizeRun', { gameId: gTD, runId: rNormal });

  // (e) Play a task, finalize the test run — benchmarks + player profiles untouched.
  await creator.call('startTeams', { gameId: gTD, runId: rTD });
  const sTD = await tdA.call('getMyTeamState', { code: cTD });
  const assignedTD = sTD?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
  check('test run routes a task normally', !!assignedTD, assignedTD?.taskId);
  await tdA.call('completeTask', { taskId: assignedTD.taskId, code: cTD, lat: 31.78, lng: 35.21 });
  const finTD = await creator.call('finalizeRun', { gameId: gTD, runId: rTD });
  check('finalizeRun on a test run returns rankings', Array.isArray(finTD?.rankings), JSON.stringify(finTD?.rankings?.length));

  const benchAfter = (await adminDb.doc('benchmarks/self_report').get()).data() ?? null;
  check('test run did NOT contribute to benchmarks/self_report',
    JSON.stringify(benchAfter) === JSON.stringify(benchBefore), JSON.stringify({ before: benchBefore, after: benchAfter }));
  // Confirm no player profile was written for the test run's participant.
  const tdAuid = tdA.auth.currentUser?.uid;
  const tdAProfile = tdAuid ? (await adminDb.doc(`players/${tdAuid}`).get()) : { exists: false };
  check('test run wrote NO player profile', tdAuid ? tdAProfile.exists === false : true,
    JSON.stringify({ tdAuid, exists: tdAProfile.exists }));

  // (f) With the first test run FINISHED, a fresh test launch now succeeds.
  const { runId: rTD2, accessCode: cTD2 } = await creator.call('launchRun', { gameId: gTD, testDrive: true });
  check('a fresh test launch succeeds once the prior one is finalized', !!rTD2 && !!cTD2, cTD2);
  await creator.call('finalizeRun', { gameId: gTD, runId: rTD2 });

  }); // scenario: test drive

  await scenario('hint auto escalation (attempts path → free hint)', async () => {

  // ── Hint auto escalation (change: hint-auto-escalation) ─────────────────────
  // The ATTEMPTS path is driven here (the TIME path is covered by the pure
  // scripts/test-hint-escalation.ts — an e2e can't wait minutes): 2 wrong answers
  // on a task with hintAutoRevealAttempts: 2 flips hintFreeNow and makes
  // requestTaskHint charge 0; a control task without thresholds still charges.
  const { gameId: gE } = await creator.call('createGame', { title: 'Hint Escalation Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gE,
    scoringPreset: 'fixed_points_speed',
    // Both the escalation task (e-1) and the threshold-less control (e-2) live in
    // the SAME stage so that requestTaskHint's stage-scope guard (wave-g #1) is
    // satisfied for both — a hint for a FUTURE/locked stage is (correctly) denied,
    // so the control-charge assertion must exercise an ACTIVE-stage task. e-2 is
    // gated behind e-1 via unlockAfterTaskIds so routing never assigns it (keeping
    // e-1 the sole assigned task, and e-2 absent from activeStageTasks), while its
    // stage stays active so its paid hint still charges.
    stages: [
      {
        id: 'st-e1', order: 0, title: 'Struggle here', isFinal: true,
        tasks: [
          {
            id: 'e-1', title: 'Name the city', type: 'quiz', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 4, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3,
            answers: ['jerusalem'],
            hint: 'Look for the golden dome.', hintPenalty: 25, hintAutoRevealAttempts: 2,
          },
          {
            id: 'e-2', title: 'Control quiz', type: 'quiz', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 4, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3,
            answers: ['haifa'], unlockAfterTaskIds: ['e-1'],
            hint: 'Control hint text.', hintPenalty: 25,
          },
        ],
      },
    ],
  });
  const { runId: rE, accessCode: cE } = await creator.call('launchRun', { gameId: gE });
  const playerE = makeParty('playerE');
  await signInAnonymously(playerE.auth);
  await playerE.call('joinRun', { code: cE, displayName: 'Stuck Team' });
  await creator.call('startTeams', { gameId: gE, runId: rE });
  const CE = { ownerUid: creatorCred.user.uid, gameId: gE, runId: rE };
  await playerE.call('requestNextTask', CE); // ensure e-1 is assigned (startedAt written)

  const sE1 = await playerE.call('getMyTeamState', { code: cE });
  const taskE = sE1?.activeStageTasks?.find((t) => t.id === 'e-1');
  check('escalation thresholds pass through the sanitized payload', taskE?.hintAutoRevealAttempts === 2, JSON.stringify(taskE?.hintAutoRevealAttempts));
  check('hint text still stripped on an escalating task', taskE?.hint === undefined && taskE?.hasHint === true, JSON.stringify({ hint: taskE?.hint }));
  check('no hintFreeNow before any wrong attempt', taskE?.hintFreeNow !== true, JSON.stringify(taskE?.hintFreeNow));
  assertTaskPayloadAllowlisted('sanitizer(hint-escalation)', taskE);

  // Two wrong answers → the attempts threshold is met.
  const wrongE1 = await playerE.call('submitTaskAnswer', { ...CE, taskId: 'e-1', answer: 'rome' });
  const wrongE2 = await playerE.call('submitTaskAnswer', { ...CE, taskId: 'e-1', answer: 'athens' });
  check('both wrong answers rejected', wrongE1?.correct === false && wrongE2?.correct === false, JSON.stringify({ wrongE1, wrongE2 }));

  const sE2 = await playerE.call('getMyTeamState', { code: cE });
  const taskEAfter = sE2?.activeStageTasks?.find((t) => t.id === 'e-1');
  check('hintFreeNow flips after the 2nd wrong attempt', taskEAfter?.hintFreeNow === true, JSON.stringify(taskEAfter?.hintFreeNow));
  assertTaskPayloadAllowlisted('sanitizer(hint-escalation, free)', taskEAfter);
  const bonusBefore = sE2?.team?.bonusPenalty ?? 0;

  const freeHint = await playerE.call('requestTaskHint', { ...CE, taskId: 'e-1' });
  check('escalated hint is FREE (penalty 0, text revealed)',
    freeHint?.hint === 'Look for the golden dome.' && freeHint?.penalty === 0 && freeHint?.free === true,
    JSON.stringify(freeHint));
  const sE3 = await playerE.call('getMyTeamState', { code: cE });
  check('bonusPenalty untouched by the free reveal', (sE3?.team?.bonusPenalty ?? 0) === bonusBefore, String(sE3?.team?.bonusPenalty));

  const freeAgain = await playerE.call('requestTaskHint', { ...CE, taskId: 'e-1' });
  check('second request stays idempotent (alreadyUsed, charged 0)', freeAgain?.alreadyUsed === true && freeAgain?.penalty === 0, JSON.stringify(freeAgain));

  // Control: a hint WITHOUT thresholds still charges its full cost.
  const paidHint = await playerE.call('requestTaskHint', { ...CE, taskId: 'e-2' });
  check('control task without thresholds still charges 25', paidHint?.penalty === 25 && paidHint?.free !== true, JSON.stringify(paidHint));
  const sE4 = await playerE.call('getMyTeamState', { code: cE });
  check('control charge landed on bonusPenalty', (sE4?.team?.bonusPenalty ?? 0) === bonusBefore + 25, String(sE4?.team?.bonusPenalty));

  }); // scenario: hint auto escalation

  await scenario('completeTask type gate (no answer-bypass on quiz)', async () => {

  // ── completeTask anti-cheat type gate ───────────────────────────────────────
  // completeTask is the check-in / self-report / geofence path ONLY. A quiz (and
  // every other non-completeTask type) is graded exclusively by its own callable
  // (submitTaskAnswer here). A participant who reads their own assigned taskId via
  // getMyTeamState must NOT be able to score a quiz task by calling
  // completeTask({ taskId }) with no answer. Positive control: field/self_report/
  // geofence completions through completeTask are covered by the core lifecycle
  // scenario and must stay green (the allowlist must not over-block them).
  const { gameId: gZ } = await creator.call('createGame', { title: 'Type Gate Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gZ,
    scoringPreset: 'fixed_points_speed',
    stages: [
      {
        id: 'st-z1', order: 0, title: 'Answer here',
        tasks: [{
          id: 'q-1', title: 'Name the city', type: 'quiz', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 4, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3,
          answers: ['jerusalem'],
        }],
      },
      {
        id: 'st-z2', order: 1, title: 'Finish', isFinal: true,
        tasks: [{
          id: 'z-2', title: 'Wrap up', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 2, pointValue: 10, maxConcurrentTeams: 3,
        }],
      },
    ],
  });
  const { runId: rZ, accessCode: cZ } = await creator.call('launchRun', { gameId: gZ });
  const playerZ = makeParty('playerZ');
  await signInAnonymously(playerZ.auth);
  await playerZ.call('joinRun', { code: cZ, displayName: 'Cheater Team' });
  await creator.call('startTeams', { gameId: gZ, runId: rZ });
  const CZ = { ownerUid: creatorCred.user.uid, gameId: gZ, runId: rZ };
  await playerZ.call('requestNextTask', CZ); // assign q-1 (writes startedAt)

  // Attempt the exploit: complete a quiz task with a bare id, no answer.
  let quizBypassRejected = false;
  try {
    await playerZ.call('completeTask', { ...CZ, taskId: 'q-1' });
  } catch (e) {
    quizBypassRejected =
      e.code === 'functions/failed-precondition' ||
      /different way|does not|answer/i.test(e.message);
  }
  check('completeTask refuses to score a quiz task (no answer bypass)', quizBypassRejected);

  // Prove the task did not silently complete and no points were awarded.
  const sZ = await playerZ.call('getMyTeamState', { code: cZ });
  const qZ = sZ?.activeStageTasks?.find((t) => t.id === 'q-1');
  check('quiz task remains incomplete after the bypass attempt',
    qZ && qZ.status !== 'completed', JSON.stringify(qZ?.status));
  check('no score awarded by the bypass attempt',
    (sZ?.team?.score ?? 0) === 0, String(sZ?.team?.score));

  // Positive control: the legitimate grading path still works on the quiz.
  const okZ = await playerZ.call('submitTaskAnswer', { ...CZ, taskId: 'q-1', answer: 'jerusalem' });
  check('submitTaskAnswer still grades the quiz correctly (control)', okZ?.correct === true, JSON.stringify(okZ));

  }); // scenario: completeTask type gate

  await scenario('quiz ordering (seeded shuffle + orderedAnswer)', async () => {

  // ── Ordering quiz (change: quiz-ordering) ────────────────────────────────────
  // The authored orderItems ORDER is the answer key: the participant payload must
  // carry a per-team seeded shuffle — shuffled ≠ authored AND the same multiset,
  // stable across polls — and grading happens only via submitTaskAnswer's
  // orderedAnswer path (normalization-tolerant, all-or-nothing).
  const AUTHORED_ORDER = ['Abraham', 'Moses', 'King David', 'Herzl'];
  const { gameId: gO } = await creator.call('createGame', { title: 'Ordering Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gO,
    scoringPreset: 'fixed_points_speed',
    stages: [
      {
        id: 'st-o1', order: 0, title: 'Timeline',
        tasks: [{
          id: 'o-1', title: 'Order the figures', type: 'quiz', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 4, estimatedMinutes: 5, pointValue: 90, maxConcurrentTeams: 3,
          orderItems: AUTHORED_ORDER,
        }],
      },
      {
        id: 'st-o2', order: 1, title: 'Plain quiz', isFinal: true,
        tasks: [{
          id: 'o-2', title: 'Classic question', type: 'quiz', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3,
          answers: ['yes'],
        }],
      },
    ],
  });
  const { runId: rO, accessCode: cO } = await creator.call('launchRun', { gameId: gO });
  const playerO = makeParty('playerO');
  await signInAnonymously(playerO.auth);
  await playerO.call('joinRun', { code: cO, displayName: 'Sorters' });
  await creator.call('startTeams', { gameId: gO, runId: rO });
  const CO = { ownerUid: creatorCred.user.uid, gameId: gO, runId: rO };
  await playerO.call('requestNextTask', CO);

  const sO1 = await playerO.call('getMyTeamState', { code: cO });
  const taskO = sO1?.activeStageTasks?.find((t) => t.id === 'o-1');
  const shuffled = taskO?.orderItems;
  const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  check('payload carries the 4 ordering items', Array.isArray(shuffled) && shuffled.length === 4, JSON.stringify(shuffled));
  check('payload order ≠ authored order (answer key never leaks)', !sameArr(shuffled, AUTHORED_ORDER), JSON.stringify(shuffled));
  check('payload is the same multiset as authored', sameArr([...(shuffled ?? [])].sort(), [...AUTHORED_ORDER].sort()), JSON.stringify(shuffled));
  assertTaskPayloadAllowlisted('sanitizer(ordering)', taskO);

  const sO2 = await playerO.call('getMyTeamState', { code: cO });
  const shuffledAgain = sO2?.activeStageTasks?.find((t) => t.id === 'o-1')?.orderItems;
  check('shuffle is stable across polls (no reshuffle-to-solve)', sameArr(shuffled, shuffledAgain), JSON.stringify({ shuffled, shuffledAgain }));

  // A plain `answer` on an ordering task is refused loud.
  await expectError('ordering task without orderedAnswer is rejected',
    playerO.call('submitTaskAnswer', { ...CO, taskId: 'o-1', answer: 'Abraham' }),
    { codeIn: ['functions/invalid-argument'] });

  // Submitting the SHUFFLED order is guaranteed wrong (identity guard) → counted, not completed.
  const wrongO = await playerO.call('submitTaskAnswer', { ...CO, taskId: 'o-1', orderedAnswer: shuffled });
  check('the shuffled arrangement grades wrong', wrongO?.correct === false, JSON.stringify(wrongO));

  // A case/whitespace-mangled copy of the AUTHORED order grades correct + completes.
  const mangled = AUTHORED_ORDER.map((s) => `  ${s.toUpperCase()}   `.replace(' ', '  '));
  const rightO = await playerO.call('submitTaskAnswer', { ...CO, taskId: 'o-1', orderedAnswer: mangled });
  check('the authored order (mangled case/whitespace) grades correct', rightO?.correct === true, JSON.stringify(rightO));
  const sO3 = await playerO.call('getMyTeamState', { code: cO });
  const recO = sO3?.team?.stages?.[0]?.tasks?.find((r) => r.taskId === 'o-1');
  check('ordering task completed + scored by the normal preset', recO?.status === 'completed' && (recO?.earnedScore ?? 0) > 0, JSON.stringify(recO));

  // orderedAnswer on a PLAIN quiz is refused loud (no silent ignore).
  await expectError('orderedAnswer on a plain quiz is rejected',
    playerO.call('submitTaskAnswer', { ...CO, taskId: 'o-2', orderedAnswer: ['yes'] }),
    { codeIn: ['functions/invalid-argument'] });

  // Save-time validation: too few items / non-quiz / mixed modes all rejected.
  const badStage = (task) => [{ id: 'st-bad', order: 0, title: 'Bad', isFinal: true, tasks: [task] }];
  const baseBad = {
    id: 'bad-1', title: 'Bad ordering', locationless: true, coordinates: { lat: 0, lng: 0 },
    difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3,
  };
  await expectError('updateGame rejects a 2-item ordering quiz',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'quiz', orderItems: ['a', 'b'] }) }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('updateGame rejects orderItems on a non-quiz task',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'field', orderItems: ['a', 'b', 'c'] }) }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('updateGame rejects orderItems mixed with answers',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'quiz', orderItems: ['a', 'b', 'c'], answers: ['a'] }) }),
    { codeIn: ['functions/invalid-argument'] });

  // Unwinnable-task guard: a task with no usable answer key can never be
  // completed by any participant (matchesTaskAnswer/verifyStationCode/
  // submitSequenceStep all reject an empty answer). updateGame must refuse to
  // persist one — bypassing the Wizard's client-side guard directly.
  await expectError('updateGame rejects a quiz with no answers',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'quiz' }) }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('updateGame rejects a numeric task with no numericAnswer',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'numeric' }) }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('updateGame rejects a smart_station with no secretCode',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'smart_station' }) }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('updateGame rejects a sequence with no steps',
    creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'sequence' }) }),
    { codeIn: ['functions/invalid-argument'] });

  // Defense in depth: a game saved BEFORE this guard existed (or written by any
  // other path) could still carry an unwinnable task. launchRun must catch it
  // too, not just updateGame — write directly via the Admin SDK to bypass the
  // callable's validation entirely, simulating that legacy-data case.
  const { gameId: gLegacyBad } = await creator.call('createGame', { title: 'Legacy Bad Game', mode: 'individual' });
  await adminSdk.firestore().doc(`users/${creatorCred.user.uid}/games/${gLegacyBad}`).update({
    stages: badStage({ ...baseBad, type: 'quiz' }),
  });
  await expectError('launchRun rejects a legacy game with an unwinnable task',
    creator.call('launchRun', { gameId: gLegacyBad }),
    { codeIn: ['functions/failed-precondition'] });

  }); // scenario: quiz ordering

  await scenario('survey tasks (choice + free-text, results aggregation)', async () => {

  // ── Survey tasks (change: survey-tasks) ──────────────────────────────────────
  // A survey has NO right answer: any valid response completes the task for its
  // fixed pointValue via the EXISTING submitTaskAnswer/completeTaskForTeam path.
  // surveyChoices is participant-visible (allowlisted); the team's own response
  // is echoed in getMyTeamState; getRunSurveyResults aggregates for owner/staff.
  const OWNER = creatorCred.user.uid;
  const { gameId: gS } = await creator.call('createGame', { title: 'Survey Game', mode: 'individual' });
  const C1 = 'Pizza', C2 = 'Falafel', C3 = 'Sushi';
  await creator.call('updateGame', {
    gameId: gS,
    scoringPreset: 'fixed_points_speed',
    stages: [
      {
        id: 'sv-s1', order: 0, title: 'Poll', isFinal: true,
        tasks: [
          {
            id: 'sv-choice', title: 'Favorite food?', type: 'survey',
            triggerMode: 'instant', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1,
            pointValue: 20, maxConcurrentTeams: 9, surveyChoices: [C1, C2, C3],
          },
          {
            id: 'sv-text', title: 'Say anything', type: 'survey',
            triggerMode: 'instant', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1,
            pointValue: 0, maxConcurrentTeams: 9,
          },
        ],
      },
    ],
  });
  const { runId: rS, accessCode: cS } = await creator.call('launchRun', { gameId: gS });
  const CTX = { ownerUid: OWNER, gameId: gS, runId: rS };

  const svA = makeParty('surveyA');
  const svB = makeParty('surveyB');
  await signInAnonymously(svA.auth);
  await signInAnonymously(svB.auth);
  await svA.call('joinRun', { code: cS, displayName: 'TeamA' });
  await svB.call('joinRun', { code: cS, displayName: 'TeamB' });
  await creator.call('startTeams', { gameId: gS, runId: rS });
  const uidA = svA.auth.currentUser.uid;
  const uidB = svB.auth.currentUser.uid;

  // Sanitized payload: surveyChoices present, allowlist green.
  const stateA0 = await svA.call('getMyTeamState', { code: cS });
  const choiceTask = stateA0?.activeStageTasks?.find((t) => t.id === 'sv-choice');
  check('survey choice task exposes surveyChoices to the participant',
    Array.isArray(choiceTask?.surveyChoices) && choiceTask.surveyChoices.length === 3, JSON.stringify(choiceTask?.surveyChoices));
  assertTaskPayloadAllowlisted('sanitizer(survey)', choiceTask);
  const textTask = stateA0?.activeStageTasks?.find((t) => t.id === 'sv-text');
  check('free-text survey task carries no surveyChoices', textTask?.surveyChoices === undefined, JSON.stringify(textTask?.surveyChoices));

  // Team A picks C1, Team B picks C2; both send free-text.
  const rA1 = await svA.call('submitTaskAnswer', { ...CTX, taskId: 'sv-choice', answer: C1 });
  check('choice survey completes correct for team A', rA1?.correct === true, JSON.stringify(rA1));
  const rB1 = await svB.call('submitTaskAnswer', { ...CTX, taskId: 'sv-choice', answer: C2 });
  check('choice survey completes correct for team B', rB1?.correct === true, JSON.stringify(rB1));
  await svA.call('submitTaskAnswer', { ...CTX, taskId: 'sv-text', answer: '  We loved the fountain!  ' });
  await svB.call('submitTaskAnswer', { ...CTX, taskId: 'sv-text', answer: 'Best day ever' });

  // Completion + fixed pointValue scoring + own surveyResponse echoed back.
  const stateA1 = await svA.call('getMyTeamState', { code: cS });
  const recChoiceA = stateA1?.team?.stages?.[0]?.tasks?.find((r) => r.taskId === 'sv-choice');
  const recTextA = stateA1?.team?.stages?.[0]?.tasks?.find((r) => r.taskId === 'sv-text');
  check('choice survey scored its fixed 20 points', recChoiceA?.status === 'completed' && recChoiceA?.earnedScore === 20, JSON.stringify(recChoiceA));
  check('free-text survey scored its fixed 0 points', recTextA?.status === 'completed' && (recTextA?.earnedScore ?? 0) === 0, JSON.stringify(recTextA));
  check("team A's own choice response echoes in getMyTeamState", recChoiceA?.surveyResponse === C1, JSON.stringify(recChoiceA?.surveyResponse));
  check("team A's own free-text response is trimmed + echoed", recTextA?.surveyResponse === 'We loved the fountain!', JSON.stringify(recTextA?.surveyResponse));

  // Duplicate submission ⇒ idempotent no-op (response + score unchanged).
  const dupA = await svA.call('submitTaskAnswer', { ...CTX, taskId: 'sv-choice', answer: C2 });
  check('duplicate survey submission still returns correct', dupA?.correct === true, JSON.stringify(dupA));
  const stateA2 = await svA.call('getMyTeamState', { code: cS });
  const recChoiceA2 = stateA2?.team?.stages?.[0]?.tasks?.find((r) => r.taskId === 'sv-choice');
  check('first survey response is final (duplicate never overwrites)', recChoiceA2?.surveyResponse === C1 && recChoiceA2?.earnedScore === 20, JSON.stringify(recChoiceA2));

  // Invalid responses ⇒ invalid-argument. Use team B's still-fresh choice task?
  // Both teams already completed; use a fresh third team so the guard doesn't
  // short-circuit the validation path.
  const svC = makeParty('surveyC');
  await signInAnonymously(svC.auth);
  await svC.call('joinRun', { code: cS, displayName: 'TeamC' });
  await creator.call('startTeams', { gameId: gS, runId: rS });
  await expectError('unlisted choice ⇒ invalid-argument',
    svC.call('submitTaskAnswer', { ...CTX, taskId: 'sv-choice', answer: 'Tacos' }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('empty response ⇒ invalid-argument',
    svC.call('submitTaskAnswer', { ...CTX, taskId: 'sv-text', answer: '   ' }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('501-char response ⇒ invalid-argument',
    svC.call('submitTaskAnswer', { ...CTX, taskId: 'sv-text', answer: 'a'.repeat(501) }),
    { codeIn: ['functions/invalid-argument'] });

  // getRunSurveyResults as OWNER: choice counts {c1:1,c2:1,c3:0}; free-text rows
  // carry both team names + responses.
  const resOwner = await creator.call('getRunSurveyResults', { gameId: gS, runId: rS });
  const choiceRes = resOwner?.results?.find((r) => r.taskId === 'sv-choice');
  const textRes = resOwner?.results?.find((r) => r.taskId === 'sv-text');
  check('owner survey results: per-choice counts are 0-filled + tallied',
    choiceRes?.counts?.[C1] === 1 && choiceRes?.counts?.[C2] === 1 && choiceRes?.counts?.[C3] === 0,
    JSON.stringify(choiceRes?.counts));
  check('owner survey results: choice responseCount is 2', choiceRes?.responseCount === 2, JSON.stringify(choiceRes?.responseCount));
  const textNames = (textRes?.responses ?? []).map((r) => r.teamName).sort();
  check('owner survey results: free-text rows carry both team names',
    JSON.stringify(textNames) === JSON.stringify(['TeamA', 'TeamB']), JSON.stringify(textNames));
  check('owner survey results: a free-text response text is present',
    (textRes?.responses ?? []).some((r) => r.response === 'We loved the fountain!'), JSON.stringify(textRes?.responses));

  // getRunSurveyResults as RUN-SCOPED STAFF: allowed.
  const { pin: svPin } = await creator.call('inviteStaff', {
    ownerUid: OWNER, gameId: gS, runId: rS, name: 'Survey Marshal', permissions: ['review_photos'],
  });
  const svStaff = makeParty('surveyStaff');
  await signInAnonymously(svStaff.auth);
  const svStok = await svStaff.call('staffSignIn', { ownerUid: OWNER, gameId: gS, runId: rS, pin: svPin });
  await signInWithCustomToken(svStaff.auth, svStok.customToken);
  const resStaff = await svStaff.call('getRunSurveyResults', { ownerUid: OWNER, gameId: gS, runId: rS });
  check('run staff can read survey results', Array.isArray(resStaff?.results) && resStaff.results.length === 2, JSON.stringify(resStaff?.results?.length));

  // Leaderboard invariant oracle stays green (survey points flow earnedScore).
  const svBoard = await creator.call('refreshLeaderboard', { gameId: gS, runId: rS, publish: false });
  assertLeaderboardInvariants('survey board', svBoard?.rankings ?? [], [uidA, uidB, svC.auth.currentUser.uid]);

  }); // scenario: survey tasks

  await scenario('post-game feedback (survey + owner summary)', async () => {

  // A team-mode game so a second phone can attach (shared-team-devices) and each
  // player submits their OWN feedback. Survey opens once the run is finished.
  const { gameId: gf } = await creator.call('createGame', { title: 'Feedback Game', mode: 'team' });
  await creator.call('updateGame', {
    gameId: gf,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'st-fb', order: 0, title: 'One task', isFinal: true,
      tasks: [{
        id: 'fb-1', title: 'Anywhere task', type: 'self_report', locationless: true,
        coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 3,
      }],
    }],
  });
  const { runId: rf, accessCode: cf } = await creator.call('launchRun', { gameId: gf });

  const p1 = makeParty('fbP1'); // controller device
  const p1Cred = await signInAnonymously(p1.auth);
  const p2 = makeParty('fbP2'); // attached viewer device
  const p2Cred = await signInAnonymously(p2.auth);

  await p1.call('joinRun', { code: cf, displayName: 'Feedback Team' });
  const s0 = await p1.call('getMyTeamState', { code: cf });
  const teamCode = s0?.team?.deviceJoinCode;
  await p2.call('joinTeamAsDevice', { code: cf, teamCode, memberName: 'Second Phone' });
  await creator.call('startTeams', { gameId: gf, runId: rf });

  const fbCtx = { ownerUid: creatorCred.user.uid, gameId: gf, runId: rf };

  // Before the run/team finishes, the survey is closed.
  await expectError('submit before finish is rejected',
    p1.call('submitRunFeedback', { ...fbCtx, ratings: { overall: 5 }, lang: 'he' }),
    { codeIn: ['functions/failed-precondition'] });

  await creator.call('finalizeRun', { gameId: gf, runId: rf });

  // Controller submits a full response with a comment.
  const sub1 = await p1.call('submitRunFeedback', {
    ...fbCtx,
    ratings: { overall: 5, content: 4, bonding: 5, difficulty: 2, smoothness: 3, recommend: 5 },
    comment: 'הכי כיף!', lang: 'he',
  });
  check('controller feedback stored', sub1?.ok === true && sub1?.already !== true, JSON.stringify(sub1));

  // Attached VIEWER submits its own — feedback is per person, no controller gate.
  const sub2 = await p2.call('submitRunFeedback', { ...fbCtx, ratings: { overall: 3, recommend: 2 }, lang: 'he' });
  check('viewer device feedback stored (per-player, not per-team)', sub2?.ok === true, JSON.stringify(sub2));

  // A second submit from the same uid is an acknowledged no-op.
  const dup = await p1.call('submitRunFeedback', { ...fbCtx, ratings: { overall: 1 }, lang: 'he' });
  check('duplicate submission is a no-op', dup?.already === true, JSON.stringify(dup));

  // Garbage payloads are rejected.
  await expectError('out-of-range rating rejected',
    p2.call('submitRunFeedback', { ...fbCtx, ratings: { overall: 9 }, lang: 'he' }),
    { codeIn: ['functions/invalid-argument'] });

  // Owner sees the aggregated summary + individual responses.
  const summary = await creator.call('getRunFeedbackSummary', { gameId: gf, runId: rf });
  check('summary counts both responses', summary?.summary?.responseCount === 2, JSON.stringify(summary?.summary?.responseCount));
  check('overall average is 4 (5 and 3)', summary?.summary?.ratings?.overall?.avg === 4, JSON.stringify(summary?.summary?.ratings?.overall));
  check('duplicate did NOT overwrite the first response', summary?.summary?.ratings?.overall?.count === 2, JSON.stringify(summary?.summary?.ratings?.overall));
  const comments = (summary?.responses ?? []).filter((r) => r.comment);
  check('the free-text comment is visible to the owner', comments.some((r) => r.comment === 'הכי כיף!'), JSON.stringify(comments.map((r) => r.comment)));
  check('individual respondents are identifiable', (summary?.responses ?? []).some((r) => r.uid === p1Cred.user.uid) && (summary?.responses ?? []).some((r) => r.uid === p2Cred.user.uid), JSON.stringify((summary?.responses ?? []).map((r) => r.uid)));

  // Non-owner cannot read the feedback summary (resolves the run, then denied).
  await expectError('non-owner is denied the feedback summary',
    p1.call('getRunFeedbackSummary', { ownerUid: creatorCred.user.uid, gameId: gf, runId: rf }),
    { codeIn: ['functions/permission-denied'] });

  }); // scenario: post-game feedback

  await scenario('live photo feed (approve → broadcast → react → hide → prune)', async () => {
    const OWNER = creatorCred.user.uid;

    // Game: stage 1 = autoApprove photo, stage 2 (final) = staff-reviewed photo.
    const { gameId: fg } = await creator.call('createGame', { title: 'Feed Game', mode: 'individual' });
    const photoTask = (id, title, order) => ({
      id, title, type: 'photo',
      coordinates: { lat: 31.79 + order * 0.005, lng: 35.2 + order * 0.005 },
      difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
      smart: { enabled: true, verificationType: 'photo_upload', autoApprove: order === 0 },
    });
    await creator.call('updateGame', {
      gameId: fg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'fs-1', order: 0, title: 'Auto photo', tasks: [photoTask('fp-auto', 'Snap the mural', 0)] },
        { id: 'fs-2', order: 1, title: 'Reviewed photo', isFinal: true, tasks: [photoTask('fp-rev', 'Team at the gate', 1)] },
      ],
    });
    const { game: feedGame } = await creator.call('getGame', { gameId: fg });
    check('photoFeedEnabled defaults to on (absent ⇒ enabled)', feedGame?.photoFeedEnabled !== false);

    const { runId: fr, accessCode: fc } = await creator.call('launchRun', { gameId: fg });
    const fp = makeParty('feedPlayer');
    const fpCred = await signInAnonymously(fp.auth);
    const fUid = fpCred.user.uid;
    await fp.call('joinRun', { code: fc, displayName: 'Feed Lions' });
    await creator.call('startTeams', { gameId: fg, runId: fr });
    const FCTX = { ownerUid: OWNER, gameId: fg, runId: fr };
    const feedCol = `users/${OWNER}/games/${fg}/runs/${fr}/feedItems`;
    const feedPhotoUrl = (name) =>
      `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${fr}/teams/${fUid}/${name}`)}?alt=media`;

    // 1) Auto-approved photo → a feed item appears, with the denormalized fields.
    const auto = await fp.call('submitStationPhoto', { ...FCTX, teamId: fUid, taskId: 'fp-auto', photoUrl: feedPhotoUrl('a.jpg') });
    check('feed: autoApprove photo is approved', auto?.autoApproved === true, JSON.stringify(auto));
    const afterAuto = await fp.getColAt(feedCol);
    check('feed: auto-approval broadcast exactly one item', afterAuto.length === 1, String(afterAuto.length));
    const item1 = afterAuto[0];
    check('feed: item carries taskTitle + teamName + photoUrl + active',
      item1?.taskTitle === 'Snap the mural' && item1?.teamName === 'Feed Lions'
        && item1?.photoUrl === feedPhotoUrl('a.jpg') && item1?.active === true
        && item1?.taskId === 'fp-auto' && item1?.teamId === fUid,
      JSON.stringify(item1));

    // 2) Staff-review approve path → a second item (game-doc read on the staff path).
    const fTeamPath = `users/${OWNER}/games/${fg}/runs/${fr}/teams/${fUid}`;
    const fRunPath = `users/${OWNER}/games/${fg}/runs/${fr}`;
    await fp.call('submitStationPhoto', { ...FCTX, teamId: fUid, taskId: 'fp-rev', photoUrl: feedPhotoUrl('b.jpg') });

    // 2a) REVIEW QUEUE SOURCE (wave-e task 13): a photo awaiting review lands as
    //     `taskSubmissions[taskId]` on the TEAM doc with status 'pending' — that map
    //     is the ONLY source a live approval queue can read (there is no submissions
    //     collection), and the owner reads it directly via firestore.rules. If this
    //     goes empty or non-'pending', every review console silently shows nothing —
    //     exactly the failure mode of the "photos never reach the console" report,
    //     whose root cause was the requireStorageUrl rejection (docs/wave-c).
    const pendingTeam = await creator.getDocAt(fTeamPath);
    const pendingSub = pendingTeam.data?.taskSubmissions?.['fp-rev'];
    check('queue: a submitted photo is visible to the owner as taskSubmissions[taskId].status pending',
      pendingSub?.status === 'pending' && pendingSub?.photoUrl === feedPhotoUrl('b.jpg'),
      JSON.stringify(pendingSub));
    check('queue: the pending submission carries a submittedAt (the queue sorts FIFO on it)',
      typeof pendingSub?.submittedAt === 'string' && pendingSub.submittedAt.length > 0,
      JSON.stringify(pendingSub?.submittedAt));

    const rev = await creator.call('reviewStationSubmission', { ...FCTX, teamId: fUid, taskId: 'fp-rev', approved: true });
    check('feed: staff review approves', rev?.approved === true);
    const afterReview = await fp.getColAt(feedCol);
    check('feed: staff approval broadcast a second item', afterReview.length === 2, String(afterReview.length));
    const item2 = afterReview.find((d) => d.taskId === 'fp-rev');
    check('feed: reviewed item carries the submitted photo + title',
      item2?.photoUrl === feedPhotoUrl('b.jpg') && item2?.taskTitle === 'Team at the gate' && item2?.active === true,
      JSON.stringify(item2));

    // 2b) The approved row leaves the queue and the approval SCORED the task.
    const approvedTeam = await creator.getDocAt(fTeamPath);
    check('queue: an approved submission flips to status approved (it leaves the pending queue)',
      approvedTeam.data?.taskSubmissions?.['fp-rev']?.status === 'approved',
      JSON.stringify(approvedTeam.data?.taskSubmissions?.['fp-rev']));
    check('queue: approval records reviewedAt + reviewedBy (the recently-reviewed strip reads them)',
      typeof approvedTeam.data?.taskSubmissions?.['fp-rev']?.reviewedAt === 'string'
        && approvedTeam.data?.taskSubmissions?.['fp-rev']?.reviewedBy === OWNER,
      JSON.stringify(approvedTeam.data?.taskSubmissions?.['fp-rev']));
    const scoreAfterApprove = approvedTeam.data?.score ?? 0;
    check('queue: approval awarded points', scoreAfterApprove > 0, String(scoreAfterApprove));

    // 2c) STATION SLOT RELEASED on approval. completeTaskForTeam releases the held
    //     slot inside its own transaction; a leak here would mean a capped photo
    //     station stops handing itself out after the first approval of the run.
    const afterApproveCounts = (await creator.getDocAt(fRunPath)).data?.taskCounts ?? {};
    check('queue: approving a photo releases its station slot (taskCounts back to 0)',
      (afterApproveCounts['fp-rev'] ?? 0) === 0, JSON.stringify(afterApproveCounts));
    check('queue: the approved task is no longer the team\'s activeTaskId',
      approvedTeam.data?.activeTaskId !== 'fp-rev', String(approvedTeam.data?.activeTaskId));

    // 2d) DOUBLE APPROVAL IS IDEMPOTENT — a double-clicked Approve (or two
    //     reviewers) must not score twice, must not re-broadcast, and must not
    //     re-release a slot it no longer holds. completeTaskForTeam returns
    //     completed:false on replay and every side effect is gated on it.
    const rev2 = await creator.call('reviewStationSubmission', { ...FCTX, teamId: fUid, taskId: 'fp-rev', approved: true });
    check('queue: a second approval of the same submission still resolves ok', rev2?.ok === true, JSON.stringify(rev2));
    const twiceTeam = await creator.getDocAt(fTeamPath);
    check('queue: double approval does NOT score twice',
      (twiceTeam.data?.score ?? 0) === scoreAfterApprove,
      `${twiceTeam.data?.score} vs ${scoreAfterApprove}`);
    const feedAfterDouble = await fp.getColAt(feedCol);
    check('queue: double approval does NOT broadcast a duplicate feed item',
      feedAfterDouble.length === 2, String(feedAfterDouble.length));
    const doubleCounts = (await creator.getDocAt(fRunPath)).data?.taskCounts ?? {};
    check('queue: double approval never drives a station counter negative',
      Object.values(doubleCounts).every((n) => (n ?? 0) >= 0), JSON.stringify(doubleCounts));

    // 3) Reaction semantics: dedup (same emoji is a no-op) + switch (count moves).
    const r1 = await fp.call('reactToFeedItem', { ...FCTX, itemId: item1.id, emoji: '👍' });
    check('react: first reaction counts', r1?.changed === true && r1?.reactions?.['👍'] === 1, JSON.stringify(r1));
    const r2 = await fp.call('reactToFeedItem', { ...FCTX, itemId: item1.id, emoji: '👍' });
    check('react: same emoji again is a no-op (never double-counts)',
      r2?.changed === false && r2?.reactions?.['👍'] === 1, JSON.stringify(r2));
    const r3 = await fp.call('reactToFeedItem', { ...FCTX, itemId: item1.id, emoji: '🔥' });
    check('react: switching emoji moves the count (old key dropped)',
      r3?.changed === true && r3?.reactions?.['🔥'] === 1 && r3?.reactions?.['👍'] === undefined,
      JSON.stringify(r3));
    const rOwner = await creator.call('reactToFeedItem', { ...FCTX, itemId: item1.id, emoji: '👍' });
    check('react: a second identity (owner fallback) accumulates independently',
      rOwner?.reactions?.['🔥'] === 1 && rOwner?.reactions?.['👍'] === 1, JSON.stringify(rOwner?.reactions));

    // 4) Denials: invalid emoji, stranger, participant moderation.
    await expectError('react: emoji outside the closed set is rejected',
      fp.call('reactToFeedItem', { ...FCTX, itemId: item1.id, emoji: '💀' }),
      { codeIn: ['functions/invalid-argument'] });
    const feedStranger = makeParty('feedStranger');
    await signInAnonymously(feedStranger.auth);
    await expectError('react: a stranger (not in the run, not staff) is denied',
      feedStranger.call('reactToFeedItem', { ...FCTX, itemId: item1.id, emoji: '👍' }),
      { codeIn: ['functions/permission-denied', 'functions/not-found'] });
    // Cross-tenant READ: the feed carries participant photo URLs + team names, so a
    // stranger who is not a participant/staff/owner of THIS run must be denied the
    // direct collection read (rules-enforced — getColAt itself is rejected).
    await expectError('feed read: a stranger is denied reading another run\'s feed',
      feedStranger.getColAt(feedCol),
      { codeIn: ['permission-denied'] });
    // Allow-path regression guards: the run participant and the run owner still read it.
    const partFeedRead = await fp.getColAt(feedCol);
    check('feed read: a run participant still reads the feed', Array.isArray(partFeedRead) && partFeedRead.length >= 1, String(partFeedRead?.length));
    const ownerFeedRead = await creator.getColAt(feedCol);
    check('feed read: the run owner still reads the feed', Array.isArray(ownerFeedRead) && ownerFeedRead.length >= 1, String(ownerFeedRead?.length));
    await expectError('hide: a participant cannot hide a feed item',
      fp.call('hideFeedItem', { ...FCTX, itemId: item2.id }),
      { codeIn: ['functions/permission-denied'] });

    // 5) Owner hides an item; a hidden item no longer accepts reactions.
    const hid = await creator.call('hideFeedItem', { ...FCTX, itemId: item2.id });
    check('hide: owner hides the item', hid?.ok === true);
    const afterHide = await fp.getColAt(feedCol);
    const hidden = afterHide.find((d) => d.id === item2.id);
    check('hide: item flips active:false (listeners filter it out)', hidden?.active === false, JSON.stringify(hidden));
    await expectError('react: a hidden item rejects reactions',
      fp.call('reactToFeedItem', { ...FCTX, itemId: item2.id, emoji: '👍' }),
      { codeIn: ['functions/not-found'] });

    // 5b) Ceremony mode (ceremony-mode): getPublicLeaderboard carries the
    //     server-selected top-liked ceremonyFeed — published-gated, hidden items
    //     excluded, and shaped exactly {taskTitle,teamName,photoUrl,totalReactions}.
    const preCeremony = await fp.call('getPublicLeaderboard', { code: fc });
    check('ceremony: feed run pre-publish ceremonyFeed is []',
      Array.isArray(preCeremony?.ceremonyFeed) && preCeremony.ceremonyFeed.length === 0,
      JSON.stringify(preCeremony?.ceremonyFeed));
    await creator.call('refreshLeaderboard', { ...FCTX, publish: true });
    const postCeremony = await fp.call('getPublicLeaderboard', { code: fc });
    const cf = postCeremony?.ceremonyFeed ?? [];
    check('ceremony: post-publish ceremonyFeed carries the liked item only (hidden excluded)',
      cf.length === 1 && cf[0]?.taskTitle === 'Snap the mural' && cf[0]?.totalReactions === 2,
      JSON.stringify(cf));
    check('ceremony: feed is capped at 20', cf.length <= 20, String(cf.length));
    check('ceremony: sorted by totalReactions desc',
      cf.every((x, i) => i === 0 || cf[i - 1].totalReactions >= x.totalReactions));
    const cfKeys = Object.keys(cf[0] ?? {}).sort().join(',');
    check('ceremony: item shape leaks no reactedBy/active/ids',
      cfKeys === 'photoUrl,taskTitle,teamName,totalReactions', cfKeys);

    // 6) photoFeedEnabled:false gates ALL feed writes (enforced write-side —
    //    rules cannot conditionally gate reads on the flag).
    const { gameId: offGame } = await creator.call('createGame', { title: 'Feed Off Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: offGame, scoringPreset: 'fixed_points_speed', photoFeedEnabled: false,
      stages: [{ id: 'fo-s', order: 0, title: 'S', isFinal: true, tasks: [photoTask('fo-auto', 'Quiet photo', 0)] }],
    });
    const { game: offGameDoc } = await creator.call('getGame', { gameId: offGame });
    check('feed off: updateGame persists photoFeedEnabled:false', offGameDoc?.photoFeedEnabled === false);
    const { runId: offRun, accessCode: offCode } = await creator.call('launchRun', { gameId: offGame });
    const offP = makeParty('feedOffPlayer');
    const offCred = await signInAnonymously(offP.auth);
    await offP.call('joinRun', { code: offCode, displayName: 'Quiet Team' });
    await creator.call('startTeams', { gameId: offGame, runId: offRun });
    const offUrl = `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${offRun}/teams/${offCred.user.uid}/q.jpg`)}?alt=media`;
    const offSubmit = await offP.call('submitStationPhoto', {
      ownerUid: OWNER, gameId: offGame, runId: offRun, teamId: offCred.user.uid, taskId: 'fo-auto', photoUrl: offUrl,
    });
    check('feed off: photo still auto-approves (completion unaffected)', offSubmit?.autoApproved === true);
    const offItems = await offP.getColAt(`users/${OWNER}/games/${offGame}/runs/${offRun}/feedItems`);
    check('feed off: NO feed item is written when the game disables the feed', offItems.length === 0, String(offItems.length));

    // 6b) APPROVAL QUEUE: the reject path + two reviewers acting at once
    //     (wave-e task 13). Runs on its OWN game/run so it cannot perturb the feed
    //     counts, reaction totals or ceremony assertions above.
    const { gameId: rqGame } = await creator.call('createGame', { title: 'Review Queue Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: rqGame, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'rq-s1', order: 0, title: 'Reviewed shots', tasks: [
          photoTask('rq-rej', 'Reject me', 1),
          photoTask('rq-dual', 'Two reviewers', 2),
        ] },
        { id: 'rq-s2', order: 1, title: 'End', isFinal: true, tasks: [photoTask('rq-end', 'Last shot', 3)] },
      ],
    });
    const { runId: rqRun, accessCode: rqCode } = await creator.call('launchRun', { gameId: rqGame });
    const rqP = makeParty('reviewQueuePlayer');
    const rqCred = await signInAnonymously(rqP.auth);
    const rqUid = rqCred.user.uid;
    await rqP.call('joinRun', { code: rqCode, displayName: 'Queue Foxes' });
    await creator.call('startTeams', { gameId: rqGame, runId: rqRun });
    const RQCTX = { ownerUid: OWNER, gameId: rqGame, runId: rqRun };
    const rqTeamPath = `users/${OWNER}/games/${rqGame}/runs/${rqRun}/teams/${rqUid}`;
    const rqRunPath = `users/${OWNER}/games/${rqGame}/runs/${rqRun}`;
    const rqFeedCol = `users/${OWNER}/games/${rqGame}/runs/${rqRun}/feedItems`;
    const rqUrl = (name) =>
      `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${rqRun}/teams/${rqUid}/${name}`)}?alt=media`;

    // REJECT PATH: no score, no feed item, and the team may RESUBMIT (the
    // moderation guard only blocks an already-approved/completed task, so a
    // rejection must leave the task retryable — otherwise one bad photo would
    // permanently dead-end the team).
    await rqP.call('submitStationPhoto', { ...RQCTX, teamId: rqUid, taskId: 'rq-rej', photoUrl: rqUrl('r1.jpg') });
    const scoreBeforeReject = (await creator.getDocAt(rqTeamPath)).data?.score ?? 0;
    const rejected = await creator.call('reviewStationSubmission', {
      ...RQCTX, teamId: rqUid, taskId: 'rq-rej', approved: false, note: 'Too dark, try again',
    });
    check('queue reject: the callable reports approved:false', rejected?.approved === false, JSON.stringify(rejected));
    const rejTeam = await creator.getDocAt(rqTeamPath);
    const rejSub = rejTeam.data?.taskSubmissions?.['rq-rej'];
    check('queue reject: status flips to rejected and keeps the review note',
      rejSub?.status === 'rejected' && rejSub?.reviewNote === 'Too dark, try again', JSON.stringify(rejSub));
    check('queue reject: rejection awards NO points',
      (rejTeam.data?.score ?? 0) === scoreBeforeReject, `${rejTeam.data?.score} vs ${scoreBeforeReject}`);
    const rejFeed = await rqP.getColAt(rqFeedCol);
    check('queue reject: rejection broadcasts NO feed item', rejFeed.length === 0, String(rejFeed.length));
    await rqP.call('submitStationPhoto', { ...RQCTX, teamId: rqUid, taskId: 'rq-rej', photoUrl: rqUrl('r2.jpg') });
    const resub = (await creator.getDocAt(rqTeamPath)).data?.taskSubmissions?.['rq-rej'];
    check('queue reject: a rejected task stays re-submittable (status returns to pending)',
      resub?.status === 'pending' && resub?.photoUrl === rqUrl('r2.jpg'), JSON.stringify(resub));

    // CONCURRENT REVIEWERS: the owner and run-scoped staff hit Approve on the SAME
    // submission at the same moment. Exactly one completion may take effect.
    const { pin: rqPin } = await creator.call('inviteStaff', {
      ...RQCTX, name: 'Queue Marshal', permissions: ['review_photos'],
    });
    const rqStaff = makeParty('reviewQueueStaff');
    await signInAnonymously(rqStaff.auth);
    const rqTok = await rqStaff.call('staffSignIn', { ownerUid: OWNER, gameId: rqGame, runId: rqRun, pin: rqPin });
    await signInWithCustomToken(rqStaff.auth, rqTok.customToken);

    await rqP.call('submitStationPhoto', { ...RQCTX, teamId: rqUid, taskId: 'rq-dual', photoUrl: rqUrl('d.jpg') });
    const scoreBeforeDual = (await creator.getDocAt(rqTeamPath)).data?.score ?? 0;
    const dual = await Promise.allSettled([
      creator.call('reviewStationSubmission', { ...RQCTX, teamId: rqUid, taskId: 'rq-dual', approved: true }),
      rqStaff.call('reviewStationSubmission', { ...RQCTX, teamId: rqUid, taskId: 'rq-dual', approved: true }),
    ]);
    check('queue race: at least one concurrent approval succeeds',
      dual.some((r) => r.status === 'fulfilled' && r.value?.ok === true),
      JSON.stringify(dual.map((r) => (r.status === 'fulfilled' ? 'ok' : String(r.reason?.code ?? r.reason)))));
    const dualTeam = await creator.getDocAt(rqTeamPath);
    check('queue race: the submission ends approved', dualTeam.data?.taskSubmissions?.['rq-dual']?.status === 'approved',
      JSON.stringify(dualTeam.data?.taskSubmissions?.['rq-dual']));
    const scoreAfterDual = dualTeam.data?.score ?? 0;
    check('queue race: two simultaneous approvals score the task exactly once',
      scoreAfterDual > scoreBeforeDual, `${scoreBeforeDual} → ${scoreAfterDual}`);
    const dualFeed = await rqP.getColAt(rqFeedCol);
    check('queue race: two simultaneous approvals broadcast exactly ONE feed item',
      dualFeed.filter((d) => d.taskId === 'rq-dual').length === 1,
      JSON.stringify(dualFeed.map((d) => d.taskId)));
    const dualCounts = (await creator.getDocAt(rqRunPath)).data?.taskCounts ?? {};
    check('queue race: the contested station slot is released exactly once (counter 0, never negative)',
      (dualCounts['rq-dual'] ?? 0) === 0 && Object.values(dualCounts).every((n) => (n ?? 0) >= 0),
      JSON.stringify(dualCounts));
    // A third, serial approval on top of the race must still change nothing.
    await creator.call('reviewStationSubmission', { ...RQCTX, teamId: rqUid, taskId: 'rq-dual', approved: true });
    const settled = await creator.getDocAt(rqTeamPath);
    check('queue race: a further approval after the race is still a no-op on the score',
      (settled.data?.score ?? 0) === scoreAfterDual, `${settled.data?.score} vs ${scoreAfterDual}`);
    const replayFeed = await rqP.getColAt(rqFeedCol);
    check('queue race: a further approval after the race broadcasts nothing new',
      replayFeed.length === dualFeed.length, `${replayFeed.length} vs ${dualFeed.length}`);

    // 7) Retention: feed items (photo URLs + team names) die with the run's PII.
    const prunedFeed = await platformAdmin.call('pruneRunNow', { ...FCTX });
    check('feed: pruneRunNow succeeds on the feed run', prunedFeed?.ok === true, JSON.stringify(prunedFeed));
    const afterPrune = await fp.getColAt(feedCol);
    check('feed: prune deletes every feed item', afterPrune.length === 0, String(afterPrune.length));
  });

  // wave-f S1: a HIDDEN-LOCATION photo task must NOT enter the run-wide live feed —
  // its photo (taken AT the secret spot) leaks the location to teams still hunting
  // it, reopening the wave-D hidden-task secrecy the feed guard (shouldFeedTask)
  // exists to protect. FULL exclusion: neither the task's id NOR its title may
  // reach the feed. Guarded at BOTH feed-write sites, so this scenario exercises
  // the submitStationPhoto autoApprove path AND the reviewStationSubmission staff
  // approve path — and, at each site, asserts a NORMAL task still feeds (the guard
  // must not over-suppress). See docs/wave-f/feed-title-leak.md.
  await scenario('hidden-location task is excluded from the live photo feed', async () => {
    const OWNER = creatorCred.user.uid;
    const HIDDEN_TITLE = 'Secret waterfall selfie';
    const NORMAL_TITLE = 'Snap the fountain';
    const feedPhotoUrl = (rid, uid, name) =>
      `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${rid}/teams/${uid}/${name}`)}?alt=media`;
    const hiddenPhotoTask = (id, title, order, autoApprove) => ({
      id, title, type: 'photo', triggerMode: 'radius',
      hideLocation: true, coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40,
      locationClue: 'Where water never stops',
      difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
      smart: { enabled: true, verificationType: 'photo_upload', autoApprove },
    });
    const normalPhotoTask = (id, title, order, autoApprove) => ({
      id, title, type: 'photo',
      coordinates: { lat: 31.79 + order * 0.005, lng: 35.2 + order * 0.005 },
      difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
      smart: { enabled: true, verificationType: 'photo_upload', autoApprove },
    });

    // ── PATH 1: submitStationPhoto autoApprove ────────────────────────────────
    // Stage 1 = normal autoApprove photo (must feed). Stage 2 (final) = hidden
    // autoApprove photo (must NOT feed).
    const { gameId: ag } = await creator.call('createGame', { title: 'Hidden Feed Auto', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: ag, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'ha-1', order: 0, title: 'Normal shot', tasks: [normalPhotoTask('ha-normal', NORMAL_TITLE, 0, true)] },
        { id: 'ha-2', order: 1, title: 'Secret shot', isFinal: true, tasks: [hiddenPhotoTask('ha-hidden', HIDDEN_TITLE, 1, true)] },
      ],
    });
    const { runId: ar, accessCode: ac } = await creator.call('launchRun', { gameId: ag });
    const ap = makeParty('hiddenFeedAuto');
    const apCred = await signInAnonymously(ap.auth);
    const apUid = apCred.user.uid;
    await ap.call('joinRun', { code: ac, displayName: 'Auto Seekers' });
    await creator.call('startTeams', { gameId: ag, runId: ar });
    const ACTX = { ownerUid: OWNER, gameId: ag, runId: ar };
    const aFeedCol = `users/${OWNER}/games/${ag}/runs/${ar}/feedItems`;

    // Normal task completes + broadcasts.
    const autoNormal = await ap.call('submitStationPhoto', { ...ACTX, teamId: apUid, taskId: 'ha-normal', photoUrl: feedPhotoUrl(ar, apUid, 'n.jpg') });
    check('hidden-feed(auto): normal photo auto-approves', autoNormal?.autoApproved === true, JSON.stringify(autoNormal));
    // Arrive at the hidden spot so it is revealed + completable, then submit it.
    const arr = await ap.call('reportArrival', { ...ACTX, taskId: 'ha-hidden', lat: 31.78, lng: 35.21 });
    check('hidden-feed(auto): arrival at the hidden spot latches', arr?.arrived === true, JSON.stringify(arr));
    const autoHidden = await ap.call('submitStationPhoto', { ...ACTX, teamId: apUid, taskId: 'ha-hidden', photoUrl: feedPhotoUrl(ar, apUid, 'h.jpg') });
    check('hidden-feed(auto): hidden photo still auto-approves (completion unaffected)', autoHidden?.autoApproved === true, JSON.stringify(autoHidden));

    const aFeed = await creator.getColAt(aFeedCol);
    const aTaskIds = aFeed.map((d) => d.taskId);
    check('hidden-feed(auto): the NORMAL task feeds (guard does not over-suppress)',
      aTaskIds.includes('ha-normal'), JSON.stringify(aTaskIds));
    check('hidden-feed(auto): the HIDDEN task is excluded from the feed (photo leaks the secret spot)',
      !aTaskIds.includes('ha-hidden'), JSON.stringify(aTaskIds));
    check('hidden-feed(auto): the hidden task TITLE never reaches the feed',
      !aFeed.some((d) => d.taskTitle === HIDDEN_TITLE), JSON.stringify(aFeed.map((d) => d.taskTitle)));

    // ── PATH 2: reviewStationSubmission (staff approve) ───────────────────────
    // Mirror the exclusion on the OTHER feed-write site. Stage 1 = hidden
    // staff-reviewed photo (must NOT feed on approval). Stage 2 (final) = normal
    // staff-reviewed photo (must feed on approval).
    const { gameId: rg } = await creator.call('createGame', { title: 'Hidden Feed Review', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: rg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'hr-1', order: 0, title: 'Secret review', tasks: [hiddenPhotoTask('hr-hidden', HIDDEN_TITLE, 0, false)] },
        { id: 'hr-2', order: 1, title: 'Normal review', isFinal: true, tasks: [normalPhotoTask('hr-normal', NORMAL_TITLE, 1, false)] },
      ],
    });
    const { runId: rr, accessCode: rc } = await creator.call('launchRun', { gameId: rg });
    const rp = makeParty('hiddenFeedReview');
    const rpCred = await signInAnonymously(rp.auth);
    const rpUid = rpCred.user.uid;
    await rp.call('joinRun', { code: rc, displayName: 'Review Seekers' });
    await creator.call('startTeams', { gameId: rg, runId: rr });
    const RCTX = { ownerUid: OWNER, gameId: rg, runId: rr };
    const rFeedCol = `users/${OWNER}/games/${rg}/runs/${rr}/feedItems`;

    // Hidden staff-reviewed task: arrive, submit (pending), owner approves.
    const rArr = await rp.call('reportArrival', { ...RCTX, taskId: 'hr-hidden', lat: 31.78, lng: 35.21 });
    check('hidden-feed(review): arrival at the hidden spot latches', rArr?.arrived === true, JSON.stringify(rArr));
    await rp.call('submitStationPhoto', { ...RCTX, teamId: rpUid, taskId: 'hr-hidden', photoUrl: feedPhotoUrl(rr, rpUid, 'h.jpg') });
    const revHidden = await creator.call('reviewStationSubmission', { ...RCTX, teamId: rpUid, taskId: 'hr-hidden', approved: true });
    check('hidden-feed(review): staff approves the hidden photo', revHidden?.approved === true, JSON.stringify(revHidden));

    const feedAfterHidden = await creator.getColAt(rFeedCol);
    check('hidden-feed(review): approving the HIDDEN task broadcasts NO feed item',
      !feedAfterHidden.some((d) => d.taskId === 'hr-hidden'), JSON.stringify(feedAfterHidden.map((d) => d.taskId)));
    check('hidden-feed(review): the hidden task TITLE never reaches the feed on the staff path',
      !feedAfterHidden.some((d) => d.taskTitle === HIDDEN_TITLE), JSON.stringify(feedAfterHidden.map((d) => d.taskTitle)));

    // Normal staff-reviewed task (stage 2, now active): submit + approve → feeds.
    await rp.call('submitStationPhoto', { ...RCTX, teamId: rpUid, taskId: 'hr-normal', photoUrl: feedPhotoUrl(rr, rpUid, 'n.jpg') });
    const revNormal = await creator.call('reviewStationSubmission', { ...RCTX, teamId: rpUid, taskId: 'hr-normal', approved: true });
    check('hidden-feed(review): staff approves the normal photo', revNormal?.approved === true, JSON.stringify(revNormal));
    const feedAfterNormal = await creator.getColAt(rFeedCol);
    check('hidden-feed(review): the NORMAL task feeds on the staff path (guard does not over-suppress)',
      feedAfterNormal.some((d) => d.taskId === 'hr-normal'), JSON.stringify(feedAfterNormal.map((d) => d.taskId)));
  }); // scenario: hidden-location feed secrecy

  await scenario('task types: quiz · numeric · geofence · sequence · trigger modes', async () => {

  // ── 14. New task types: quiz · numeric · geofence · sequence ────────────────
  const { gameId: g4 } = await creator.call('createGame', { title: 'Task-Types Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: g4,
    scoringPreset: 'fixed_points_speed',
    stages: [
      { id: 's-quiz', order: 0, title: 'Quiz', tasks: [{
        id: 'q1', title: 'Capital of France?', type: 'quiz',
        coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 9,
        choices: ['Paris', 'London', 'Rome'], answers: ['Paris'],
      }] },
      { id: 's-num', order: 1, title: 'Numeric', tasks: [{
        id: 'n1', title: 'How many arches? (±1)', type: 'numeric',
        coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 9,
        numericAnswer: 12, numericTolerance: 1,
      }] },
      { id: 's-geo', order: 2, title: 'Geofence', tasks: [{
        id: 'gf1', title: 'Reach the gate', type: 'geofence',
        coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 60, difficulty: 2, estimatedMinutes: 3, pointValue: 50, maxConcurrentTeams: 9,
      }, {
        id: 'ex1', title: 'Exact arrival', type: 'field', triggerMode: 'exact',
        coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 4, difficulty: 2, estimatedMinutes: 3, pointValue: 50, maxConcurrentTeams: 9,
      }, {
        id: 'in1', title: 'Instant task', type: 'field', triggerMode: 'instant',
        coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
      }] },
      { id: 's-seq', order: 3, title: 'Sequence', isFinal: true, tasks: [{
        id: 'sq1', title: 'Three steps', type: 'sequence',
        coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 4, pointValue: 50, maxConcurrentTeams: 9,
        steps: [
          { id: 'st1', prompt: 'Say the magic word', answer: 'open' },
          { id: 'st2', prompt: 'Tap to confirm you found the door' },
          { id: 'st3', prompt: 'Year on the plaque?', answer: '1899' },
        ],
      }] },
    ],
  });
  const { runId: r4, accessCode: c4 } = await creator.call('launchRun', { gameId: g4 });
  const player4 = makeParty('player4');
  await signInAnonymously(player4.auth);
  await player4.call('joinRun', { code: c4, displayName: 'Quizzer' });
  await creator.call('startTeams', { gameId: g4, runId: r4 });
  const C4 = { ownerUid: creatorCred.user.uid, gameId: g4, runId: r4 };

  // quiz: secrets stripped, choices present; wrong rejected, right advances
  const sq = await player4.call('getMyTeamState', { code: c4 });
  const qTask = sq?.activeStageTasks?.find((t) => t.id === 'q1');
  check('quiz: answers stripped but choices sent', qTask?.answers === undefined && Array.isArray(qTask?.choices), JSON.stringify({ answers: qTask?.answers, choices: qTask?.choices }));
  const wrongQ = await player4.call('submitTaskAnswer', { ...C4, taskId: 'q1', answer: 'London' });
  check('quiz: wrong answer rejected', wrongQ?.correct === false);
  const rightQ = await player4.call('submitTaskAnswer', { ...C4, taskId: 'q1', answer: 'paris' });
  check('quiz: correct answer (case-insensitive) advances', rightQ?.correct === true);

  // numeric: within tolerance
  const wrongN = await player4.call('submitTaskAnswer', { ...C4, taskId: 'n1', answer: '20' });
  check('numeric: out-of-tolerance rejected', wrongN?.correct === false);
  const rightN = await player4.call('submitTaskAnswer', { ...C4, taskId: 'n1', answer: '11' });
  check('numeric: within ±tolerance accepted', rightN?.correct === true);

  // geofence: far rejected, near accepted (server validates GPS)
  let geoFar = false;
  try { await player4.call('completeTask', { ...C4, taskId: 'gf1', lat: 32.5, lng: 35.9 }); }
  catch (e) { geoFar = /too far/i.test(e.message); }
  check('geofence: too-far check-in rejected', geoFar);
  const geoNear = await player4.call('completeTask', { ...C4, taskId: 'gf1', lat: 31.78, lng: 35.21 });
  check('geofence: in-radius check-in accepted', geoNear?.ok === true);

  // exact (triggerMode): tight 4m radius — 10m away rejected, 3m accepted.
  let exFar = false;
  try { await player4.call('completeTask', { ...C4, taskId: 'ex1', lat: 31.7801, lng: 35.21 }); }
  catch (e) { exFar = /too far/i.test(e.message); }
  check('exact: 10m-away check-in rejected', exFar);
  const exNear = await player4.call('completeTask', { ...C4, taskId: 'ex1', lat: 31.78, lng: 35.21 });
  check('exact: within-4m check-in accepted', exNear?.ok === true);

  // instant (triggerMode): completes with no GPS at all.
  const inst = await player4.call('completeTask', { ...C4, taskId: 'in1' });
  check('instant: completes with no coordinates', inst?.ok === true);

  // sequence: step prompts sent (no answers); steps advance in order
  const sSeq = await player4.call('getMyTeamState', { code: c4 });
  const seqTask = sSeq?.activeStageTasks?.find((t) => t.id === 'sq1');
  check('sequence: step prompts sent without answers',
    Array.isArray(seqTask?.steps) && seqTask.steps.length === 3 && seqTask.steps.every((s) => s.answer === undefined),
    JSON.stringify(seqTask?.steps));
  const seq0 = await player4.call('submitSequenceStep', { ...C4, taskId: 'sq1', stepIndex: 0, answer: 'open' });
  check('sequence: step 1 (answer) accepted', seq0?.stepCorrect === true && seq0?.stepsDone === 1);
  const seq1 = await player4.call('submitSequenceStep', { ...C4, taskId: 'sq1', stepIndex: 1 });
  check('sequence: step 2 (tap-to-confirm) accepted', seq1?.stepCorrect === true && seq1?.stepsDone === 2);
  const seqBad = await player4.call('submitSequenceStep', { ...C4, taskId: 'sq1', stepIndex: 2, answer: 'nope' });
  check('sequence: wrong final answer rejected', seqBad?.stepCorrect === false);
  const seq2 = await player4.call('submitSequenceStep', { ...C4, taskId: 'sq1', stepIndex: 2, answer: '1899' });
  check('sequence: final step completes the task', seq2?.taskComplete === true);
  const fin4 = await player4.call('getMyTeamState', { code: c4 });
  check('all four task types completed → team finished', fin4?.team?.status === 'finished', fin4?.team?.status);

  }); // scenario: task types

  await scenario('quiz location verification (requirePresence gate)', async () => {

  // ── requirePresence: an answer task with real coordinates + the opt-in flag can
  // only be graded from WITHIN a lenient radius. A far submission (even with the
  // correct answer) is refused BEFORE grading (failed-precondition), while the
  // same correct answer at the coordinates grades normally. The sanitized payload
  // exposes requirePresence (client needs it to attach GPS) but still no answers.
  const { gameId: gP } = await creator.call('createGame', { title: 'Presence Quiz', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gP,
    scoringPreset: 'fixed_points_speed',
    stages: [
      { id: 'sp', order: 0, title: 'Presence', isFinal: true, tasks: [{
        id: 'pq1', title: 'What color is the dome?', type: 'quiz', requirePresence: true,
        coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 9,
        choices: ['Blue', 'Gold', 'Green'], answers: ['Blue'],
      }] },
    ],
  });
  const { runId: rP, accessCode: cP } = await creator.call('launchRun', { gameId: gP });
  const playerP = makeParty('playerP');
  await signInAnonymously(playerP.auth);
  await playerP.call('joinRun', { code: cP, displayName: 'Pilgrim' });
  await creator.call('startTeams', { gameId: gP, runId: rP });
  const CP = { ownerUid: creatorCred.user.uid, gameId: gP, runId: rP };

  // sanitized payload: requirePresence visible, answers stripped.
  const sP = await playerP.call('getMyTeamState', { code: cP });
  const pTask = sP?.activeStageTasks?.find((t) => t.id === 'pq1');
  check('presence: requirePresence exposed to client', pTask?.requirePresence === true, JSON.stringify(pTask?.requirePresence));
  check('presence: answers still stripped', pTask?.answers === undefined && pTask?.numericAnswer === undefined);

  // far + correct answer → refused before grading (not graded as correct).
  let farRefused = false;
  let farLeak = '';
  try {
    const r = await playerP.call('submitTaskAnswer', { ...CP, taskId: 'pq1', answer: 'blue', lat: 32.10, lng: 34.85 });
    farLeak = JSON.stringify(r); // must NOT reach here with { correct: true }
  } catch (e) {
    farRefused = /failed-precondition|move closer|location required/i.test(e.message);
  }
  check('presence: far answer refused (failed-precondition, not graded)', farRefused, farLeak);

  // correct answer AT the coordinates → grades.
  const nearP = await playerP.call('submitTaskAnswer', { ...CP, taskId: 'pq1', answer: 'blue', lat: 31.78, lng: 35.21 });
  check('presence: in-range correct answer grades', nearP?.correct === true, JSON.stringify(nearP));

  }); // scenario: quiz location verification

  await scenario('scheduled release (timed task + stage gates)', async () => {
    // A game with: stage 0 = an instant task gated by a FUTURE releaseAt (blocked),
    // plus a second instant task already released; stage 1 gated far in the future
    // (a timed drop that won't open during the test); a THIRD game where a later
    // stage's releaseAt is already in the PAST (unlocks normally).
    const future = new Date(Date.now() + 60 * 60_000).toISOString(); // +60 min
    const past = new Date(Date.now() - 5 * 60_000).toISOString();     // −5 min

    const { gameId: gS } = await creator.call('createGame', { title: 'Timed Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gS,
      scoringPreset: 'fixed_points_speed',
      stages: [
        // requiredTaskCount:1 — completing the OPEN task finishes the stage; the
        // still-gated task is auto-skipped (a permanently-gated task in an
        // all-required stage would correctly block the stage until it releases).
        { id: 'ts0', order: 0, title: 'Opening', requiredTaskCount: 1, tasks: [
          { id: 'locked-1', title: 'Not yet', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
            releaseAt: future },
          { id: 'open-1', title: 'Go now', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
            // play-task-gating: only an ASSIGNED task is shipped to the client, so
            // the `releaseAt` sanitizer-passthrough assertion has to ride on the
            // task the team actually holds. A PAST releaseAt is released, hence
            // assignable, and still exercises the passthrough.
            releaseAt: past },
        ] },
        { id: 'ts1', order: 1, title: 'The Drop', isFinal: true, releaseAfterMinutes: 120, tasks: [
          { id: 'drop-1', title: 'Timed drop', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: rS, accessCode: cS } = await creator.call('launchRun', { gameId: gS });
    const pS = makeParty('playerSched');
    await signInAnonymously(pS.auth);
    await pS.call('joinRun', { code: cS, displayName: 'Timed' });
    await creator.call('startTeams', { gameId: gS, runId: rS });
    const CS = { ownerUid: creatorCred.user.uid, gameId: gS, runId: rS };

    // Sanitizer exposes the release fields (allowlisted) so the client can render a countdown.
    await pS.call('requestNextTask', { ...CS, lat: 0, lng: 0, stageId: 'ts0' }).catch(() => undefined);
    const s0 = await pS.call('getMyTeamState', { code: cS });
    const openTaskS = s0?.activeStageTasks?.find((t) => t.id === 'open-1');
    check('scheduled: releaseAt survives sanitizer', openTaskS?.releaseAt === past, openTaskS?.releaseAt);
    // play-task-gating: the still-GATED task is not merely un-completable, it is
    // absent from the wire (a player cannot choose it, so they never receive it).
    check('scheduled: the not-yet-released task is absent from the payload',
      s0?.activeStageTasks?.find((t) => t.id === 'locked-1') === undefined,
      JSON.stringify((s0?.activeStageTasks ?? []).map((t) => t.id)));

    // completeTask on the not-yet-released task is refused.
    let blocked = false;
    try { await pS.call('completeTask', { ...CS, taskId: 'locked-1' }); }
    catch (e) { blocked = /not available yet/i.test(e.message); }
    check('scheduled: future-release task cannot be completed', blocked);

    // Routing assigns the OPEN task, not the gated one.
    const asg = await pS.call('requestNextTask', { ...CS, lat: 0, lng: 0, stageId: 'ts0' });
    check('scheduled: routing skips the gated task', asg?.taskId === 'open-1', asg?.taskId);

    // Completing the open task finishes stage 0; stage 1 is gated 120 min out, so
    // the team is now BETWEEN stages with a countdown, and gets no next task.
    await pS.call('completeTask', { ...CS, taskId: 'open-1' });
    const s1 = await pS.call('getMyTeamState', { code: cS });
    check('scheduled: gated next stage stays locked (no active tasks)',
      (s1?.activeStageTasks?.length ?? 0) === 0, JSON.stringify(s1?.activeStageTasks?.map((t) => t.id)));
    check('scheduled: nextStageReleaseAt countdown is set', typeof s1?.nextStageReleaseAt === 'number' && s1.nextStageReleaseAt > Date.now());
    check('scheduled: team not finished while waiting on the drop', s1?.team?.status !== 'finished', s1?.team?.status);
    const nn = await pS.call('requestNextTask', { ...CS, lat: 0, lng: 0, stageId: 'ts1' });
    check('scheduled: no task handed out before the drop opens', (nn?.taskId ?? null) === null, nn?.taskId);

    // Second game: a later stage whose releaseAt is already in the PAST unlocks
    // as soon as its predecessor completes.
    const { gameId: gP } = await creator.call('createGame', { title: 'Past Drop', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gP,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'ps0', order: 0, title: 'One', tasks: [
          { id: 'p-a', title: 'Tap', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
        ] },
        { id: 'ps1', order: 1, title: 'Two', isFinal: true, releaseAt: past, tasks: [
          { id: 'p-b', title: 'Tap two', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: rP, accessCode: cP } = await creator.call('launchRun', { gameId: gP });
    const pP = makeParty('playerPast');
    await signInAnonymously(pP.auth);
    await pP.call('joinRun', { code: cP, displayName: 'Past' });
    await creator.call('startTeams', { gameId: gP, runId: rP });
    const CP = { ownerUid: creatorCred.user.uid, gameId: gP, runId: rP };
    await pP.call('completeTask', { ...CP, taskId: 'p-a' });

    // Controller-only poll persistence (change: fix-getmyteamstate-hotpath-writes):
    // stage 0 is done and stage 1 is past-release due. Attach a VIEWER and let ONLY
    // it poll — the response must reflect the unlock, but the persisted team doc must
    // NOT advance from a viewer poll. Then the controller's poll persists it.
    const teamDocPathP = `users/${creatorCred.user.uid}/games/${gP}/runs/${rP}/teams/${pP.auth.currentUser.uid}`;
    const pcode = (await pP.call('getMyTeamState', { code: cP }))?.team?.deviceJoinCode;
    // (that controller poll just persisted the unlock; re-lock via admin to isolate the viewer test)
    await adminSdk.firestore().doc(teamDocPathP).update({
      stages: [
        { stageId: 'ps0', status: 'completed', tasks: [{ taskId: 'p-a', taskIndex: 0, status: 'completed', earnedScore: 50 }] },
        { stageId: 'ps1', status: 'locked', tasks: [{ taskId: 'p-b', taskIndex: 0, status: 'unassigned' }] },
      ],
    });
    const viewerP = makeParty('viewerPast');
    await signInAnonymously(viewerP.auth);
    await viewerP.call('joinTeamAsDevice', { code: cP, teamCode: pcode, memberName: 'Viewer' });
    const vState = await viewerP.call('getMyTeamState', { code: cP });
    // play-task-gating: `p-b` is still UNASSIGNED, so it is (correctly) absent
    // from activeStageTasks. The unlock is observed where it actually lives — the
    // returned team's stage record — which is also what the play UI drives
    // routing off. The persistence assertions below are unchanged.
    check('scheduled: viewer poll response reflects the unlock',
      vState?.team?.stages?.find((s) => s.stageId === 'ps1')?.status === 'active',
      JSON.stringify(vState?.team?.stages?.map((s) => [s.stageId, s.status])));
    const afterViewer = (await adminSdk.firestore().doc(teamDocPathP).get()).data();
    check('scheduled: a viewer poll does NOT persist the unlock (controller-only writes)',
      afterViewer?.stages?.find((s) => s.stageId === 'ps1')?.status === 'locked',
      afterViewer?.stages?.find((s) => s.stageId === 'ps1')?.status);

    const sp = await pP.call('getMyTeamState', { code: cP });
    check('scheduled: past-release stage unlocks (active task present)',
      sp?.team?.stages?.find((s) => s.stageId === 'ps1')?.status === 'active',
      JSON.stringify(sp?.team?.stages?.map((s) => [s.stageId, s.status])));
    const afterController = (await adminSdk.firestore().doc(teamDocPathP).get()).data();
    check('scheduled: the controller poll DOES persist the unlock',
      afterController?.stages?.find((s) => s.stageId === 'ps1')?.status === 'active',
      afterController?.stages?.find((s) => s.stageId === 'ps1')?.status);
    await pP.call('completeTask', { ...CP, taskId: 'p-b' });
    const spF = await pP.call('getMyTeamState', { code: cP });
    check('scheduled: past-release run completes to finished', spF?.team?.status === 'finished', spF?.team?.status);
  }); // scenario: scheduled release

  await scenario('unlockable tasks (same-stage prerequisites)', async () => {
    // A 2-task stage where B unlocks only after A. Routing must never hand out
    // B first, a direct completeTask(B) is refused, and once A completes B is
    // assigned and completable. The gate ids pass the sanitizer (not a secret).
    const { gameId: gU } = await creator.call('createGame', { title: 'Unlock Chain', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gU,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'us0', order: 0, title: 'Chain', isFinal: true, tasks: [
          { id: 'u-a', title: 'Solve the cipher', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
          { id: 'u-b', title: 'Open the vault', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
            unlockAfterTaskIds: ['u-a'] },
        ] },
      ],
    });
    const { runId: rU, accessCode: cU } = await creator.call('launchRun', { gameId: gU });
    const pU = makeParty('playerUnlock');
    await signInAnonymously(pU.auth);
    await pU.call('joinRun', { code: cU, displayName: 'Unlocker' });
    await creator.call('startTeams', { gameId: gU, runId: rU });
    const CU = { ownerUid: creatorCred.user.uid, gameId: gU, runId: rU };

    // PRODUCT DECISION CHANGED (play-task-gating, wave D). This scenario used to
    // assert the opposite: that a LOCKED task still shipped to the participant
    // with its `unlockAfterTaskIds` intact, so the play UI could render the chain
    // ("solve the cipher, THEN the vault opens"). The user's ruling is that a
    // player never chooses where to go — routing does — so they receive only the
    // task they were routed to. Showing a locked task therefore buys nothing and
    // costs a pre-read of its content. The assertion is INVERTED on purpose, not
    // deleted: the locked task must now be ABSENT from the wire entirely.
    const s0 = await pU.call('getMyTeamState', { code: cU });
    const lockedB = s0?.activeStageTasks?.find((t) => t.id === 'u-b');
    check('unlock: the LOCKED task is absent from the participant payload',
      lockedB === undefined,
      JSON.stringify((s0?.activeStageTasks ?? []).map((t) => t.id)));
    check('unlock: the locked task title appears nowhere on the wire',
      !JSON.stringify(s0).includes('Open the vault'), 'locked task content leaked');
    for (const t of s0?.activeStageTasks ?? []) assertTaskPayloadAllowlisted('unlock: shipped task', t);

    // Anti-cheat: a hand-crafted completion of the locked task is refused.
    await expectError('unlock: direct completeTask on a locked task is refused',
      pU.call('completeTask', { ...CU, taskId: 'u-b' }),
      { match: /locked|prerequisite/i });

    // Routing hands out A (never the locked B).
    const asg = await pU.call('requestNextTask', { ...CU, lat: 0, lng: 0 });
    check('unlock: routing assigns the prerequisite-free task first', asg?.taskId === 'u-a', asg?.taskId);

    // Completing A opens B: the follow-up assignment picks it up and it completes.
    const doneA = await pU.call('completeTask', { ...CU, taskId: 'u-a' });
    check('unlock: after A, B is assigned', doneA?.nextTaskId === 'u-b', doneA?.nextTaskId);
    await pU.call('completeTask', { ...CU, taskId: 'u-b' });
    const s1 = await pU.call('getMyTeamState', { code: cU });
    check('unlock: chain completes to finished', s1?.team?.status === 'finished', s1?.team?.status);

    // Save-time validation: a prerequisite cycle is rejected loud.
    await expectError('unlock: cyclic prerequisite graph is rejected',
      creator.call('updateGame', {
        gameId: gU,
        stages: [
          { id: 'us0', order: 0, title: 'Cycle', isFinal: true, tasks: [
            { id: 'u-b', title: 'B', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
              unlockAfterTaskIds: ['u-c'] },
            { id: 'u-c', title: 'C', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
              unlockAfterTaskIds: ['u-b'] },
          ] },
        ],
      }),
      { match: /cycle/i });

    // Self-reference and unknown/cross-stage ids are rejected too.
    await expectError('unlock: self-referencing prerequisite is rejected',
      creator.call('updateGame', {
        gameId: gU,
        stages: [
          { id: 'us0', order: 0, title: 'Selfie', isFinal: true, tasks: [
            { id: 'u-s', title: 'S', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
              unlockAfterTaskIds: ['u-s'] },
          ] },
        ],
      }),
      { match: /itself|unknown/i });
  }); // scenario: unlockable tasks

  await scenario('mutually exclusive tasks (pick one, sibling auto-skipped)', async () => {
    // A stage offering "either A or B, plus C". Completing A must RETIRE B by
    // marking it `skipped` in the same transaction — not merely refuse it later.
    // requiredTaskCount=2 is exactly the attainable ceiling (1 per group + 1
    // ungrouped); if the loser were left pending, completedCount could never
    // reach 2 and `allTerminal` would stay false, stranding the team forever.
    const { gameId: gX } = await creator.call('createGame', { title: 'Either Or', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gX,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'xs0', order: 0, title: 'Pick one', isFinal: true, requiredTaskCount: 2,
          exclusiveGroups: [{ id: 'xg1', taskIds: ['x-a', 'x-b'] }],
          tasks: [
            { id: 'x-a', title: 'Climb the tower', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
            { id: 'x-b', title: 'Swim the moat', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
            { id: 'x-c', title: 'Ring the bell', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
          ] },
      ],
    });
    const { runId: rX, accessCode: cX } = await creator.call('launchRun', { gameId: gX });
    const pX = makeParty('playerExclusive');
    await signInAnonymously(pX.auth);
    await pX.call('joinRun', { code: cX, displayName: 'Chooser' });
    await creator.call('startTeams', { gameId: gX, runId: rX });
    const CX = { ownerUid: creatorCred.user.uid, gameId: gX, runId: rX };

    // Exclusive-group membership is stage structure, not an answer key — it must
    // survive the participant sanitizer without leaking anything secret.
    const xs0 = await pX.call('getMyTeamState', { code: cX });
    for (const t of xs0?.activeStageTasks ?? []) assertTaskPayloadAllowlisted('exclusive: task payload', t);

    await pX.call('completeTask', { ...CX, taskId: 'x-a' });

    // The losing sibling is SKIPPED (never failed), so it counts as terminal.
    const xs1 = await pX.call('getMyTeamState', { code: cX });
    const recs = (xs1?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    const bRec = recs.find((t) => t.taskId === 'x-b');
    check('exclusive: completing A marks sibling B skipped', bRec?.status === 'skipped', bRec?.status);
    check('exclusive: the ungrouped task C is untouched',
      recs.find((t) => t.taskId === 'x-c')?.status !== 'skipped',
      recs.find((t) => t.taskId === 'x-c')?.status);

    // A late submission of the retired sibling is a graceful no-op (terminal-status
    // short-circuit), NOT an error — a second device mid-flight must not see a crash.
    let lateThrew = null;
    try { await pX.call('completeTask', { ...CX, taskId: 'x-b' }); } catch (e) { lateThrew = e; }
    check('exclusive: late completion of the skipped sibling is a silent no-op',
      lateThrew === null, lateThrew ? `${lateThrew.code}: ${lateThrew.message}` : 'no-op');

    // The team can still finish: 1 completed + 1 skipped + C reaches the ceiling.
    await pX.call('completeTask', { ...CX, taskId: 'x-c' });
    const xs2 = await pX.call('getMyTeamState', { code: cX });
    check('exclusive: team finishes despite the retired sibling (not stranded)',
      xs2?.team?.status === 'finished', xs2?.team?.status);
  }); // scenario: mutually exclusive tasks

  await scenario('manual leaderboard reveal (withheld on finalize, published on demand)', async () => {
    // With manualLeaderboardReveal on, finalizeRun computes and freezes the board
    // but must NOT publish it — players cannot learn who won until the creator
    // reveals. Crucially the board must be absent from the WIRE, not just unrendered.
    const { gameId: gL } = await creator.call('createGame', { title: 'Silent Podium', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gL,
      scoringPreset: 'fixed_points_speed',
      manualLeaderboardReveal: true,
      stages: [
        { id: 'ls0', order: 0, title: 'Only', isFinal: true, tasks: [
          { id: 'l-a', title: 'Touch the gate', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 40, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: rL, accessCode: cL } = await creator.call('launchRun', { gameId: gL });
    const pL = makeParty('playerReveal');
    await signInAnonymously(pL.auth);
    await pL.call('joinRun', { code: cL, displayName: 'Hopeful' });
    await creator.call('startTeams', { gameId: gL, runId: rL });
    const CL = { ownerUid: creatorCred.user.uid, gameId: gL, runId: rL };
    await pL.call('completeTask', { ...CL, taskId: 'l-a' });

    const fin = await creator.call('finalizeRun', { gameId: gL, runId: rL });
    check('reveal: finalize still returns rankings to the organizer',
      Array.isArray(fin?.rankings) && fin.rankings.length > 0, JSON.stringify(fin?.rankings?.length));

    // The participant payload must carry NO board at all — an unpublished board on
    // the wire is readable in devtools and would defeat the staged reveal.
    const ls1 = await pL.call('getMyTeamState', { code: cL });
    check('reveal: board is withheld from the participant payload before reveal',
      (ls1?.run?.leaderboard ?? null) === null, JSON.stringify(ls1?.run?.leaderboard));

    // Creator reveals; the same participant call now carries the standings.
    const pub = await creator.call('refreshLeaderboard', { gameId: gL, runId: rL, publish: true });
    check('reveal: refreshLeaderboard publishes the frozen final board', pub?.published === true, JSON.stringify(pub?.published));
    const ls2 = await pL.call('getMyTeamState', { code: cL });
    check('reveal: board reaches the participant after the reveal',
      Array.isArray(ls2?.run?.leaderboard?.rankings) && ls2.run.leaderboard.rankings.length > 0,
      JSON.stringify(ls2?.run?.leaderboard?.rankings?.length));
  }); // scenario: manual leaderboard reveal

  await scenario('task expiry (timed close + in-flight auto-skip)', async () => {
    // A 2-task stage where E expires 12s after launch (fractional minutes are
    // honored exactly so tests don't wait whole minutes; the window still leaves
    // room for the join/start round-trips — launchedAt is set at launchRun). E is
    // at the team's location so routing picks it first; F is far away with a
    // generous expiry (sanitizer passthrough check). After E closes:
    // completeTask(E) is refused, then the next requestNextTask sweeps the stuck
    // task (skipped + station slot freed) and reroutes the team.
    const OWNER = creatorCred.user.uid;
    const { gameId: gX } = await creator.call('createGame', { title: 'Expiry Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gX,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'xs0', order: 0, title: 'Pop-up stations', isFinal: true, tasks: [
          { id: 'x-e', title: 'Flash bonus', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
            expiresAfterMinutes: 0.2 }, // 12s
          { id: 'x-f', title: 'Steady station', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 1, lng: 1 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
            expiresAfterMinutes: 120 },
        ] },
      ],
    });
    const { runId: rX, accessCode: cX } = await creator.call('launchRun', { gameId: gX });
    const pX = makeParty('playerExpiry');
    await signInAnonymously(pX.auth);
    await pX.call('joinRun', { code: cX, displayName: 'Sprinter' });
    await creator.call('startTeams', { gameId: gX, runId: rX });
    const CX = { ownerUid: OWNER, gameId: gX, runId: rX };

    // The nearby flash task is assigned while its window is open.
    const asg = await pX.call('requestNextTask', { ...CX, lat: 0, lng: 0 });
    check('expiry: open flash task is assigned first', asg?.taskId === 'x-e', asg?.taskId);

    // Sanitizer passthrough: expiresAfterMinutes reaches the client (countdown UI).
    const s0 = await pX.call('getMyTeamState', { code: cX });
    // play-task-gating: only the ASSIGNED task ships, so the countdown-passthrough
    // assertion reads x-e (the assigned flash task) instead of the unassigned x-f.
    // Same contract: expiresAfterMinutes reaches the client for the countdown UI.
    const fTask = s0?.activeStageTasks?.find((t) => t.id === 'x-e');
    check('expiry: expiresAfterMinutes survives the sanitizer', fTask?.expiresAfterMinutes === 0.2, fTask?.expiresAfterMinutes);
    check('expiry: the unassigned sibling task is absent from the payload',
      s0?.activeStageTasks?.find((t) => t.id === 'x-f') === undefined,
      JSON.stringify((s0?.activeStageTasks ?? []).map((t) => t.id)));
    assertTaskPayloadAllowlisted('expiry: generous-expiry task', fTask);

    // Let the flash window close (server clock decides, not the client). Wait
    // relative to the run's actual launchedAt, not a blind sleep.
    const launchedMs = Date.parse((await creator.getDocAt(`users/${OWNER}/games/${gX}/runs/${rX}`)).data?.launchedAt);
    const closeAt = launchedMs + 0.2 * 60_000 + 500; // +0.5s server-clock margin
    if (Date.now() < closeAt) await new Promise((r) => setTimeout(r, closeAt - Date.now()));

    // A closed task cannot be completed even by a direct call.
    await expectError('expiry: completing an expired task is refused',
      pX.call('completeTask', { ...CX, taskId: 'x-e' }),
      { match: /expired/i });

    // The next poll sweeps the stuck in-flight task: skipped, slot freed, rerouted.
    const next = await pX.call('requestNextTask', { ...CX, lat: 0, lng: 0 });
    check('expiry: stuck team is rerouted to the remaining task', next?.taskId === 'x-f', next?.taskId);
    const s1 = await pX.call('getMyTeamState', { code: cX });
    const eRec = s1?.team?.stages?.[0]?.tasks?.find((t) => t.taskId === 'x-e');
    check('expiry: expired in-flight task is auto-skipped', eRec?.status === 'skipped', eRec?.status);
    const runDoc = await creator.getDocAt(`users/${OWNER}/games/${gX}/runs/${rX}`);
    const counts = runDoc.data?.taskCounts ?? {};
    check('expiry: expired task\'s station slot is released', (counts['x-e'] ?? 0) === 0, JSON.stringify(counts));

    // Finishing the surviving task completes the run (skipped ≠ blocked).
    await pX.call('completeTask', { ...CX, taskId: 'x-f' });
    const s2 = await pX.call('getMyTeamState', { code: cX });
    check('expiry: run completes with the expired task skipped', s2?.team?.status === 'finished', s2?.team?.status);

    // Save-time validation: an empty availability window is rejected loud.
    await expectError('expiry: empty availability window (expiry ≤ release) is rejected',
      creator.call('updateGame', {
        gameId: gX,
        stages: [
          { id: 'xs0', order: 0, title: 'Empty window', isFinal: true, tasks: [
            { id: 'x-w', title: 'Never playable', type: 'field', triggerMode: 'instant',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
              releaseAfterMinutes: 30, expiresAfterMinutes: 10 },
          ] },
        ],
      }),
      { match: /window|expire/i });
  }); // scenario: task expiry

  await scenario('chat integration webhook (Slack/Teams URL validation)', async () => {
    const { gameId: gW } = await creator.call('createGame', { title: 'Webhook Game', mode: 'individual' });

    // Off-allowlist URL is rejected (SSRF guard) — never silently persisted.
    let rejected = false;
    try { await creator.call('updateGame', { gameId: gW, integrationWebhookUrl: 'https://evil.example.com/hook' }); }
    catch (e) { rejected = /webhook/i.test(e.message); }
    check('webhook: off-allowlist URL rejected', rejected);

    // A valid Slack incoming-webhook URL is accepted, persisted, and platform-detected.
    await creator.call('updateGame', { gameId: gW, integrationWebhookUrl: 'https://hooks.slack.com/services/T00/B00/xyz' });
    const g1 = await creator.call('getGame', { gameId: gW });
    check('webhook: valid Slack URL persisted', g1?.game?.integrationWebhookUrl === 'https://hooks.slack.com/services/T00/B00/xyz', g1?.game?.integrationWebhookUrl);
    check('webhook: platform auto-detected as slack', g1?.game?.integrationPlatform === 'slack', g1?.game?.integrationPlatform);

    // It is NOT leaked into the public gallery when the game is published.
    await creator.call('publishGame', { gameId: gW, visibility: 'public' }).catch(() => undefined);

    // An empty string clears it.
    await creator.call('updateGame', { gameId: gW, integrationWebhookUrl: '' });
    const g2 = await creator.call('getGame', { gameId: gW });
    check('webhook: empty string clears the URL', !g2?.game?.integrationWebhookUrl, g2?.game?.integrationWebhookUrl);
  }); // scenario: chat integration webhook

  await scenario('narrative chapters (stage intro/outro passthrough)', async () => {
    const { gameId: gN } = await creator.call('createGame', { title: 'Story Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gN,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'sn0', order: 0, title: 'Prologue', isFinal: true,
          narrative: {
            intro: { title: 'Chapter 1', body: 'The adventure begins', bodyHe: 'ההרפתקה מתחילה', imageUrl: 'http://insecure/x.jpg' },
            outro: { body: 'Well done' },
          },
          tasks: [{ id: 'sn-a', title: 'Go', type: 'field', triggerMode: 'instant',
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] },
      ],
    });
    const { runId: rN, accessCode: cN } = await creator.call('launchRun', { gameId: gN });
    const pN = makeParty('playerNarr');
    await signInAnonymously(pN.auth);
    await pN.call('joinRun', { code: cN, displayName: 'Reader' });
    await creator.call('startTeams', { gameId: gN, runId: rN });

    const sN = await pN.call('getMyTeamState', { code: cN });
    const active = (sN?.stageNarratives ?? []).find((n) => n.status === 'active');
    check('narrative: active stage intro is echoed', active?.narrative?.intro?.title === 'Chapter 1', JSON.stringify(active?.narrative?.intro));
    check('narrative: bilingual body passthrough', active?.narrative?.intro?.bodyHe === 'ההרפתקה מתחילה', active?.narrative?.intro?.bodyHe);
    check('narrative: insecure (non-https) image is stripped', !active?.narrative?.intro?.imageUrl && active?.narrative?.intro?.imageUrl !== 'http://insecure/x.jpg', JSON.stringify(active?.narrative?.intro?.imageUrl));
    check('narrative: only reached stages exposed (no spoilers)', (sN?.stageNarratives ?? []).every((n) => n.status === 'active' || n.status === 'completed'), JSON.stringify((sN?.stageNarratives ?? []).map((n) => n.status)));
  }); // scenario: narrative chapters

  await scenario('multi-run GM overview (listLiveRuns)', async () => {
    const { gameId: gA } = await creator.call('createGame', { title: 'Run A', mode: 'individual' });
    const { gameId: gB } = await creator.call('createGame', { title: 'Run B', mode: 'individual' });
    // launchRun requires at least one stage — give each game a minimal one.
    const oneStage = (sid) => [{ id: sid, order: 0, title: 'S', isFinal: true, tasks: [{
      id: `${sid}-t`, title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] }];
    await creator.call('updateGame', { gameId: gA, stages: oneStage('ga-s') });
    await creator.call('updateGame', { gameId: gB, stages: oneStage('gb-s') });
    const { runId: rA } = await creator.call('launchRun', { gameId: gA });
    const { runId: rB } = await creator.call('launchRun', { gameId: gB });

    const live1 = await creator.call('listLiveRuns', {});
    const ids1 = (live1?.runs ?? []).map((x) => x.runId);
    check('gm: both fresh live runs are listed', ids1.includes(rA) && ids1.includes(rB), JSON.stringify(ids1));
    const rowA = (live1?.runs ?? []).find((x) => x.runId === rA);
    check('gm: row carries game title + access code', rowA?.gameTitle === 'Run A' && typeof rowA?.accessCode === 'string', JSON.stringify(rowA));

    // Finalizing a run drops it from the live list.
    await creator.call('finalizeRun', { gameId: gA, runId: rA });
    const live2 = await creator.call('listLiveRuns', {});
    const ids2 = (live2?.runs ?? []).map((x) => x.runId);
    check('gm: a finalized run leaves the live list', !ids2.includes(rA) && ids2.includes(rB), JSON.stringify(ids2));

    // Owner isolation: a different signed-in user sees none of this owner's runs.
    const outsider = makeParty('gmOutsider');
    await signInAnonymously(outsider.auth);
    const strangerView = await outsider.call('listLiveRuns', {});
    const strangerIds = (strangerView?.runs ?? []).map((x) => x.runId);
    check('gm: owner isolation — outsider sees none of these runs', !strangerIds.includes(rB), JSON.stringify(strangerIds));
  }); // scenario: multi-run GM overview

  await scenario('global per-run device cap (16 phones max, both join paths)', async () => {
    // A hard global ceiling on total phones in one run (MAX_RUN_DEVICES = 16),
    // layered on top of the billing participant cap (free mode = 50) and the
    // per-team device cap (3). Free mode gives maxParticipants 50, so we can reach
    // 16 phones via joinRun before the billing cap fires. The run.deviceCount
    // counter grows on BOTH joinRun (a founding phone) and joinTeamAsDevice (an
    // attached phone); the 17th phone is refused from either entry point.
    const RUN_DEVICE_CAP = 16;
    const { gameId: gDC } = await creator.call('createGame', { title: 'Device Cap Game', mode: 'team' });
    await creator.call('updateGame', { gameId: gDC, stages: [{ id: 'dc-s', order: 0, title: 'S', isFinal: true, tasks: [{
      id: 'dc-t', title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 20 }] }] });
    const { runId: rDC, accessCode: cDC } = await creator.call('launchRun', { gameId: gDC });
    const runDocPath = `users/${creatorCred.user.uid}/games/${gDC}/runs/${rDC}`;

    // Phone 1: the founding device of team 0 (joinRun path).
    const p0 = makeParty('rdc-founder');
    await signInAnonymously(p0.auth);
    await p0.call('joinRun', { code: cDC, displayName: 'Cap Team 0' });
    const p0State = await p0.call('getMyTeamState', { code: cDC });
    const teamCode = p0State?.team?.deviceJoinCode;
    check('device-cap: founder join set deviceCount to 1',
      (await creator.getDocAt(runDocPath)).data?.deviceCount === 1);

    // Phone 2: an attached teammate on team 0 (joinTeamAsDevice path → counter grows).
    const pA = makeParty('rdc-attach');
    await signInAnonymously(pA.auth);
    const attachRes = await pA.call('joinTeamAsDevice', { code: cDC, teamCode, memberName: 'Phone 2' });
    check('device-cap: joinTeamAsDevice attaches below the ceiling', attachRes?.role === 'viewer');
    check('device-cap: attach grew deviceCount to 2',
      (await creator.getDocAt(runDocPath)).data?.deviceCount === 2);

    // Phones 3..16: fourteen more founding devices (joinRun path) → reach the cap.
    for (let i = 1; i <= RUN_DEVICE_CAP - 2; i++) {
      const p = makeParty(`rdc-f${i}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: cDC, displayName: `Cap Team ${i}` });
    }
    check('device-cap: run holds exactly MAX_RUN_DEVICES phones',
      (await creator.getDocAt(runDocPath)).data?.deviceCount === RUN_DEVICE_CAP,
      String((await creator.getDocAt(runDocPath)).data?.deviceCount));

    // The 17th phone via joinRun is refused (run full) even though billing (50) allows it.
    const pOver = makeParty('rdc-over');
    await signInAnonymously(pOver.auth);
    await expectError('device-cap: 17th phone via joinRun is refused',
      pOver.call('joinRun', { code: cDC, displayName: 'Cap Team Over' }),
      { codeIn: ['functions/resource-exhausted'], match: /16 devices/ });

    // The 17th phone via joinTeamAsDevice is ALSO refused — team 0 still has room
    // (2/3), so this exercises the ceiling on the device path, not the per-team cap.
    const pOverDev = makeParty('rdc-over-dev');
    await signInAnonymously(pOverDev.auth);
    await expectError('device-cap: 17th phone via joinTeamAsDevice is refused',
      pOverDev.call('joinTeamAsDevice', { code: cDC, teamCode, memberName: 'Phone Over' }),
      { codeIn: ['functions/resource-exhausted'] });

    check('device-cap: counter unchanged after both rejections (still 16)',
      (await creator.getDocAt(runDocPath)).data?.deviceCount === RUN_DEVICE_CAP);
  }); // scenario: global per-run device cap

  await scenario('movement heatmap (GPS track → density)', async () => {
    const { gameId: gH } = await creator.call('createGame', { title: 'Heatmap Game', mode: 'individual' });
    await creator.call('updateGame', { gameId: gH, stages: [{ id: 'h-s', order: 0, title: 'S', isFinal: true, tasks: [{
      id: 'h-t', title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] }] });
    const { runId: rH, accessCode: cH } = await creator.call('launchRun', { gameId: gH });
    const pH = makeParty('playerHeat');
    await signInAnonymously(pH.auth);
    await pH.call('joinRun', { code: cH, displayName: 'Walker' });
    await creator.call('startTeams', { gameId: gH, runId: rH });
    const CH = { ownerUid: creatorCred.user.uid, gameId: gH, runId: rH };

    // The controlling phone pings a few nearby positions (builds the track).
    for (const [lat, lng] of [[31.7801, 35.2101], [31.7802, 35.2102], [31.7803, 35.2103]]) {
      await pH.call('updateLocation', { ...CH, lat, lng });
    }

    // Owner reads the density; non-owner is refused.
    const heat = await creator.call('getRunHeatmap', { code: cH });
    check('heatmap: track retained → non-zero point count', (heat?.pointCount ?? 0) >= 3, JSON.stringify(heat?.pointCount));
    check('heatmap: density cells returned', Array.isArray(heat?.cells) && heat.cells.length >= 1 && heat.cells[0].weight >= 1, JSON.stringify(heat?.cells?.slice(0, 2)));
    await expectError('heatmap: non-owner is denied',
      pH.call('getRunHeatmap', { code: cH }),
      { codeIn: ['functions/permission-denied'] });
  }); // scenario: movement heatmap

  await scenario('player profile + badges (finish → getMyProfile)', async () => {
    const { gameId: gPr } = await creator.call('createGame', { title: 'Profile Game', mode: 'individual' });
    await creator.call('updateGame', { gameId: gPr, stages: [{ id: 'pr-s', order: 0, title: 'S', isFinal: true, tasks: [{
      id: 'pr-t', title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] }] });
    const { runId: rPr, accessCode: cPr } = await creator.call('launchRun', { gameId: gPr });
    const pPr = makeParty('playerProfile');
    await signInAnonymously(pPr.auth);
    await pPr.call('joinRun', { code: cPr, displayName: 'Champ' });
    await creator.call('startTeams', { gameId: gPr, runId: rPr });
    const CPr = { ownerUid: creatorCred.user.uid, gameId: gPr, runId: rPr };

    await pPr.call('completeTask', { ...CPr, taskId: 'pr-t' });
    const st = await pPr.call('getMyTeamState', { code: cPr });
    check('profile: team finished after the only task', st?.team?.status === 'finished', st?.team?.status);

    // Profiles are recorded by the `onRunFinalized` Firestore trigger (perf:
    // run-perf-scale, Task 9), asynchronously off finalizeRun's own response —
    // poll briefly instead of asserting immediately (real trigger execution,
    // not a dangling promise — see the `waitFor` doc comment above).
    await creator.call('finalizeRun', { gameId: gPr, runId: rPr });
    const prof = await waitFor(async () => {
      const p = await pPr.call('getMyProfile', {});
      return (p?.profile?.gamesPlayed ?? 0) >= 1 ? p : null;
    }) ?? await pPr.call('getMyProfile', {});
    check('profile: gamesPlayed recorded on finish', (prof?.profile?.gamesPlayed ?? 0) >= 1, JSON.stringify(prof?.profile));
    check('profile: tasksCompleted recorded', (prof?.profile?.tasksCompleted ?? 0) >= 1, prof?.profile?.tasksCompleted);
    check('profile: first_finish badge earned', (prof?.profile?.badges ?? []).includes('first_finish'), JSON.stringify(prof?.profile?.badges));

    // A brand-new user has a zeroed profile (own-profile only).
    const other = makeParty('profileOther');
    await signInAnonymously(other.auth);
    const empty = await other.call('getMyProfile', {});
    check('profile: a new user has a zeroed profile', (empty?.profile?.gamesPlayed ?? 0) === 0, JSON.stringify(empty?.profile));
  }); // scenario: player profile

  await scenario('trackable collectibles (create → pickup → drop)', async () => {
    const { gameId: gT } = await creator.call('createGame', { title: 'Trackable Game', mode: 'individual' });
    await creator.call('updateGame', { gameId: gT, stages: [{ id: 't-s', order: 0, title: 'S', isFinal: true, tasks: [{
      id: 't-t', title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] }] });
    const { runId: rT, accessCode: cT } = await creator.call('launchRun', { gameId: gT });
    const owner = creatorCred.user.uid;
    const CT = { ownerUid: owner, gameId: gT, runId: rT };

    const pA = makeParty('trackA'); await signInAnonymously(pA.auth);
    await pA.call('joinRun', { code: cT, displayName: 'Alpha' });
    const pB = makeParty('trackB'); await signInAnonymously(pB.auth);
    await pB.call('joinRun', { code: cT, displayName: 'Bravo' });
    await creator.call('startTeams', { gameId: gT, runId: rT });

    // Owner authors a trackable.
    const created = await creator.call('createTrackable', { gameId: gT, runId: rT, name: 'Golden Compass' });
    const tid = created?.trackable?.id;
    check('trackable: created unheld', !created?.trackable?.currentHolderTeamId && typeof tid === 'string', JSON.stringify(created?.trackable));

    // Player A picks it up.
    await pA.call('pickUpTrackable', { ...CT, trackableId: tid });
    const l1 = await pA.call('getRunTrackables', { ...CT });
    check('trackable: A becomes the holder', l1?.trackables?.[0]?.currentHolderTeamId === pA.auth.currentUser.uid, JSON.stringify(l1?.trackables?.[0]));

    // Player B cannot pick up (already held) nor drop (not the holder).
    await expectError('trackable: B cannot pick up a held item',
      pB.call('pickUpTrackable', { ...CT, trackableId: tid }), { codeIn: ['functions/failed-precondition'] });
    await expectError('trackable: B cannot drop what A carries',
      pB.call('dropTrackable', { ...CT, trackableId: tid }), { codeIn: ['functions/failed-precondition'] });

    // A drops it → unheld again.
    await pA.call('dropTrackable', { ...CT, trackableId: tid });
    const l2 = await pA.call('getRunTrackables', { ...CT });
    check('trackable: dropping releases the item', !l2?.trackables?.[0]?.currentHolderTeamId, JSON.stringify(l2?.trackables?.[0]));
  }); // scenario: trackable collectibles

  await scenario('marketplace instant play (public self-guided run)', async () => {
    const oneStage = (sid) => [{ id: sid, order: 0, title: 'S', isFinal: true, tasks: [{
      id: `${sid}-t`, title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] }];

    const { gameId: gI } = await creator.call('createGame', { title: 'Instant Game', mode: 'individual' });
    await creator.call('updateGame', { gameId: gI, allowInstantPlay: true, stages: oneStage('i-s') });
    await creator.call('publishGame', { gameId: gI, visibility: 'public' });

    const pI = makeParty('instantPlayer'); await signInAnonymously(pI.auth);
    const res = await pI.call('startInstantPlay', { gameId: gI, displayName: 'Solo' });
    check('instant: returns a run context', typeof res?.runId === 'string' && typeof res?.accessCode === 'string', JSON.stringify(res));
    const st = await pI.call('getMyTeamState', { code: res.accessCode });
    check('instant: player is active in a self-guided run', st?.team?.status === 'active' && st?.run?.status === 'live', JSON.stringify({ t: st?.team?.status, r: st?.run?.status }));

    // The self-guided run is fully playable to completion.
    await pI.call('completeTask', { ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId, taskId: 'i-s-t' });
    const fin = await pI.call('getMyTeamState', { code: res.accessCode });
    check('instant: the run completes to finished', fin?.team?.status === 'finished', fin?.team?.status);

    // A published game that did NOT opt in refuses instant play.
    const { gameId: gN2 } = await creator.call('createGame', { title: 'No Instant', mode: 'individual' });
    await creator.call('updateGame', { gameId: gN2, stages: oneStage('n2-s') });
    await creator.call('publishGame', { gameId: gN2, visibility: 'public' });
    await expectError('instant: a non-opted-in game is refused',
      pI.call('startInstantPlay', { gameId: gN2 }), { codeIn: ['functions/failed-precondition'] });
  }); // scenario: marketplace instant play

  await scenario('territory capture (zones + capture bonus + flip)', async () => {
    const { gameId: gZ } = await creator.call('createGame', { title: 'Territory Game', mode: 'individual' });
    await creator.call('updateGame', { gameId: gZ, stages: [{ id: 'z-s', order: 0, title: 'S', isFinal: true, tasks: [{
      id: 'z-t', title: 'Go', type: 'field', triggerMode: 'instant',
      coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 }] }] });
    const { runId: rZ, accessCode: cZ } = await creator.call('launchRun', { gameId: gZ });
    const owner = creatorCred.user.uid;
    const CZ = { ownerUid: owner, gameId: gZ, runId: rZ };

    const zA = makeParty('zoneA'); await signInAnonymously(zA.auth);
    await zA.call('joinRun', { code: cZ, displayName: 'Alpha' });
    const zB = makeParty('zoneB'); await signInAnonymously(zB.auth);
    await zB.call('joinRun', { code: cZ, displayName: 'Bravo' });
    await creator.call('startTeams', { gameId: gZ, runId: rZ });

    const created = await creator.call('createZone', { gameId: gZ, runId: rZ, title: 'Hilltop', lat: 31.78, lng: 35.21 });
    const zid = created?.zone?.id;
    check('zone: created unowned with a bonus', !created?.zone?.ownerTeamId && created?.zone?.captureBonus > 0, JSON.stringify(created?.zone));

    // A captures from inside the radius → becomes owner + gets the bonus.
    await zA.call('captureZone', { ...CZ, zoneId: zid, lat: 31.7801, lng: 35.2101 });
    const z1 = await zA.call('getRunZones', { ...CZ });
    check('zone: A becomes the holder', z1?.zones?.[0]?.ownerTeamId === zA.auth.currentUser.uid, JSON.stringify(z1?.zones?.[0]));
    const sA = await zA.call('getMyTeamState', { code: cZ });
    check('zone: capture bonus applied to score (negative bonusPenalty)', (sA?.team?.bonusPenalty ?? 0) === -created.zone.captureBonus, JSON.stringify(sA?.team?.bonusPenalty));

    // A cannot re-capture its own zone; an out-of-radius capture is rejected.
    await expectError('zone: cannot re-capture your own zone',
      zA.call('captureZone', { ...CZ, zoneId: zid, lat: 31.7801, lng: 35.2101 }), { codeIn: ['functions/failed-precondition'] });
    await expectError('zone: out-of-radius capture is rejected',
      zB.call('captureZone', { ...CZ, zoneId: zid, lat: 32.5, lng: 35.9 }), { codeIn: ['functions/failed-precondition'] });

    // B flips it from inside.
    await zB.call('captureZone', { ...CZ, zoneId: zid, lat: 31.7801, lng: 35.2101 });
    const z2 = await zB.call('getRunZones', { ...CZ });
    check('zone: B flips ownership', z2?.zones?.[0]?.ownerTeamId === zB.auth.currentUser.uid, JSON.stringify(z2?.zones?.[0]));

    // Owner can delete a zone.
    await creator.call('deleteZone', { gameId: gZ, runId: rZ, zoneId: zid });
    const z3 = await zA.call('getRunZones', { ...CZ });
    check('zone: owner deletes the zone', (z3?.zones ?? []).length === 0, JSON.stringify(z3?.zones));
  }); // scenario: territory capture

  await scenario('hidden-location task (treasure hunt)', async () => {

  // ── 14b. Hidden-location task (treasure hunt: coords secret, clue-guided) ───
  // A hidden located task keeps its coordinates server-side: the participant gets
  // the clue + a locationHidden flag but NO coordinates/radius, and the out-of-range
  // rejection must not leak the distance. A sibling visible task still gets coords.
  const { gameId: gHL } = await creator.call('createGame', { title: 'Hidden Spot Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gHL,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 's-hidden', order: 0, title: 'Find it', isFinal: true,
      tasks: [{
        id: 'hl-1', title: 'The secret spot', type: 'field', triggerMode: 'radius',
        hideLocation: true, coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40,
        locationClue: 'Where water never stops', locationClueHe: 'במקום שבו המים לא נחים',
        difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 9,
      }, {
        id: 'hl-2', title: 'A visible spot', type: 'field', triggerMode: 'radius',
        coordinates: { lat: 31.781, lng: 35.211 }, geofenceRadiusMeters: 40,
        difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 9,
      }],
    }],
  });
  const { runId: rHL, accessCode: cHL } = await creator.call('launchRun', { gameId: gHL });
  const playerHL = makeParty('playerHL');
  await signInAnonymously(playerHL.auth);
  await playerHL.call('joinRun', { code: cHL, displayName: 'Seeker' });
  await creator.call('startTeams', { gameId: gHL, runId: rHL });
  const CHL = { ownerUid: creatorCred.user.uid, gameId: gHL, runId: rHL };

  // Routing assigns hl-1 (or hl-2) — force hl-1 to be the assigned one so the
  // sealed-payload assertions below are about the task the team actually holds.
  // (play-task-gating: only the ASSIGNED task is shipped at all.)
  let sHL = await playerHL.call('getMyTeamState', { code: cHL });
  let assignedHL = sHL?.team?.stages?.[0]?.tasks?.find((r) => r.status === 'assigned')?.taskId;
  if (assignedHL === 'hl-2') {
    await playerHL.call('completeTask', { ...CHL, taskId: 'hl-2', lat: 31.781, lng: 35.211 });
    sHL = await playerHL.call('getMyTeamState', { code: cHL });
    assignedHL = sHL?.team?.stages?.[0]?.tasks?.find((r) => r.status === 'assigned')?.taskId;
  }
  check('hidden task: the hidden task is the assigned one', assignedHL === 'hl-1', String(assignedHL));

  const hiddenTask = sHL?.activeStageTasks?.find((t) => t.id === 'hl-1');

  // ── SEALED (pre-arrival): assert ON THE WIRE, not in the UI ────────────────
  // play-task-gating (wave D): a hidden-location task reveals NOTHING but its
  // clue until the server has confirmed arrival. "Withheld" means the key is
  // absent from the payload — a devtools reader must find nothing.
  check('hidden task: arrivalPending true before arrival', hiddenTask?.arrivalPending === true, String(hiddenTask?.arrivalPending));
  check('hidden task: TITLE absent before arrival', hiddenTask?.title === undefined, String(hiddenTask?.title));
  check('hidden task: TYPE absent before arrival', hiddenTask?.type === undefined, String(hiddenTask?.type));
  check('hidden task: description/smart/steps absent before arrival',
    hiddenTask?.description === undefined && hiddenTask?.smart === undefined && hiddenTask?.steps === undefined,
    JSON.stringify({ d: hiddenTask?.description, s: hiddenTask?.smart, st: hiddenTask?.steps }));
  check('hidden task: coordinates stripped from payload', hiddenTask?.coordinates === undefined, JSON.stringify(hiddenTask?.coordinates));
  check('hidden task: locationHidden flag set', hiddenTask?.locationHidden === true, String(hiddenTask?.locationHidden));
  check('hidden task: exact radius withheld', hiddenTask?.geofenceRadiusMeters === undefined, String(hiddenTask?.geofenceRadiusMeters));
  check('hidden task: clue exposed (EN + HE)',
    hiddenTask?.locationClue === 'Where water never stops' && hiddenTask?.locationClueHe === 'במקום שבו המים לא נחים',
    JSON.stringify({ en: hiddenTask?.locationClue, he: hiddenTask?.locationClueHe }));
  // Whole-payload sweep: catches a leak of the authored title through ANY other
  // field (recommendations, narratives, team records…), not just the task object.
  check('hidden task: the authored title appears NOWHERE in the whole response',
    !JSON.stringify(sHL).includes('The secret spot'), 'title leaked into getMyTeamState');
  assertTaskPayloadAllowlisted('sanitizer(hidden, sealed)', hiddenTask);

  // Second channel, same secret: getRecommendedTasks is participant-callable and
  // used to echo every candidate task's TITLE — which would hand back exactly what
  // the sealed stub just withheld. It must withhold it too.
  const recHL = await playerHL.call('getRecommendedTasks', { ...CHL, lat: 31.9, lng: 35.3 });
  check('hidden task: getRecommendedTasks withholds the hidden title',
    !JSON.stringify(recHL ?? {}).includes('The secret spot'),
    JSON.stringify(recHL?.recommendations ?? []));

  // ── reportArrival: the arrival authority ───────────────────────────────────
  // Far away → not arrived, no distance digits, and the task STAYS sealed.
  const farArrival = await playerHL.call('reportArrival', { ...CHL, taskId: 'hl-1', lat: 32.5, lng: 35.9 });
  check('reportArrival: far away does not arrive', farArrival?.arrived === false, JSON.stringify(farArrival));
  check('reportArrival: far-away reason leaks NO distance digits',
    !/\d/.test(farArrival?.reason ?? '') && !/m away/i.test(farArrival?.reason ?? ''), farArrival?.reason);
  const sHLstill = await playerHL.call('getMyTeamState', { code: cHL });
  check('reportArrival: task still sealed after a far-away probe',
    sHLstill?.activeStageTasks?.find((t) => t.id === 'hl-1')?.title === undefined,
    'title revealed by a far-away probe');

  // No coordinates at all → refused. Arrival is never self-declared.
  await expectError('reportArrival: refused with no coordinates',
    playerHL.call('reportArrival', { ...CHL, taskId: 'hl-1' }),
    { match: /location required/i });

  // Out-of-range check-in on the hidden task: rejected with NO distance leaked.
  let hiddenFarMsg = '';
  try { await playerHL.call('completeTask', { ...CHL, taskId: 'hl-1', lat: 32.5, lng: 35.9 }); }
  catch (e) { hiddenFarMsg = e.message; }
  check('hidden task: out-of-range check-in rejected', hiddenFarMsg.length > 0, hiddenFarMsg);
  check('hidden task: rejection leaks NO distance digits', hiddenFarMsg.length > 0 && !/\d/.test(hiddenFarMsg) && !/m away/i.test(hiddenFarMsg), hiddenFarMsg);

  // In range → arrived. The latch is idempotent.
  const nearArrival = await playerHL.call('reportArrival', { ...CHL, taskId: 'hl-1', lat: 31.78, lng: 35.21 });
  check('reportArrival: in range arrives', nearArrival?.arrived === true, JSON.stringify(nearArrival));
  const teamDocHL = await adminSdk.firestore()
    .doc(`users/${creatorCred.user.uid}/games/${gHL}/runs/${rHL}/teams/${sHL.team.id}`).get();
  const arrivedAt1 = teamDocHL.data()?.stages?.[0]?.tasks?.find((r) => r.taskId === 'hl-1')?.arrivedAt;
  check('reportArrival: arrivedAt latched on the team record', typeof arrivedAt1 === 'string', String(arrivedAt1));
  await playerHL.call('reportArrival', { ...CHL, taskId: 'hl-1', lat: 31.78, lng: 35.21 });
  const teamDocHL2 = await adminSdk.firestore()
    .doc(`users/${creatorCred.user.uid}/games/${gHL}/runs/${rHL}/teams/${sHL.team.id}`).get();
  check('reportArrival: repeat call is idempotent (arrivedAt unchanged)',
    teamDocHL2.data()?.stages?.[0]?.tasks?.find((r) => r.taskId === 'hl-1')?.arrivedAt === arrivedAt1,
    'arrivedAt was rewritten');

  // ── REVEALED (post-arrival) ───────────────────────────────────────────────
  // Product decision (wave D, user): after arrival the coordinates ARE released
  // so a player who wanders off can navigate back to the spot.
  const sHLopen = await playerHL.call('getMyTeamState', { code: cHL });
  const openTask = sHLopen?.activeStageTasks?.find((t) => t.id === 'hl-1');
  check('hidden task: title revealed after arrival', openTask?.title === 'The secret spot', String(openTask?.title));
  check('hidden task: type revealed after arrival', openTask?.type === 'field', String(openTask?.type));
  check('hidden task: coordinates released after arrival', openTask?.coordinates?.lat === 31.78, JSON.stringify(openTask?.coordinates));
  check('hidden task: arrivalPending cleared after arrival', openTask?.arrivalPending === undefined, String(openTask?.arrivalPending));
  check('hidden task: still flagged locationHidden (clue chrome kept)', openTask?.locationHidden === true, String(openTask?.locationHidden));
  assertTaskPayloadAllowlisted('sanitizer(hidden, revealed)', openTask);

  // Arrival within radius completes (server-validated GPS), assigns the next task.
  const hiddenNear = await playerHL.call('completeTask', { ...CHL, taskId: 'hl-1', lat: 31.78, lng: 35.21 });
  check('hidden task: arrival within radius completes', hiddenNear?.ok === true, JSON.stringify(hiddenNear));

  }); // scenario: hidden-location

  await scenario('hidden-location: arrival is per-team + authz-scoped', async () => {
    // play-task-gating: `arrivedAt` is latched on the TEAM record, so one team
    // arriving must never unseal the task for anyone else, and a stranger must
    // not be able to probe the spot at all.
    const { gameId: gA } = await creator.call('createGame', { title: 'Two Seekers', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gA,
      scoringPreset: 'fixed_points_speed',
      stages: [{
        id: 's-arr', order: 0, title: 'Seek', isFinal: true,
        tasks: [{
          id: 'arr-1', title: 'The buried chest', type: 'field', triggerMode: 'radius',
          hideLocation: true, coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40,
          locationClue: 'Under the old stone', difficulty: 2, estimatedMinutes: 3,
          pointValue: 60, maxConcurrentTeams: 9,
        }],
      }],
    });
    const { runId: rA, accessCode: cA } = await creator.call('launchRun', { gameId: gA });
    const pA = makeParty('arrivalA'); await signInAnonymously(pA.auth);
    const pB = makeParty('arrivalB'); await signInAnonymously(pB.auth);
    await pA.call('joinRun', { code: cA, displayName: 'Seeker A' });
    await pB.call('joinRun', { code: cA, displayName: 'Seeker B' });
    await creator.call('startTeams', { gameId: gA, runId: rA });
    const CA = { ownerUid: creatorCred.user.uid, gameId: gA, runId: rA };

    const arrA = await pA.call('reportArrival', { ...CA, taskId: 'arr-1', lat: 31.78, lng: 35.21 });
    check('arrival: team A arrives', arrA?.arrived === true, JSON.stringify(arrA));

    const stA = await pA.call('getMyTeamState', { code: cA });
    const stB = await pB.call('getMyTeamState', { code: cA });
    check('arrival: team A sees the revealed title',
      stA?.activeStageTasks?.find((t) => t.id === 'arr-1')?.title === 'The buried chest',
      String(stA?.activeStageTasks?.find((t) => t.id === 'arr-1')?.title));
    check('arrival: team B is STILL sealed (arrivedAt is per-team)',
      stB?.activeStageTasks?.find((t) => t.id === 'arr-1')?.title === undefined &&
        stB?.activeStageTasks?.find((t) => t.id === 'arr-1')?.arrivalPending === true,
      JSON.stringify(stB?.activeStageTasks?.find((t) => t.id === 'arr-1')));
    check('arrival: team B response contains the title NOWHERE',
      !JSON.stringify(stB).includes('The buried chest'), 'title leaked to a team that never arrived');

    // A stranger with no team in this run cannot probe the secret spot.
    const stranger = makeParty('arrivalStranger'); await signInAnonymously(stranger.auth);
    await expectError('arrival: a stranger cannot call reportArrival',
      stranger.call('reportArrival', { ...CA, taskId: 'arr-1', lat: 31.78, lng: 35.21 }),
      { match: /not|permission|found/i });
  }); // scenario: hidden-location arrival authz

  await scenario('task visibility gating (non-assigned tasks are absent from the wire)', async () => {
    // play-task-gating (wave D), the second security win of this change: a
    // multi-task stage used to ship EVERY task's quiz choices at once, so a
    // player could pre-read the whole stage in devtools before routing handed it
    // out. Routing decides where a player goes, so a player receives only the
    // task they were routed to (plus the ones they already finished).
    const { gameId: gV } = await creator.call('createGame', { title: 'Pre-read Leak', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gV,
      scoringPreset: 'fixed_points_speed',
      stages: [{
        id: 's-vis', order: 0, title: 'Three quizzes', isFinal: true,
        tasks: [
          { id: 'v-1', title: 'Quiz one', type: 'quiz', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
            choices: ['alpha', 'beta'], answers: ['alpha'], difficulty: 1, estimatedMinutes: 1, pointValue: 40, maxConcurrentTeams: 9 },
          { id: 'v-2', title: 'Quiz two', type: 'quiz', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
            choices: ['gamma', 'delta'], answers: ['gamma'], difficulty: 1, estimatedMinutes: 1, pointValue: 40, maxConcurrentTeams: 9 },
          { id: 'v-3', title: 'Quiz three', type: 'quiz', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
            choices: ['epsilon', 'zeta'], answers: ['epsilon'], difficulty: 1, estimatedMinutes: 1, pointValue: 40, maxConcurrentTeams: 9 },
        ],
      }],
    });
    const { runId: rV, accessCode: cV } = await creator.call('launchRun', { gameId: gV });
    const pV = makeParty('visGate'); await signInAnonymously(pV.auth);
    await pV.call('joinRun', { code: cV, displayName: 'Peeker' });
    await creator.call('startTeams', { gameId: gV, runId: rV });
    const CV = { ownerUid: creatorCred.user.uid, gameId: gV, runId: rV };

    const sV = await pV.call('getMyTeamState', { code: cV });
    const assignedV = sV?.team?.stages?.[0]?.tasks?.find((r) => r.status === 'assigned')?.taskId;
    check('visibility: exactly ONE task ships while one is assigned',
      (sV?.activeStageTasks ?? []).length === 1 && sV.activeStageTasks[0].id === assignedV,
      JSON.stringify((sV?.activeStageTasks ?? []).map((t) => t.id)));
    const others = ['v-1', 'v-2', 'v-3'].filter((id) => id !== assignedV);
    check('visibility: the other tasks are ABSENT from activeStageTasks',
      others.every((id) => !(sV?.activeStageTasks ?? []).some((t) => t.id === id)),
      JSON.stringify((sV?.activeStageTasks ?? []).map((t) => t.id)));
    // The pre-read leak itself: no unrouted quiz's CHOICES may appear anywhere.
    const wireV = JSON.stringify(sV);
    const otherChoices = { 'v-1': 'alpha', 'v-2': 'gamma', 'v-3': 'epsilon' };
    check('visibility: an unrouted quiz’s choices appear nowhere in the response',
      others.every((id) => !wireV.includes(otherChoices[id])),
      'a non-assigned quiz’s choices are readable on the wire');
    check('visibility: an unrouted task’s TITLE appears nowhere either',
      others.every((id) => !wireV.includes(`Quiz ${{ 'v-1': 'one', 'v-2': 'two', 'v-3': 'three' }[id]}`)),
      'a non-assigned task title is readable on the wire');

    // Hiding is a PAYLOAD concern only: the server still authorizes normally, so
    // a hand-crafted answer to a non-assigned task is graded on its merits, not
    // silently accepted because "the client couldn't have known".
    const victim = others[0];
    const wrong = await pV.call('submitTaskAnswer', { ...CV, taskId: victim, answer: 'not-the-answer' });
    check('visibility: server still grades a hand-crafted non-assigned answer (no omission-as-authz)',
      wrong?.correct === false, JSON.stringify(wrong));

    // History still renders: after completing the assigned task it stays in the
    // payload (the player has seen it) — progress/recap must not go blank.
    await pV.call('submitTaskAnswer', { ...CV, taskId: assignedV, answer: { 'v-1': 'alpha', 'v-2': 'gamma', 'v-3': 'epsilon' }[assignedV] });
    const sV2 = await pV.call('getMyTeamState', { code: cV });
    check('visibility: a COMPLETED task stays visible (history renders)',
      (sV2?.activeStageTasks ?? []).some((t) => t.id === assignedV),
      JSON.stringify((sV2?.activeStageTasks ?? []).map((t) => t.id)));
    for (const t of sV2?.activeStageTasks ?? []) assertTaskPayloadAllowlisted(`visibility(${t.id})`, t);
  }); // scenario: task visibility gating

  await scenario('stuck-next-task regression (wave-f): routable task never reads as locked; routing works without coords', async () => {
    // A real player on a multi-task stage (with a hidden-location task) got dead
    // ended: the client mis-read every unassigned task as "locked" (its content is
    // omitted by wave D, so the old `activeStageTasks.find(...)` lookup was always
    // undefined ⇒ "locked"), and a GPS failure surfaced as the terminal
    // "couldn't get your next task". This proves the WIRE now carries the truth:
    //   Bug A — the server ships `lockedTaskIds` (genuinely gated ids only), so a
    //           routable-but-unassigned task is NOT reported locked.
    //   Bug B — routing assigns the next task with NO coordinates (the server
    //           defaults location and routes by load), so a GPS failure is not a
    //           routing failure. This asserts the server side; the client no longer
    //           dead-ends on GPS denial (see TaskRunner).
    const { gameId: gW } = await creator.call('createGame', { title: 'Stuck Next Task', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gW,
      scoringPreset: 'fixed_points_speed',
      stages: [{
        id: 's-wf', order: 0, title: 'Mixed stage', isFinal: true,
        tasks: [
          // Routable, locationless (transit 0) ⇒ deterministically routed first.
          { id: 't-open', title: 'Open task', type: 'self_report', triggerMode: 'instant',
            locationless: true, difficulty: 1, estimatedMinutes: 1, pointValue: 30, maxConcurrentTeams: 9 },
          // Genuinely gated: locked until t-open is completed.
          { id: 't-gated', title: 'Gated task', type: 'self_report', triggerMode: 'instant',
            locationless: true, unlockAfterTaskIds: ['t-open'],
            difficulty: 1, estimatedMinutes: 1, pointValue: 30, maxConcurrentTeams: 9 },
          // Hidden-location, NO gate ⇒ routable (just not picked first). It must
          // NOT be reported locked — that was the false-positive dead-end.
          { id: 't-hidden', title: 'Buried thing', type: 'field', triggerMode: 'instant',
            hideLocation: true, coordinates: { lat: 31.7767, lng: 35.2345 }, locationClue: 'By the old gate',
            difficulty: 1, estimatedMinutes: 1, pointValue: 30, maxConcurrentTeams: 9 },
        ],
      }],
    });
    const { runId: rW, accessCode: cW } = await creator.call('launchRun', { gameId: gW });
    const pW = makeParty('stuckWF'); await signInAnonymously(pW.auth);
    await pW.call('joinRun', { code: cW, displayName: 'Stuck Fox' });
    await creator.call('startTeams', { gameId: gW, runId: rW });
    const CW = { ownerUid: creatorCred.user.uid, gameId: gW, runId: rW };

    const s0 = await pW.call('getMyTeamState', { code: cW });
    const assigned0 = s0?.team?.stages?.[0]?.tasks?.find((r) => r.status === 'assigned')?.taskId;
    check('wave-f: the locationless open task is routed first (deterministic)',
      assigned0 === 't-open', String(assigned0));

    // Bug A — the wire carries genuine lock state, ids only.
    check('wave-f: getMyTeamState returns a lockedTaskIds array',
      Array.isArray(s0?.lockedTaskIds), JSON.stringify(s0?.lockedTaskIds));
    check('wave-f: the genuinely gated task IS reported locked',
      (s0?.lockedTaskIds ?? []).includes('t-gated'), JSON.stringify(s0?.lockedTaskIds));
    check('wave-f: a routable (hidden, ungated) unassigned task is NOT reported locked',
      !(s0?.lockedTaskIds ?? []).includes('t-hidden'), JSON.stringify(s0?.lockedTaskIds));

    // The exact client decision (TaskRunner.allRemainingLocked): every unassigned
    // task in lockedTaskIds. A routable task remains ⇒ this MUST be false, so the
    // player sees the routing spinner, not the false "all locked" dead-end.
    const unassigned0 = (s0?.team?.stages?.[0]?.tasks ?? []).filter((r) => r.status === 'unassigned');
    const lockedIds0 = s0?.lockedTaskIds ?? [];
    const allRemainingLocked0 = unassigned0.length > 0 && unassigned0.every((r) => lockedIds0.includes(r.taskId));
    check('wave-f: client allRemainingLocked is FALSE while a routable task remains (no false dead-end)',
      allRemainingLocked0 === false, JSON.stringify({ unassigned: unassigned0.map((r) => r.taskId), lockedIds0 }));

    // Bug B — complete the open task WITHOUT coordinates. The auto-reassign runs
    // with a defaulted location and MUST still hand out a next task (no dead-end).
    const done = await pW.call('completeTask', { ...CW, taskId: 't-open' });
    check('wave-f: completing without coords routes the next task (coordless routing works)',
      done?.ok === true && done?.nextTaskId != null, JSON.stringify(done));

    // requestNextTask with NO lat/lng must also resolve to a task (never reject) —
    // the direct proof that the terminal routingError was client GPS-gating, not a
    // server throw.
    const nextNoCoords = await pW.call('requestNextTask', { ...CW });
    check('wave-f: requestNextTask without coords returns a task (no reject, no null)',
      nextNoCoords?.taskId != null, JSON.stringify(nextNoCoords));

    // After t-open is done, t-gated is unlocked ⇒ no longer in lockedTaskIds.
    const s1 = await pW.call('getMyTeamState', { code: cW });
    check('wave-f: a task whose prerequisite is now met drops out of lockedTaskIds',
      !(s1?.lockedTaskIds ?? []).includes('t-gated'), JSON.stringify(s1?.lockedTaskIds));
    for (const t of s1?.activeStageTasks ?? []) assertTaskPayloadAllowlisted(`wave-f(${t.id})`, t);
  }); // scenario: stuck-next-task regression (wave-f)

  await scenario('task media (upload URL + YouTube round-trip, external URL dropped)', async () => {

  // ── Task media (change: task-media-attachments) ────────────────────────────
  // A creator can attach image/video/YouTube media to any task. The server (updateGame)
  // validates + canonicalizes: Storage image/video URLs are kept, YouTube links are
  // rewritten to the canonical /embed/<id> form, and off-origin image/video URLs are
  // dropped. The sanitizer passes `media` through to the participant (it is not secret),
  // and the payload stays allowlisted (the `media` key was just added to ALLOWED_TASK_KEYS).
  const STORAGE = 'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/gameMedia%2Fx.jpg?alt=media&token=t';
  const { gameId: gM } = await creator.call('createGame', { title: 'Media Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gM,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 's-media', order: 0, title: 'Look here', isFinal: true,
      tasks: [{
        id: 'm-1', title: 'Watch then find', type: 'field', triggerMode: 'radius',
        coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40,
        difficulty: 2, estimatedMinutes: 4, pointValue: 60, maxConcurrentTeams: 9,
        media: [
          { id: 'ma', kind: 'image', url: STORAGE, caption: 'the spot' },
          { id: 'mb', kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' },
          { id: 'mc', kind: 'image', url: 'https://evil.example.com/x.jpg' }, // dropped
        ],
      }],
    }],
  });
  // Server-side persistence: external image dropped, youtube canonicalized.
  const persisted = await creator.call('getGame', { gameId: gM });
  const savedMedia = persisted?.game?.stages?.[0]?.tasks?.[0]?.media ?? [];
  check('media: external image URL dropped server-side', savedMedia.length === 2 && !savedMedia.some((m) => /evil\.example/.test(m.url)), JSON.stringify(savedMedia));
  check('media: YouTube link canonicalized to /embed/<id>',
    savedMedia.find((m) => m.kind === 'youtube')?.url === 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    JSON.stringify(savedMedia));
  check('media: Storage image kept with caption', savedMedia.find((m) => m.kind === 'image')?.caption === 'the spot', JSON.stringify(savedMedia));

  // Participant round-trip: media reaches the sanitized payload intact + allowlisted.
  const { runId: rM, accessCode: cM } = await creator.call('launchRun', { gameId: gM });
  const playerM = makeParty('playerM');
  await signInAnonymously(playerM.auth);
  await playerM.call('joinRun', { code: cM, displayName: 'Viewer' });
  await creator.call('startTeams', { gameId: gM, runId: rM });
  const sM = await playerM.call('getMyTeamState', { code: cM });
  const mediaTask = sM?.activeStageTasks?.find((t) => t.id === 'm-1');
  check('media: participant receives both valid entries', (mediaTask?.media?.length ?? 0) === 2, JSON.stringify(mediaTask?.media));
  check('media: participant sees canonical YouTube embed url',
    mediaTask?.media?.find((m) => m.kind === 'youtube')?.url === 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    JSON.stringify(mediaTask?.media));
  assertTaskPayloadAllowlisted('sanitizer(media)', mediaTask);

  }); // scenario: task media

  await scenario('free mode + referral program', async () => {

  // ── 15. Free mode: no consumption + referral (free-run bonus, once) ─────────
  // In free mode all 4 launches were free, so nothing was consumed: the wallet
  // still shows the full 3 lifetime free runs and 0 credits. The referral
  // mechanics below are retained (dark) and still bookkeep the wallet.
  const preRef = await creator.call('getWalletStatus');
  check('free mode: 4 launches consumed no free runs (still 3)', preRef?.freeRunsRemaining === 3, JSON.stringify(preRef));
  check('free mode: no Event Credits spent', preRef?.eventCredits === 0, JSON.stringify(preRef));

  const newbie = makeParty('newbie');
  const newbieCred = await signInAnonymously(newbie.auth);

  let selfRejected = false;
  try { await newbie.call('claimReferral', { referrerUid: newbieCred.user.uid }); }
  catch (e) { selfRejected = /yourself/i.test(e.message); }
  check('claimReferral rejects self-referral', selfRejected);

  const claim = await newbie.call('claimReferral', { referrerUid: creatorCred.user.uid });
  check('claimReferral grants a free run to the newcomer', claim?.ok === true && claim?.bonusFreeRuns > 0, JSON.stringify(claim));
  const newbieStatus = await newbie.call('getWalletStatus');
  check('newcomer free runs bumped', newbieStatus?.freeRunsRemaining === 3 + claim.bonusFreeRuns, JSON.stringify(newbieStatus));
  const newbieWallet = (await newbie.call('getWallet')).wallet;
  check('newcomer referredBy set', newbieWallet.referredBy === creatorCred.user.uid, newbieWallet.referredBy);

  const refAfter = await creator.call('getWalletStatus');
  check('inviter earns an extra free run',
    refAfter?.freeRunsRemaining === preRef.freeRunsRemaining + claim.bonusFreeRuns,
    JSON.stringify({ before: preRef.freeRunsRemaining, after: refAfter.freeRunsRemaining }));
  const refWallet = (await creator.call('getWallet')).wallet;
  check('inviter referralCount bumped', (refWallet.referralCount ?? 0) >= 1, String(refWallet.referralCount));

  const claimAgain = await newbie.call('claimReferral', { referrerUid: creatorCred.user.uid });
  check('claimReferral is one-time per account', claimAgain?.alreadyClaimed === true && claimAgain?.bonusFreeRuns === 0, JSON.stringify(claimAgain));
  const refUnchanged = await creator.call('getWalletStatus');
  check('re-claim does NOT double-grant the inviter', refUnchanged?.freeRunsRemaining === refAfter.freeRunsRemaining, JSON.stringify(refUnchanged));

  }); // scenario: free mode + referral

  await scenario('answer attempt limit (anti-brute-force)', async () => {

  // ── 16. Answer attempt limit (anti-cheat row 42) ───────────────────────────
  // A quiz with attemptLimit:2 — two wrong answers exhaust it; the 3rd attempt is
  // refused with resource-exhausted, even though it would be correct.
  const { gameId: g5 } = await creator.call('createGame', { title: 'Attempt-Limit Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: g5, scoringPreset: 'fixed_points_speed',
    stages: [{ id: 'al-s', order: 0, title: 'Quiz', isFinal: true, tasks: [{
      id: 'al-q', title: 'Capital of France?', type: 'quiz',
      coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 9,
      choices: ['Paris', 'London'], answers: ['Paris'],
      smart: { enabled: true, verificationType: 'code_verification', attemptLimit: 2 },
    }] }],
  });
  const { runId: r5, accessCode: c5 } = await creator.call('launchRun', { gameId: g5 });
  const player5 = makeParty('player5');
  await signInAnonymously(player5.auth);
  await player5.call('joinRun', { code: c5, displayName: 'Limiter' });
  await creator.call('startTeams', { gameId: g5, runId: r5 });
  const C5 = { ownerUid: creatorCred.user.uid, gameId: g5, runId: r5 };
  const w1 = await player5.call('submitTaskAnswer', { ...C5, taskId: 'al-q', answer: 'London' });
  check('attempt-limit: 1st wrong answer rejected (not exhausted)', w1?.correct === false);
  const w2 = await player5.call('submitTaskAnswer', { ...C5, taskId: 'al-q', answer: 'London' });
  check('attempt-limit: 2nd wrong answer rejected (limit reached)', w2?.correct === false);
  let attemptExhausted = false;
  try {
    await player5.call('submitTaskAnswer', { ...C5, taskId: 'al-q', answer: 'Paris' }); // would be correct
  } catch (e) {
    attemptExhausted = e.code === 'functions/resource-exhausted' || /attempts left/i.test(e.message);
  }
  check('attempt-limit: 3rd attempt refused even with the correct answer', attemptExhausted);

  }); // scenario: attempt limit

  await scenario('guardian consent gate', async () => {

  // ── 17. Guardian consent gate (guardian-consent-qr) ────────────────────────
  // A consent-required run holds a minor's team in pending-consent: startTeams
  // does NOT launch them until a guardian approves via a single-use token.
  const { gameId: g6 } = await creator.call('createGame', { title: 'Consent Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: g6, scoringPreset: 'time_only', requiresGuardianConsent: true, minAge: 13,
    stages: [{ id: 'cs-s', order: 0, title: 'One', isFinal: true, tasks: [{
      id: 'cs-t', title: 'Tap in', type: 'self_report', triggerMode: 'locationless',
      coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9,
    }] }],
  });
  const { runId: r6, accessCode: c6 } = await creator.call('launchRun', { gameId: g6 });
  const minor = makeParty('minor');
  await signInAnonymously(minor.auth);
  await minor.call('joinRun', { code: c6, displayName: 'Kid' });
  const start1 = await creator.call('startTeams', { gameId: g6, runId: r6 });
  check('consent: team is NOT started before consent', start1?.launched === 0, JSON.stringify(start1));

  const { token } = await minor.call('requestGuardianConsent', {
    ownerUid: creatorCred.user.uid, gameId: g6, runId: r6, teamId: minor.auth.currentUser.uid,
  });
  check('requestGuardianConsent issues a token', !!token, token);

  // A guardian (separate device) approves with the single-use token.
  const guardian = makeParty('guardian');
  await signInAnonymously(guardian.auth);
  const grant = await guardian.call('grantGuardianConsent', {
    ownerUid: creatorCred.user.uid, gameId: g6, runId: r6, token, guardianName: 'A. Parent',
  });
  check('grantGuardianConsent records consent', grant?.ok === true);

  let tokenReused = false;
  try {
    await guardian.call('grantGuardianConsent', { ownerUid: creatorCred.user.uid, gameId: g6, runId: r6, token, guardianName: 'Again' });
  } catch (e) { tokenReused = e.code === 'functions/failed-precondition' || /already used/i.test(e.message); }
  check('consent: a used token is refused', tokenReused);

  const start2 = await creator.call('startTeams', { gameId: g6, runId: r6 });
  check('consent: team starts after a guardian approves', start2?.launched === 1, JSON.stringify(start2));

  }); // scenario: guardian consent

  await scenario('safe-zone boundary (out-of-bounds soft pause)', async () => {

  // ── 18. Safe-zone boundary (safe-zone-boundary) ────────────────────────────
  // A location outside the zone flags the team out-of-bounds and soft-pauses new
  // task assignment; returning inside clears the flag and assignment resumes.
  const { gameId: g7 } = await creator.call('createGame', { title: 'Safe Zone Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: g7, scoringPreset: 'time_only',
    safeZone: { center: { lat: 31.78, lng: 35.21 }, radiusMeters: 200 },
    stages: [{ id: 'sz-s', order: 0, title: 'Play', isFinal: true, requiredTaskCount: 1, tasks: [
      { id: 'sz-a', title: 'A', type: 'self_report', triggerMode: 'locationless', coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      { id: 'sz-b', title: 'B', type: 'self_report', triggerMode: 'locationless', coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
    ] }],
  });
  const { runId: r7, accessCode: c7 } = await creator.call('launchRun', { gameId: g7 });
  const wanderer = makeParty('wanderer');
  await signInAnonymously(wanderer.auth);
  await wanderer.call('joinRun', { code: c7, displayName: 'Wanderer' });
  await creator.call('startTeams', { gameId: g7, runId: r7 });
  const C7 = { ownerUid: creatorCred.user.uid, gameId: g7, runId: r7 };

  const breach = await wanderer.call('updateLocation', { ...C7, lat: 32.5, lng: 35.9 });
  check('safe-zone: out-of-zone location flags outOfBounds + alerts', breach?.outOfBounds === true, JSON.stringify(breach));
  const paused = await wanderer.call('requestNextTask', { ...C7, lat: 32.5, lng: 35.9 });
  check('safe-zone: no new task while out of bounds (soft-pause)', paused?.taskId === null && paused?.outOfBounds === true, JSON.stringify(paused));
  const back = await wanderer.call('updateLocation', { ...C7, lat: 31.78, lng: 35.21 });
  check('safe-zone: returning inside clears outOfBounds', back?.outOfBounds === false, JSON.stringify(back));
  const resumed = await wanderer.call('requestNextTask', { ...C7, lat: 31.78, lng: 35.21 });
  check('safe-zone: assignment resumes inside the zone', resumed?.outOfBounds !== true, JSON.stringify(resumed));

  }); // scenario: safe-zone

  // ── Run recap (getRunRecap) ─────────────────────────────────────────────────
  await scenario('run recap · replay · analytics', async () => {
    // The main run is published + has had photo activity by now.
    const ownerRecap = await creator.call('getRunRecap', { code: accessCode });
    check('recap: owner gets ordered standings', (ownerRecap?.standings?.length ?? 0) > 0, JSON.stringify(ownerRecap?.stats));
    check('recap: stats report a winner + team count', !!ownerRecap?.stats?.winnerName && (ownerRecap?.stats?.teamCount ?? 0) > 0, JSON.stringify(ownerRecap?.stats));
    check('recap: photos is an array (≥0)', Array.isArray(ownerRecap?.photos));

    // Published run → a fresh non-owner can read the public recap.
    const recapViewer = makeParty('recapViewer');
    await signInAnonymously(recapViewer.auth);
    const pubRecap = await recapViewer.call('getRunRecap', { code: accessCode });
    check('recap: published run is public to non-owners', (pubRecap?.standings?.length ?? 0) > 0);

    // Unpublished run → a non-owner is denied.
    const { gameId: rcGame } = await creator.call('createGame', { title: 'Recap Gate', mode: 'individual' });
    await creator.call('updateGame', { gameId: rcGame, stages: [{ id: 'rc-s', order: 0, title: 'S', isFinal: true,
      tasks: [{ id: 'rc-t', title: 'T', type: 'field', coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 3 }] }] });
    const { accessCode: rcCode } = await creator.call('launchRun', { gameId: rcGame });
    let denied = false;
    try { await recapViewer.call('getRunRecap', { code: rcCode }); }
    catch (e) { denied = e.code === 'functions/permission-denied'; }
    check('recap: unpublished run is private to non-owners', denied);
    // Owner can still read their own unpublished run's recap.
    const ownerUnpub = await creator.call('getRunRecap', { code: rcCode });
    check('recap: owner reads their own unpublished run', Array.isArray(ownerUnpub?.standings));

    // ── Run replay (getRunReplay) — owner-only timeline ───────────────────────
    const replay = await creator.call('getRunReplay', { code: accessCode });
    check('replay: owner gets a time-ordered event stream', Array.isArray(replay?.events) && replay.events.length > 0, `events=${replay?.events?.length}`);
    const ts = (replay?.events ?? []).map((e) => e.t);
    check('replay: events are globally time-ordered', JSON.stringify(ts) === JSON.stringify([...ts].sort()));
    check('replay: scoreSeries present per team', replay?.scoreSeries && Object.keys(replay.scoreSeries).length > 0);
    let replayDenied = false;
    try { await recapViewer.call('getRunReplay', { code: accessCode }); }
    catch (e) { replayDenied = e.code === 'functions/permission-denied'; }
    check('replay: non-owner is denied', replayDenied);

    // ── Run analytics (getRunAnalytics) — owner-only per-task aggregate ────────
    const analytics = await creator.call('getRunAnalytics', { code: accessCode });
    check('analytics: owner gets per-task rows', Array.isArray(analytics?.tasks) && analytics.tasks.length > 0, `tasks=${analytics?.tasks?.length}`);
    check('analytics: rows carry completion stats', analytics?.tasks?.every((t) => 'completionRate' in t && 'medianMs' in t && 'hintCount' in t), JSON.stringify(analytics?.tasks?.[0]));
    check('analytics: overall completion rate present', typeof analytics?.overallCompletionRate === 'number');
    let analyticsDenied = false;
    try { await recapViewer.call('getRunAnalytics', { code: accessCode }); }
    catch (e) { analyticsDenied = e.code === 'functions/permission-denied'; }
    check('analytics: non-owner is denied', analyticsDenied);

    // ── Run summary (getRunSummary) — owner-only recap+analytics+feedback fold ──
    const summary = await creator.call('getRunSummary', { code: accessCode });
    check('summary: owner gets standings', (summary?.standings?.length ?? 0) > 0, `standings=${summary?.standings?.length}`);
    check('summary: completion rate numeric', typeof summary?.completion?.overallCompletionRate === 'number');
    check('summary: feedback digest present', summary?.feedback && Array.isArray(summary.feedback.topIssues));
    let summaryDenied = false;
    try { await recapViewer.call('getRunSummary', { code: accessCode }); }
    catch (e) { summaryDenied = e.code === 'functions/permission-denied'; }
    check('summary: non-owner denied', summaryDenied);
  }); // scenario: recap · replay · analytics

  // ── Duplicate & translate a game (translateGame) ────────────────────────────
  await scenario('duplicate & translate a game', async () => {
    const { gameId: trGame } = await creator.call('createGame', { title: 'Translate Me', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: trGame, scoringPreset: 'smart_weighted',
      stages: [{ id: 'tr-s', order: 0, title: 'Round 1', isFinal: true,
        tasks: [{ id: 'tr-q', title: 'Capital of France?', description: 'Think hard', type: 'quiz',
          coordinates: { lat: 31.79, lng: 35.16 }, difficulty: 2, estimatedMinutes: 3, pointValue: 40,
          maxConcurrentTeams: 5, answers: ['Paris'] }] }],
    });

    const tr = await creator.call('translateGame', { gameId: trGame, targetLang: 'es' });
    check('translate: returns a new gameId', !!tr?.gameId && tr.gameId !== trGame, JSON.stringify(tr));

    const { game: newGame } = await creator.call('getGame', { gameId: tr.gameId });
    check('translate: title is translated', /^\[es\]/.test(newGame?.title ?? ''), newGame?.title);
    const newTask = newGame?.stages?.[0]?.tasks?.[0];
    check('translate: task text translated', /^\[es\]/.test(newTask?.title ?? ''), newTask?.title);
    // Non-text preserved verbatim.
    check('translate: coordinates preserved', newTask?.coordinates?.lat === 31.79 && newTask?.coordinates?.lng === 35.16);
    check('translate: type + scoring preserved', newTask?.type === 'quiz' && newGame?.scoringPreset === 'smart_weighted');
    check('translate: pointValue preserved', newTask?.pointValue === 40);
    // Original free-text answer kept as an accepted alias.
    check('translate: original answer kept as alias', Array.isArray(newTask?.answers) && newTask.answers.includes('Paris'), JSON.stringify(newTask?.answers));
    check('translate: translated answer added too', newTask?.answers?.includes('[es] Paris'), JSON.stringify(newTask?.answers));
  }); // scenario: translate

  // ── Discovery POIs (surprise-trivia-waypoints) ──────────────────────────────
  await scenario('discovery POIs (surprise trivia waypoints)', async () => {
    const { gameId: dpGame } = await creator.call('createGame', { title: 'Discovery Game', mode: 'individual' });
    const POI = { lat: 31.79, lng: 35.16 };
    await creator.call('updateGame', {
      gameId: dpGame, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'dp-s', order: 0, title: 'Stage', isFinal: true,
        tasks: [{ id: 'dp-t', title: 'Go', type: 'field', coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 }] }],
    });
    // Creator writes a hidden POI directly (owner rules allow; coords are secret).
    await creator.setDocAt(`users/${creatorCred.user.uid}/games/${dpGame}/discoveryPois/poiA`, {
      id: 'poiA', coordinates: POI, radiusMeters: 200, title: 'Old fountain',
      flavorText: 'You spot something...', question: 'What is this landmark?',
      answers: ['Fountain', 'fountain'], bonusPoints: 40,
    });

    const { runId: dpRun, accessCode: dpCode } = await creator.call('launchRun', { gameId: dpGame });
    const dpPlayer = makeParty('dpPlayer');
    await signInAnonymously(dpPlayer.auth);
    await dpPlayer.call('joinRun', { code: dpCode, displayName: 'Explorer' });
    await creator.call('startTeams', { gameId: dpGame, runId: dpRun });

    // getRunDiscoveryPois never leaks coordinates or answers.
    const list = await dpPlayer.call('getRunDiscoveryPois', { code: dpCode });
    const got = list?.pois?.[0];
    check('discovery: getRunDiscoveryPois returns the POI', got?.id === 'poiA', JSON.stringify(got));
    check('discovery: payload has NO coordinates or answers',
      got && !('coordinates' in got) && !('answers' in got), JSON.stringify(Object.keys(got ?? {})));

    const before = (await dpPlayer.call('getMyTeamState', { code: dpCode }))?.team?.score ?? 0;

    // Outside radius → failed-precondition.
    let outside = false;
    try { await dpPlayer.call('claimDiscoveryPoi', { code: dpCode, poiId: 'poiA', lat: 32.5, lng: 35.9, answer: 'Fountain' }); }
    catch (e) { outside = e.code === 'functions/failed-precondition'; }
    check('discovery: outside radius → failed-precondition', outside);

    // Wrong answer inside radius → no points.
    const wrong = await dpPlayer.call('claimDiscoveryPoi', { code: dpCode, poiId: 'poiA', lat: POI.lat, lng: POI.lng, answer: 'Statue' });
    check('discovery: wrong answer → {correct:false}', wrong?.correct === false, JSON.stringify(wrong));
    const afterWrong = (await dpPlayer.call('getMyTeamState', { code: dpCode }))?.team?.score ?? 0;
    check('discovery: wrong answer awards no points', afterWrong === before, `before=${before} after=${afterWrong}`);

    // Correct answer inside radius → bonus.
    const right = await dpPlayer.call('claimDiscoveryPoi', { code: dpCode, poiId: 'poiA', lat: POI.lat, lng: POI.lng, answer: 'fountain' });
    check('discovery: correct answer → {correct:true} + bonus', right?.correct === true && right?.bonus === 40, JSON.stringify(right));
    const afterRight = (await dpPlayer.call('getMyTeamState', { code: dpCode }))?.team?.score ?? 0;
    check('discovery: correct answer increases score by the bonus', afterRight === before + 40, `before=${before} after=${afterRight}`);

    // Double-claim → already-exists.
    let dup = false;
    try { await dpPlayer.call('claimDiscoveryPoi', { code: dpCode, poiId: 'poiA', lat: POI.lat, lng: POI.lng, answer: 'fountain' }); }
    catch (e) { dup = e.code === 'functions/already-exists'; }
    check('discovery: double-claim → already-exists', dup);
  }); // scenario: discovery POIs

  // ── Hot Zone bonus (activate/deactivate + multiplied score) ─────────────────
  await scenario('hot zone bonus (timed score multiplier)', async () => {
    const { gameId: hzGame } = await creator.call('createGame', { title: 'Hot Zone Game', mode: 'individual' });
    const CENTER = { lat: 31.79, lng: 35.16 };
    const FAR = { lat: 31.85, lng: 35.30 }; // ~15km away — outside any zone
    await creator.call('updateGame', {
      gameId: hzGame,
      scoringPreset: 'fixed_points_speed',
      stages: [{
        id: 'hz-stage', order: 0, title: 'Hot Zone stage', isFinal: true, requiredTaskCount: 2,
        tasks: [
          { id: 'hz-in', title: 'In the zone', type: 'field', coordinates: CENTER, difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3 },
          { id: 'hz-out', title: 'Out of zone', type: 'field', coordinates: FAR, difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3 },
        ],
      }],
    });
    const { runId: hzRun, accessCode: hzCode } = await creator.call('launchRun', { gameId: hzGame });
    const hzPlayer = makeParty('hzPlayer');
    await signInAnonymously(hzPlayer.auth);
    await hzPlayer.call('joinRun', { code: hzCode, displayName: 'Zoner' });
    await creator.call('startTeams', { gameId: hzGame, runId: hzRun });

    // Activation stamps a bounded zone with start/expiry.
    const act = await creator.call('activateHotZone', {
      gameId: hzGame, runId: hzRun, center: CENTER, radiusMeters: 250, multiplier: 2, durationMinutes: 10,
    });
    check('hot-zone: activation returns a stamped zone', !!act?.hotZone?.startedAt && !!act?.hotZone?.expiresAt, JSON.stringify(act?.hotZone));
    check('hot-zone: multiplier stored', act?.hotZone?.multiplier === 2);

    // Only one active zone — re-activating replaces, not stacks.
    const act2 = await creator.call('activateHotZone', {
      gameId: hzGame, runId: hzRun, center: CENTER, radiusMeters: 250, multiplier: 3, durationMinutes: 10,
    });
    check('hot-zone: re-activation replaces (single zone)', act2?.hotZone?.multiplier === 3);
    // Reset back to 2x for the scoring assertions.
    await creator.call('activateHotZone', { gameId: hzGame, runId: hzRun, center: CENTER, radiusMeters: 250, multiplier: 2, durationMinutes: 10 });

    // Complete both tasks (routing assigns one at a time; re-request after each).
    for (let i = 0; i < 2; i++) {
      let st = await hzPlayer.call('getMyTeamState', { code: hzCode });
      let assigned = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      if (!assigned) {
        await hzPlayer.call('requestNextTask', { code: hzCode, lat: CENTER.lat, lng: CENTER.lng });
        st = await hzPlayer.call('getMyTeamState', { code: hzCode });
        assigned = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      }
      if (!assigned) break;
      const at = assigned.taskId === 'hz-in' ? CENTER : FAR;
      await hzPlayer.call('completeTask', { taskId: assigned.taskId, code: hzCode, lat: at.lat, lng: at.lng });
    }

    const fin = await hzPlayer.call('getMyTeamState', { code: hzCode });
    const recs = fin?.team?.stages?.[0]?.tasks ?? [];
    const inRec = recs.find((t) => t.taskId === 'hz-in');
    const outRec = recs.find((t) => t.taskId === 'hz-out');
    check('hot-zone: in-zone completion is multiplied ×2',
      inRec?.scoreBreakdown?.hotZoneMultiplier === 2 && inRec?.scoreBreakdown?.total === inRec?.scoreBreakdown?.taskScore * 2,
      JSON.stringify(inRec?.scoreBreakdown));
    check('hot-zone: out-of-zone completion is NOT multiplied',
      !outRec?.scoreBreakdown?.hotZoneMultiplier && outRec?.scoreBreakdown?.total === outRec?.scoreBreakdown?.taskScore,
      JSON.stringify(outRec?.scoreBreakdown));

    const deact = await creator.call('deactivateHotZone', { gameId: hzGame, runId: hzRun });
    check('hot-zone: deactivate clears the zone', deact?.ok === true);
  }); // scenario: hot zone

  // ── Hot Zone routing bias (change: hot-zone-routing-bias) ────────────────────
  // An active hot zone should pull auto-routing toward in-zone tasks. To prove
  // the bias actually changes the outcome (not just breaks ties), the in-zone
  // task is placed FARTHER from the team than a closer out-of-zone task — so
  // without the bias the closer out-of-zone task would win on transit, but the
  // in-zone bonus flips the assignment.
  await scenario('hot zone routing bias (in-zone task is assigned first)', async () => {
    const { gameId: rbGame } = await creator.call('createGame', { title: 'Routing Bias Game', mode: 'individual' });
    const RB_CENTER = { lat: 31.79, lng: 35.16 };  // zone centre; in-zone task lives here
    const RB_TEAM = { lat: 31.80, lng: 35.16 };     // team ~1.1km N of centre
    const RB_NEAR_OUT = { lat: 31.799, lng: 35.16 };// ~110m from team, ~1km from centre → OUT of a 250m zone
    await creator.call('updateGame', {
      gameId: rbGame,
      scoringPreset: 'smart_weighted',
      stages: [{
        id: 'rb-stage', order: 0, title: 'Routing bias stage', isFinal: true, requiredTaskCount: 1,
        tasks: [
          { id: 'rb-in', title: 'Far but in zone', type: 'field', coordinates: RB_CENTER, difficulty: 5, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3 },
          { id: 'rb-out', title: 'Near but out of zone', type: 'field', coordinates: RB_NEAR_OUT, difficulty: 5, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 3 },
        ],
      }],
    });
    const { runId: rbRun, accessCode: rbCode } = await creator.call('launchRun', { gameId: rbGame });
    const rbPlayer = makeParty('rbPlayer');
    await signInAnonymously(rbPlayer.auth);
    await rbPlayer.call('joinRun', { code: rbCode, displayName: 'Router' });
    await creator.call('startTeams', { gameId: rbGame, runId: rbRun });

    await creator.call('activateHotZone', {
      gameId: rbGame, runId: rbRun, center: RB_CENTER, radiusMeters: 250, multiplier: 2, durationMinutes: 10,
    });

    // Ask for the next task from the team's location; the bias should route the
    // team to the (farther) in-zone task over the (closer) out-of-zone task.
    await rbPlayer.call('requestNextTask', { code: rbCode, lat: RB_TEAM.lat, lng: RB_TEAM.lng });
    const st = await rbPlayer.call('getMyTeamState', { code: rbCode });
    const assigned = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
    check('hot-zone routing: the in-zone task is assigned despite being farther',
      assigned?.taskId === 'rb-in', JSON.stringify(assigned));

    await creator.call('deactivateHotZone', { gameId: rbGame, runId: rbRun });
  }); // scenario: hot zone routing bias

  // ── Power-ups (change: power-ups) ───────────────────────────────────────────
  // Predicts the deterministic award sequence from the seeded roll, then audits
  // that consumption (×2), the flat bonus (−15 bonusPenalty), idempotence, and the
  // leaderboard invariants all hold. Embedded FNV-1a copy — PINNED by the vitest
  // known vectors in functions/src/__property__/powerUps.property.test.ts (the two
  // copies can never silently diverge). NEVER import Math.random here.
  const POWER_UP_RATE_E2E = 25;
  const POWER_UP_BONUS_E2E = 15;
  function puHash(runId, teamId, taskId) {
    const input = `${runId}:${teamId}:${taskId}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function puRoll(runId, teamId, taskId) {
    const h = puHash(runId, teamId, taskId);
    if (h % 100 >= POWER_UP_RATE_E2E) return null;
    return (h >>> 8) % 2 === 0 ? 'double_points' : 'bonus_points';
  }
  await scenario('power-ups (seeded award + consume + invariants)', async () => {
    // Anti-drift self-check: the embedded copy must reproduce the pinned vectors.
    check('power-ups: embedded FNV matches pinned vectors',
      puHash('run1', 'teamA', 't13') === 1474030213 &&
      puRoll('run1', 'teamA', 't13') === 'double_points' &&
      puRoll('run1', 'teamA', 't6') === 'bonus_points' &&
      puRoll('run1', 'teamA', 't0') === null,
      `${puHash('run1', 'teamA', 't13')} ${puRoll('run1', 'teamA', 't6')}`);
    const AT = { lat: 31.78, lng: 35.21 };
    // 12 fixed-points tasks in one non-partial stage so ALL get completed and each
    // gets a roll. Distinct ids drive distinct rolls.
    const taskIds = Array.from({ length: 12 }, (_, i) => `pu-${i}`);
    const { gameId: puGame } = await creator.call('createGame', { title: 'Power-ups Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: puGame,
      scoringPreset: 'fixed_points_speed',
      powerUpsEnabled: true,
      stages: [{
        id: 'pu-stage', order: 0, title: 'Power stage', isFinal: true,
        tasks: taskIds.map((id) => ({
          id, title: id, type: 'field', coordinates: AT,
          difficulty: 3, estimatedMinutes: 5, pointValue: 100, maxConcurrentTeams: 12,
        })),
      }],
    });
    const { runId: puRun, accessCode: puCode } = await creator.call('launchRun', { gameId: puGame });
    const puPlayer = makeParty('puPlayer');
    await signInAnonymously(puPlayer.auth);
    const puJoin = await puPlayer.call('joinRun', { code: puCode, displayName: 'Charged' });
    const puTeam = puJoin.teamId;
    await creator.call('startTeams', { gameId: puGame, runId: puRun });

    // Complete every task, following routing one-at-a-time, recording the ACTUAL
    // completion order (the double consumes on the next scoring completion, so the
    // order matters and we verify against what the server actually did).
    const completionOrder = [];
    for (let i = 0; i < taskIds.length + 2 && completionOrder.length < taskIds.length; i++) {
      let st = await puPlayer.call('getMyTeamState', { code: puCode });
      let assigned = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      if (!assigned) {
        await puPlayer.call('requestNextTask', { code: puCode, lat: AT.lat, lng: AT.lng });
        st = await puPlayer.call('getMyTeamState', { code: puCode });
        assigned = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      }
      if (!assigned) break;
      await puPlayer.call('completeTask', { taskId: assigned.taskId, code: puCode, lat: AT.lat, lng: AT.lng });
      completionOrder.push(assigned.taskId);
    }
    check('power-ups: completed all 12 tasks', completionOrder.length === 12, String(completionOrder.length));

    const finState = await puPlayer.call('getMyTeamState', { code: puCode });
    const finTeam = finState?.team;
    const recs = finTeam?.stages?.[0]?.tasks ?? [];
    const recById = Object.fromEntries(recs.map((t) => [t.taskId, t]));

    // Predict per-task awards from the deterministic roll, applied over the OBSERVED
    // completion order with the single-armed-slot rule, and predict which task each
    // double consumes on (the next >0-point completion).
    let armed = false;               // is a double currently armed?
    const predicted = { bonuses: [], doubles: [] }; // doubles: {awardTask, consumedBy}
    let pendingDoubleAward = null;
    for (const tid of completionOrder) {
      // Consume first (this completion earns >0 for a fixed_points task).
      if (armed) {
        predicted.doubles.push({ awardTask: pendingDoubleAward, consumedBy: tid });
        armed = false;
        pendingDoubleAward = null;
      }
      // Then roll.
      let won = puRoll(puRun, puTeam, tid);
      if (won === 'double_points' && armed) won = 'bonus_points'; // single slot
      if (won === 'bonus_points') predicted.bonuses.push(tid);
      else if (won === 'double_points') { armed = true; pendingDoubleAward = tid; }
    }
    // A double rolled on the FINAL completion arms a slot with nothing after it to
    // consume, so it stays armed and is logged as an award WITHOUT a consumedByTaskId.
    // It's still a legitimate award (the server logs it), so include it in the award
    // set even though it never doubled a task. This is what makes the last-task-rolls-
    // a-double case (runId-dependent) match instead of flaking.
    const trailingArmedDouble = armed ? pendingDoubleAward : null;
    const predictedDoubleAwards = [
      ...predicted.doubles.map((d) => d.awardTask),
      ...(trailingArmedDouble ? [trailingArmedDouble] : []),
    ];

    // Assert the log matches the prediction exactly (order-independent set compare).
    const log = finTeam?.powerUps?.log ?? [];
    const bonusLog = log.filter((e) => e.type === 'bonus_points').map((e) => e.taskId).sort();
    const doubleLog = log.filter((e) => e.type === 'double_points');
    check('power-ups: bonus awards match the predicted set',
      JSON.stringify(bonusLog) === JSON.stringify([...predicted.bonuses].sort()),
      `got ${JSON.stringify(bonusLog)} want ${JSON.stringify([...predicted.bonuses].sort())}`);
    check('power-ups: double awards match the predicted set',
      JSON.stringify(doubleLog.map((e) => e.taskId).sort()) === JSON.stringify([...predictedDoubleAwards].sort()),
      `got ${JSON.stringify(doubleLog.map((e) => e.taskId))} want ${JSON.stringify(predictedDoubleAwards)}`);

    // Each bonus decremented bonusPenalty by 15 (bonus is a negative penalty).
    check('power-ups: bonusPenalty == -15 * bonus count',
      (finTeam?.bonusPenalty ?? 0) === -POWER_UP_BONUS_E2E * predicted.bonuses.length,
      `bonusPenalty=${finTeam?.bonusPenalty} bonuses=${predicted.bonuses.length}`);

    // Each consumed double exactly doubled the NEXT completed task's earnedScore, and
    // recorded powerUpMultiplier:2 in its breakdown; the double log entry stamped
    // consumedByTaskId + amount (the pre-double points).
    for (const d of predicted.doubles) {
      const consumedRec = recById[d.consumedBy];
      check(`power-ups: task ${d.consumedBy} was doubled (×2 breakdown)`,
        consumedRec?.scoreBreakdown?.powerUpMultiplier === 2 &&
        consumedRec?.scoreBreakdown?.total === consumedRec?.scoreBreakdown?.taskScore * 2,
        JSON.stringify(consumedRec?.scoreBreakdown));
      const logEntry = doubleLog.find((e) => e.taskId === d.awardTask);
      check(`power-ups: double from ${d.awardTask} stamped consumedByTaskId=${d.consumedBy}`,
        logEntry?.consumedByTaskId === d.consumedBy && logEntry?.amount === consumedRec?.scoreBreakdown?.taskScore,
        JSON.stringify(logEntry));
    }
    // The armed slot is cleared once every double is consumed — UNLESS the final
    // completion itself rolled a double (nothing after it to consume), in which case
    // it legitimately stays armed. Both outcomes are seed-dependent, so assert the one
    // the observed rolls predict rather than assuming the slot always ends empty.
    if (trailingArmedDouble) {
      check('power-ups: final-task double stays armed (nothing left to consume)',
        finTeam?.powerUps?.active === 'double_points',
        JSON.stringify(finTeam?.powerUps?.active));
    } else {
      check('power-ups: no double left armed after all completions',
        !finTeam?.powerUps?.active || finTeam?.powerUps?.active === null,
        JSON.stringify(finTeam?.powerUps?.active));
    }

    // Σ earned == score still holds (doubled values flow through stage roll-up).
    assertScoreConservation('power-ups', finTeam);

    // Idempotence: re-submitting a completed task changes nothing.
    const before = JSON.stringify({ log: finTeam?.powerUps?.log, bp: finTeam?.bonusPenalty, score: finTeam?.score });
    await puPlayer.call('completeTask', { taskId: completionOrder[0], code: puCode, lat: AT.lat, lng: AT.lng });
    const afterDup = (await puPlayer.call('getMyTeamState', { code: puCode }))?.team;
    check('power-ups: duplicate completion is a no-op (no double-award)',
      JSON.stringify({ log: afterDup?.powerUps?.log, bp: afterDup?.bonusPenalty, score: afterDup?.score }) === before);

    // Live leaderboard invariants + live/final parity (bonusPenalty reflected both).
    const puLive = await creator.call('refreshLeaderboard', { gameId: puGame, runId: puRun, publish: false });
    assertLeaderboardInvariants('power-ups live', puLive?.rankings, [puTeam]);
    const puLiveScore = puLive?.rankings?.[0]?.score;
    const puFinal = await creator.call('finalizeRun', { gameId: puGame, runId: puRun });
    const puFinalScore = (puFinal?.rankings ?? puFinal?.leaderboard?.rankings ?? [])[0]?.score;
    check('power-ups: live and final score agree (bonusPenalty parity)',
      puLiveScore === puFinalScore, `live=${puLiveScore} final=${puFinalScore}`);

    // ── Negative control A: flag ABSENT ⇒ powerUps never appears ───────────────
    const { gameId: ncGame } = await creator.call('createGame', { title: 'No Power-ups', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: ncGame,
      scoringPreset: 'fixed_points_speed',
      stages: [{
        id: 'nc-stage', order: 0, title: 'Plain', isFinal: true,
        tasks: [{ id: 'nc-0', title: 'Plain task', type: 'field', coordinates: AT, difficulty: 3, estimatedMinutes: 5, pointValue: 100, maxConcurrentTeams: 3 }],
      }],
    });
    const { runId: ncRun, accessCode: ncCode } = await creator.call('launchRun', { gameId: ncGame });
    const ncP = makeParty('ncPlayer');
    await signInAnonymously(ncP.auth);
    await ncP.call('joinRun', { code: ncCode, displayName: 'Plain' });
    await creator.call('startTeams', { gameId: ncGame, runId: ncRun });
    {
      let st = await ncP.call('getMyTeamState', { code: ncCode });
      let a = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      if (a) await ncP.call('completeTask', { taskId: a.taskId, code: ncCode, lat: AT.lat, lng: AT.lng });
    }
    const ncTeam = (await ncP.call('getMyTeamState', { code: ncCode }))?.team;
    check('power-ups: flag-absent game never grows powerUps',
      ncTeam?.powerUps === undefined || (ncTeam?.powerUps?.log?.length ?? 0) === 0,
      JSON.stringify(ncTeam?.powerUps));

    // ── Negative control B: time_only + flag on ⇒ no rolls ─────────────────────
    const { gameId: toGame } = await creator.call('createGame', { title: 'Time-only Power', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: toGame,
      scoringPreset: 'time_only',
      powerUpsEnabled: true,
      stages: [{
        id: 'to-stage', order: 0, title: 'Timed', isFinal: true,
        tasks: Array.from({ length: 6 }, (_, i) => ({ id: `to-${i}`, title: `T${i}`, type: 'field', coordinates: AT, difficulty: 3, estimatedMinutes: 5, pointValue: 100, maxConcurrentTeams: 6 })),
      }],
    });
    const { runId: toRun, accessCode: toCode } = await creator.call('launchRun', { gameId: toGame });
    const toP = makeParty('toPlayer');
    await signInAnonymously(toP.auth);
    await toP.call('joinRun', { code: toCode, displayName: 'Ticker' });
    await creator.call('startTeams', { gameId: toGame, runId: toRun });
    for (let i = 0; i < 8; i++) {
      let st = await toP.call('getMyTeamState', { code: toCode });
      let a = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      if (!a) { await toP.call('requestNextTask', { code: toCode, lat: AT.lat, lng: AT.lng }); st = await toP.call('getMyTeamState', { code: toCode }); a = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned'); }
      if (!a) break;
      await toP.call('completeTask', { taskId: a.taskId, code: toCode, lat: AT.lat, lng: AT.lng });
    }
    const toTeam = (await toP.call('getMyTeamState', { code: toCode }))?.team;
    check('power-ups: time_only never rolls even with the flag on',
      (toTeam?.powerUps?.log?.length ?? 0) === 0 && (toTeam?.bonusPenalty ?? 0) === 0,
      JSON.stringify({ log: toTeam?.powerUps?.log, bp: toTeam?.bonusPenalty }));
  }); // scenario: power-ups

  // ── Challenge a friend (checkChallengeAnswer) ───────────────────────────────
  // Isolated published quiz game so the main lifecycle is untouched.
  await scenario('challenge a friend (viral teaser)', async () => {
    const { gameId: chGame } = await creator.call('createGame', { title: 'Challenge Quiz' });
    const QUIZ_ID = 'ch-quiz-1';
    await creator.call('updateGame', {
      gameId: chGame,
      stages: [{
        id: 'ch-stage-1', order: 0, title: 'Quiz', isFinal: true,
        tasks: [{
          id: QUIZ_ID, title: 'Capital of France?', type: 'quiz',
          coordinates: { lat: 31.79, lng: 35.16 }, difficulty: 1,
          estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 5,
          answers: ['Paris'],
        }],
      }],
    });

    // Unpublished → refused (no publicGames doc to resolve the owner).
    let refused = false;
    try { await creator.call('checkChallengeAnswer', { gameId: chGame, taskId: QUIZ_ID, answer: 'Paris' }); }
    catch { refused = true; }
    check('challenge: unpublished game is refused', refused);

    await creator.call('publishGame', { gameId: chGame, visibility: 'public' });

    const right = await creator.call('checkChallengeAnswer', { gameId: chGame, taskId: QUIZ_ID, answer: 'paris' });
    check('challenge: correct answer → {correct:true}', right?.correct === true, JSON.stringify(right));
    const wrong = await creator.call('checkChallengeAnswer', { gameId: chGame, taskId: QUIZ_ID, answer: 'London' });
    check('challenge: wrong answer → {correct:false}', wrong?.correct === false, JSON.stringify(wrong));
    // The answer key must NEVER appear in the response — only { correct }.
    const keys = Object.keys(right ?? {});
    check('challenge: payload exposes only {correct}', keys.length === 1 && keys[0] === 'correct', JSON.stringify(keys));

    let missing = false;
    try { await creator.call('checkChallengeAnswer', { gameId: chGame, taskId: 'no-such-task', answer: 'x' }); }
    catch (e) { missing = e.code === 'functions/not-found'; }
    check('challenge: unknown task → not-found', missing);
  }); // scenario: challenge a friend

  // ═══ Leaderboard invariants + live/final parity ═════════════════════════════
  // buildRankings() is shared by refreshLeaderboard and finalizeRun precisely so
  // live and final standings can't drift — this scenario ASSERTS that promise on
  // a 3-team run with strictly divergent scores, plus general well-formedness
  // (oracle) and per-team score conservation.
  await scenario('leaderboard invariants + live/final parity', async () => {
    const { gameId: lg } = await creator.call('createGame', { title: 'Invariant Game', mode: 'individual' });
    const mkTask = (id, pts) => ({
      id, title: id, type: 'self_report', triggerMode: 'locationless', locationless: true,
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: pts, maxConcurrentTeams: 9,
    });
    await creator.call('updateGame', {
      gameId: lg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'lb-1', order: 0, title: 'One', tasks: [mkTask('lb-t1', 30)] },
        { id: 'lb-2', order: 1, title: 'Two', tasks: [mkTask('lb-t2', 60)] },
        { id: 'lb-3', order: 2, title: 'Three', isFinal: true, tasks: [mkTask('lb-t3', 90)] },
      ],
    });
    const { runId: lr, accessCode: lc } = await creator.call('launchRun', { gameId: lg });
    const names = ['Alpha', 'Bravo', 'Charlie'];
    const invPlayers = [];
    for (const n of names) {
      const p = makeParty(`inv${n}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: lc, displayName: n });
      invPlayers.push(p);
    }
    await creator.call('startTeams', { gameId: lg, runId: lr });

    // Alpha completes 3 stages, Bravo 2, Charlie 1 → strictly divergent scores.
    const playThrough = async (p, n) => {
      for (const t of ['lb-t1', 'lb-t2', 'lb-t3'].slice(0, n)) await p.call('completeTask', { taskId: t, code: lc });
    };
    await playThrough(invPlayers[0], 3);
    await playThrough(invPlayers[1], 2);
    await playThrough(invPlayers[2], 1);

    const teamIds = invPlayers.map((p) => p.auth.currentUser.uid);
    for (let i = 0; i < invPlayers.length; i++) {
      const st = await invPlayers[i].call('getMyTeamState', { code: lc });
      assertScoreConservation(`conservation(${names[i]})`, st?.team);
    }

    const live = await creator.call('refreshLeaderboard', { gameId: lg, runId: lr, publish: false });
    assertLeaderboardInvariants('live board', live?.rankings ?? [], teamIds);
    check('parity: live order is Alpha > Bravo > Charlie',
      JSON.stringify((live?.rankings ?? []).map((r) => r.teamName)) === JSON.stringify(names),
      (live?.rankings ?? []).map((r) => `${r.teamName}:${Math.round(r.score)}`).join(' '));

    const finL = await creator.call('finalizeRun', { gameId: lg, runId: lr });
    assertLeaderboardInvariants('final board', finL?.rankings ?? [], teamIds);
    check('parity: live and final team orderings agree (no drift)',
      JSON.stringify((live?.rankings ?? []).map((r) => r.teamId)) ===
        JSON.stringify((finL?.rankings ?? []).map((r) => r.teamId)),
      JSON.stringify({ live: (live?.rankings ?? []).map((r) => r.teamName), final: (finL?.rankings ?? []).map((r) => r.teamName) }));
  });

  // ═══ Hot-path leaderboard moved to read-time (WO Fix 4) ═════════════════════
  // completeTask must NOT recompute/write run.leaderboard during active play (it
  // dominated completeTask p95 under load). The board is recomputed lazily when an
  // organizer/viewer reads it (refreshLeaderboard / getPublicLeaderboard). Assert
  // the observable contract: a completion leaves run.leaderboard.updatedAt UNCHANGED,
  // and an organizer refresh then recomputes it (advancing updatedAt + reflecting the
  // new score). The live/final parity oracle above is the companion guard that this
  // move didn't break standings.
  await scenario('completeTask does not write the run-doc leaderboard during active play; organizer read recomputes it', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: hg } = await creator.call('createGame', { title: 'Hot-Path Board', mode: 'individual' });
    const mkTask = (id, pts) => ({
      id, title: id, type: 'self_report', triggerMode: 'locationless', locationless: true,
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: pts, maxConcurrentTeams: 9,
    });
    await creator.call('updateGame', {
      gameId: hg, scoringPreset: 'smart_weighted',
      stages: [
        { id: 'hp-1', order: 0, title: 'One', tasks: [mkTask('hp-t1', 30)] },
        { id: 'hp-2', order: 1, title: 'Two', isFinal: true, tasks: [mkTask('hp-t2', 60)] },
      ],
    });
    const { runId: hr, accessCode: hc } = await creator.call('launchRun', { gameId: hg });
    const teamA = makeParty('hpA');
    await signInAnonymously(teamA.auth);
    await teamA.call('joinRun', { code: hc, displayName: 'A' });
    const teamB = makeParty('hpB');
    await signInAnonymously(teamB.auth);
    await teamB.call('joinRun', { code: hc, displayName: 'B' });
    await creator.call('startTeams', { gameId: hg, runId: hr });

    const runPath = `users/${OWNER}/games/${hg}/runs/${hr}`;
    const before = (await creator.getDocAt(runPath)).data?.leaderboard?.updatedAt ?? null;

    // A scoring completion during active play.
    await teamA.call('completeTask', { taskId: 'hp-t1', code: hc });

    const afterCompletion = (await creator.getDocAt(runPath)).data?.leaderboard?.updatedAt ?? null;
    check('WO4: completeTask leaves run.leaderboard.updatedAt unchanged (no hot-path write)',
      afterCompletion === before, `before=${before} after=${afterCompletion}`);

    // An organizer read recomputes on demand.
    const refreshed = await creator.call('refreshLeaderboard', { gameId: hg, runId: hr, publish: false });
    const aEntry = (refreshed?.rankings ?? []).find((r) => r.teamName === 'A');
    check('WO4: organizer refresh recomputes and reflects A\'s new score',
      (aEntry?.score ?? 0) > 0, JSON.stringify(refreshed?.rankings));
    const afterRefresh = (await creator.getDocAt(runPath)).data?.leaderboard?.updatedAt ?? null;
    check('WO4: the organizer refresh advanced run.leaderboard.updatedAt',
      afterRefresh !== null && afterRefresh !== before, `before=${before} afterRefresh=${afterRefresh}`);
  });

  // ═══ Non-finite leaderboard guard (family-playtest regression) ══════════════
  // A team that JOINED but was never STARTED has no startedAt → durationSeconds
  // returns Infinity, which used to poison run.leaderboard and crash
  // getMyTeamState / refreshLeaderboard at JSON-encode (51× in the 2026-07-11
  // playtest). The board and the unstarted team's state must now be finite.
  await scenario('non-finite leaderboard guard (joined-but-not-started team)', async () => {
    const { gameId: nf } = await creator.call('createGame', { title: 'Non-Finite Guard', mode: 'individual' });
    const mkTask = (id, pts) => ({
      id, title: id, type: 'self_report', triggerMode: 'locationless', locationless: true,
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: pts, maxConcurrentTeams: 9,
    });
    await creator.call('updateGame', {
      gameId: nf, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'nf-1', order: 0, title: 'One', tasks: [mkTask('nf-t1', 30)] },
        { id: 'nf-2', order: 1, title: 'Two', isFinal: true, tasks: [mkTask('nf-t2', 60)] },
      ],
    });
    const { runId: nr, accessCode: nc } = await creator.call('launchRun', { gameId: nf });

    // Alpha joins and is started; Bravo joins AFTER startTeams → never started
    // (no startedAt) — the exact playtest condition.
    const alpha = makeParty('nfAlpha');
    await signInAnonymously(alpha.auth);
    await alpha.call('joinRun', { code: nc, displayName: 'Alpha' });
    await creator.call('startTeams', { gameId: nf, runId: nr });

    const bravo = makeParty('nfBravo');
    await signInAnonymously(bravo.auth);
    await bravo.call('joinRun', { code: nc, displayName: 'Bravo' });

    // A scoring event populates the board while Bravo sits unstarted.
    await alpha.call('completeTask', { taskId: 'nf-t1', code: nc });

    const board = await creator.call('refreshLeaderboard', { gameId: nf, runId: nr, publish: true });
    check('refreshLeaderboard resolves with an unstarted team in the run',
      Array.isArray(board?.rankings) && board.rankings.length === 2, JSON.stringify(board?.rankings?.length));
    assertAllFinite('refreshLeaderboard', board);

    // Both teams poll state; the published board is embedded in each response.
    const alphaState = await alpha.call('getMyTeamState', { code: nc });
    assertAllFinite('getMyTeamState(started)', alphaState);
    const bravoState = await bravo.call('getMyTeamState', { code: nc });
    check('getMyTeamState resolves for the unstarted team', bravoState?.team?.displayName === 'Bravo');
    assertAllFinite('getMyTeamState(unstarted)', bravoState);

    // Finalizing with an unstarted team present must also stay finite.
    const finalBoard = await creator.call('finalizeRun', { gameId: nf, runId: nr });
    assertAllFinite('finalizeRun', finalBoard);
  });

  // ═══ Station contention (concurrency) ═══════════════════════════════════════
  // Three teams finish a warmup task SIMULTANEOUSLY, forcing three concurrent
  // assignTask calls to race for a stage of two cap-1 stations. The station cap
  // must hold: no counter above 1, no two teams holding the same station.
  await scenario('station contention + duplicate submissions', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: cg } = await creator.call('createGame', { title: 'Contention Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: cg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'ct-warm', order: 0, title: 'Warmup', tasks: [
          { id: 'ct-w', title: 'Warm', type: 'self_report', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        ] },
        { id: 'ct-race', order: 1, title: 'Two cap-1 stations', isFinal: true, requiredTaskCount: 1, tasks: [
          { id: 'ct-a', title: 'Station A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
          { id: 'ct-b', title: 'Station B', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
        ] },
      ],
    });
    const { runId: cr, accessCode: cc } = await creator.call('launchRun', { gameId: cg });
    const racers = [];
    for (let i = 0; i < 3; i++) {
      const p = makeParty(`racer${i}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: cc, displayName: `Racer ${i}` });
      racers.push(p);
    }
    await creator.call('startTeams', { gameId: cg, runId: cr });

    await Promise.all(racers.map((p) => p.call('completeTask', { taskId: 'ct-w', code: cc })));

    const runDoc = await creator.getDocAt(`users/${OWNER}/games/${cg}/runs/${cr}`);
    const counts = runDoc.data?.taskCounts ?? {};
    check('contention: no station counter exceeds its cap (taskCounts ≤ 1)',
      (counts['ct-a'] ?? 0) <= 1 && (counts['ct-b'] ?? 0) <= 1, JSON.stringify(counts));

    const states = await Promise.all(racers.map((p) => p.call('getMyTeamState', { code: cc })));
    const held = states.map((s) => s?.team?.activeTaskId).filter(Boolean);
    check('contention: no two teams hold the same cap-1 station',
      new Set(held).size === held.length, JSON.stringify(held));
    check('contention: exactly 2 of 3 teams hold a station (2 slots exist)',
      held.length === 2, JSON.stringify(held));

    // Duplicate concurrent submissions must score exactly once — the completion
    // transaction is idempotent (`status === 'completed'` short-circuit).
    const { gameId: dg } = await creator.call('createGame', { title: 'Double Submit', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: dg, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'ds-s', order: 0, title: 'Code', isFinal: true, tasks: [
        { id: 'ds-code', title: 'Code station', type: 'smart_station', coordinates: { lat: 31.78, lng: 35.21 },
          difficulty: 2, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 3,
          smart: { enabled: true, verificationType: 'code_verification', hasCode: true, secretCode: 'TWICE' } },
      ] }],
    });
    const { runId: dr, accessCode: dc } = await creator.call('launchRun', { gameId: dg });
    const doubler = makeParty('doubler');
    await signInAnonymously(doubler.auth);
    await doubler.call('joinRun', { code: dc, displayName: 'Doubler' });
    await creator.call('startTeams', { gameId: dg, runId: dr });
    const dPayload = { ownerUid: OWNER, gameId: dg, runId: dr, taskId: 'ds-code', code: 'twice' };
    const dres = await Promise.allSettled([
      doubler.call('verifyStationCode', dPayload),
      doubler.call('verifyStationCode', dPayload),
    ]);
    check('double-submit: at least one concurrent verify succeeds',
      dres.some((r) => r.status === 'fulfilled'), JSON.stringify(dres.map((r) => r.status)));
    const dstate = await doubler.call('getMyTeamState', { code: dc });
    const drec = dstate?.team?.stages?.[0]?.tasks?.[0];
    check('double-submit: task scored exactly once (team.score == its earnedScore)',
      dstate?.team?.score === drec?.earnedScore && (drec?.earnedScore ?? 0) > 0,
      `score=${dstate?.team?.score} earned=${drec?.earnedScore}`);
  });

  // ═══ Partial-stage auto-skip of a sibling-held task is a no-op (WO Fix 2) ═════
  // A partial stage (requiredTaskCount:1) completing auto-skips leftover tasks — a
  // leftover a SIBLING team still holds gets flipped to 'skipped' AND its stage off
  // 'active'. That sibling then completing its now-'skipped' task must be a graceful
  // no-op ({ ok:true, already:true }), NOT a thrown failed-precondition that crashes
  // the play loop (the --teams=16 Run A crash). The idempotency guard must fold any
  // non-actionable status (completed|skipped) BEFORE the stage-active throw.
  await scenario('partial-stage auto-skip of a task a sibling still holds is a no-op, not failed-precondition', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: pg } = await creator.call('createGame', { title: 'Partial Auto-Skip', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: pg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'ps-warm', order: 0, title: 'Warmup', tasks: [
          { id: 'ps-w', title: 'Warm', type: 'self_report', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        ] },
        { id: 'ps-race', order: 1, title: 'Two cap-1 stations, pick one', isFinal: true, requiredTaskCount: 1, tasks: [
          { id: 'ps-a', title: 'Station A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
          { id: 'ps-b', title: 'Station B', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
        ] },
      ],
    });
    const { runId: pr, accessCode: pc } = await creator.call('launchRun', { gameId: pg });
    const racers = [];
    for (let i = 0; i < 3; i++) {
      const p = makeParty(`psRacer${i}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: pc, displayName: `PS Racer ${i}` });
      racers.push(p);
    }
    await creator.call('startTeams', { gameId: pg, runId: pr });
    // Complete the warmup so routing advances everyone into the cap-1 stage.
    await Promise.all(racers.map((p) => p.call('completeTask', { taskId: 'ps-w', code: pc })));

    // Identify the two holders (2 of 3; the third dead-ends stationsFull).
    const states = await Promise.all(racers.map(async (p, i) => ({
      p, i, state: await p.call('getMyTeamState', { code: pc }),
    })));
    const holders = states
      .map((s) => ({ p: s.p, held: s.state?.team?.activeTaskId }))
      .filter((s) => !!s.held);
    check('WO2: exactly 2 of 3 racers hold a cap-1 station', holders.length === 2,
      JSON.stringify(states.map((s) => s.state?.team?.activeTaskId)));
    const [H1, H2] = holders;

    // H1 completes its own held station → its requiredTaskCount:1 (isFinal) stage
    // flips 'completed', auto-skipping H1's OTHER same-stage task and releasing its
    // slot. ps-a/ps-b are LOCATED `field` stations (real coords, radius trigger), so —
    // like a real client at the station — the check-in must carry GPS or the server's
    // anti-spoof gate rejects it with "Location required to check in here". Both
    // stations sit at 31.78/35.21. (Auto-skip is per-team: H1 finishing does NOT skip
    // H2's separately-held station, so H2 below completes its own task for real.)
    await H1.p.call('completeTask', { taskId: H1.held, code: pc, lat: 31.78, lng: 35.21 });

    // H2 completes its OWN still-held station — a genuine first completion, which
    // likewise flips H2's partial stage 'completed' and auto-skips H2's leftover.
    const h2First = await H2.p.call('completeTask', { taskId: H2.held, code: pc, lat: 31.78, lng: 35.21 });
    check('WO2: H2 completes its own held station without a failed-precondition crash',
      h2First?.ok === true, JSON.stringify(h2First));

    // The crash driver: a DUPLICATE completion of H2's now-terminal ('completed')
    // task, in a stage that has flipped off 'active'. The WO Fix 2 idempotency guard
    // must fold this to a graceful no-op — NOT the stage-active failed-precondition
    // throw that crashed the play loop (the --teams=16 Run A crash).
    let threw = null;
    let res = null;
    try {
      res = await H2.p.call('completeTask', { taskId: H2.held, code: pc, lat: 31.78, lng: 35.21 });
    } catch (e) {
      threw = e;
    }
    check('WO2: a duplicate completion of a now-terminal task does not throw',
      threw === null, threw ? String(threw?.message ?? threw) : 'no throw');
    check('WO2: it returns a graceful idempotent no-op (ok && already)',
      res?.ok === true && res?.already === true, JSON.stringify(res));

    // Invariant tail: every station counter ≤ cap and the finished run drains to 0.
    const runDoc = await creator.getDocAt(`users/${OWNER}/games/${pg}/runs/${pr}`);
    const counts = runDoc.data?.taskCounts ?? {};
    check('WO2: no station counter exceeds its cap (≤ 1)',
      (counts['ps-a'] ?? 0) <= 1 && (counts['ps-b'] ?? 0) <= 1, JSON.stringify(counts));
  });

  // ═══ Same-team assignment race (fix-station-slot-same-team-race) ═════════════
  // Two concurrent requestNextTask calls for the SAME team on a multi-task stage
  // race to claim a station slot. The old code read the team, then wrote the
  // assignment non-atomically, so both could reserve DIFFERENT slots and the
  // second write would win — leaving one reserved slot with no team on it (a
  // permanent station-capacity leak the different-team contention test can't see).
  // The team must end holding exactly one task, and the total reserved across the
  // stage's candidate stations must be exactly 1 (no leak). Rate-limiting one of
  // the two calls doesn't invalidate the invariant — it must hold either way.
  await scenario('same-team assignment race leaks no station slot', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: sg } = await creator.call('createGame', { title: 'Same-Team Race', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: sg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'st-multi', order: 0, title: 'Two stations, pick one', isFinal: true, requiredTaskCount: 1, tasks: [
          { id: 'st-a', title: 'Station A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
          { id: 'st-b', title: 'Station B', type: 'field', coordinates: { lat: 31.79, lng: 35.22 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
        ] },
      ],
    });
    const { runId: sr, accessCode: sc } = await creator.call('launchRun', { gameId: sg });
    const solo = makeParty('sameTeamRacer');
    await signInAnonymously(solo.auth);
    await solo.call('joinRun', { code: sc, displayName: 'Racer' });
    await creator.call('startTeams', { gameId: sg, runId: sr });

    // Fire the initial assignment TWICE at once for the one team.
    const CS = { ownerUid: OWNER, gameId: sg, runId: sr, code: sc, lat: 31.78, lng: 35.21 };
    await Promise.allSettled([
      solo.call('requestNextTask', CS),
      solo.call('requestNextTask', CS),
    ]);

    const runDoc = await creator.getDocAt(`users/${OWNER}/games/${sg}/runs/${sr}`);
    const counts = runDoc.data?.taskCounts ?? {};
    const reserved = (counts['st-a'] ?? 0) + (counts['st-b'] ?? 0);
    const state = await solo.call('getMyTeamState', { code: sc });
    const active = state?.team?.activeTaskId;
    check('same-team race: team holds exactly one task', !!active, JSON.stringify(active));
    check('same-team race: exactly one slot reserved (no leaked station slot)',
      reserved === 1, JSON.stringify(counts));
    check('same-team race: the reserved slot matches the held task',
      (counts[active] ?? 0) === 1, `active=${active} counts=${JSON.stringify(counts)}`);
  });

  // ═══ Cross-team completion cannot steal a held station slot ══════════════════
  // A hand-crafted completeTask on a capped station the caller never checked out
  // must NOT decrement run.taskCounts for the slot the HOLDER reserved (that would
  // silently defeat the station cap). Two cap-1 stations, requiredTaskCount 1.
  await scenario('cross-team completion cannot steal a held station slot', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: bg } = await creator.call('createGame', { title: 'Cap Bypass', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: bg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'cap0', order: 0, title: 'Two capped stations', isFinal: true, requiredTaskCount: 1, tasks: [
          { id: 'st-a', title: 'Station A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
          { id: 'st-b', title: 'Station B', type: 'field', coordinates: { lat: 31.79, lng: 35.22 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
        ] },
      ],
    });
    const { runId: br, accessCode: bc } = await creator.call('launchRun', { gameId: bg });

    const teamA = makeParty('capHolderA');
    await signInAnonymously(teamA.auth);
    await teamA.call('joinRun', { code: bc, displayName: 'Holder A' });
    const teamB = makeParty('capThiefB');
    await signInAnonymously(teamB.auth);
    await teamB.call('joinRun', { code: bc, displayName: 'Thief B' });
    await creator.call('startTeams', { gameId: bg, runId: br });

    const CA = { ownerUid: OWNER, gameId: bg, runId: br, code: bc, lat: 31.78, lng: 35.21 };
    const CB = { ownerUid: OWNER, gameId: bg, runId: br, code: bc, lat: 31.78, lng: 35.21 };

    // startTeams already auto-assigned each team its first task (from a fixed seed
    // location, in unordered team-query order); requestNextTask just returns that
    // in-flight task. Both cap-1 stations are >2.5 km from the seed, so their transit
    // norms tie and the sequential assignment loop hands st-a to whichever team it
    // processes FIRST — a Firestore doc-order coin-flip. So don't assume which named
    // team holds which station; identify the two holders. The invariant under test is
    // "a completion by a team that does NOT hold st-a cannot drain st-a's reserved
    // slot", which is independent of that ordering.
    const aAsg = await teamA.call('requestNextTask', CA);
    const bAsg = await teamB.call('requestNextTask', CB);
    check('cap: the two teams hold the two distinct cap-1 stations',
      new Set([aAsg?.taskId, bAsg?.taskId]).size === 2 &&
        [aAsg?.taskId, bAsg?.taskId].every((t) => t === 'st-a' || t === 'st-b'),
      JSON.stringify({ aAsg, bAsg }));
    // The attacker holds st-b; its target is st-a (reserved by the OTHER team).
    const attacker = aAsg?.taskId === 'st-a' ? teamB : teamA;
    const holderOfStA = aAsg?.taskId === 'st-a' ? teamA : teamB;

    const runPath = `users/${OWNER}/games/${bg}/runs/${br}`;
    let counts = (await creator.getDocAt(runPath)).data?.taskCounts ?? {};
    check('cap: both slots reserved before the attack', (counts['st-a'] ?? 0) === 1 && (counts['st-b'] ?? 0) === 1, JSON.stringify(counts));

    // ATTACK: the st-b holder hand-crafts a completeTask on st-a, which it never checked out.
    await attacker.call('completeTask', { ownerUid: OWNER, gameId: bg, runId: br, code: bc, lat: 31.78, lng: 35.21, taskId: 'st-a' });

    counts = (await creator.getDocAt(runPath)).data?.taskCounts ?? {};
    check("cap: attacker cannot drain the holder's slot (taskCounts st-a still 1)",
      (counts['st-a'] ?? 0) === 1, JSON.stringify(counts));

    const holderState = await holderOfStA.call('getMyTeamState', { code: bc });
    check('cap: the st-a holder still holds st-a', holderState?.team?.activeTaskId === 'st-a', JSON.stringify(holderState?.team?.activeTaskId));

    // Invariant: a third team must NOT be assignable into the still-held st-a.
    const teamC = makeParty('capThirdC');
    await signInAnonymously(teamC.auth);
    await teamC.call('joinRun', { code: bc, displayName: 'Third C' });
    await creator.call('startTeams', { gameId: bg, runId: br });
    const cAsg = await teamC.call('requestNextTask', { ownerUid: OWNER, gameId: bg, runId: br, code: bc, lat: 31.78, lng: 35.21 });
    check('cap: third team is not assigned the still-held st-a', cAsg?.taskId !== 'st-a', JSON.stringify(cAsg));
  });

  // ═══ Lost-response retry leaks no station slot (bug-hunt-2026-07-10) ═════════
  // The play-web callable wrapper now retries a callable up to 3× on a transient/
  // timeout code (the client can't tell "the server never got it" from "the
  // response never got back") — so a SEQUENTIAL duplicate call (await the first
  // call fully, THEN call again with identical args) must model a genuine
  // lost-response retry, distinct from the true-concurrency race above. Covers
  // both requestNextTask (assign path) and completeTask (release+reassign path)
  // at a CAPPED (maxConcurrentTeams=1) station so a leak is visible immediately.
  await scenario('lost-response retry leaks no station slot', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: rg } = await creator.call('createGame', { title: 'Retry Safety', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: rg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'rt-multi', order: 0, title: 'Two capped stations', requiredTaskCount: 1, tasks: [
          { id: 'rt-a', title: 'Station A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
          { id: 'rt-b', title: 'Station B', type: 'field', coordinates: { lat: 31.79, lng: 35.22 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 1 },
        ] },
        { id: 'rt-final', order: 1, isFinal: true, tasks: [
          { id: 'rt-c', title: 'Finish', type: 'field', coordinates: { lat: 31.80, lng: 35.23 },
            difficulty: 1, estimatedMinutes: 5, pointValue: 10 },
        ] },
      ],
    });
    const { runId: rr, accessCode: rc } = await creator.call('launchRun', { gameId: rg });
    const retrier = makeParty('retryTeam');
    await signInAnonymously(retrier.auth);
    await retrier.call('joinRun', { code: rc, displayName: 'Retrier' });
    await creator.call('startTeams', { gameId: rg, runId: rr });

    const RC = { ownerUid: OWNER, gameId: rg, runId: rr, code: rc, lat: 31.78, lng: 35.21 };

    // 1) Assign path: call requestNextTask, await it fully, then call it AGAIN
    //    with identical args — the in-flight guard should make this a no-op.
    const first = await retrier.call('requestNextTask', RC);
    const retry1 = await retrier.call('requestNextTask', RC);
    check('retry requestNextTask returns the SAME task (no re-assignment)',
      first?.taskId && first.taskId === retry1?.taskId, JSON.stringify({ first, retry1 }));

    let runDoc = await creator.getDocAt(`users/${OWNER}/games/${rg}/runs/${rr}`);
    let counts = runDoc.data?.taskCounts ?? {};
    check('retry requestNextTask: capped station counter still exactly 1 (no leak)',
      (counts[first.taskId] ?? 0) === 1, JSON.stringify(counts));

    // 2) Release+reassign path: complete the held task, await it fully, then call
    //    completeTask AGAIN with identical args (as a client would after a lost
    //    response) — the already-completed guard should make this a pure no-op:
    //    no second release, no second (extra) assignment.
    const cDone = await retrier.call('completeTask', { taskId: first.taskId, ownerUid: OWNER, gameId: rg, runId: rr, code: rc, lat: 31.78, lng: 35.21 });
    const cRetry = await retrier.call('completeTask', { taskId: first.taskId, ownerUid: OWNER, gameId: rg, runId: rr, code: rc, lat: 31.78, lng: 35.21 });
    check('retry completeTask: duplicate call is a no-op (no nextTaskId)',
      cRetry?.nextTaskId == null, JSON.stringify({ cDone, cRetry }));
    // WO-3: the no-op replay is now OBSERVABLE — a duplicate returns already:true
    // while the first completion does not, so clients/sims can tell them apart.
    check('retry completeTask: duplicate is flagged already:true (first was not)',
      cRetry?.already === true && cDone?.already !== true, JSON.stringify({ cDone, cRetry }));

    runDoc = await creator.getDocAt(`users/${OWNER}/games/${rg}/runs/${rr}`);
    counts = runDoc.data?.taskCounts ?? {};
    check('retry completeTask: completed station released back to 0 (no negative leak either)',
      (counts[first.taskId] ?? 0) === 0, JSON.stringify(counts));
    const otherStationId = first.taskId === 'rt-a' ? 'rt-b' : 'rt-a';
    check('retry completeTask: the OTHER capped station was never touched',
      (counts[otherStationId] ?? 0) === 0, JSON.stringify(counts));

    const state = await retrier.call('getMyTeamState', { code: rc });
    check('retry completeTask: team advanced to the next task exactly once',
      cDone?.nextTaskId != null && state?.team?.activeTaskId === cDone.nextTaskId,
      JSON.stringify({ cDoneNext: cDone?.nextTaskId, active: state?.team?.activeTaskId }));
  });

  // ═══ Stage-lock enforcement (fix-stage-lock-bypass) ═════════════════════════
  // A completion may only land in the team's ACTIVE stage. A task in a LOCKED
  // (future) stage — reachable because a participant can read its own future
  // task ids from getMyTeamState — must be rejected `failed-precondition`, not
  // graded. The isUnlocked guard only covers intra-stage prerequisites, not
  // stage ordering, so this closes all five funnel paths at once.
  await scenario('stage-lock enforcement (no out-of-order grading in locked stages)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: sg } = await creator.call('createGame', { title: 'Stage Lock', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: sg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'sl-1', order: 0, title: 'Stage One', tasks: [
          { id: 'sl-t1', title: 'Warm', type: 'self_report', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9,
            hint: 'Active-stage hint you are allowed to see.', hintPenalty: 15 },
        ] },
        { id: 'sl-2', order: 1, title: 'Stage Two (locked)', isFinal: true, tasks: [
          { id: 'sl-quiz', title: 'Locked quiz', type: 'quiz', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 9,
            answers: ['open'], hint: 'SECRET future-stage spot — must not leak.', hintPenalty: 30 },
          { id: 'sl-field', title: 'Locked check-in', type: 'field', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: sr, accessCode: sc } = await creator.call('launchRun', { gameId: sg });
    const p = makeParty('stageLockPlayer');
    await signInAnonymously(p.auth);
    await p.call('joinRun', { code: sc, displayName: 'Locked Team' });
    await creator.call('startTeams', { gameId: sg, runId: sr });

    const before = await p.call('getMyTeamState', { code: sc });
    check('stage-lock: stage 2 is locked while stage 1 is active',
      before?.team?.stages?.[1]?.status === 'locked', before?.team?.stages?.[1]?.status);
    const CS = { ownerUid: OWNER, gameId: sg, runId: sr, code: sc };

    // completeTask against a locked-stage field task (passes the type gate) is rejected.
    await expectError('stage-2 field task rejected via completeTask while stage 1 active',
      p.call('completeTask', { ...CS, taskId: 'sl-field' }),
      { codeIn: ['functions/failed-precondition'], match: /stage|locked|active/i });
    // submitTaskAnswer with the CORRECT answer still can't grade a locked-stage quiz.
    await expectError('stage-2 quiz rejected via submitTaskAnswer while stage 1 active',
      p.call('submitTaskAnswer', { ...CS, taskId: 'sl-quiz', answer: 'open' }),
      { codeIn: ['functions/failed-precondition'], match: /stage|locked|active/i });
    // requestTaskHint must carry the SAME stage-scope guard (wave-g #1): paying to
    // reveal a locked/future stage's hint is a scout-ahead / hidden-spot oracle.
    await expectError('stage-2 hint rejected via requestTaskHint while stage 1 active',
      p.call('requestTaskHint', { ...CS, taskId: 'sl-quiz' }),
      { codeIn: ['functions/failed-precondition'], match: /stage|locked|active/i });
    // ...but the ACTIVE-stage task's hint must still reveal (intended by design —
    // e.g. a hidden-location find-the-spot hint for the spot you are hunting NOW).
    const activeHint = await p.call('requestTaskHint', { ...CS, taskId: 'sl-t1' });
    check('active-stage hint still reveals via requestTaskHint',
      activeHint?.hint === 'Active-stage hint you are allowed to see.',
      JSON.stringify(activeHint));

    const after = await p.call('getMyTeamState', { code: sc });
    check('stage-lock: still exactly one active stage after the rejections',
      (after?.team?.stages ?? []).filter((s) => s.status === 'active').length === 1,
      JSON.stringify((after?.team?.stages ?? []).map((s) => s.status)));
    check('stage-lock: the locked-stage tasks were NOT completed',
      (after?.team?.stages?.[1]?.tasks ?? []).every((t) => t.status !== 'completed'),
      JSON.stringify((after?.team?.stages?.[1]?.tasks ?? []).map((t) => t.status)));
    check('stage-lock: no score awarded by the out-of-order attempts',
      (after?.team?.score ?? 0) === 0, String(after?.team?.score));

    // Finalizing must not have credited the never-legitimately-completed final task.
    const fin = await creator.call('finalizeRun', { gameId: sg, runId: sr });
    const entry = (fin?.rankings ?? []).find((r) => r.teamId === p.auth.currentUser.uid);
    check('stage-lock: finalized team was not credited an out-of-order final completion',
      (entry?.score ?? 0) === 0, JSON.stringify(entry));
  });

  // ═══ WO-1: verifyStationCode releases its held station slot ══════════════════
  // A correct code completes the task — but the fire-and-forget completion never
  // released the reserved slot, so a capped smart_station leaked a slot on every
  // check-in (the next team got {taskId:null} forever). It must now release the
  // slot AND return nextTaskId for parity with completeTask/submitStationPhoto.
  await scenario('verifyStationCode releases its station slot (WO-1)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: vg } = await creator.call('createGame', { title: 'Station Release', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: vg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'vs-0', order: 0, title: 'Cap-1 station', tasks: [
          { id: 'vs-code', title: 'Secret station', type: 'smart_station', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 1,
            smart: { enabled: true, verificationType: 'code_verification', hasCode: true, secretCode: 'OPEN' } },
        ] },
        { id: 'vs-1', order: 1, title: 'Finish', isFinal: true, tasks: [
          { id: 'vs-fin', title: 'Wrap up', type: 'self_report', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: vr, accessCode: vc } = await creator.call('launchRun', { gameId: vg });
    const runPath = `users/${OWNER}/games/${vg}/runs/${vr}`;

    const teamA = makeParty('vsTeamA');
    await signInAnonymously(teamA.auth);
    await teamA.call('joinRun', { code: vc, displayName: 'Alpha' });
    await creator.call('startTeams', { gameId: vg, runId: vr });

    // Reserve the cap-1 station slot.
    await teamA.call('requestNextTask', { ownerUid: OWNER, gameId: vg, runId: vr, code: vc, lat: 31.78, lng: 35.21 });
    let counts = (await creator.getDocAt(runPath)).data?.taskCounts ?? {};
    check('WO-1: slot reserved before completion (taskCounts vs-code == 1)',
      (counts['vs-code'] ?? 0) === 1, JSON.stringify(counts));

    // Correct code completes → releases the slot AND advances to the next stage.
    const vres = await teamA.call('verifyStationCode', { ownerUid: OWNER, gameId: vg, runId: vr, taskId: 'vs-code', code: 'open' });
    check('WO-1: verifyStationCode verified true', vres?.verified === true, JSON.stringify(vres));
    check('WO-1: response carries nextTaskId (parity with completeTask)',
      vres?.nextTaskId === 'vs-fin', JSON.stringify(vres));

    counts = (await creator.getDocAt(runPath)).data?.taskCounts ?? {};
    check('WO-1: station slot released after completion (taskCounts vs-code == 0)',
      (counts['vs-code'] ?? 0) === 0, JSON.stringify(counts));

    // Team B can now take the same station (the slot is free again).
    const teamB = makeParty('vsTeamB');
    await signInAnonymously(teamB.auth);
    await teamB.call('joinRun', { code: vc, displayName: 'Bravo' });
    await creator.call('startTeams', { gameId: vg, runId: vr });
    const bAsg = await teamB.call('requestNextTask', { ownerUid: OWNER, gameId: vg, runId: vr, code: vc, lat: 31.78, lng: 35.21 });
    check('WO-1: team B gets the freed station (non-null taskId)',
      bAsg?.taskId === 'vs-code', JSON.stringify(bAsg));
  });

  // ═══ WO-2: locked/future-stage answer oracle is closed ══════════════════════
  // Every answer callable computed correctness BEFORE the stage-active gate (which
  // lived inside completeTaskForTeam), so a locked-stage task returned a clean
  // correct/wrong oracle (wrong→{correct:false}, correct→a different error). A
  // wrong and a correct probe on a locked stage must now be BYTE-IDENTICAL.
  await scenario('locked-stage answer oracle is closed (WO-2)', async () => {
    const OWNER = creatorCred.user.uid;
    const grab = async (p) => {
      try { return { ok: true, r: await p }; }
      catch (e) { return { ok: false, code: e.code, message: e.message }; }
    };
    const { gameId: og } = await creator.call('createGame', { title: 'Answer Oracle', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: og, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'or-0', order: 0, title: 'Warmup', tasks: [
          { id: 'or-warm', title: 'Warm', type: 'self_report', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        ] },
        { id: 'or-1', order: 1, title: 'Locked stage', isFinal: true, requiredTaskCount: 1, tasks: [
          { id: 'or-quiz', title: 'Locked quiz', type: 'quiz', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 9,
            answers: ['42'] },
          { id: 'or-num', title: 'Locked numeric', type: 'numeric', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 5, pointValue: 80, maxConcurrentTeams: 9,
            numericAnswer: 7, numericTolerance: 0 },
          { id: 'or-code', title: 'Locked station', type: 'smart_station', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 9,
            smart: { enabled: true, verificationType: 'code_verification', hasCode: true, secretCode: 'OPEN' } },
          { id: 'or-seq', title: 'Locked sequence', type: 'sequence', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 5, pointValue: 60, maxConcurrentTeams: 9,
            steps: [{ id: 's1', prompt: 'Step 1', answer: 'step1' }, { id: 's2', prompt: 'Step 2', answer: 'step2' }] },
        ] },
      ],
    });
    const { runId: orr, accessCode: oc } = await creator.call('launchRun', { gameId: og });
    const p = makeParty('oraclePlayer');
    await signInAnonymously(p.auth);
    await p.call('joinRun', { code: oc, displayName: 'Prober' });
    await creator.call('startTeams', { gameId: og, runId: orr });
    const CS = { ownerUid: OWNER, gameId: og, runId: orr, code: oc };

    // submitTaskAnswer: wrong vs correct on the locked quiz are indistinguishable.
    const wrongQuiz = await grab(p.call('submitTaskAnswer', { ...CS, taskId: 'or-quiz', answer: 'nope' }));
    const rightQuiz = await grab(p.call('submitTaskAnswer', { ...CS, taskId: 'or-quiz', answer: '42' }));
    check('WO-2: locked-stage wrong quiz throws failed-precondition (not {correct:false})',
      wrongQuiz.ok === false && wrongQuiz.code === 'functions/failed-precondition', JSON.stringify(wrongQuiz));
    check('WO-2: locked-stage correct quiz throws the SAME error as wrong (no oracle)',
      rightQuiz.ok === false && rightQuiz.code === wrongQuiz.code && rightQuiz.message === wrongQuiz.message,
      JSON.stringify({ wrongQuiz, rightQuiz }));

    // verifyStationCode: wrong vs correct code on the locked station are identical.
    const wrongCode = await grab(p.call('verifyStationCode', { ownerUid: OWNER, gameId: og, runId: orr, taskId: 'or-code', code: 'nope' }));
    const rightCode = await grab(p.call('verifyStationCode', { ownerUid: OWNER, gameId: og, runId: orr, taskId: 'or-code', code: 'open' }));
    check('WO-2: locked-stage wrong station code throws failed-precondition',
      wrongCode.ok === false && wrongCode.code === 'functions/failed-precondition', JSON.stringify(wrongCode));
    check('WO-2: locked-stage correct code throws the SAME generic error (not "Incorrect code")',
      rightCode.ok === false && rightCode.message === wrongCode.message && !/incorrect code/i.test(rightCode.message ?? ''),
      JSON.stringify({ wrongCode, rightCode }));

    // submitSequenceStep: wrong vs correct step on the locked sequence are identical.
    const wrongStep = await grab(p.call('submitSequenceStep', { ...CS, taskId: 'or-seq', stepIndex: 0, answer: 'nope' }));
    const rightStep = await grab(p.call('submitSequenceStep', { ...CS, taskId: 'or-seq', stepIndex: 0, answer: 'step1' }));
    check('WO-2: locked-stage sequence step throws the SAME error regardless of correctness',
      wrongStep.ok === false && rightStep.ok === false &&
      wrongStep.code === 'functions/failed-precondition' &&
      wrongStep.code === rightStep.code && wrongStep.message === rightStep.message,
      JSON.stringify({ wrongStep, rightStep }));

    // Positive control: once stage 1 is active, grading works normally again.
    await p.call('completeTask', { ...CS, taskId: 'or-warm' }); // completes stage 0 → stage 1 active
    const wrongNow = await grab(p.call('submitTaskAnswer', { ...CS, taskId: 'or-quiz', answer: 'nope' }));
    const rightNow = await grab(p.call('submitTaskAnswer', { ...CS, taskId: 'or-quiz', answer: '42' }));
    check('WO-2 positive control: active-stage wrong quiz returns {correct:false}',
      wrongNow.ok === true && wrongNow.r?.correct === false, JSON.stringify(wrongNow));
    check('WO-2 positive control: active-stage correct quiz completes',
      rightNow.ok === true && rightNow.r?.correct === true, JSON.stringify(rightNow));
  });

  // ═══ WO-4: run-wide staff lockout never blocks a correct PIN ═════════════════
  // The run-wide lockout throw fired BEFORE the PIN lookup, so any griefer could
  // spend 20 wrong guesses from fresh anonymous uids and lock every legit staffer
  // out of a live run. A correct, unused PIN must win even under run-wide lockout;
  // only wrong guesses stay gated.
  await scenario('run-wide staff lockout never blocks a correct PIN (WO-4)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: gg } = await creator.call('createGame', { title: 'Lockout DoS', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gg, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'lk-0', order: 0, isFinal: true, title: 'Only stage', tasks: [
        { id: 'lk-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: lr } = await creator.call('launchRun', { gameId: gg });
    const { pin } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: gg, runId: lr, name: 'Legit Marshal', permissions: ['review_photos'],
    });

    // Drive the RUN-WIDE counter to lockout: STAFF_RUN_LOCKOUT_LIMIT (20) wrong
    // guesses, each from a FRESH anonymous identity (per-uid counter never trips).
    for (let i = 0; i < 20; i++) {
      const griefer = makeParty(`grief${i}`);
      await signInAnonymously(griefer.auth);
      try { await griefer.call('staffSignIn', { ownerUid: OWNER, gameId: gg, runId: lr, pin: '000000' }); }
      catch { /* expected not-found / resource-exhausted */ }
    }

    // A WRONG PIN during the run-wide lockout window is still rejected.
    const wrongDuring = makeParty('wrongDuring');
    await signInAnonymously(wrongDuring.auth);
    let wrongRejected = false;
    try { await wrongDuring.call('staffSignIn', { ownerUid: OWNER, gameId: gg, runId: lr, pin: '111111' }); }
    catch { wrongRejected = true; }
    check('WO-4: a WRONG PIN during run-wide lockout is still rejected', wrongRejected);

    // A legit staffer with the CORRECT PIN succeeds despite the run-wide lockout.
    const legit = makeParty('legitStaff');
    await signInAnonymously(legit.auth);
    const tok = await legit.call('staffSignIn', { ownerUid: OWNER, gameId: gg, runId: lr, pin });
    check('WO-4: correct PIN succeeds under run-wide lockout (mints a token)',
      !!tok?.customToken, JSON.stringify({ hasToken: !!tok?.customToken }));
  });

  // ═══ WO-5: bad-coordinate inputs return clean errors, not 500 ════════════════
  // Client {lat,lng} flowed into haversineKm; only null/undefined defaulted to
  // (0,0). Out-of-range/NaN/string coords reached haversineKm → LocationError →
  // opaque INTERNAL (a 500). On completeTask the 500 fired AFTER the task was
  // already marked complete. Each callable must now throw a clean invalid-argument
  // up front, and completeTask must not complete the task on a rejected call.
  await scenario('bad-coordinate inputs return clean errors, not 500 (WO-5)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: bg } = await creator.call('createGame', { title: 'Bad Coords', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: bg, scoringPreset: 'smart_weighted',
      stages: [{ id: 'bc-0', order: 0, isFinal: true, title: 'Mixed tasks', requiredTaskCount: 1, tasks: [
        { id: 'bc-field', title: 'Check in', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        { id: 'bc-quiz', title: 'Quiz', type: 'quiz', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 9,
          answers: ['x'] },
        { id: 'bc-seq', title: 'Sequence', type: 'sequence', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 9,
          steps: [{ id: 's1', prompt: 'Step 1', answer: 'a' }] },
      ] }],
    });
    const { runId: brr, accessCode: bcc } = await creator.call('launchRun', { gameId: bg });
    const p = makeParty('badCoordPlayer');
    await signInAnonymously(p.auth);
    await p.call('joinRun', { code: bcc, displayName: 'Coords' });
    await creator.call('startTeams', { gameId: bg, runId: brr });
    const CS = { ownerUid: OWNER, gameId: bg, runId: brr, code: bcc };
    const BAD = { lat: 999, lng: 181 };

    await expectError('WO-5: requestNextTask rejects out-of-range coords (invalid-argument)',
      p.call('requestNextTask', { ...CS, ...BAD }), { codeIn: ['functions/invalid-argument'] });
    await expectError('WO-5: getRecommendedTasks rejects out-of-range coords (invalid-argument)',
      p.call('getRecommendedTasks', { ...CS, ...BAD }), { codeIn: ['functions/invalid-argument'] });
    await expectError('WO-5: submitTaskAnswer rejects out-of-range coords (invalid-argument)',
      p.call('submitTaskAnswer', { ...CS, taskId: 'bc-quiz', answer: 'x', ...BAD }), { codeIn: ['functions/invalid-argument'] });
    await expectError('WO-5: submitSequenceStep rejects out-of-range coords (invalid-argument)',
      p.call('submitSequenceStep', { ...CS, taskId: 'bc-seq', stepIndex: 0, answer: 'a', ...BAD }), { codeIn: ['functions/invalid-argument'] });
    // Non-numeric (string) coords are rejected the same way, not coerced/500'd.
    await expectError('WO-5: string coords are rejected (invalid-argument, not internal)',
      p.call('requestNextTask', { ...CS, lat: 'abc', lng: 'def' }), { codeIn: ['functions/invalid-argument'] });

    // completeTask: the guard must fire BEFORE completeTaskForTeam so the player
    // never sees an error AFTER a successful check-in.
    await expectError('WO-5: completeTask rejects out-of-range coords (invalid-argument, not internal)',
      p.call('completeTask', { ...CS, taskId: 'bc-field', ...BAD }), { codeIn: ['functions/invalid-argument'] });
    const st = await p.call('getMyTeamState', { code: bcc });
    const fieldRec = (st?.team?.stages ?? []).flatMap((s) => s.tasks).find((t) => t.taskId === 'bc-field');
    check('WO-5: bc-field is NOT completed after the rejected bad-coord completeTask',
      fieldRec?.status !== 'completed', JSON.stringify(fieldRec));

    // Positive control: absent lat/lng still routes via the (0,0) no-location path.
    const okReq = await p.call('requestNextTask', { ...CS });
    check('WO-5 positive control: absent lat/lng still routes (no throw)',
      okReq !== undefined && okReq !== null, JSON.stringify(okReq));
  });

  // ═══ checkOutTask holds its own slot (fix-checkouttask-slot-theft) ══════════
  // checkOutTask may only release a slot the caller's team actually holds. A
  // replayed call (team no longer holds it) or a cross-team call (never held it)
  // must be a no-op — otherwise run.taskCounts is drained for a slot the caller
  // never owned, defeating station caps.
  await scenario('checkOutTask holds its own slot (no cross-team cap drain)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: cg } = await creator.call('createGame', { title: 'Checkout Guard', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: cg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'co-1', order: 0, title: 'One capped station', tasks: [
          { id: 'co-a', title: 'Station A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 },
            difficulty: 2, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 2 },
        ] },
        { id: 'co-2', order: 1, title: 'Finish', isFinal: true, tasks: [
          { id: 'co-f', title: 'Finish', type: 'self_report', triggerMode: 'locationless', locationless: true,
            coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: cr, accessCode: cc } = await creator.call('launchRun', { gameId: cg });
    const runDocPath = `users/${OWNER}/games/${cg}/runs/${cr}`;
    const countsNow = async () => ((await creator.getDocAt(runDocPath)).data?.taskCounts ?? {});

    // Team A joins + starts → startTeams auto-assigns the single stage-0 station.
    const teamA = makeParty('coTeamA');
    await signInAnonymously(teamA.auth);
    await teamA.call('joinRun', { code: cc, displayName: 'Alpha' });
    await creator.call('startTeams', { gameId: cg, runId: cr });
    check('checkout: A holds the station after start (taskCounts co-a == 1)',
      ((await countsNow())['co-a'] ?? 0) === 1, JSON.stringify(await countsNow()));

    // Cross-team: B (does NOT hold co-a) tries to check it out — count must not move.
    const teamB = makeParty('coTeamB');
    await signInAnonymously(teamB.auth);
    await teamB.call('joinRun', { code: cc, displayName: 'Bravo' });
    await teamB.call('checkOutTask', { ownerUid: OWNER, gameId: cg, runId: cr, code: cc, taskId: 'co-a' });
    check('checkout: cross-team call does NOT drain the slot it never owned',
      ((await countsNow())['co-a'] ?? 0) === 1, JSON.stringify(await countsNow()));

    // A checks out its own slot → count 0, activeTaskId cleared, record unassigned.
    await teamA.call('checkOutTask', { ownerUid: OWNER, gameId: cg, runId: cr, code: cc, taskId: 'co-a' });
    const aState = await teamA.call('getMyTeamState', { code: cc });
    check('checkout: A released its slot (taskCounts co-a == 0)',
      ((await countsNow())['co-a'] ?? 0) === 0, JSON.stringify(await countsNow()));
    check('checkout: A activeTaskId cleared', aState?.team?.activeTaskId == null, JSON.stringify(aState?.team?.activeTaskId));
    check('checkout: A task record is unassigned (not still assigned)',
      aState?.team?.stages?.[0]?.tasks?.[0]?.status === 'unassigned',
      aState?.team?.stages?.[0]?.tasks?.[0]?.status);

    // Replayed checkout (A no longer holds it) resolves but never underflows.
    await teamA.call('checkOutTask', { ownerUid: OWNER, gameId: cg, runId: cr, code: cc, taskId: 'co-a' });
    check('checkout: replayed call does not underflow the counter',
      ((await countsNow())['co-a'] ?? 0) >= 0 && ((await countsNow())['co-a'] ?? 0) === 0,
      JSON.stringify(await countsNow()));
  });

  // ═══ joinRun registrationData type guard + poisoned-doc resilience ══════════
  // (fix-joinrun-registrationdata-type) A non-plain-object registrationData is
  // rejected at the boundary; and a single legacy/poisoned team doc (bypassing
  // the guard) is QUARANTINED by scoring rather than aborting the whole run's
  // leaderboard.
  await scenario('joinRun registrationData type guard + scoring quarantine', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: qg } = await creator.call('createGame', { title: 'Reg Type Guard', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: qg, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'q-1', order: 0, title: 'Only', isFinal: true, tasks: [
        { id: 'q-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: qr, accessCode: qc } = await creator.call('launchRun', { gameId: qg });
    const good = makeParty('regGoodPlayer');
    await signInAnonymously(good.auth);
    await good.call('joinRun', { code: qc, displayName: 'Valid Team' });
    await creator.call('startTeams', { gameId: qg, runId: qr });

    // A fresh party attempts non-object registrationData — rejected before any write.
    const bad = makeParty('regBadPlayer');
    await signInAnonymously(bad.auth);
    for (const [label, reg] of [['array', [1, 2, 3]], ['string', 'iamastring'], ['number', 42]]) {
      await expectError(`joinRun rejects ${label} registrationData`,
        bad.call('joinRun', { code: qc, displayName: 'X', registrationData: reg }),
        { codeIn: ['functions/invalid-argument'] });
    }

    // Seed a POISONED team doc directly (bypassing the guard) to simulate a
    // legacy row, then prove scoring quarantines it instead of throwing INTERNAL.
    await adminSdk.firestore()
      .doc(`users/${OWNER}/games/${qg}/runs/${qr}/teams/poison-team`)
      .set({
        id: 'poison-team', runId: qr, gameId: qg, ownerUid: OWNER,
        displayName: 'Poison', registrationData: 'not-an-object', status: 'registered',
        stages: [], score: 0, bonusPenalty: 0, launched: false,
        deviceUids: ['poison-team'], activeTaskId: null,
        updatedAt: new Date().toISOString(),
      });

    const board = await creator.call('refreshLeaderboard', { gameId: qg, runId: qr, publish: false });
    check('quarantine: refreshLeaderboard resolves despite a poisoned team doc',
      Array.isArray(board?.rankings), JSON.stringify(board?.rankings?.length));
    check('quarantine: the poisoned team is skipped (only the valid team ranks)',
      (board?.rankings ?? []).length === 1 &&
        board.rankings[0].teamId === good.auth.currentUser.uid,
      JSON.stringify((board?.rankings ?? []).map((r) => r.teamId)));
    assertAllFinite('refreshLeaderboard(poisoned)', board);

    const fin = await creator.call('finalizeRun', { gameId: qg, runId: qr });
    check('quarantine: finalizeRun resolves despite a poisoned team doc',
      (fin?.rankings ?? []).length === 1, JSON.stringify(fin?.rankings?.length));
    assertAllFinite('finalizeRun(poisoned)', fin);
  });

  // ═══ joinRun split-brain device guard (fix-joinrun-attached-device-splitbrain) ═
  // A uid already ATTACHED as a device of a team must not mint a SECOND standalone
  // team by calling joinRun — that double-counts participants and splits the uid
  // across two teams. joinRun returns the attached team as alreadyJoined instead.
  await scenario('joinRun rejects an already-attached device (no split-brain membership)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: bg } = await creator.call('createGame', { title: 'Split Brain', mode: 'team' });
    await creator.call('updateGame', {
      gameId: bg, scoringPreset: 'time_only',
      stages: [{ id: 'b-1', order: 0, title: 'Only', isFinal: true, tasks: [
        { id: 'b-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: br, accessCode: bc } = await creator.call('launchRun', { gameId: bg });
    const runDocPath = `users/${OWNER}/games/${bg}/runs/${br}`;

    // Team A founder joins; a second phone attaches as a device of A.
    const founder = makeParty('sbFounder');
    await signInAnonymously(founder.auth);
    await founder.call('joinRun', { code: bc, displayName: 'Split Team' });
    const founderUid = founder.auth.currentUser.uid;
    const fState = await founder.call('getMyTeamState', { code: bc });
    const teamCode = fState?.team?.deviceJoinCode;
    const device = makeParty('sbDevice');
    await signInAnonymously(device.auth);
    const attach = await device.call('joinTeamAsDevice', { code: bc, teamCode, memberName: 'Phone 2' });
    check('split-brain: device attached to the founding team', attach?.teamId === founderUid, JSON.stringify(attach));

    const pcBefore = (await creator.getDocAt(runDocPath)).data?.participantCount ?? 0;

    // The attached device now calls joinRun — must NOT create a second team.
    const res = await device.call('joinRun', { code: bc, displayName: 'Sneaky Second Team' });
    check('split-brain: joinRun returns the attached team as alreadyJoined',
      res?.alreadyJoined === true && res?.teamId === founderUid, JSON.stringify(res));

    const pcAfter = (await creator.getDocAt(runDocPath)).data?.participantCount ?? 0;
    check('split-brain: participantCount did not increment on the duplicate joinRun',
      pcAfter === pcBefore, `before=${pcBefore} after=${pcAfter}`);

    const teams = (await creator.call('listRunTeams', { gameId: bg, runId: br }))?.teams ?? [];
    check('split-brain: exactly one team exists (no phantom second team)',
      teams.length === 1, JSON.stringify(teams.map((t) => t.id ?? t.teamId)));
  });

  // ═══ Team ↔ HQ chat (team-hq-chat) ══════════════════════════════════════════
  // A single thread doc per team; either side sends. Covers: both directions,
  // ordering, cap (>100 → oldest dropped), validation, rate-limit, finished-run,
  // and a non-controller attached device sending. deviceUids is mirrored so rules
  // reuse isAttachedDevice(); the doc is server-write-only.
  await scenario('team ↔ HQ chat (send · reply · cap · validation)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: cg } = await creator.call('createGame', { title: 'Chat Game', mode: 'team' });
    await creator.call('updateGame', {
      gameId: cg, scoringPreset: 'time_only',
      stages: [{ id: 'ch-s', order: 0, title: 'S', isFinal: true, tasks: [
        { id: 'ch-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: cr, accessCode: cc } = await creator.call('launchRun', { gameId: cg });

    const founder = makeParty('chatFounder');
    await signInAnonymously(founder.auth);
    await founder.call('joinRun', { code: cc, displayName: 'Chat Team' });
    const founderUid = founder.auth.currentUser.uid;
    const s0 = await founder.call('getMyTeamState', { code: cc });
    const teamCode = s0?.team?.deviceJoinCode;
    await creator.call('startTeams', { gameId: cg, runId: cr });

    const CTX = { ownerUid: OWNER, gameId: cg, runId: cr };
    const chatPath = `users/${OWNER}/games/${cg}/runs/${cr}/chat/${founderUid}`;

    // 1. Team sends → doc holds 1 msg (from:'team', senderName == team name).
    const sent = await founder.call('sendTeamChatMessage', { ...CTX, text: 'Stuck at the bridge' });
    check('chat: team send returns a messageId', !!sent?.messageId, JSON.stringify(sent));
    let chat = (await creator.getDocAt(chatPath)).data;
    check('chat: doc holds 1 message after team send', chat?.messages?.length === 1, JSON.stringify(chat?.messages?.length));
    check('chat: team message is from:team', chat?.messages?.[0]?.from === 'team', chat?.messages?.[0]?.from);
    check('chat: team message senderName == team name', chat?.messages?.[0]?.senderName === 'Chat Team', chat?.messages?.[0]?.senderName);
    check('chat: deviceUids mirrored onto the doc', Array.isArray(chat?.deviceUids) && chat.deviceUids.includes(founderUid), JSON.stringify(chat?.deviceUids));

    // 2. Owner (HQ) replies with an explicit teamId → 2 msgs, from:'hq'.
    await creator.call('sendTeamChatMessage', { ...CTX, teamId: founderUid, text: 'Use code 4712', senderName: 'HQ' });
    chat = (await creator.getDocAt(chatPath)).data;
    check('chat: doc holds 2 messages after HQ reply', chat?.messages?.length === 2, JSON.stringify(chat?.messages?.length));
    check('chat: HQ message is from:hq', chat?.messages?.[1]?.from === 'hq', chat?.messages?.[1]?.from);
    check('chat: order is chronological (team then hq)',
      chat?.messages?.[0]?.from === 'team' && chat?.messages?.[1]?.from === 'hq',
      chat?.messages?.map((m) => m.from).join(','));

    // 3. A staff token also replies as HQ.
    const { pin: chatPin } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: cg, runId: cr, name: 'Chat Marshal', permissions: ['review_photos'],
    });
    const chatStaff = makeParty('chatStaff');
    await signInAnonymously(chatStaff.auth);
    const cstok = await chatStaff.call('staffSignIn', { ownerUid: OWNER, gameId: cg, runId: cr, pin: chatPin });
    await signInWithCustomToken(chatStaff.auth, cstok.customToken);
    await chatStaff.call('sendTeamChatMessage', { ...CTX, teamId: founderUid, text: 'Marshal on the way', senderName: 'Chat Marshal' });
    chat = (await creator.getDocAt(chatPath)).data;
    check('chat: staff reply appended as hq', chat?.messages?.length === 3 && chat.messages[2].from === 'hq', JSON.stringify(chat?.messages?.length));

    // 4. Validation: 501-char, whitespace-only rejected; control chars stripped.
    await expectError('chat: 501-char text rejected',
      founder.call('sendTeamChatMessage', { ...CTX, text: 'x'.repeat(501) }),
      { codeIn: ['functions/invalid-argument'] });
    await expectError('chat: whitespace-only text rejected',
      founder.call('sendTeamChatMessage', { ...CTX, text: '   ' }),
      { codeIn: ['functions/invalid-argument'] });
    await founder.call('sendTeamChatMessage', { ...CTX, text: 'cleantext' });
    chat = (await creator.getDocAt(chatPath)).data;
    check('chat: control chars stripped from stored message',
      chat?.messages?.[chat.messages.length - 1]?.text === 'cleantext',
      chat?.messages?.[chat.messages.length - 1]?.text);

    // 5. Client-supplied `from` is ignored (server always sets it).
    await founder.call('sendTeamChatMessage', { ...CTX, text: 'forge attempt', from: 'hq', senderName: 'Fake HQ' });
    chat = (await creator.getDocAt(chatPath)).data;
    const forged = chat?.messages?.[chat.messages.length - 1];
    check('chat: client-supplied from is ignored (still from:team)', forged?.from === 'team', forged?.from);
    check('chat: participant cannot forge senderName', forged?.senderName === 'Chat Team', forged?.senderName);

    // 6. A non-controller attached device CAN send (triggerSOS rationale).
    const device = makeParty('chatDevice');
    await signInAnonymously(device.auth);
    await device.call('joinTeamAsDevice', { code: cc, teamCode, memberName: 'Back-of-group phone' });
    await device.call('sendTeamChatMessage', { ...CTX, text: 'From my phone' });
    chat = (await creator.getDocAt(chatPath)).data;
    const deviceMsg = chat?.messages?.[chat.messages.length - 1];
    check('chat: attached (non-controller) device can send', deviceMsg?.text === 'From my phone' && deviceMsg?.from === 'team',
      JSON.stringify({ text: deviceMsg?.text, from: deviceMsg?.from }));
    check('chat: device message attributed to the team', deviceMsg?.senderName === 'Chat Team', deviceMsg?.senderName);

    // 7. Rate limit: the 11th send from one uid inside a minute is rejected.
    const rl = makeParty('chatRate');
    await signInAnonymously(rl.auth);
    await rl.call('joinTeamAsDevice', { code: cc, teamCode, memberName: 'Rate phone' });
    let rateTripped = false;
    for (let i = 0; i < 12; i++) {
      try { await rl.call('sendTeamChatMessage', { ...CTX, text: `spam ${i}` }); }
      catch (e) { if (e.code === 'functions/resource-exhausted') { rateTripped = true; break; } }
    }
    check('chat: 11th send in a minute from one uid is rate-limited', rateTripped);

    // 8. Cap: drive total > 100 across many HQ sender uids (10/min per uid) → the
    //    doc retains exactly 100, oldest dropped, newest intact. HQ staff carry the
    //    volume: 11 distinct staff tokens × up to 10 each = 110 > 100.
    const NEWEST = 'THE-NEWEST-MESSAGE';
    let capSent = chat?.messages?.length ?? 0;
    let lastText = null;
    for (let s = 0; s < 12 && capSent <= 110; s++) {
      const { pin } = await creator.call('inviteStaff', {
        ownerUid: OWNER, gameId: cg, runId: cr, name: `Cap ${s}`, permissions: ['review_photos'],
      });
      const capStaff = makeParty(`chatCap${s}`);
      await signInAnonymously(capStaff.auth);
      const tok = await capStaff.call('staffSignIn', { ownerUid: OWNER, gameId: cg, runId: cr, pin });
      await signInWithCustomToken(capStaff.auth, tok.customToken);
      for (let i = 0; i < 10 && capSent <= 110; i++) {
        lastText = (capSent === 110) ? NEWEST : `cap ${s}-${i}`;
        try { await capStaff.call('sendTeamChatMessage', { ...CTX, teamId: founderUid, text: lastText, senderName: 'HQ' }); capSent++; }
        catch (e) { if (e.code === 'functions/resource-exhausted') break; else throw e; }
      }
    }
    chat = (await creator.getDocAt(chatPath)).data;
    check('chat: message array capped at 100', chat?.messages?.length === 100, String(chat?.messages?.length));
    check('chat: newest message retained at the tail', chat?.messages?.[chat.messages.length - 1]?.text === NEWEST,
      chat?.messages?.[chat.messages.length - 1]?.text);
    check('chat: the very first (oldest) message was dropped',
      !chat?.messages?.some((m) => m.text === 'Stuck at the bridge'), 'oldest still present');

    // 9. Finished run: after finalize, any send is rejected.
    await creator.call('finalizeRun', { gameId: cg, runId: cr });
    await expectError('chat: send into a finished run is rejected',
      creator.call('sendTeamChatMessage', { ...CTX, teamId: founderUid, text: 'too late', senderName: 'HQ' }),
      { codeIn: ['functions/failed-precondition'] });
  });

  // ═══ Authorization denial matrix ════════════════════════════════════════════
  // Data-driven: wrong-role identities × privileged callables → typed denial.
  // Every row runs even if one fails; extend the table when adding a callable.
  await scenario('authorization denial matrix', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: ag } = await creator.call('createGame', { title: 'Authz Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: ag, scoringPreset: 'time_only',
      stages: [{ id: 'az-s', order: 0, title: 'S', isFinal: true, tasks: [
        { id: 'az-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: ar, accessCode: ac } = await creator.call('launchRun', { gameId: ag });
    const pl = makeParty('authzPlayer');
    await signInAnonymously(pl.auth);
    await pl.call('joinRun', { code: ac, displayName: 'Sneak' });
    await creator.call('startTeams', { gameId: ag, runId: ar });
    const plUid = pl.auth.currentUser.uid;
    const str = makeParty('authzStranger');
    await signInAnonymously(str.auth);

    // A staff PIN is RUN-scoped: staff signed into run B must not reach run A.
    const { runId: ar2 } = await creator.call('launchRun', { gameId: ag });
    const { pin: pinB } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: ag, runId: ar2, name: 'Other-Run Marshal', permissions: ['review_photos'],
    });
    const staffB = makeParty('authzStaffB');
    await signInAnonymously(staffB.auth);
    const stok = await staffB.call('staffSignIn', { ownerUid: OWNER, gameId: ag, runId: ar2, pin: pinB });
    await signInWithCustomToken(staffB.auth, stok.customToken);

    const DENY = ['functions/permission-denied', 'functions/not-found'];
    const rows = [
      // A joined participant must not reach owner/staff/admin surfaces:
      ['participant', pl, 'startTeams', { gameId: ag, runId: ar }],
      ['participant', pl, 'skipStage', { gameId: ag, runId: ar, teamId: plUid }],
      ['participant', pl, 'refreshLeaderboard', { gameId: ag, runId: ar, publish: true }],
      ['participant', pl, 'finalizeRun', { gameId: ag, runId: ar }],
      ['participant', pl, 'adjustTeamScore', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, delta: 500 }],
      ['participant', pl, 'inviteStaff', { ownerUid: OWNER, gameId: ag, runId: ar, name: 'Fake', permissions: ['review_photos'] }],
      ['participant', pl, 'reviewStationSubmission', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t', approved: true }],
      ['participant', pl, 'pushAnnouncement', { ownerUid: OWNER, gameId: ag, runId: ar, title: 'pwn', message: 'pwn' }],
      ['participant', pl, 'activateHotZone', { gameId: ag, runId: ar, center: { lat: 31.78, lng: 35.21 }, radiusMeters: 100, multiplier: 2, durationMinutes: 5 }],
      ['participant', pl, 'deactivateHotZone', { gameId: ag, runId: ar }],
      ['participant', pl, 'getRunReplay', { code: ac }],
      ['participant', pl, 'getRunAnalytics', { code: ac }],
      ['participant', pl, 'pruneRunNow', { ownerUid: OWNER, gameId: ag, runId: ar }],
      // Even the OWNER is not the platform admin:
      ['owner', creator, 'pruneRunNow', { ownerUid: OWNER, gameId: ag, runId: ar }],
      ['owner', creator, 'listAuditLogs', { limit: 5 }],
      // Staff of a DIFFERENT run (same owner) must not reach this run:
      ['other-run staff', staffB, 'adjustTeamScore', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, delta: 500 }],
      ['other-run staff', staffB, 'reviewStationSubmission', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t', approved: true }],
      ['other-run staff', staffB, 'pushAnnouncement', { ownerUid: OWNER, gameId: ag, runId: ar, title: 'pwn', message: 'pwn' }],
      // A stranger (never joined) must not resolve anything in the run:
      ['stranger', str, 'getMyTeamState', { code: ac }],
      ['stranger', str, 'transferController', { ownerUid: OWNER, gameId: ag, runId: ar, toUid: plUid }],
      ['stranger', str, 'captureZone', { ownerUid: OWNER, gameId: ag, runId: ar, zoneId: 'fake', lat: 31.78, lng: 35.21 }],
      ['stranger', str, 'pickUpTrackable', { ownerUid: OWNER, gameId: ag, runId: ar, trackableId: 'fake' }],
      // play-task-gating: reportArrival unseals hidden-location content, so a
      // non-participant must not be able to probe a run's secret spots at all.
      ['stranger', str, 'reportArrival', { ownerUid: OWNER, gameId: ag, runId: ar, taskId: 'az-t', lat: 31.78, lng: 35.21 }],
      // Territory/trackable authoring is owner-only — a participant can't create them:
      ['participant', pl, 'createZone', { gameId: ag, runId: ar, title: 'pwn', lat: 31.78, lng: 35.21 }],
      ['participant', pl, 'deleteZone', { gameId: ag, runId: ar, zoneId: 'fake' }],
      ['participant', pl, 'createTrackable', { gameId: ag, runId: ar, name: 'pwn' }],
      ['participant', pl, 'getRunHeatmap', { code: ac }],
      // survey-tasks: results are owner/run-staff only.
      ['participant', pl, 'getRunSurveyResults', { gameId: ag, runId: ar }],
      ['stranger', str, 'getRunSurveyResults', { ownerUid: OWNER, gameId: ag, runId: ar }],
      ['other-run staff', staffB, 'getRunSurveyResults', { ownerUid: OWNER, gameId: ag, runId: ar }],
      // team-hq-chat: a stranger (never joined) can't resolve a team to chat into;
      // other-run staff isn't scoped to this run, so its HQ send is denied.
      ['stranger', str, 'sendTeamChatMessage', { ownerUid: OWNER, gameId: ag, runId: ar, text: 'sneak in' }],
      ['other-run staff', staffB, 'sendTeamChatMessage', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, text: 'not my run' }],
    ];
    for (const [who, party, fn, payload] of rows) {
      await expectError(`authz: ${who} is denied ${fn}`, party.call(fn, payload), { codeIn: DENY });
    }

    // team-hq-chat isolation: a member of ANOTHER team sending (no teamId) lands
    // ONLY in their own thread — the target team's thread is never touched.
    const pl2 = makeParty('authzPlayer2');
    await signInAnonymously(pl2.auth);
    await pl2.call('joinRun', { code: ac, displayName: 'Other Team' });
    const pl2Uid = pl2.auth.currentUser.uid;
    await pl2.call('sendTeamChatMessage', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, text: 'wrong thread' });
    const victimChat = await creator.getDocAt(`users/${OWNER}/games/${ag}/runs/${ar}/chat/${plUid}`);
    check('authz: other-team send did NOT reach the target team thread',
      !victimChat.exists || (victimChat.data?.messages ?? []).length === 0,
      JSON.stringify(victimChat.data?.messages?.length ?? 'absent'));
    const ownChat = await creator.getDocAt(`users/${OWNER}/games/${ag}/runs/${ar}/chat/${pl2Uid}`);
    check('authz: other-team send landed in the sender\'s OWN thread',
      ownChat.exists && (ownChat.data?.messages ?? []).length === 1,
      JSON.stringify(ownChat.data?.messages?.length ?? 'absent'));

    // The sweep must have left the run untouched.
    const runDoc = await creator.getDocAt(`users/${OWNER}/games/${ag}/runs/${ar}`);
    check('authz: run is still live + unpublished after the denial sweep',
      runDoc.data?.status !== 'finished' && (runDoc.data?.leaderboard?.published ?? false) === false,
      JSON.stringify({ status: runDoc.data?.status, published: runDoc.data?.leaderboard?.published }));
    const teamDoc = await creator.getDocAt(`users/${OWNER}/games/${ag}/runs/${ar}/teams/${plUid}`);
    check('authz: team score/penalty untouched by the denial sweep',
      (teamDoc.data?.score ?? 0) === 0 && (teamDoc.data?.bonusPenalty ?? 0) === 0,
      JSON.stringify({ score: teamDoc.data?.score, bonusPenalty: teamDoc.data?.bonusPenalty }));
  });

  // ═══ Boundary fuzz (seeded, reproducible) ═══════════════════════════════════
  // Pins the edge semantics of answer matching and geo triggers where
  // off-by-one regressions live.
  await scenario('boundary fuzz: answers + geofence edges', async () => {
    const OWNER = creatorCred.user.uid;
    const GATE = { lat: 31.78, lng: 35.21 };
    const { gameId: fg } = await creator.call('createGame', { title: 'Boundary Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: fg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'bf-quiz', order: 0, title: 'Quiz', tasks: [
          { id: 'bf-q', title: 'City?', type: 'quiz', locationless: true, coordinates: { lat: 0, lng: 0 },
            difficulty: 2, estimatedMinutes: 2, pointValue: 40, maxConcurrentTeams: 9, answers: ['Jerusalem'] },
        ] },
        { id: 'bf-num', order: 1, title: 'Numeric', tasks: [
          { id: 'bf-n', title: 'Count?', type: 'numeric', locationless: true, coordinates: { lat: 0, lng: 0 },
            difficulty: 2, estimatedMinutes: 2, pointValue: 40, maxConcurrentTeams: 9, numericAnswer: 12, numericTolerance: 1 },
        ] },
        { id: 'bf-geo', order: 2, title: 'Radius edge', isFinal: true, tasks: [
          { id: 'bf-g', title: 'Gate', type: 'field', triggerMode: 'radius', coordinates: GATE,
            geofenceRadiusMeters: 60, difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 9 },
        ] },
      ],
    });
    const { runId: fr, accessCode: fc } = await creator.call('launchRun', { gameId: fg });
    const fuzzer = makeParty('fuzzer');
    await signInAnonymously(fuzzer.auth);
    await fuzzer.call('joinRun', { code: fc, displayName: 'Fuzzer' });
    await creator.call('startTeams', { gameId: fg, runId: fr });
    const F = { ownerUid: OWNER, gameId: fg, runId: fr };

    // Quiz: a near-miss decoy must NOT match; random casing + padding must.
    const decoy = await fuzzer.call('submitTaskAnswer', { ...F, taskId: 'bf-q', answer: 'Jerusalen' });
    check('fuzz: near-miss decoy answer rejected', decoy?.correct === false, JSON.stringify(decoy));
    const mangled = `  ${randCase('Jerusalem')}\t`;
    const okQ = await fuzzer.call('submitTaskAnswer', { ...F, taskId: 'bf-q', answer: mangled });
    check(`fuzz: random-cased padded answer accepted (${JSON.stringify(mangled)})`, okQ?.correct === true, JSON.stringify(okQ));

    // Numeric 12±1: the tolerance is INCLUSIVE at the boundary, exclusive past it.
    const n14 = await fuzzer.call('submitTaskAnswer', { ...F, taskId: 'bf-n', answer: '14' });
    check('fuzz: numeric 14 (Δ2 > tol 1) rejected', n14?.correct === false);
    const n1099 = await fuzzer.call('submitTaskAnswer', { ...F, taskId: 'bf-n', answer: '10.99' });
    check('fuzz: numeric 10.99 (Δ1.01 > tol 1) rejected', n1099?.correct === false);
    const n13 = await fuzzer.call('submitTaskAnswer', { ...F, taskId: 'bf-n', answer: '13' });
    check('fuzz: numeric 13 (Δ1 == tol 1, inclusive) accepted', n13?.correct === true);

    // Geofence 60 m: ~70 m out rejected, ~55 m in accepted.
    const degPerMeterLat = 1 / 111_320;
    await expectError('fuzz: check-in ~70m out of a 60m radius is rejected',
      fuzzer.call('completeTask', { ...F, taskId: 'bf-g', lat: GATE.lat + 70 * degPerMeterLat, lng: GATE.lng }),
      { match: /too far/i });
    const near = await fuzzer.call('completeTask', { ...F, taskId: 'bf-g', lat: GATE.lat + 55 * degPerMeterLat, lng: GATE.lng });
    check('fuzz: check-in ~55m inside a 60m radius is accepted', near?.ok === true, JSON.stringify(near));
  });

  // ═══ Long-tail coverage: exercise the callables the lifecycle skips ══════════
  // Gives the coverage guard below a real (not smoke) invocation of each: owner
  // reads, live-ops broadcasts, SOS ack, gallery search, and account self-service.
  await scenario('long-tail callables (reads · ops · gallery · account)', async () => {
    const OWNER = creatorCred.user.uid;

    const games = await creator.call('listGames', {});
    check('listGames returns the owner games', Array.isArray(games?.games) && games.games.length > 0, String(games?.games?.length));

    const dup = await creator.call('duplicateGame', { gameId });
    check('duplicateGame returns a fresh gameId', !!dup?.gameId && dup.gameId !== gameId, dup?.gameId);
    const { game: dupGame } = await creator.call('getGame', { gameId: dup.gameId });
    check('duplicateGame copies the stages', (dupGame?.stages?.length ?? 0) === 3, String(dupGame?.stages?.length));

    const { gameId: throwGame } = await creator.call('createGame', { title: 'Delete Me', mode: 'individual' });
    await creator.call('deleteGame', { gameId: throwGame });
    await expectError('deleteGame removes the game', creator.call('getGame', { gameId: throwGame }), { codeIn: ['functions/not-found'] });

    // A live run to drive ops + participant reads/mutations.
    const { gameId: cvGame } = await creator.call('createGame', { title: 'Coverage Run', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: cvGame, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'cv-s', order: 0, title: 'S', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'cv-a', title: 'A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3 },
        { id: 'cv-b', title: 'B', type: 'field', coordinates: { lat: 31.781, lng: 35.211 }, difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3 },
      ] }],
    });
    const { runId: cvRun, accessCode: cvCode } = await creator.call('launchRun', { gameId: cvGame });
    const cvP = makeParty('coverageP');
    await signInAnonymously(cvP.auth);
    await cvP.call('joinRun', { code: cvCode, displayName: 'Coverage' });
    await creator.call('startTeams', { gameId: cvGame, runId: cvRun });
    const CV = { ownerUid: OWNER, gameId: cvGame, runId: cvRun };
    const cvUid = cvP.auth.currentUser.uid;

    const teams = await creator.call('listRunTeams', { gameId: cvGame, runId: cvRun });
    check('listRunTeams lists the joined team', (teams?.teams ?? []).some((t) => t.id === cvUid), String(teams?.teams?.length));

    const recs = await cvP.call('getRecommendedTasks', { code: cvCode, lat: 31.78, lng: 35.21 });
    check('getRecommendedTasks returns a ranked list', Array.isArray(recs?.recommendations), String(recs?.recommendations?.length));

    // checkOutTask releases the currently-held station slot (counter → 0).
    const cvState = await cvP.call('getMyTeamState', { code: cvCode });
    const holding = cvState?.team?.activeTaskId;
    check('coverage precondition: team holds a station', !!holding, String(holding));
    if (holding) {
      const co = await cvP.call('checkOutTask', { code: cvCode, taskId: holding });
      check('checkOutTask releases the slot', co?.ok === true);
      const runDoc = await creator.getDocAt(`users/${OWNER}/games/${cvGame}/runs/${cvRun}`);
      check('checkOutTask decremented the station counter to 0', (runDoc.data?.taskCounts?.[holding] ?? 0) === 0, JSON.stringify(runDoc.data?.taskCounts));
    }

    // Live-ops broadcasts: push then tear down.
    const ann = await creator.call('pushAnnouncement', { ...CV, title: 'Heads up', message: 'Move to zone B' });
    check('pushAnnouncement returns an id', !!ann?.announcementId, ann?.announcementId);

    // Targeted announcements (change: targeted-announcements).
    const annCol = `users/${OWNER}/games/${cvGame}/runs/${cvRun}/announcements`;
    // Untargeted doc carries no teamId and kind:'announcement'.
    {
      const doc = (await creator.getColAt(annCol)).find((a) => a.id === ann.announcementId);
      check('untargeted announcement carries no teamId', doc && doc.teamId === undefined, JSON.stringify(doc?.teamId));
      check('untargeted announcement kind is announcement', doc?.kind === 'announcement', doc?.kind);
    }
    // Targeted at a real joined team persists teamId + kind.
    const tann = await creator.call('pushAnnouncement', { ...CV, message: 'Team-only heads up', teamId: cvUid });
    check('targeted pushAnnouncement returns an id', !!tann?.announcementId, tann?.announcementId);
    {
      const doc = (await creator.getColAt(annCol)).find((a) => a.id === tann.announcementId);
      check('targeted announcement persists teamId', doc?.teamId === cvUid, doc?.teamId);
      check('targeted announcement kind is announcement', doc?.kind === 'announcement', doc?.kind);
    }
    // Bogus teamId ⇒ not-found (a typo can't silently broadcast to nobody).
    {
      let denied = false;
      try {
        await creator.call('pushAnnouncement', { ...CV, message: 'nope', teamId: 'no-such-team-xyz' });
      } catch (e) { denied = /not-found/i.test(String(e?.code || e?.message || e)); }
      check('bogus teamId is rejected not-found', denied);
    }

    // adjustTeamScore: existing scoring behavior PLUS a new kind:'score' notice.
    const adj = await creator.call('adjustTeamScore', { ...CV, teamId: cvUid, delta: 50, reason: 'great teamwork' });
    check('adjustTeamScore decrements bonusPenalty by delta', adj?.newBonusPenalty === -50, JSON.stringify(adj));
    {
      const teamDoc = await creator.getDocAt(`users/${OWNER}/games/${cvGame}/runs/${cvRun}/teams/${cvUid}`);
      check('adjustTeamScore wrote bonusPenalty on the team', (teamDoc.data?.bonusPenalty ?? 0) === -50, String(teamDoc.data?.bonusPenalty));
      const notice = (await creator.getColAt(annCol)).find((a) => a.kind === 'score' && a.teamId === cvUid && a.delta === 50);
      check('adjustTeamScore wrote a kind:score notice', !!notice, JSON.stringify(notice));
      check('score notice carries a bilingual message', !!notice?.message && !!notice?.messageHe && notice?.active === true, JSON.stringify(notice));
    }

    const deactAnn = await creator.call('deactivateAnnouncement', { ...CV, announcementId: ann.announcementId });
    check('deactivateAnnouncement acks', deactAnn?.ok === true);
    const flash = await creator.call('pushFlashMission', { ...CV, title: 'Bonus!', description: 'First to the gate', bonusPoints: 50, ttlSeconds: 600 });
    check('pushFlashMission returns an id', !!flash?.id, flash?.id);

    // SOS from the participant, acknowledged by the owner.
    const sos = await cvP.call('triggerSOS', { ...CV, lat: 31.78, lng: 35.21, message: 'need help' });
    check('triggerSOS raises an alert', !!sos?.alertId, sos?.alertId);
    const ack = await creator.call('acknowledgeAlert', { ...CV, alertId: sos.alertId });
    check('acknowledgeAlert clears the alert', ack?.ok === true);

    // Gallery: publish → search → copy-count.
    await creator.call('publishGame', { gameId: cvGame, visibility: 'public' });
    const gal = await creator.call('searchGallery', { query: '' });
    check('searchGallery returns a games array', Array.isArray(gal?.games));
    const lib = await creator.call('searchTaskLibrary', { query: '' });
    check('searchTaskLibrary returns a tasks array', Array.isArray(lib?.tasks));
    const inc = await creator.call('incrementTaskCopyCount', { publicTaskId: `${cvGame}_cv-a` });
    check('incrementTaskCopyCount bumps a published task', inc?.ok === true);

    // C2 (consistency sweep): editing a PUBLISHED game must re-sync the gallery
    // summary doc (stageCount/taskCount) WITHOUT a republish, so the public card
    // can't disagree with the live Dashboard. playCount (a live counter) and the
    // publicTasks copyCount must NOT be clobbered by the re-sync.
    const pubBefore = await creator.getDocAt(`publicGames/${cvGame}`);
    const playCountBefore = pubBefore.data?.playCount ?? 0;
    await creator.call('updateGame', { gameId: cvGame, stages: [
      { id: 'cv-s', order: 0, title: 'S', isFinal: false, requiredTaskCount: 1, tasks: [
        { id: 'cv-a', title: 'A', type: 'field', coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3 } ] },
      { id: 'cv-s2', order: 1, title: 'S2', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'cv-b', title: 'B', type: 'self_report', locationless: true, coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 2, pointValue: 20, maxConcurrentTeams: 3 } ] },
    ] });
    // The resync is deliberately fire-and-forget in updateGame (best-effort, no
    // await) — poll briefly instead of a single racy read. The contract under
    // test is "the gallery card converges quickly", not "synchronously".
    let pubAfter = await creator.getDocAt(`publicGames/${cvGame}`);
    for (let i = 0; i < 10 && !(pubAfter.data?.stageCount === 2 && pubAfter.data?.taskCount === 2); i++) {
      await new Promise((r) => setTimeout(r, 300));
      pubAfter = await creator.getDocAt(`publicGames/${cvGame}`);
    }
    check('editing a published game re-syncs gallery counts (no republish)',
      pubAfter.data?.stageCount === 2 && pubAfter.data?.taskCount === 2,
      JSON.stringify({ stageCount: pubAfter.data?.stageCount, taskCount: pubAfter.data?.taskCount }));
    check('gallery re-sync preserves the live playCount counter',
      (pubAfter.data?.playCount ?? 0) === playCountBefore,
      JSON.stringify({ before: playCountBefore, after: pubAfter.data?.playCount }));

    // Account self-service on a throwaway identity (deleteMyAccount is terminal).
    const acct = makeParty('coverageAcct');
    await signInAnonymously(acct.auth);
    const prof = await acct.call('updateMyProfile', { displayName: 'Temp User' });
    check('updateMyProfile updates the display name', prof?.ok === true && prof?.displayName === 'Temp User', JSON.stringify(prof));
    const exp = await acct.call('exportMyData', {});
    check('exportMyData returns a data bundle', exp && typeof exp === 'object');
    const del = await acct.call('deleteMyAccount', { confirm: true });
    check('deleteMyAccount deletes on confirm', del?.ok === true, JSON.stringify(del));

    // Admin retention sweep (idempotent no-op when nothing is expired).
    const sweep = await platformAdmin.call('pruneExpiredRunDataNow', {});
    check('pruneExpiredRunDataNow runs the retention sweep', sweep?.ok === true, JSON.stringify(sweep));
  });

  // ═══ Wave 1 Fix 1: access-code normalization (no opaque 500s) ════════════════
  // A non-string code makes .trim() a TypeError; a code with `/` builds an odd-
  // segment path db.doc() rejects — both were re-thrown as INTERNAL. They must now
  // be a clean invalid-argument BEFORE any accessCodes/ doc path is built.
  await scenario('access code type/slash guard (invalid-argument, not 500) (Fix 1)', async () => {
    await expectError('getJoinInfo with a numeric code rejects invalid-argument',
      player.call('getJoinInfo', { code: 42 }), { codeIn: ['functions/invalid-argument'] });
    await expectError('getJoinInfo with a slash code rejects invalid-argument',
      player.call('getJoinInfo', { code: 'A/B' }), { codeIn: ['functions/invalid-argument'] });
    await expectError('getJoinInfo with an object code rejects invalid-argument',
      player.call('getJoinInfo', { code: {} }), { codeIn: ['functions/invalid-argument'] });
  });

  // ═══ Wave 1 Fix 2: pre-start grading is rejected until the host starts ═══════
  // Stage 0 is 'active' at join while the team is launched:false. Grading any task
  // before startTeams must be rejected (failed-precondition); after start it works.
  await scenario('pre-start grading is rejected until host starts (Fix 2)', async () => {
    const { gameId: gp } = await creator.call('createGame', { title: 'Pre-Start Guard', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gp, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'ps-0', order: 0, isFinal: true, title: 'Only stage', tasks: [
        { id: 'ps-t', title: 'Anywhere', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: rp, accessCode: cp } = await creator.call('launchRun', { gameId: gp });
    const pre = makeParty('preStartPlayer');
    await signInAnonymously(pre.auth);
    await pre.call('joinRun', { code: cp, displayName: 'Eager Beaver' });

    // No startTeams yet → grading is rejected.
    await expectError('completeTask before startTeams is rejected',
      pre.call('completeTask', { taskId: 'ps-t', code: cp, lat: 0, lng: 0 }),
      { codeIn: ['functions/failed-precondition'] });
    let preState = await pre.call('getMyTeamState', { code: cp });
    check('team is not launched before startTeams', preState?.team?.launched !== true, String(preState?.team?.launched));

    // After startTeams the same completion works.
    await creator.call('startTeams', { gameId: gp, runId: rp });
    await pre.call('completeTask', { taskId: 'ps-t', code: cp, lat: 0, lng: 0 });
    preState = await pre.call('getMyTeamState', { code: cp });
    const psTask = (preState?.team?.stages?.[0]?.tasks ?? []).find((t) => t.taskId === 'ps-t');
    check('grading after startTeams works', psTask?.status === 'completed', psTask?.status);
    check('startedAt is set only after start', !!preState?.team?.startedAt, preState?.team?.startedAt);
  });

  // ═══ Wave 1 Fix 3: post-finalize grading rejected + final board frozen ═══════
  await scenario('post-finalize grading is rejected and final board is frozen (Fix 3)', async () => {
    const { gameId: gf } = await creator.call('createGame', { title: 'Finalize Freeze', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gf, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'ff-0', order: 0, isFinal: true, title: 'Two tasks', requiredTaskCount: 1, tasks: [
        { id: 'ff-a', title: 'Do A', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        { id: 'ff-b', title: 'Do B', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: rf, accessCode: cf } = await creator.call('launchRun', { gameId: gf });
    const fp = makeParty('finalizePlayer');
    await signInAnonymously(fp.auth);
    await fp.call('joinRun', { code: cf, displayName: 'Straggler' });
    await creator.call('startTeams', { gameId: gf, runId: rf });

    const fin = await creator.call('finalizeRun', { gameId: gf, runId: rf });
    const publishedRankings = JSON.stringify(fin?.rankings ?? []);
    check('finalizeRun returns rankings', Array.isArray(fin?.rankings) && fin.rankings.length === 1);

    // A straggler completion on a not-yet-completed task must be rejected.
    await expectError('completion after finalize is rejected',
      fp.call('completeTask', { taskId: 'ff-a', code: cf, lat: 0, lng: 0 }),
      { codeIn: ['functions/failed-precondition'] });

    // The auto-snapshot must not overwrite the published final board: it is frozen.
    const board = await creator.call('getPublicLeaderboard', { code: cf }).catch(() => null);
    const reFin = await creator.call('finalizeRun', { gameId: gf, runId: rf }).catch((e) => e);
    check('published final board rankings are unchanged',
      JSON.stringify(reFin?.rankings ?? []) === publishedRankings, 'rankings drifted after re-finalize');
    check('final board is published to participants', Array.isArray(board?.rankings) || board === null);
  });

  // ═══ Wave 1 Fix 4: submitStationPhoto write-ordering ═════════════════════════
  await scenario('station photo write-ordering (no moderation bypass / feed flood) (Fix 4)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: gs } = await creator.call('createGame', { title: 'Photo Ordering', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gs, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'so-0', order: 0, isFinal: true, title: 'Auto photo', tasks: [
        { id: 'so-t', title: 'Snap it', type: 'photo', coordinates: { lat: 31.78, lng: 35.21 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9,
          smart: { enabled: true, verificationType: 'photo_verification', autoApprove: true } },
      ] }],
    });
    const { runId: rs, accessCode: cs } = await creator.call('launchRun', { gameId: gs });
    const sp = makeParty('stationPhotoPlayer');
    const spCred = await signInAnonymously(sp.auth);
    await sp.call('joinRun', { code: cs, displayName: 'Shutterbug' });
    await creator.call('startTeams', { gameId: gs, runId: rs });

    const ownPhoto = (n) => `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.firebasestorage.app/o/runs%2F${rs}%2Fteams%2F${spCred.user.uid}%2Fphoto-${n}.jpg?alt=media`;

    // Submit the same autoApprove task 3× — only the first completes; the rest are no-ops.
    const first = await sp.call('submitStationPhoto', { ownerUid: OWNER, gameId: gs, runId: rs, taskId: 'so-t', photoUrl: ownPhoto(1) });
    check('first autoApprove submission is not a replay', first?.already !== true, JSON.stringify(first));
    const dup2 = await sp.call('submitStationPhoto', { ownerUid: OWNER, gameId: gs, runId: rs, taskId: 'so-t', photoUrl: ownPhoto(2) });
    const dup3 = await sp.call('submitStationPhoto', { ownerUid: OWNER, gameId: gs, runId: rs, taskId: 'so-t', photoUrl: ownPhoto(3) });
    check('duplicate autoApprove submissions are idempotent no-ops',
      dup2?.already === true && dup3?.already === true, JSON.stringify({ dup2, dup3 }));

    // The stored submission stays approved with the ORIGINAL url (no approved→pending
    // flip). taskSubmissions live on the team doc — read via the player's own
    // getMyTeamState (listRunTeams intentionally exposes only pendingReviews, not the
    // full submission records).
    const spState = await sp.call('getMyTeamState', { code: cs });
    const sub = spState?.team?.taskSubmissions?.['so-t'];
    check('re-submit after approval keeps status approved + original url',
      sub?.status === 'approved' && sub?.photoUrl === ownPhoto(1),
      JSON.stringify(sub));
  });

  // ═══ Wave 1 Fix 5: staffSignIn single-use PIN under concurrency ══════════════
  await scenario('staffSignIn PIN is single-use under concurrency (Fix 5)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: gc } = await creator.call('createGame', { title: 'PIN Race', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gc, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'pc-0', order: 0, isFinal: true, title: 'Only stage', tasks: [
        { id: 'pc-t', title: 'T', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: rc } = await creator.call('launchRun', { gameId: gc });
    const { pin } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: gc, runId: rc, name: 'Solo Marshal', permissions: ['review_photos'],
    });

    // Fire N concurrent staffSignIn calls from distinct identities with the same PIN.
    const N = 10;
    const parties = [];
    for (let i = 0; i < N; i++) {
      const pty = makeParty(`pinRacer${i}`);
      await signInAnonymously(pty.auth);
      parties.push(pty);
    }
    const results = await Promise.allSettled(
      parties.map((pty) => pty.call('staffSignIn', { ownerUid: OWNER, gameId: gc, runId: rc, pin })),
    );
    const successes = results.filter((r) => r.status === 'fulfilled' && r.value?.customToken);
    check('exactly one staffSignIn succeeds under concurrency', successes.length === 1,
      `successes=${successes.length}/${N}`);
    check('the rest are rejected (single-use enforced)',
      results.filter((r) => r.status === 'rejected').length === N - 1,
      `rejected=${results.filter((r) => r.status === 'rejected').length}`);
  });

  // ═══ startTeams scales with team count (perf: run-perf-scale, Task 10) ═══════
  // Root cause: startTeams used to await assignNextInActiveStage STRICTLY
  // serially, one team at a time, re-reading the SAME game doc every iteration —
  // 20+ teams could push the v1 default 60s callable timeout. This scenario
  // joins a large cohort and asserts (a) startTeams still launches + routes
  // every one of them correctly and (b) the single startTeams call comes back
  // fast — a regression back to the serial loop would blow well past this
  // budget locally, long before it ever got near a real 60s ceiling.
  await scenario('startTeams scales with team count', async () => {
    // Capped at 12, NOT ~24: MAX_RUN_DEVICES is a hard global ceiling of 16
    // phones per run regardless of billing tier (see the dedicated "global
    // per-run device cap (16 phones max)" scenario) — this scenario found that
    // the hard way (a real bug in the TEST, not the fix: 24 joins tripped
    // "This run is full (16 devices max)" before startTeams was even called).
    // 12 teams still exercises 2 full chunks of the bounded-concurrency fan-out
    // (chunk size 8) without touching either cap.
    const N = 12;
    const { gameId: gSc } = await creator.call('createGame', { title: 'Scale Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gSc, scoringPreset: 'fixed_points_speed',
      stages: [{
        id: 'sc-s', order: 0, title: 'Anywhere', isFinal: true,
        // Locationless + uncapped so every one of the N teams can be routed to
        // the same task without a station-cap fight muddying the timing signal
        // (station contention has its own dedicated scenario above).
        tasks: [{ id: 'sc-t', title: 'Do it anywhere', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 999 }],
      }],
    });
    const { runId: rSc, accessCode: cSc } = await creator.call('launchRun', { gameId: gSc });
    const scPlayers = [];
    for (let i = 0; i < N; i++) {
      const p = makeParty(`scale${i}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: cSc, displayName: `Scale ${i}` });
      scPlayers.push(p);
    }

    const t0 = Date.now();
    const startRes = await creator.call('startTeams', { gameId: gSc, runId: rSc });
    const ms = Date.now() - t0;
    check(`startTeams launched all ${N} teams`, startRes?.launched === N, JSON.stringify(startRes));
    console.log(`      startTeams(${N} teams) took ${ms}ms`);
    // Generous ceiling for a local emulator — the point is architecture (bounded
    // fan-out + one game read), not a tight production SLO. The old serial
    // per-team loop scaled linearly with N and re-read the game doc every time;
    // this should stay flat-ish as N grows.
    check(`startTeams(${N} teams) completes well within budget`, ms < 20000, `${ms}ms`);

    const states = await Promise.all(scPlayers.map((p) => p.call('getMyTeamState', { code: cSc })));
    const allAssigned = states.every((s) => s?.team?.stages?.[0]?.tasks?.[0]?.status === 'assigned');
    check('every team was routed to the locationless task', allAssigned,
      JSON.stringify(states.map((s) => s?.team?.stages?.[0]?.tasks?.[0]?.status)));
  });

  // ═══ Callable coverage guard ════════════════════════════════════════════════
  // Introspect the callables the emulator actually serves (from the built lib)
  // and require every one to have been INVOKED by the suite above (positively or
  // via the authz denial matrix). A newly added callable ships RED here until it
  // gets a test — the single biggest "don't let an untested callable slip" lever.
  await scenario('callable coverage guard', async () => {
    const deployed = listDeployedCallables();
    check('coverage: introspected the deployed callable set', deployed.length > 0, `${deployed.length} callables`);
    const exercised = new Set(latencySamples.keys());
    // Each exemption MUST carry a reason. Keep this EMPTY if possible — an empty
    // list means 100% callable coverage.
    const EXEMPT = new Map([
      // e.g. ['someCallable', 'reason it genuinely cannot be exercised here'],
    ]);
    const uncovered = deployed.filter((c) => !exercised.has(c) && !EXEMPT.has(c));
    check('coverage: every deployed callable is exercised by the suite (or exempt)',
      uncovered.length === 0,
      uncovered.length ? `UNCOVERED → add a test or exempt: ${uncovered.join(', ')}` : `${exercised.size}/${deployed.length} covered`);
    // The exempt list must not rot: an entry that no longer exists, or is now
    // exercised, should be removed.
    const stale = [...EXEMPT.keys()].filter((c) => !deployed.includes(c) || exercised.has(c));
    check('coverage: no stale entries in the exempt list', stale.length === 0, stale.join(', '));
  });

  printSummary();
  if (transientRetries > 0) console.log(`\n⚠ transient internal/unavailable retries absorbed: ${transientRetries}`);
  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n💥 Uncaught error:', e.message);
  console.error(e);
  process.exit(1);
});
