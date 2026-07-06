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
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } from 'firebase/firestore';
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

// The Admin SDK is used ONLY to mint auth custom tokens against the Auth
// emulator (a platform-admin identity for the admin-only callables). It never
// touches Firestore — all game/run state still flows through the callables.
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
adminSdk.initializeApp({ projectId: PROJECT });

// ── Per-callable latency sampling (reported at the end) ───────────────────────
const latencySamples = new Map(); // fn → number[] (ms)
function recordLatency(fn, ms) {
  if (!latencySamples.has(fn)) latencySamples.set(fn, []);
  latencySamples.get(fn).push(ms);
}

function makeParty(name) {
  const app = initializeApp(
    { apiKey: 'emulator-key', projectId: PROJECT, appId: `emu-${name}` },
    name,
  );
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
        return (await httpsCallable(functions, fn)(data)).data;
      } finally {
        recordLatency(fn, Date.now() - t0);
      }
    },
    setDocAt: (path, data) => setDoc(doc(db, path), data),
    getDocAt: (path) => getDoc(doc(db, path)).then((s) => ({ exists: s.exists(), data: s.data() })),
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
  // added by the sanitizer itself:
  'hasHint', 'locationHidden',
]);
const ALLOWED_SMART_KEYS = new Set([
  'enabled', 'verificationType', 'longInstructions', 'longInstructionsHe',
  'extraInfo', 'mediaUrl', 'imageUrl', 'codeInputLabel', 'hasCode',
  'geofenceRadiusMeters', 'stationCoords', 'timeLimitSeconds', 'autoApprove',
  'attemptLimit',
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
          type: 'station',
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
          type: 'navigation',
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
  const activeTask = state?.activeStageTasks?.[0];
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
    d2State?.team?.displayName === 'The Test Lions' && d2State?.activeStageTasks?.[0]?.id === CODE_TASK_ID);
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

  // ── 8b. Live leaderboard mid-run (refreshLeaderboard) ───────────────────────
  const lbCtx = { ownerUid: creatorCred.user.uid, gameId, runId };
  const lbHidden = await creator.call('refreshLeaderboard', { ...lbCtx, publish: false });
  check('refreshLeaderboard returns live rankings mid-run', (lbHidden?.rankings?.length ?? 0) === 1,
    JSON.stringify(lbHidden?.rankings?.[0]));
  check('refreshLeaderboard stays unpublished by default', lbHidden?.published === false);
  let midState = await player.call('getMyTeamState', { code: accessCode });
  check('run is still live after refresh (not finished)', midState?.run?.status !== 'finished', midState?.run?.status);
  check('unpublished standings are hidden from participant', midState?.run?.leaderboard?.published === false);

  // Public, shareable leaderboard is gated on publish: hidden before, shown after.
  const boardBefore = await player.call('getPublicLeaderboard', { code: accessCode });
  check('public leaderboard hides rankings until published',
    boardBefore?.published === false && (boardBefore?.rankings?.length ?? 0) === 0);

  const lbShown = await creator.call('refreshLeaderboard', { ...lbCtx, publish: true });
  check('refreshLeaderboard can publish to teams', lbShown?.published === true);
  midState = await player.call('getMyTeamState', { code: accessCode });
  check('published standings are visible to participant', midState?.run?.leaderboard?.published === true);

  const boardAfter = await player.call('getPublicLeaderboard', { code: accessCode });
  check('public leaderboard exposes rankings once published',
    boardAfter?.published === true && (boardAfter?.rankings?.length ?? 0) === 1,
    JSON.stringify(boardAfter?.rankings?.[0]));

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

  const photoSubmit = await player.call('submitStationPhoto', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: PHOTO_TASK_ID,
    photoUrl: STORAGE_PHOTO_URL,
  });
  check('submitStationPhoto accepts a photo (pending, not auto-approved)',
    photoSubmit?.submitted === true && photoSubmit?.autoApproved === false, JSON.stringify(photoSubmit));

  state = await player.call('getMyTeamState', { code: accessCode });
  check('submission is stored NESTED under taskSubmissions (not a literal dotted key)',
    state?.team?.taskSubmissions?.[PHOTO_TASK_ID]?.status === 'pending',
    JSON.stringify(state?.team?.taskSubmissions ?? {}));
  check('photo stage stays active until reviewed', state?.team?.stages?.[1]?.status === 'active',
    state?.team?.stages?.[1]?.status);

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

  const review = await staff.call('reviewStationSubmission', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: PHOTO_TASK_ID, approved: true,
  });
  check('reviewStationSubmission approves', review?.ok === true && review?.approved === true);

  state = await player.call('getMyTeamState', { code: accessCode });
  check('review marks the submission approved (nested update)',
    state?.team?.taskSubmissions?.[PHOTO_TASK_ID]?.status === 'approved',
    state?.team?.taskSubmissions?.[PHOTO_TASK_ID]?.status);
  check('approved photo completes the stage', state?.team?.stages?.[1]?.status === 'completed',
    state?.team?.stages?.[1]?.status);
  check('final stage unlocked after photo', state?.team?.stages?.[2]?.status === 'active',
    state?.team?.stages?.[2]?.status);

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
  // Finalizing the main run folds anonymized per-task-type aggregates into
  // benchmarks/{taskType}. The main game has a 'station' task type.
  const benchStation = await creator.getDocAt('benchmarks/station');
  check('benchmark: finalize contributed a station aggregate', benchStation.exists && (benchStation.data?.count ?? 0) >= 1, JSON.stringify(benchStation.data));
  check('benchmark: aggregate is anonymized (no run/team ids)',
    benchStation.exists && typeof benchStation.data?.medianMsRolling === 'number'
      && !('runId' in benchStation.data) && !('teamId' in benchStation.data) && !('ownerUid' in benchStation.data),
    JSON.stringify(benchStation.data));

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
  const htask = s3?.activeStageTasks?.[0];
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
  const qTask = sq?.activeStageTasks?.[0];
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
  const seqTask = sSeq?.activeStageTasks?.[0];
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
            coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9 },
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
    const s0 = await pS.call('getMyTeamState', { code: cS });
    const lockedTask = s0?.activeStageTasks?.find((t) => t.id === 'locked-1');
    check('scheduled: releaseAt survives sanitizer', lockedTask?.releaseAt === future, lockedTask?.releaseAt);

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
    const sp = await pP.call('getMyTeamState', { code: cP });
    check('scheduled: past-release stage unlocks (active task present)',
      sp?.activeStageTasks?.some((t) => t.id === 'p-b') === true, JSON.stringify(sp?.activeStageTasks?.map((t) => t.id)));
    await pP.call('completeTask', { ...CP, taskId: 'p-b' });
    const spF = await pP.call('getMyTeamState', { code: cP });
    check('scheduled: past-release run completes to finished', spF?.team?.status === 'finished', spF?.team?.status);
  }); // scenario: scheduled release

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

    // Profiles are recorded at finalize (off the hot completeTask path).
    await creator.call('finalizeRun', { gameId: gPr, runId: rPr });
    const prof = await pPr.call('getMyProfile', {});
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

  const sHL = await playerHL.call('getMyTeamState', { code: cHL });
  const hiddenTask = sHL?.activeStageTasks?.find((t) => t.id === 'hl-1');
  const visibleTask = sHL?.activeStageTasks?.find((t) => t.id === 'hl-2');
  check('hidden task: coordinates stripped from payload', hiddenTask?.coordinates === undefined, JSON.stringify(hiddenTask?.coordinates));
  check('hidden task: locationHidden flag set', hiddenTask?.locationHidden === true, String(hiddenTask?.locationHidden));
  check('hidden task: exact radius withheld', hiddenTask?.geofenceRadiusMeters === undefined, String(hiddenTask?.geofenceRadiusMeters));
  check('hidden task: clue exposed (EN + HE)',
    hiddenTask?.locationClue === 'Where water never stops' && hiddenTask?.locationClueHe === 'במקום שבו המים לא נחים',
    JSON.stringify({ en: hiddenTask?.locationClue, he: hiddenTask?.locationClueHe }));
  check('visible sibling task: coordinates still present', visibleTask?.coordinates?.lat === 31.781 && visibleTask?.locationHidden === undefined, JSON.stringify(visibleTask?.coordinates));

  // Out-of-range check-in on the hidden task: rejected with NO distance leaked.
  let hiddenFarMsg = '';
  try { await playerHL.call('completeTask', { ...CHL, taskId: 'hl-1', lat: 32.5, lng: 35.9 }); }
  catch (e) { hiddenFarMsg = e.message; }
  check('hidden task: out-of-range check-in rejected', hiddenFarMsg.length > 0, hiddenFarMsg);
  check('hidden task: rejection leaks NO distance digits', hiddenFarMsg.length > 0 && !/\d/.test(hiddenFarMsg) && !/m away/i.test(hiddenFarMsg), hiddenFarMsg);

  // Arrival within radius completes (server-validated GPS), assigns the next task.
  const hiddenNear = await playerHL.call('completeTask', { ...CHL, taskId: 'hl-1', lat: 31.78, lng: 35.21 });
  check('hidden task: arrival within radius completes', hiddenNear?.ok === true, JSON.stringify(hiddenNear));

  // Hidden task payload must ALSO stay allowlisted (locationHidden path).
  assertTaskPayloadAllowlisted('sanitizer(hidden)', hiddenTask);

  }); // scenario: hidden-location

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
      // Territory/trackable authoring is owner-only — a participant can't create them:
      ['participant', pl, 'createZone', { gameId: ag, runId: ar, title: 'pwn', lat: 31.78, lng: 35.21 }],
      ['participant', pl, 'deleteZone', { gameId: ag, runId: ar, zoneId: 'fake' }],
      ['participant', pl, 'createTrackable', { gameId: ag, runId: ar, name: 'pwn' }],
      ['participant', pl, 'getRunHeatmap', { code: ac }],
    ];
    for (const [who, party, fn, payload] of rows) {
      await expectError(`authz: ${who} is denied ${fn}`, party.call(fn, payload), { codeIn: DENY });
    }

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
  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n💥 Uncaught error:', e.message);
  console.error(e);
  process.exit(1);
});
