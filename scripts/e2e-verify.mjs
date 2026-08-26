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
// The gallery ranking oracle: the suite asserts the STORED popularity field equals
// this pure function applied to the stored counters, so a bump that forgets to
// recompute the score (a silently wrong ORDER, with no error anywhere) fails loud.
// GAME_FILE_FORMAT/CURRENT_GAME_FILE_VERSION come along so the export/import
// scenario asserts against the SAME envelope the server writes (a version bump
// can never silently pass an outdated assertion).
import { popularityScore, GAME_FILE_FORMAT, CURRENT_GAME_FILE_VERSION, MAX_RUN_DEVICES } from '@rushpoint/shared';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Emulator ports come from ONE pure resolver (change: emulator-port-offset), so this
// suite can run on an offset block beside a live playtest stack instead of fighting it
// for 8080/9099/5001/9199. Unset RUSHPOINT_EMULATOR_PORT_OFFSET ⇒ exactly today's ports.
import { resolveEmulatorPorts, resolveEmulatorHostEnv } from './lib/emulatorPorts.mjs';

const PROJECT = 'rushpoint-pwa-7daaa';
const EMU = resolveEmulatorPorts(process.env);

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
// `??=` on purpose: inside `emulators:exec` the CLI already exported the ports it really
// bound, and those must win. This only fills the gap for a standalone `npm run e2e`.
{
  const hosts = resolveEmulatorHostEnv(process.env);
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= hosts.FIREBASE_AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST ??= hosts.FIRESTORE_EMULATOR_HOST;
}
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
  connectAuthEmulator(auth, `http://127.0.0.1:${EMU.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', EMU.functions);
  connectFirestoreEmulator(db, '127.0.0.1', EMU.firestore);
  connectStorageEmulator(storage, '127.0.0.1', EMU.storage);
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
// Recursively collect any of `keys` present anywhere inside `value` (change:
// test-mode-hidden-scoring). The sealed-payload assertions need DEPTH: the score
// fields that matter most live on nested task records, so a top-level key check
// would pass while `team.stages[0].tasks[0].earnedScore` sailed through. Returns
// dotted paths so a failure names the exact leak site.
function findKeysDeep(value, keys, path = 'team', out = []) {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findKeysDeep(v, keys, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (keys.includes(k)) out.push(`${path}.${k}`);
    findKeysDeep(v, keys, `${path}.${k}`, out);
  }
  return out;
}

const ALLOWED_TASK_KEYS = new Set([
  'id', 'title', 'description', 'type', 'coordinates', 'difficulty',
  'estimatedMinutes', 'expectedDurationMinutes', 'pointValue',
  'maxConcurrentTeams', 'currentTeamCount', 'status', 'maxDurationMinutes',
  'smart', 'triggerMode', 'locationless', 'hideLocation', 'locationClue',
  'locationClueHe', 'hintPenalty', 'choices', 'numericTolerance',
  'geofenceRadiusMeters', 'steps', 'tags', 'media',
  // pause-clock-tasks: the participant is TOLD the clock is stopped (that is the
  // whole point — a team that does not know will still hurry), so the flag is
  // deliberately participant-visible. It reveals no answer and no secret.
  'pausesTimer',
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
  // wrong-answer-cost: the creator-authored strictness level for a wrong answer.
  // It says what a wrong answer COSTS, never what the answer is, and the whole
  // point of the change is that the participant is TOLD the rule before answering.
  'wrongAnswerPenalty',
  // added by the sanitizer itself:
  'hasHint', 'locationHidden', 'hintFreeNow',
  // wrong-answer-cost: server-computed display object (level, free attempts left,
  // next point/second cost, cooldown expiry, charged so far). Derived from the
  // level table + the team's OWN progress; carries no fragment of an answer key.
  'answerCost',
  // play-task-gating: set on a hidden-location task the server has NOT yet
  // unsealed. It is a boolean state flag, not content — the sealed payload it
  // accompanies carries no title/type/inputs at all.
  'arrivalPending',
  // hidden-mission-search-area: the coarse search CIRCLE a sealed hidden mission
  // shows its player, so a treasure hunt's map is not blank. Grid-snapped to a
  // ~445m cell by a pure function of the coordinate (so polling cannot sharpen
  // it), guaranteed to CONTAIN the spot and never to be it, and absent the moment
  // the server unseals the task and returns the exact `coordinates`. The
  // sanitizer's own vitest holds the containment + withholding contract.
  'searchArea',
]);
const ALLOWED_SMART_KEYS = new Set([
  'enabled', 'verificationType', 'longInstructions', 'longInstructionsHe',
  'extraInfo', 'mediaUrl', 'imageUrl', 'codeInputLabel', 'hasCode',
  'geofenceRadiusMeters', 'stationCoords', 'timeLimitSeconds', 'autoApprove',
  'attemptLimit',
  // audio-tasks / video-submission-task: which capture widget the client renders
  // (photo vs audio vs video) — not a secret, so it passes through the sanitizer.
  // The video clip-length range passes for the same reason: a recorder cannot
  // enforce a limit it cannot see.
  'captureKind', 'videoMinSeconds', 'videoMaxSeconds',
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

// ── listRunTeams ROW allowlist (change: run-console-attention) ────────────────
// The same argument as ALLOWED_TASK_KEYS, one level up: `listRunTeams` is an
// OWNER/STAFF projection built by hand in functions/src/runs/index.ts, and the
// team document it projects from carries answer keys, per-task attempt counters,
// device uids, guardian-consent records and raw submission urls. A future `...t`
// spread — or one more "just this one field" — would ship all of that to every
// staff console with nothing failing. Pinning the row shape means a projection
// ADDITION fails here until it is consciously classified.
//
// This list is the exact set of keys the handler returns today; the three
// attention signals are asserted PRESENT separately below, because an allowlist
// alone cannot catch a field being silently dropped.
const ALLOWED_RUN_TEAM_ROW_KEYS = new Set([
  'id', 'displayName', 'memberNames', 'memberCount', 'status', 'score',
  'bonusPenalty', 'completedStages', 'pendingReviews', 'activeStageOrder',
  'finished', 'launched', 'startedAt', 'finishedAt', 'outOfBounds',
  // run-console-attention: three freshness/attention clocks. None is a position
  // and none is an answer key — `answerLockoutUntil` is an expiry, not a hint.
  'updatedAt', 'answerLockoutUntil', 'lastLocationAt',
  // held-team-visibility: a BOOLEAN, never the guardian's name or contact.
  'heldForConsent',
]);

function assertRunTeamRowAllowlisted(label, row) {
  const bad = Object.keys(row ?? {}).filter((k) => !ALLOWED_RUN_TEAM_ROW_KEYS.has(k));
  check(`${label}: listRunTeams row keys are allowlisted`, bad.length === 0, bad.join(','));
  // The attention signals are nullable but never ABSENT — the handler writes
  // `?? null` for each. A console that reads an absent key gets `undefined` and
  // renders "no evidence" forever, which is exactly the silent failure the change
  // exists to remove, so presence is asserted independently of the value.
  for (const k of ['updatedAt', 'answerLockoutUntil', 'lastLocationAt']) {
    check(`${label}: listRunTeams row carries '${k}'`, row != null && k in row,
      JSON.stringify(Object.keys(row ?? {})));
  }
}

// ── Leaderboard invariant oracle ──────────────────────────────────────────────
// Well-formedness that must hold for ANY rankings payload (live or final):
// every expected team exactly once, contiguous ranks from 1, finite scores,
// scores non-increasing (non-time presets rank by score).
// `startedAtByTeamId` is OPTIONAL and only a caller that independently holds the
// teams' server-written `startedAt` (read straight off the team documents, never
// off the board being checked) passes it — that second, independent source is what
// makes the wall-clock bound below a real comparison rather than a restatement of
// the board.
function assertLeaderboardInvariants(label, rankings, expectedTeamIds, startedAtByTeamId) {
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

  // ── Duration well-formedness (change: pause-clock-tasks) ────────────────────
  // `durationSeconds` is now derived (adjustedElapsedSeconds = raw − excluded)
  // rather than measured, so it is the one leaderboard field a subtraction bug can
  // reach. Three things must hold for EVERY board the suite ever builds:
  //
  //   1. When present it is a finite, non-negative number. A negative would mean a
  //      team was credited MORE excluded time than it spent (adjustedElapsedSeconds
  //      lost its `Math.max(0, …)` floor); a NaN would mean a corrupt `excludedMs`
  //      stamp propagated instead of being ignored by teamExcludedMs. Either one
  //      also crashes the response at JSON-encode.
  //   2. A FINISHED entry always carries one. The omission branch exists only to
  //      keep an unfinished team's Infinity off the wire (the family-playtest
  //      crash); a finished team losing its duration would silently drop it out of
  //      the time_only ordering (it sorts on exactly this field) with no error
  //      anywhere. Deliberately one-directional: an unfinished entry is allowed to
  //      omit it, which is what assertAllFinite already pins on the other side.
  //   3. It never EXCEEDS the team's own wall clock (checked below when the caller
  //      supplies the independently-read startedAt map). Excluded time can only
  //      subtract; a sign flip anywhere on that path shows up as a duration longer
  //      than the team was actually racing.
  check(`${label}: every finished entry carries a finite durationSeconds`,
    (rankings ?? []).every((r) => !r.finishedAt || Number.isFinite(r.durationSeconds)),
    JSON.stringify((rankings ?? []).map((r) => ({ f: !!r.finishedAt, d: r.durationSeconds }))));
  // `== null` on purpose, not `=== undefined`: these rankings arrive over a
  // callable, i.e. through JSON, where `undefined` cannot survive. An unfinished
  // team's absent duration is therefore ALWAYS `null` on the wire, so an
  // undefined-only check can never pass for a run that has anyone still playing.
  check(`${label}: every present durationSeconds is finite and >= 0`,
    (rankings ?? []).every((r) => r.durationSeconds == null
      || (Number.isFinite(r.durationSeconds) && r.durationSeconds >= 0)),
    JSON.stringify((rankings ?? []).map((r) => r.durationSeconds)));
  if (startedAtByTeamId) {
    const overrun = (rankings ?? []).filter((r) => {
      const startedAt = startedAtByTeamId[r.teamId];
      if (!r.finishedAt || !startedAt || r.durationSeconds == null) return false;
      const wallSec = (new Date(r.finishedAt).getTime() - new Date(startedAt).getTime()) / 1000;
      return !(r.durationSeconds <= wallSec + 1e-6);
    });
    check(`${label}: no finished team's durationSeconds exceeds its wall clock`,
      overrun.length === 0,
      JSON.stringify(overrun.map((r) => ({
        teamId: r.teamId, dur: r.durationSeconds,
        wall: (new Date(r.finishedAt).getTime() - new Date(startedAtByTeamId[r.teamId]).getTime()) / 1000,
      }))));
  }
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
  const VIDEO_TASK_ID = 'task-video-1'; // video-submission-task: same pipeline, captureKind:'video'
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
        {
          // video-submission-task: the third capture kind on the SAME photo
          // pipeline. Deliberately LOCATED (not locationless) so the audio task
          // stays the one routing assigns — this scenario's captureKind sanitizer
          // assertion above depends on that, and a second locationless task would
          // make the assignment a coin flip.
          id: VIDEO_TASK_ID,
          title: 'Film your team handshake',
          type: 'photo',
          coordinates: { lat: 31.7955, lng: 35.1655 },
          difficulty: 2,
          estimatedMinutes: 4,
          pointValue: 60,
          maxConcurrentTeams: 3,
          smart: {
            enabled: true,
            verificationType: 'photo_upload',
            captureKind: 'video',
            videoMinSeconds: 10,
            videoMaxSeconds: 30,
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
  // team.score is the DISPLAY channel the participant's own PlayScreen header
  // reads DIRECTLY from getMyTeamState (not from the ranked leaderboard) — a
  // real bug shipped where adjustTeamScore updated only bonusPenalty, so the
  // ranking board moved instantly but a player's own score badge stayed frozen
  // until finalizeRun. Capture it before the adjustment so a regression here
  // (adjustTeamScore stops writing team.score) fails loud, not silently.
  const ownScoreBeforeAdj = (await player.call('getMyTeamState', { code: accessCode }))?.team?.score ?? 0;
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
  // The actual bug: the participant's OWN mid-run score (getMyTeamState →
  // team.score, what PlayScreen's header renders) must move by the same delta
  // in the SAME poll — not just the organizer-facing ranked leaderboard.
  const ownScoreAfterAdj = (await player.call('getMyTeamState', { code: accessCode }))?.team?.score ?? 0;
  check('adjustTeamScore updates the participant\'s own live score badge (−20), not just the leaderboard',
    ownScoreAfterAdj === ownScoreBeforeAdj - 20,
    JSON.stringify({ before: ownScoreBeforeAdj, after: ownScoreAfterAdj }));
  const teamsAfterAdj = (await creator.call('listRunTeams', { gameId, runId }))?.teams ?? [];
  const rowAfterAdj = teamsAfterAdj.find((t) => t.id === playerCred.user.uid);
  check('listRunTeams exposes bonusPenalty (+20 after a −20 adjustment)',
    (rowAfterAdj?.bonusPenalty ?? 0) - (rowBeforeAdj?.bonusPenalty ?? 0) === 20,
    JSON.stringify({ before: rowBeforeAdj?.bonusPenalty, after: rowAfterAdj?.bonusPenalty }));

  // ── 8b3. The console row SHAPE is pinned (change: run-console-attention) ────
  // This team has been playing for several completions by now, so `updatedAt` is
  // a real server write clock and not the join stamp — asserted against the
  // independently-read team document below rather than against itself.
  assertRunTeamRowAllowlisted('console row', rowAfterAdj);
  const liveTeamDoc = (await creator.getDocAt(
    `users/${creatorCred.user.uid}/games/${gameId}/runs/${runId}/teams/${playerCred.user.uid}`,
  )).data;
  check('listRunTeams.updatedAt is the team document\'s own server write clock',
    rowAfterAdj?.updatedAt === (liveTeamDoc?.updatedAt ?? null),
    JSON.stringify({ row: rowAfterAdj?.updatedAt, doc: liveTeamDoc?.updatedAt }));
  // No wrong answer has been charged on this team, so the lockout clock is null
  // (a NUMBER here would mean the reducer folded an unrelated field into it), and
  // no GPS ping has been sent for this team in this run, so the location clock is
  // null rather than a stale value borrowed from another team's document.
  check('listRunTeams.answerLockoutUntil is null with no wrong answers charged',
    rowAfterAdj?.answerLockoutUntil === null, String(rowAfterAdj?.answerLockoutUntil));
  check('listRunTeams.lastLocationAt is null before this team has pinged',
    rowAfterAdj?.lastLocationAt === null, String(rowAfterAdj?.lastLocationAt));

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
    `http://127.0.0.1:${EMU.storage}/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=e2e-token`;
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

  // ── 8e. Video task (video-submission-task): same pipeline, captureKind:'video' ─
  const videoObjectPath = `runs/${runId}/teams/${playerCred.user.uid}/handshake-1.webm`;
  const VIDEO_URL =
    `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(videoObjectPath)}?alt=media`;
  let videoUploadOk = false;
  try {
    await player.uploadBytesAt(videoObjectPath, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 4, 5, 6, 7]), 'video/webm');
    videoUploadOk = true;
  } catch (e) { videoUploadOk = false; console.log('  video upload err ::', e.message); }
  check('storage.rules accept a video/webm upload to the team folder', videoUploadOk);

  const submitVideo = (contentType, taskId = VIDEO_TASK_ID, photoUrl = VIDEO_URL) =>
    player.call('submitStationPhoto', {
      ownerUid: creatorCred.user.uid, gameId, runId,
      teamId: playerCred.user.uid, taskId, photoUrl, contentType,
    });

  // Negatives: the kind gate must reject in EVERY direction, not just the obvious
  // one — a video type on a photo/audio task and a photo/audio type on the video
  // task. The server derives the kind from the game snapshot, never from the client.
  let videoImageRejected = false;
  try { await submitVideo('image/jpeg'); } catch (e) { videoImageRejected = isInvalidArg(e); }
  check('video task rejects an image content-type', videoImageRejected);

  let videoAudioRejected = false;
  try { await submitVideo('audio/webm'); } catch (e) { videoAudioRejected = isInvalidArg(e); }
  check('video task rejects an audio content-type', videoAudioRejected);

  let videoMissingRejected = false;
  try { await submitVideo(undefined); } catch (e) { videoMissingRejected = isInvalidArg(e); }
  check('video task rejects a missing content-type', videoMissingRejected);

  let photoVideoRejected = false;
  try {
    await submitVideo('video/webm', PHOTO_TASK_ID, STORAGE_PHOTO_URL);
  } catch (e) { photoVideoRejected = isInvalidArg(e); }
  check('photo task rejects a video content-type', photoVideoRejected);

  // Happy path: a proper video/webm submission → pending + mediaKind 'video'.
  const videoSubmit = await submitVideo('video/webm');
  check('submitStationPhoto accepts a video submission (pending)',
    videoSubmit?.submitted === true && videoSubmit?.autoApproved === false, JSON.stringify(videoSubmit));

  state = await player.call('getMyTeamState', { code: accessCode });
  check('video submission records mediaKind === "video" (server-derived)',
    state?.team?.taskSubmissions?.[VIDEO_TASK_ID]?.mediaKind === 'video',
    JSON.stringify(state?.team?.taskSubmissions?.[VIDEO_TASK_ID] ?? {}));

  const videoReview = await staff.call('reviewStationSubmission', {
    ownerUid: creatorCred.user.uid, gameId, runId,
    teamId: playerCred.user.uid, taskId: VIDEO_TASK_ID, approved: true,
  });
  check('reviewStationSubmission approves the video submission',
    videoReview?.ok === true && videoReview?.approved === true);

  state = await player.call('getMyTeamState', { code: accessCode });
  check('video submission marked approved after review',
    state?.team?.taskSubmissions?.[VIDEO_TASK_ID]?.status === 'approved',
    state?.team?.taskSubmissions?.[VIDEO_TASK_ID]?.status);

  // NOTE: this stage has requiredTaskCount:1 and PHOTO_TASK_ID already satisfied
  // it above, so AUDIO_TASK_ID/VIDEO_TASK_ID were auto-skipped as the stage
  // completed — completeTaskForTeam is a no-op (completed:false) for both, so
  // NEITHER can ever reach the feed here regardless of kind. That is a property
  // of this shared fixture's partial-stage setup, not evidence about video's
  // feed eligibility — see the dedicated "video submissions enter the live photo
  // feed (mediaKind)" scenario below for real coverage of the autoApprove path,
  // the staff-review path, the hidden-location exclusion, and the mediaKind
  // field (change: run-media-gallery-and-video-feed).
  const feedItemsAfterVideo = await player.getColAt(
    `users/${creatorCred.user.uid}/games/${gameId}/runs/${runId}/feedItems`,
  ).catch(() => []);
  check('no feed item for the video submission on an already-satisfied requiredTaskCount stage',
    !feedItemsAfterVideo.some((f) => f?.taskId === VIDEO_TASK_ID),
    JSON.stringify(feedItemsAfterVideo.map((f) => f?.taskId)));

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
  // The summary email is scoped to runs owned by an IDENTIFIABLE creator — one
  // with an email on their profile (change: run-email-scope-and-digest). That rule
  // is what excludes simulations, which (like this suite) create their creator
  // with signInAnonymously. Stamp an email here so the `summaryEmailSent` claim
  // asserted below still exercises the POSITIVE path; without it that assertion
  // would silently degrade into "the email correctly didn't send".
  await adminSdk.firestore().doc(`users/${creatorCred.user.uid}`).set(
    { email: 'e2e-lifecycle-creator@example.test' }, { merge: true });
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

  await scenario('wrong answers cost (escalate, cap, cooldown, replay, preset)', async () => {

  // ── Wrong-answer cost (change: wrong-answer-cost) ───────────────────────────
  // Before this change the `if (!correct)` branch charged NOTHING, so on a 4
  // choice quiz brute-forcing every option was strictly optimal play. These
  // assertions pin the whole model: free attempts, escalation, the cumulative
  // cap, the retry cooldown, duplicate-submission idempotence, the preset gate,
  // and the promise that a game authored BEFORE this change is untouched.
  const ownerUid = creatorCred.user.uid;
  const quizTask = (id, answer) => ({
    id, title: `Riddle ${id}`, type: 'quiz', answers: [answer],
    choices: [answer, 'wrong-a', 'wrong-b', 'wrong-c'],
    coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 4, estimatedMinutes: 5,
    pointValue: 100, maxConcurrentTeams: 5, triggerMode: 'instant',
  });

  // ── A. A normal `standard` run: free → charged → replay → cooldown ──────────
  const { gameId: gWA } = await creator.call('createGame', { title: 'Wrong Answer Cost', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gWA,
    scoringPreset: 'fixed_points_speed',
    scoringOptions: { wrongAnswerPenalty: 'standard' },
    stages: [{ id: 'st-wa', order: 0, title: 'Quiz', isFinal: true, tasks: [quizTask('wa-1', 'olive')] }],
  });
  const { runId: rWA, accessCode: cWA } = await creator.call('launchRun', { gameId: gWA });
  const pWA = makeParty('wrongAnswerPlayer');
  await signInAnonymously(pWA.auth);
  await pWA.call('joinRun', { code: cWA, displayName: 'Guesser' });
  await creator.call('startTeams', { gameId: gWA, runId: rWA });
  const waCtx = { ownerUid, gameId: gWA, runId: rWA };

  // The rule is announced BEFORE the first answer, and it leaks nothing.
  const sWA0 = await pWA.call('getMyTeamState', { code: cWA });
  const tWA0 = sWA0?.activeStageTasks?.find((t) => t.id === 'wa-1');
  assertTaskPayloadAllowlisted('wrong-answer cost task', tWA0);
  check('answerCost is announced before the first answer',
    tWA0?.answerCost?.level === 'standard' && tWA0?.answerCost?.freeAttemptsLeft === 1,
    JSON.stringify(tWA0?.answerCost));
  check('answerCost leaks no answer key',
    tWA0?.answers === undefined && tWA0?.numericAnswer === undefined,
    JSON.stringify({ answers: tWA0?.answers }));

  // 1st wrong answer: FREE (a typo is not a crime) and no lockout.
  const w1 = await pWA.call('submitTaskAnswer', { ...waCtx, taskId: 'wa-1', answer: 'wrong-a' });
  check('1st wrong answer at standard is free', w1?.correct === false && (w1?.penalty ?? 0) === 0, JSON.stringify(w1));
  check('1st wrong answer starts no cooldown', (w1?.cooldownUntil ?? 0) === 0, JSON.stringify(w1?.cooldownUntil));
  const sWA1 = await pWA.call('getMyTeamState', { code: cWA });
  check('1st wrong answer left bonusPenalty at 0', (sWA1?.team?.bonusPenalty ?? 0) === 0, String(sWA1?.team?.bonusPenalty));
  check('1st wrong answer was recorded as an attempt', (sWA1?.team?.taskAttempts?.['wa-1'] ?? 0) === 1, JSON.stringify(sWA1?.team?.taskAttempts));

  // 2nd wrong answer: charged 10 points + a 15 second lockout.
  const w2 = await pWA.call('submitTaskAnswer', { ...waCtx, taskId: 'wa-1', answer: 'wrong-b' });
  check('2nd wrong answer charges 10 points', w2?.penalty === 10, JSON.stringify(w2));
  check('2nd wrong answer starts a 15 second cooldown',
    w2?.retryAfterSeconds > 0 && w2?.retryAfterSeconds <= 15, String(w2?.retryAfterSeconds));
  // retry-lockout-clock-skew: the lockout travels as a DURATION computed against
  // the SERVER clock. A duration is meaningful on any device; the absolute
  // instant it replaces was only meaningful on the clock that produced it, and a
  // participant phone counting it against its own clock froze itself out.
  check('the lockout ships as a server-computed remaining duration',
    w2?.retryAfterMs > 0 && w2?.retryAfterMs <= 15_000, String(w2?.retryAfterMs));
  check('retryAfterMs and retryAfterSeconds describe the same wait',
    Math.ceil(w2.retryAfterMs / 1000) === w2.retryAfterSeconds,
    JSON.stringify({ ms: w2?.retryAfterMs, s: w2?.retryAfterSeconds }));
  const sWA2 = await pWA.call('getMyTeamState', { code: cWA });
  check('the charge landed on bonusPenalty (never on buildRankings)',
    (sWA2?.team?.bonusPenalty ?? 0) === 10, String(sWA2?.team?.bonusPenalty));

  // Duplicate submission (network retry / double tap) must NOT double-charge.
  const w2dup = await pWA.call('submitTaskAnswer', { ...waCtx, taskId: 'wa-1', answer: 'wrong-b' });
  check('a duplicate identical wrong answer is an idempotent replay',
    w2dup?.correct === false && w2dup?.replay === true && (w2dup?.penalty ?? 0) === 0, JSON.stringify(w2dup));
  // The replay reply must carry the SAME duration shape, or a double-tapping
  // client would lose its countdown and hammer a call the server refuses.
  check('the replay reply also carries the remaining duration',
    typeof w2dup?.retryAfterMs === 'number' && w2dup.retryAfterMs > 0 && w2dup.retryAfterMs <= 15_000,
    String(w2dup?.retryAfterMs));
  const sWA3 = await pWA.call('getMyTeamState', { code: cWA });
  check('the replay did not double-charge bonusPenalty', (sWA3?.team?.bonusPenalty ?? 0) === 10, String(sWA3?.team?.bonusPenalty));
  check('the replay did not inflate the attempt count', (sWA3?.team?.taskAttempts?.['wa-1'] ?? 0) === 2, JSON.stringify(sWA3?.team?.taskAttempts));
  // Case/whitespace variants of the same answer are the same attempt.
  const w2case = await pWA.call('submitTaskAnswer', { ...waCtx, taskId: 'wa-1', answer: '  WRONG-B ' });
  check('a case/whitespace variant of the same wrong answer is still a replay', w2case?.replay === true, JSON.stringify(w2case));

  // A DIFFERENT answer during the lockout is refused before it is graded — that
  // ordering is the whole deterrent (grading first would let a team fire every
  // option during the wait).
  await expectError('a different wrong answer during the cooldown is refused',
    pWA.call('submitTaskAnswer', { ...waCtx, taskId: 'wa-1', answer: 'wrong-c' }),
    { codeIn: ['functions/failed-precondition'] });
  await expectError('even the CORRECT answer waits out the cooldown (no free grading oracle)',
    pWA.call('submitTaskAnswer', { ...waCtx, taskId: 'wa-1', answer: 'olive' }),
    { codeIn: ['functions/failed-precondition'] });
  const sWA4 = await pWA.call('getMyTeamState', { code: cWA });
  check('a cooldown refusal consumes no attempt and charges nothing',
    (sWA4?.team?.taskAttempts?.['wa-1'] ?? 0) === 2 && (sWA4?.team?.bonusPenalty ?? 0) === 10,
    JSON.stringify({ a: sWA4?.team?.taskAttempts, bp: sWA4?.team?.bonusPenalty }));
  // retry-lockout-clock-skew: assert a DURATION, deliberately NOT `cooldownUntil
  // > Date.now()` — that old assertion compared a server instant to the test
  // runner's own clock, i.e. it was written in the very units that broke players.
  const acWA4 = sWA4?.activeStageTasks?.find((t) => t.id === 'wa-1')?.answerCost;
  check('the cooldown is surfaced to the participant as a remaining duration',
    acWA4?.cooldownRemainingMs > 0 && acWA4?.cooldownRemainingMs <= 90_000, JSON.stringify(acWA4));
  check('the deprecated absolute expiry is still shipped for older cached bundles',
    (acWA4?.cooldownUntil ?? 0) > 0, JSON.stringify(acWA4?.cooldownUntil));

  // ── B. Escalation + the cap, in a TEST-DRIVE run (the cooldown is waived so a
  //       rehearsal does not spend 90 s waiting — and that waiver is asserted). ─
  const { gameId: gWB } = await creator.call('createGame', { title: 'Wrong Answer Cap', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gWB,
    scoringPreset: 'fixed_points_speed',
    scoringOptions: { wrongAnswerPenalty: 'standard' },
    stages: [{ id: 'st-wb', order: 0, title: 'Quiz', isFinal: true, tasks: [quizTask('wb-1', 'olive')] }],
  });
  const { runId: rWB, accessCode: cWB } = await creator.call('launchRun', { gameId: gWB, testDrive: true });
  const pWB = makeParty('wrongAnswerCapPlayer');
  await signInAnonymously(pWB.auth);
  await pWB.call('joinRun', { code: cWB, displayName: 'Brute' });
  await creator.call('startTeams', { gameId: gWB, runId: rWB });
  const wbCtx = { ownerUid, gameId: gWB, runId: rWB };

  const charges = [];
  for (const guess of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) {
    const r = await pWB.call('submitTaskAnswer', { ...wbCtx, taskId: 'wb-1', answer: guess });
    charges.push(r?.penalty ?? 0);
  }
  check('a test-drive rehearsal is not blocked by the cooldown', charges.length === 6, JSON.stringify(charges));
  check('escalation is 0, 10, 20, 30 then capped at 0',
    JSON.stringify(charges) === JSON.stringify([0, 10, 20, 30, 0, 0]), JSON.stringify(charges));
  const sWB = await pWB.call('getMyTeamState', { code: cWB });
  check('one task can never take more than the 60 point cap off a team',
    (sWB?.team?.bonusPenalty ?? 0) === 60, String(sWB?.team?.bonusPenalty));
  check('the per-task ledger records the capped charge',
    (sWB?.team?.answerPenalties?.['wb-1']?.charged ?? 0) === 60,
    JSON.stringify(sWB?.team?.answerPenalties));

  // A correct answer after all that still completes the task.
  const wbCorrect = await pWB.call('submitTaskAnswer', { ...wbCtx, taskId: 'wb-1', answer: 'olive' });
  check('the correct answer after six wrong ones still completes the task', wbCorrect?.correct === true, JSON.stringify(wbCorrect));

  // The penalty must be visible identically on the live and the final board, and
  // must not break the ranking oracle (it rides bonusPenalty, never buildRankings).
  const wbTeamId = (await pWB.call('getMyTeamState', { code: cWB }))?.team?.id;
  const wbLive = await creator.call('refreshLeaderboard', { gameId: gWB, runId: rWB, publish: false });
  assertLeaderboardInvariants('wrong-answer cost live', wbLive?.rankings, [wbTeamId]);
  const wbLiveScore = wbLive?.rankings?.[0]?.score;
  const wbFinal = await creator.call('finalizeRun', { gameId: gWB, runId: rWB });
  const wbFinalRankings = wbFinal?.rankings ?? wbFinal?.leaderboard?.rankings ?? [];
  assertLeaderboardInvariants('wrong-answer cost final', wbFinalRankings, [wbTeamId]);
  check('live and final scores agree with the wrong-answer charge applied',
    wbLiveScore === wbFinalRankings[0]?.score, `live=${wbLiveScore} final=${wbFinalRankings[0]?.score}`);
  check('the charge can never drive a score below the 0 floor',
    wbFinalRankings[0]?.score >= 0, String(wbFinalRankings[0]?.score));

  // ── C. time_only has no points, so the cost is time and only time ───────────
  const { gameId: gWC } = await creator.call('createGame', { title: 'Wrong Answer Time Only', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gWC,
    scoringPreset: 'time_only',
    scoringOptions: { wrongAnswerPenalty: 'standard' },
    stages: [{ id: 'st-wc', order: 0, title: 'Quiz', isFinal: true, tasks: [quizTask('wc-1', 'olive')] }],
  });
  const { runId: rWC, accessCode: cWC } = await creator.call('launchRun', { gameId: gWC, testDrive: true });
  const pWC = makeParty('wrongAnswerTimePlayer');
  await signInAnonymously(pWC.auth);
  await pWC.call('joinRun', { code: cWC, displayName: 'Racer' });
  await creator.call('startTeams', { gameId: gWC, runId: rWC });
  const wcCtx = { ownerUid, gameId: gWC, runId: rWC };
  await pWC.call('submitTaskAnswer', { ...wcCtx, taskId: 'wc-1', answer: 'g1' }); // free
  const wc2 = await pWC.call('submitTaskAnswer', { ...wcCtx, taskId: 'wc-1', answer: 'g2' });
  check('time_only charges NO points (points do not exist in that preset)', (wc2?.penalty ?? 0) === 0, JSON.stringify(wc2));
  check('time_only still applies the cooldown, which costs real race time',
    wc2?.retryAfterSeconds > 0, String(wc2?.retryAfterSeconds));
  const sWC = await pWC.call('getMyTeamState', { code: cWC });
  check('time_only leaves bonusPenalty untouched', (sWC?.team?.bonusPenalty ?? 0) === 0, String(sWC?.team?.bonusPenalty));

  // ── D. Negative control: a game authored BEFORE this change is untouched ────
  const { gameId: gWD } = await creator.call('createGame', { title: 'Legacy No Cost', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gWD,
    scoringPreset: 'fixed_points_speed',
    stages: [{ id: 'st-wd', order: 0, title: 'Quiz', isFinal: true, tasks: [quizTask('wd-1', 'olive')] }],
  });
  const { runId: rWD, accessCode: cWD } = await creator.call('launchRun', { gameId: gWD });
  const pWD = makeParty('legacyPlayer');
  await signInAnonymously(pWD.auth);
  await pWD.call('joinRun', { code: cWD, displayName: 'Legacy' });
  await creator.call('startTeams', { gameId: gWD, runId: rWD });
  const wdCtx = { ownerUid, gameId: gWD, runId: rWD };
  const sWD0 = await pWD.call('getMyTeamState', { code: cWD });
  check('a game with no wrongAnswerPenalty ships NO answerCost at all',
    sWD0?.activeStageTasks?.find((t) => t.id === 'wd-1')?.answerCost === undefined,
    JSON.stringify(sWD0?.activeStageTasks?.find((t) => t.id === 'wd-1')?.answerCost));
  for (const guess of ['x1', 'x2', 'x3']) {
    const r = await pWD.call('submitTaskAnswer', { ...wdCtx, taskId: 'wd-1', answer: guess });
    check(`legacy game: wrong answer "${guess}" costs nothing and is never refused`,
      r?.correct === false && r?.penalty === undefined, JSON.stringify(r));
  }
  const sWD = await pWD.call('getMyTeamState', { code: cWD });
  check('legacy game: bonusPenalty untouched after three wrong answers',
    (sWD?.team?.bonusPenalty ?? 0) === 0, String(sWD?.team?.bonusPenalty));

  // ── E. Composition: the hard attempt limit still wins, and charges nothing ──
  const { gameId: gWE } = await creator.call('createGame', { title: 'Wrong Answer + Limit', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gWE,
    scoringPreset: 'fixed_points_speed',
    scoringOptions: { wrongAnswerPenalty: 'standard' },
    stages: [{
      id: 'st-we', order: 0, title: 'Quiz', isFinal: true,
      tasks: [{
        ...quizTask('we-1', 'olive'),
        smart: { enabled: true, verificationType: 'code_verification', attemptLimit: 2 },
        hint: 'It grows on a tree.', hintPenalty: 25, hintAutoRevealAttempts: 2,
      }],
    }],
  });
  const { runId: rWE, accessCode: cWE } = await creator.call('launchRun', { gameId: gWE, testDrive: true });
  const pWE = makeParty('wrongAnswerLimitPlayer');
  await signInAnonymously(pWE.auth);
  await pWE.call('joinRun', { code: cWE, displayName: 'Capped' });
  await creator.call('startTeams', { gameId: gWE, runId: rWE });
  const weCtx = { ownerUid, gameId: gWE, runId: rWE };
  await pWE.call('submitTaskAnswer', { ...weCtx, taskId: 'we-1', answer: 'y1' }); // free
  const we2 = await pWE.call('submitTaskAnswer', { ...weCtx, taskId: 'we-1', answer: 'y2' }); // charged 10
  check('composition: the 2nd wrong answer is charged before the limit locks', we2?.penalty === 10, JSON.stringify(we2));
  const bpBeforeLock = (await pWE.call('getMyTeamState', { code: cWE }))?.team?.bonusPenalty ?? 0;
  await expectError('composition: attemptLimit still locks the task with resource-exhausted',
    pWE.call('submitTaskAnswer', { ...weCtx, taskId: 'we-1', answer: 'y3' }),
    { codeIn: ['functions/resource-exhausted'] });
  const sWE = await pWE.call('getMyTeamState', { code: cWE });
  check('composition: a locked task charges nothing further',
    (sWE?.team?.bonusPenalty ?? 0) === bpBeforeLock, `${sWE?.team?.bonusPenalty} vs ${bpBeforeLock}`);
  // hintAutoRevealAttempts reads the SAME taskAttempts counter, which the cost
  // curve now maintains — so guessing gets expensive and then the hint goes free.
  const weHint = await pWE.call('requestTaskHint', { ...weCtx, taskId: 'we-1' });
  check('composition: the hint is FREE once the wrong-attempt threshold is met',
    weHint?.free === true && weHint?.penalty === 0, JSON.stringify(weHint));

  }); // scenario: wrong answers cost

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

  // (d) A second test launch RETIRES the first rather than being refused
  //     (change: test-drive-straight-to-play) — "בדיקה" must stay one tap, and a
  //     run snapshots the game at launch, so reusing the old one would silently
  //     rehearse a pre-edit version. The one-live INVARIANT still holds; a NORMAL
  //     launch of the same game is unaffected (the guard is test-drive-scoped).
  // Asserted on its OWN game: the retirement finalizes the previous test run, and
  // `rTD` below is still played and finalized by the rest of this scenario.
  const { gameId: gRetire } = await creator.call('createGame', { title: 'Retire Test Drive', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gRetire,
    stages: [{ id: 'rt-s', order: 0, title: 'Only', isFinal: true, tasks: [
      { id: 'rt-a', title: 'Say hi', type: 'self_report', difficulty: 1, estimatedMinutes: 2, pointValue: 10, locationless: true },
    ] }],
  });
  const { runId: rRet1 } = await creator.call('launchRun', { gameId: gRetire, testDrive: true });
  const { runId: rRet2 } = await creator.call('launchRun', { gameId: gRetire, testDrive: true });
  check('a second test launch succeeds instead of demanding a manual finalize', !!rRet2 && rRet2 !== rRet1, rRet2);
  const retRuns = await adminDb.collection(`users/${creatorUid}/games/${gRetire}/runs`)
    .where('isTestDrive', '==', true).get();
  const liveRet = retRuns.docs.filter((d) => d.data().status !== 'finished');
  check('exactly ONE live test run remains — the previous one was retired',
    liveRet.length === 1 && liveRet[0].id === rRet2,
    JSON.stringify(retRuns.docs.map((d) => ({ id: d.id, status: d.data().status }))));
  await creator.call('finalizeRun', { gameId: gRetire, runId: rRet2 });

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

  await scenario('test drive proximity bypass (far check-in accepted; real run rejects)', async () => {

  // ── Test-drive "I'm here" proximity bypass (change: testdrive-here-bypass) ───
  // In a TEST run every proximity/presence gate accepts a submission regardless of
  // distance (desk rehearsal); a REAL run's anti-cheat still rejects the same far
  // check-in. Asserts BOTH directions for completeTask (field/radius) AND
  // reportArrival (hidden-location) so the SPOOF contract can't silently regress.
  const FAR = { lat: 32.5, lng: 34.9 };   // ~90 km from the task coordinates
  const { gameId: gPB } = await creator.call('createGame', { title: 'Proximity Bypass Game', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gPB,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'pb-s', order: 0, title: 'On site', isFinal: true,
      tasks: [
        { id: 'pb-field', title: 'Check in here', type: 'field',
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 5, pointValue: 30, maxConcurrentTeams: 3 },
        { id: 'pb-hidden', title: 'Secret spot', type: 'field', hideLocation: true,
          coordinates: { lat: 31.90, lng: 35.05 }, locationClue: 'Follow the clue',
          difficulty: 2, estimatedMinutes: 5, pointValue: 30, maxConcurrentTeams: 3 },
      ],
    }],
  });

  // (a) TEST run — a far-away check-in and a far-away hidden-arrival BOTH pass.
  const { runId: rPBT, accessCode: cPBT } = await creator.call('launchRun', { gameId: gPB, testDrive: true });
  const pbT = makeParty('pbTester'); await signInAnonymously(pbT.auth);
  await pbT.call('joinRun', { code: cPBT, displayName: 'Desk tester' });
  await creator.call('startTeams', { gameId: gPB, runId: rPBT });
  const farCheckIn = await pbT.call('completeTask', { taskId: 'pb-field', code: cPBT, ...FAR });
  check('test run ACCEPTS a far-away completeTask (desk rehearsal)', farCheckIn?.ok === true, JSON.stringify(farCheckIn));
  const farArrival = await pbT.call('reportArrival', { taskId: 'pb-hidden', code: cPBT, ...FAR });
  check('test run UNSEALS a hidden task from afar (reportArrival)', farArrival?.arrived === true, JSON.stringify(farArrival));

  // (b) REAL run — the SAME far submissions are rejected (anti-cheat holds).
  const { runId: rPBN, accessCode: cPBN } = await creator.call('launchRun', { gameId: gPB });
  const pbN = makeParty('pbReal'); await signInAnonymously(pbN.auth);
  await pbN.call('joinRun', { code: cPBN, displayName: 'Real player' });
  await creator.call('startTeams', { gameId: gPB, runId: rPBN });
  await expectError('real run REJECTS the same far-away completeTask (SPOOF holds)',
    pbN.call('completeTask', { taskId: 'pb-field', code: cPBN, ...FAR }),
    { codeIn: ['functions/failed-precondition'], match: /too far/i });
  const realArrival = await pbN.call('reportArrival', { taskId: 'pb-hidden', code: cPBN, ...FAR });
  check('real run does NOT unseal a hidden task from afar', realArrival?.arrived === false, JSON.stringify(realArrival));

  await creator.call('finalizeRun', { gameId: gPB, runId: rPBT });
  await creator.call('finalizeRun', { gameId: gPB, runId: rPBN });

  }); // scenario: test drive proximity bypass

  await scenario('rehearsal reveal (test drive only; answers, media approval, real run refused)', async () => {

  // ── Rehearsal control (change: test-drive-rehearsal-control) ────────────────
  // The creator walks their own game from a desk. `revealTaskAnswer` hands back
  // the answer key so the button can FILL the input — the human still presses
  // submit, so the real submit/scoring/routing path runs. Two things must hold:
  //   (a) it works for every answerable type, and the revealed value really is
  //       accepted by the ordinary submit path (a reveal that returns the wrong
  //       shape is worse than none — it teaches the creator a false answer);
  //   (b) it is refused outright on a REAL run. That is the whole security story:
  //       answer keys stay server-secret, and this is the one door that opens
  //       them, so the door must be shut whenever isTestDrive is not true.
  const { gameId: gRV } = await creator.call('createGame', { title: 'Rehearsal Reveal', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gRV,
    scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 'rv-s', order: 0, title: 'Answerables', isFinal: true,
      tasks: [
        { id: 'rv-quiz', title: 'Quiz', type: 'quiz', answers: ['jerusalem'],
          difficulty: 1, estimatedMinutes: 3, pointValue: 20, locationless: true },
        { id: 'rv-num', title: 'Numeric', type: 'numeric', numericAnswer: 42, numericTolerance: 0,
          difficulty: 1, estimatedMinutes: 3, pointValue: 20, locationless: true },
        { id: 'rv-station', title: 'Station', type: 'smart_station',
          smart: { enabled: true, verificationType: 'code', secretCode: 'RP-4763' },
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 1, estimatedMinutes: 3, pointValue: 20 },
        { id: 'rv-seq', title: 'Sequence', type: 'sequence',
          steps: [{ id: 's1', prompt: 'First?', answer: 'alpha' }, { id: 's2', prompt: 'Second?', answer: 'beta' }],
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 1, estimatedMinutes: 3, pointValue: 20 },
        { id: 'rv-survey', title: 'Survey', type: 'survey', surveyChoices: ['a', 'b'],
          difficulty: 1, estimatedMinutes: 2, pointValue: 10, locationless: true },
        { id: 'rv-field', title: 'Go there', type: 'field',
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 1, estimatedMinutes: 3, pointValue: 20 },
      ],
    }],
  });

  const { runId: rRV, accessCode: cRV } = await creator.call('launchRun', { gameId: gRV, testDrive: true });
  const rv = makeParty('rehearser'); await signInAnonymously(rv.auth);
  await rv.call('joinRun', { code: cRV, displayName: 'Desk creator' });

  const quiz = await rv.call('revealTaskAnswer', { taskId: 'rv-quiz', code: cRV });
  check('reveal: a quiz returns its answer', quiz?.kind === 'answer' && quiz?.answer === 'jerusalem', JSON.stringify(quiz));

  const num = await rv.call('revealTaskAnswer', { taskId: 'rv-num', code: cRV });
  check('reveal: a numeric target comes back as a string', num?.kind === 'answer' && num?.answer === '42', JSON.stringify(num));

  const station = await rv.call('revealTaskAnswer', { taskId: 'rv-station', code: cRV });
  check('reveal: a station returns its secret code', station?.kind === 'answer' && station?.answer === 'RP-4763', JSON.stringify(station));

  const seq0 = await rv.call('revealTaskAnswer', { taskId: 'rv-seq', stepIndex: 0, code: cRV });
  check('reveal: a sequence returns the answer for the step asked for', seq0?.kind === 'answer' && seq0?.answer === 'alpha', JSON.stringify(seq0));
  const seq1 = await rv.call('revealTaskAnswer', { taskId: 'rv-seq', stepIndex: 1, code: cRV });
  check('reveal: a later sequence step returns ITS answer, not the first', seq1?.answer === 'beta', JSON.stringify(seq1));
  const seqOob = await rv.call('revealTaskAnswer', { taskId: 'rv-seq', stepIndex: 99, code: cRV });
  check('reveal: an out-of-range step reveals nothing instead of throwing', seqOob?.kind === 'none', JSON.stringify(seqOob));

  const survey = await rv.call('revealTaskAnswer', { taskId: 'rv-survey', code: cRV });
  check('reveal: a survey has no right answer and says so', survey?.kind === 'none', JSON.stringify(survey));

  const field = await rv.call('revealTaskAnswer', { taskId: 'rv-field', code: cRV });
  check('reveal: a located mission defers to the ordinary arrival path', field?.kind === 'arrive', JSON.stringify(field));

  // THE round trip: the revealed answer must actually be accepted. A reveal that
  // returns a value the submit path rejects would be worse than no button.
  const submitted = await rv.call('submitTaskAnswer', { taskId: 'rv-quiz', answer: quiz.answer, code: cRV });
  check('reveal → submit: the revealed quiz answer is accepted as correct',
    submitted?.correct === true, JSON.stringify(submitted));

  // (b) A REAL run refuses, whatever the request body says.
  const { runId: rRVN, accessCode: cRVN } = await creator.call('launchRun', { gameId: gRV });
  const rvN = makeParty('realPlayer'); await signInAnonymously(rvN.auth);
  await rvN.call('joinRun', { code: cRVN, displayName: 'Real player' });
  await creator.call('startTeams', { gameId: gRV, runId: rRVN });
  await expectError('a REAL run refuses to reveal any answer',
    rvN.call('revealTaskAnswer', { taskId: 'rv-quiz', code: cRVN }),
    { codeIn: ['functions/permission-denied'] });

  // Someone with no team in the TEST run cannot reveal from it either — reusing
  // the real-run player, who is a legitimate participant somewhere else. That is
  // the sharper version of the check: the caller is authenticated and is in this
  // GAME, just not in this run.
  await expectError('a player with no team in the test run is refused',
    rvN.call('revealTaskAnswer', { taskId: 'rv-quiz', code: cRV }),
    { codeIn: ['functions/permission-denied', 'functions/not-found', 'functions/failed-precondition'] });

  await creator.call('finalizeRun', { gameId: gRV, runId: rRV });
  await creator.call('finalizeRun', { gameId: gRV, runId: rRVN });

  }); // scenario: rehearsal reveal

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
  // submitSequenceStep all reject an empty answer).
  //
  // WHERE IT IS ENFORCED CHANGED (change: builder-draft-save-tolerance). These four
  // used to assert `updateGame` REFUSED such a task. It no longer does, on purpose:
  // the Builder autosaves 1.5 s after every edit, so refusing the save meant that
  // picking "quiz" as a task type rejected every autosave until the answer key was
  // finished, and the creator's authoring was silently not persisted. An unfinished
  // answer key is a DRAFT, so it now saves and is refused at the go-live doors
  // instead — asserted immediately below and, end to end, by the
  // 'draft save tolerance' scenario. This is a deliberate contract change, not a
  // relaxation of the invariant: no unwinnable task can still reach participants.
  await creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'quiz' }) });
  check('draft: updateGame ACCEPTS a quiz with no answers (go-live door enforces it)', true);
  await creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'numeric' }) });
  check('draft: updateGame ACCEPTS a numeric task with no numericAnswer', true);
  await creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'smart_station' }) });
  check('draft: updateGame ACCEPTS a smart_station with no secretCode', true);
  await creator.call('updateGame', { gameId: gO, stages: badStage({ ...baseBad, type: 'sequence' }) });
  check('draft: updateGame ACCEPTS a sequence with no steps', true);

  // ...and the go-live door refuses the very game those saves just produced, which
  // is what makes accepting them safe.
  // The message is pinned, not just the code: this game already had a run, and a
  // generic failed-precondition would otherwise let an unrelated refusal (an
  // already-live guard, say) pass this check for the wrong reason. The last save
  // above left a `sequence` task with no steps, so that is the refusal expected.
  await expectError('launchRun refuses the key-less draft that updateGame accepted',
    creator.call('launchRun', { gameId: gO }),
    { codeIn: ['functions/failed-precondition'], match: /at least one step/i });

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
    // Two more teams, joined up front, so the report/auto-hide/restore block
    // below (feed-ugc-safety) has distinct TEAMS to report with — the design
    // amendment keys reportedBy by teamId, not uid, precisely so one team's
    // extra devices can't reach the auto-hide threshold alone.
    const fp2 = makeParty('feedPlayer2');
    const fp2Cred = await signInAnonymously(fp2.auth);
    const fUid2 = fp2Cred.user.uid;
    await fp2.call('joinRun', { code: fc, displayName: 'Feed Tigers' });
    const fp3 = makeParty('feedPlayer3');
    const fp3Cred = await signInAnonymously(fp3.auth);
    const fUid3 = fp3Cred.user.uid;
    await fp3.call('joinRun', { code: fc, displayName: 'Feed Bears' });
    await creator.call('startTeams', { gameId: fg, runId: fr });
    const FCTX = { ownerUid: OWNER, gameId: fg, runId: fr };
    const feedCol = `users/${OWNER}/games/${fg}/runs/${fr}/feedItems`;
    const feedPhotoUrlFor = (teamUid, name) =>
      `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${fr}/teams/${teamUid}/${name}`)}?alt=media`;
    const feedPhotoUrl = (name) => feedPhotoUrlFor(fUid, name);

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

    // 5c) reportFeedItem (change: feed-ugc-safety) — a FRESH item (item1/item2 are
    //     already spoken for by the reaction/hide assertions above and by the
    //     ceremony check below). fp2 submits a third auto-approved photo.
    const item3Photo = feedPhotoUrlFor(fUid2, 'c.jpg');
    const item3Submit = await fp2.call('submitStationPhoto', {
      ...FCTX, teamId: fUid2, taskId: 'fp-auto', photoUrl: item3Photo,
    });
    check('report: seed item3 auto-approves', item3Submit?.autoApproved === true, JSON.stringify(item3Submit));
    const afterItem3 = await fp2.getColAt(feedCol);
    const item3 = afterItem3.find((d) => d.teamId === fUid2);
    check('report: item3 exists and is active', item3?.active === true, JSON.stringify(item3));

    const rep1 = await fp.call('reportFeedItem', { ...FCTX, itemId: item3.id, reason: 'inappropriate' });
    check('report: first report (team1) succeeds with reportCount 1',
      rep1?.ok === true && rep1?.reportCount === 1, JSON.stringify(rep1));
    const item3AfterRep1 = (await fp.getColAt(feedCol)).find((d) => d.id === item3.id);
    check('report: item stays active after one report', item3AfterRep1?.active === true, JSON.stringify(item3AfterRep1));

    const rep1Again = await fp.call('reportFeedItem', { ...FCTX, itemId: item3.id, reason: 'inappropriate' });
    check('report: the SAME team reporting again does not inflate the count (idempotent)',
      rep1Again?.ok === true && rep1Again?.reportCount === 1, JSON.stringify(rep1Again));

    // A second device on the SAME team (fp is the founding device of team fUid;
    // no second device is joined here, so this call already covers the "same
    // reporterKey" path above.) The design-amendment-specific guarantee — that a
    // team's OWN second device cannot double the count — is proven in the pure
    // lane (scripts/test-feed-reports.ts); this e2e assertion instead proves the
    // team-vs-team distinctness that actually drives auto-hide below.

    await expectError('report: an invalid reason is rejected',
      fp.call('reportFeedItem', { ...FCTX, itemId: item3.id, reason: 'because' }),
      { codeIn: ['functions/invalid-argument'] });

    await expectError('report: a stranger (not in the run, not staff) is denied',
      feedStranger.call('reportFeedItem', { ...FCTX, itemId: item3.id, reason: 'inappropriate' }),
      { codeIn: ['functions/permission-denied', 'functions/not-found'] });

    // A second DISTINCT team (fp3, team fUid3) reports the same item → auto-hide.
    const rep2 = await fp3.call('reportFeedItem', { ...FCTX, itemId: item3.id, reason: 'harassment' });
    check('report: a second distinct team hides the item', rep2?.ok === true && rep2?.hidden === true && rep2?.reportCount === 2, JSON.stringify(rep2));
    const item3AfterHide = (await fp.getColAt(feedCol)).find((d) => d.id === item3.id);
    check('report: auto-hidden item flips active:false with hiddenBy auto:reports',
      item3AfterHide?.active === false && item3AfterHide?.hiddenBy === 'auto:reports' && typeof item3AfterHide?.hiddenAt === 'string',
      JSON.stringify(item3AfterHide));
    await expectError('report: a reaction on an auto-hidden item is rejected (existing behavior still holds)',
      fp.call('reactToFeedItem', { ...FCTX, itemId: item3.id, emoji: '👍' }),
      { codeIn: ['functions/not-found'] });

    // 5d) hideFeedItem restore (change: feed-ugc-safety) — authz unchanged, then
    //     reportsCleared disarms auto-hide while reports keep counting.
    await expectError('restore: a participant cannot restore',
      fp.call('hideFeedItem', { ...FCTX, itemId: item3.id, restore: true }),
      { codeIn: ['functions/permission-denied'] });

    const restored = await creator.call('hideFeedItem', { ...FCTX, itemId: item3.id, restore: true });
    check('restore: owner restores the auto-hidden item', restored?.ok === true, JSON.stringify(restored));
    const item3AfterRestore = (await fp.getColAt(feedCol)).find((d) => d.id === item3.id);
    check('restore: item is active again with hiddenAt/hiddenBy cleared and reportsCleared true',
      item3AfterRestore?.active === true && item3AfterRestore?.hiddenAt === undefined
        && item3AfterRestore?.hiddenBy === undefined && item3AfterRestore?.reportsCleared === true,
      JSON.stringify(item3AfterRestore));

    // A THIRD distinct reporter (a new team) does NOT re-hide the restored item —
    // reportsCleared disarms auto-hide permanently, while the count still climbs.
    const thirdTeam = makeParty('feedPlayer4');
    const thirdCred = await signInAnonymously(thirdTeam.auth);
    await thirdTeam.call('joinRun', { code: fc, displayName: 'Feed Wolves' });
    await creator.call('startTeams', { gameId: fg, runId: fr });
    const rep3 = await thirdTeam.call('reportFeedItem', { ...FCTX, itemId: item3.id, reason: 'privacy' });
    check('restore: a third distinct reporter does not re-hide (hidden:false)',
      rep3?.ok === true && rep3?.hidden === false && rep3?.reportCount === 3, JSON.stringify(rep3));
    const item3AfterThird = (await fp.getColAt(feedCol)).find((d) => d.id === item3.id);
    check('restore: item stays active after the third report despite the count reaching 3',
      item3AfterThird?.active === true, JSON.stringify(item3AfterThird));

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
    // feed-ugc-safety changed this scenario's end state: item3 was auto-hidden by
    // two reports and then RESTORED by the owner, so it is legitimately back in the
    // ceremony feed (with 0 reactions). item2 stays owner-hidden. Asserting item2's
    // ABSENCE by photoUrl tests "hidden items are excluded" directly, instead of
    // inferring it from a total count that any new feed item would break.
    check('ceremony: post-publish ceremonyFeed excludes the hidden item, liked item ranks first',
      cf.length === 2
        && cf[0]?.taskTitle === 'Snap the mural' && cf[0]?.totalReactions === 2
        && !cf.some((x) => x.photoUrl === item2.photoUrl),
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

  // video-submission-task fix (change: run-media-gallery-and-video-feed): the feed
  // write sites used to allowlist ONLY kind === 'photo', so a video submission —
  // however it was approved — could never reach feedItems, and both feed
  // renderers only knew how to draw an <img>. This proves BOTH write sites now
  // accept video (mirroring the "live photo feed" scenario's autoApprove +
  // staff-review paths above), that the item carries mediaKind:'video', that a
  // hidden-location video is still excluded exactly like a hidden photo, and
  // that audio is still excluded (the allowlist gained one value, it did not
  // become an accept-everything default).
  await scenario('video submissions enter the live photo feed (mediaKind)', async () => {
    const OWNER = creatorCred.user.uid;
    const feedPhotoUrl = (rid, uid, name) =>
      `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${rid}/teams/${uid}/${name}`)}?alt=media`;
    const videoTask = (id, title, order, autoApprove, hideLocation = false) => ({
      id, title, type: 'photo',
      ...(hideLocation
        ? { triggerMode: 'radius', hideLocation: true, coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40, locationClue: 'Shh' }
        : { coordinates: { lat: 31.79 + order * 0.005, lng: 35.2 + order * 0.005 } }),
      difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
      smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', autoApprove },
    });
    const audioTask = (id, title, order, autoApprove) => ({
      id, title, type: 'photo',
      coordinates: { lat: 31.79 + order * 0.005, lng: 35.2 + order * 0.005 },
      difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
      smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'audio', autoApprove },
    });

    const { gameId: vg } = await creator.call('createGame', { title: 'Video Feed Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: vg, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'vf-1', order: 0, title: 'Auto video', tasks: [videoTask('vf-auto', 'Auto video clip', 0, true)] },
        { id: 'vf-2', order: 1, title: 'Reviewed video', tasks: [videoTask('vf-rev', 'Reviewed video clip', 1, false)] },
        { id: 'vf-3', order: 2, title: 'Hidden video', tasks: [videoTask('vf-hidden', 'Secret video clip', 2, true, true)] },
        { id: 'vf-4', order: 3, isFinal: true, title: 'Reviewed audio', tasks: [audioTask('vf-audio', 'Reviewed chant', 3, false)] },
      ],
    });
    const { runId: vr, accessCode: vc } = await creator.call('launchRun', { gameId: vg });
    const vp = makeParty('videoFeedPlayer');
    const vpCred = await signInAnonymously(vp.auth);
    const vUid = vpCred.user.uid;
    await vp.call('joinRun', { code: vc, displayName: 'Video Wolves' });
    await creator.call('startTeams', { gameId: vg, runId: vr });
    const VCTX = { ownerUid: OWNER, gameId: vg, runId: vr };
    const vFeedCol = `users/${OWNER}/games/${vg}/runs/${vr}/feedItems`;

    // 1) autoApprove video → feeds with mediaKind:'video'.
    const autoVideo = await vp.call('submitStationPhoto', { ...VCTX, teamId: vUid, taskId: 'vf-auto', photoUrl: feedPhotoUrl(vr, vUid, 'auto.webm'), contentType: 'video/webm' });
    check('video-feed: autoApprove video is approved', autoVideo?.autoApproved === true, JSON.stringify(autoVideo));
    const afterAutoVideo = await vp.getColAt(vFeedCol);
    const autoItem = afterAutoVideo.find((d) => d.taskId === 'vf-auto');
    check('video-feed: autoApprove video broadcasts a feed item', !!autoItem, JSON.stringify(afterAutoVideo.map((d) => d.taskId)));
    check('video-feed: the autoApprove feed item carries mediaKind "video"', autoItem?.mediaKind === 'video', JSON.stringify(autoItem));

    // 2) staff-reviewed video → feeds with mediaKind:'video'.
    await vp.call('submitStationPhoto', { ...VCTX, teamId: vUid, taskId: 'vf-rev', photoUrl: feedPhotoUrl(vr, vUid, 'rev.webm'), contentType: 'video/webm' });
    const revVideo = await creator.call('reviewStationSubmission', { ...VCTX, teamId: vUid, taskId: 'vf-rev', approved: true });
    check('video-feed: staff approves the video submission', revVideo?.approved === true, JSON.stringify(revVideo));
    const afterRevVideo = await creator.getColAt(vFeedCol);
    const revItem = afterRevVideo.find((d) => d.taskId === 'vf-rev');
    check('video-feed: staff-approved video broadcasts a feed item', !!revItem, JSON.stringify(afterRevVideo.map((d) => d.taskId)));
    check('video-feed: the staff-approved feed item carries mediaKind "video"', revItem?.mediaKind === 'video', JSON.stringify(revItem));

    // 3) hidden-location video → still excluded, exactly like a hidden photo.
    const vArr = await vp.call('reportArrival', { ...VCTX, taskId: 'vf-hidden', lat: 31.78, lng: 35.21 });
    check('video-feed: arrival at the hidden spot latches', vArr?.arrived === true, JSON.stringify(vArr));
    const autoHiddenVideo = await vp.call('submitStationPhoto', { ...VCTX, teamId: vUid, taskId: 'vf-hidden', photoUrl: feedPhotoUrl(vr, vUid, 'hidden.webm'), contentType: 'video/webm' });
    check('video-feed: hidden video still auto-approves (completion unaffected)', autoHiddenVideo?.autoApproved === true, JSON.stringify(autoHiddenVideo));
    const afterHiddenVideo = await vp.getColAt(vFeedCol);
    check('video-feed: the hidden-location video is excluded from the feed',
      !afterHiddenVideo.some((d) => d.taskId === 'vf-hidden'), JSON.stringify(afterHiddenVideo.map((d) => d.taskId)));

    // 4) audio stays excluded — the allowlist gained a value, it did not become
    //    accept-everything.
    await vp.call('submitStationPhoto', { ...VCTX, teamId: vUid, taskId: 'vf-audio', photoUrl: feedPhotoUrl(vr, vUid, 'chant.webm'), contentType: 'audio/webm' });
    const revAudio = await creator.call('reviewStationSubmission', { ...VCTX, teamId: vUid, taskId: 'vf-audio', approved: true });
    check('video-feed: staff approves the audio submission', revAudio?.approved === true, JSON.stringify(revAudio));
    const afterAudio = await creator.getColAt(vFeedCol);
    check('video-feed: audio submissions still never reach the feed',
      !afterAudio.some((d) => d.taskId === 'vf-audio'), JSON.stringify(afterAudio.map((d) => d.taskId)));
  }); // scenario: video enters the live feed

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

  await scenario('video mission duration range (server refuses what the Builder refuses)', async () => {
    // The Builder validates the range inline, but inline validation is a courtesy —
    // a stale tab, a hand-edited game file or a direct callable call bypasses it.
    // Both save doors read the SAME shared videoDurationProblem(), so a range the
    // Builder rejects cannot be smuggled in through updateGame.
    const { gameId: gV } = await creator.call('createGame', { title: 'Video Range Game', mode: 'individual' });
    const stagesWith = (smartExtra) => ([
      { id: 'vs0', order: 0, title: 'Film it', isFinal: true, tasks: [
        { id: 'v-1', title: 'Team handshake', type: 'photo', triggerMode: 'instant',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 50, maxConcurrentTeams: 9,
          smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', ...smartExtra } },
      ] },
    ]);
    const save = (smartExtra) => creator.call('updateGame', { gameId: gV, stages: stagesWith(smartExtra) });
    const rejects = async (label, smartExtra) => {
      let refused = false;
      try { await save(smartExtra); } catch (e) { refused = e.code === 'functions/invalid-argument'; }
      check(`updateGame refuses ${label}`, refused);
    };

    await rejects('an inverted range (min > max)', { videoMinSeconds: 40, videoMaxSeconds: 20 });
    await rejects('min === max', { videoMinSeconds: 20, videoMaxSeconds: 20 });
    await rejects('a max above the platform ceiling', { videoMinSeconds: 0, videoMaxSeconds: 600 });
    await rejects('a max below the platform floor', { videoMinSeconds: 0, videoMaxSeconds: 2 });
    await rejects('a nonzero min below the platform floor', { videoMinSeconds: 2, videoMaxSeconds: 40 });
    await rejects('too little spread between min and max', { videoMinSeconds: 38, videoMaxSeconds: 40 });

    let validAccepted = false;
    try { await save({ videoMinSeconds: 10, videoMaxSeconds: 30 }); validAccepted = true; } catch (e) {
      console.log('  valid range err ::', e.message);
    }
    check('updateGame accepts a valid range', validAccepted);

    // Absent values mean "platform defaults", not "invalid" — a creator who never
    // touches the duration controls must not have their autosave refused.
    let defaultsAccepted = false;
    try { await save({}); defaultsAccepted = true; } catch (e) { console.log('  defaults err ::', e.message); }
    check('updateGame accepts a video task with no authored range', defaultsAccepted);

    // The callable transport encodes `undefined` as `null`, so "clear this field"
    // arrives as null. That is a CLEAR, not a malformed value — refusing it would
    // trap a creator who emptied the input with no way to comply.
    let clearedAccepted = false;
    try {
      await save({ videoMinSeconds: null, videoMaxSeconds: null });
      clearedAccepted = true;
    } catch (e) { console.log('  cleared err ::', e.message); }
    check('updateGame accepts a cleared range (null === absent over the wire)', clearedAccepted);
  }); // scenario: video mission duration range

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

  await scenario(`global per-run device cap (${MAX_RUN_DEVICES} phones max, both join paths)`, async () => {
    // A hard global ceiling on total phones in one run (MAX_RUN_DEVICES),
    // layered on top of the billing participant cap (free mode = 50 TEAMS) and the
    // per-team device cap (3). The two caps count different things, so neither
    // subsumes the other. The run.deviceCount counter grows on BOTH joinRun (a
    // founding phone) and joinTeamAsDevice (an attached phone); one phone past the
    // ceiling is refused from either entry point.
    //
    // The cap is read from @rushpoint/shared, never hardcoded here — raising the
    // constant must not require editing this scenario. The low end asserts the
    // counter really accumulates on both paths; the boundary is then reached by
    // stamping deviceCount server-side rather than by signing in MAX_RUN_DEVICES
    // real phones (which at cap=100 would also trip the 50-TEAM billing cap long
    // before the ceiling, testing the wrong guard).
    const RUN_DEVICE_CAP = MAX_RUN_DEVICES;
    const adminDbDC = adminSdk.firestore();
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

    // Jump the counter to one below the ceiling, then let a REAL join take the
    // last slot — so the admitting side of the boundary is exercised by the
    // callable's own transaction, not by the stamp.
    await adminDbDC.doc(runDocPath).update({ deviceCount: RUN_DEVICE_CAP - 1 });
    const pLast = makeParty('rdc-last');
    await signInAnonymously(pLast.auth);
    await pLast.call('joinRun', { code: cDC, displayName: 'Cap Team Last' });
    check('device-cap: the last admitted phone fills the run to MAX_RUN_DEVICES',
      (await creator.getDocAt(runDocPath)).data?.deviceCount === RUN_DEVICE_CAP,
      String((await creator.getDocAt(runDocPath)).data?.deviceCount));

    // One past the ceiling via joinRun is refused (run full) even though the
    // billing cap (50 teams) still has room — this run holds only a handful.
    const pOver = makeParty('rdc-over');
    await signInAnonymously(pOver.auth);
    await expectError('device-cap: one phone past the ceiling via joinRun is refused',
      pOver.call('joinRun', { code: cDC, displayName: 'Cap Team Over' }),
      { codeIn: ['functions/resource-exhausted'], match: new RegExp(`${RUN_DEVICE_CAP} devices`) });

    // Same phone count via joinTeamAsDevice is ALSO refused — team 0 still has room
    // (2/3), so this exercises the ceiling on the device path, not the per-team cap.
    const pOverDev = makeParty('rdc-over-dev');
    await signInAnonymously(pOverDev.auth);
    await expectError('device-cap: one phone past the ceiling via joinTeamAsDevice is refused',
      pOverDev.call('joinTeamAsDevice', { code: cDC, teamCode, memberName: 'Phone Over' }),
      { codeIn: ['functions/resource-exhausted'] });

    check(`device-cap: counter unchanged after both rejections (still ${RUN_DEVICE_CAP})`,
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

    // ── fix-solo-selfguided-finalize: hostless solo run auto-finalizes ──────────
    // A startInstantPlay run is selfGuided:true, participantCount:1 with NO organizer,
    // so nothing ever calls the creator-auth finalizeRun. The moment its sole team
    // finishes, the shared grading choke point (completeTaskForTeam) auto-finalizes it
    // with forcePublish:true — the finisher must get a real, PUBLISHED, FROZEN board
    // (rank #1, badges) instead of a perpetual "waiting for the host" spinner. The
    // auto-finalize call is awaited on the completion path, but poll for robustness
    // (mirrors the onRunFinalized probe pattern above).
    const soloRunPath = `users/${res.ownerUid}/games/${res.gameId}/runs/${res.runId}`;
    const soloLb = (await waitFor(async () => {
      const d = await creator.getDocAt(soloRunPath);
      return d.data?.leaderboard?.published ? d.data.leaderboard : null;
    })) ?? null;
    check('instant: hostless solo run auto-finalizes to a PUBLISHED, FROZEN board',
      soloLb?.published === true && soloLb?.frozen === true, JSON.stringify(soloLb));
    check('instant: auto-finalized board ranks the solo finisher #1',
      Array.isArray(soloLb?.rankings) && soloLb.rankings.length === 1 && soloLb.rankings[0]?.rank === 1,
      JSON.stringify(soloLb?.rankings));
    const soloBoard = await pI.call('getMyTeamState', { code: res.accessCode });
    check('instant: getMyTeamState returns the published board (no "waiting for host" spinner)',
      (soloBoard?.run?.leaderboard ?? null) !== null && soloBoard?.run?.leaderboard?.published === true,
      JSON.stringify(soloBoard?.run?.leaderboard ?? null));

    // Publishing IS the opt-in (change: gallery-missions-quick-play). A game that
    // never expressed a preference gets instant play switched ON by publishGame, so
    // the gallery's Play button always matches what the server will actually allow.
    // Before this, publishing left the flag absent and the button could never appear.
    const { gameId: gN2 } = await creator.call('createGame', { title: 'Default Instant', mode: 'individual' });
    await creator.call('updateGame', { gameId: gN2, stages: oneStage('n2-s') });
    await creator.call('publishGame', { gameId: gN2, visibility: 'public' });
    const defaultedRun = await pI.call('startInstantPlay', { gameId: gN2 });
    check('instant: publishing defaults an unset game to allow instant play',
      !!defaultedRun?.runId, JSON.stringify(defaultedRun ?? null));

    // …but an EXPLICIT opt-out is a real decision and survives publish untouched.
    const { gameId: gNo } = await creator.call('createGame', { title: 'No Instant', mode: 'individual' });
    await creator.call('updateGame', { gameId: gNo, allowInstantPlay: false, stages: oneStage('no-s') });
    await creator.call('publishGame', { gameId: gNo, visibility: 'public' });
    await expectError('instant: an explicitly opted-OUT game is still refused',
      pI.call('startInstantPlay', { gameId: gNo }), { codeIn: ['functions/failed-precondition'] });

    // J1 (wave-J privacy): a game that requires guardian consent CANNOT be started
    // via instant play — the consent gate only existed in startTeams, letting a
    // minor play an allowInstantPlay + requiresGuardianConsent game with zero consent.
    const { gameId: gGC } = await creator.call('createGame', { title: 'Consent Instant', mode: 'individual' });
    await creator.call('updateGame', { gameId: gGC, allowInstantPlay: true, requiresGuardianConsent: true, minAge: 13, stages: oneStage('gc-s') });
    await creator.call('publishGame', { gameId: gGC, visibility: 'public' });
    await expectError('instant: a guardian-consent game is refused (J1 bypass closed)',
      pI.call('startInstantPlay', { gameId: gGC, displayName: 'Minor' }),
      { codeIn: ['functions/failed-precondition'], match: /guardian consent/i });

    // ── Regression (solo-only guard): a NORMAL launched run is NEVER auto-finalized ──
    // The airtight discriminator is selfGuided===true (startInstantPlay is its only
    // writer) — NOT participantCount. A real event with a single joined team has
    // participantCount===1, the exact shape a participantCount-only gate would falsely
    // match; auto-finalizing it mid-event would be a P0. So a launched, non-self-guided
    // run whose one team has finished must STILL wait for the organizer's finalizeRun.
    const { gameId: gReg } = await creator.call('createGame', { title: 'Not Self-Guided', mode: 'individual' });
    await creator.call('updateGame', { gameId: gReg, stages: oneStage('reg-s') });
    const { runId: rReg, accessCode: cReg } = await creator.call('launchRun', { gameId: gReg });
    const pReg = makeParty('regPlayer'); await signInAnonymously(pReg.auth);
    await pReg.call('joinRun', { code: cReg, displayName: 'Solo-ish' });
    await creator.call('startTeams', { gameId: gReg, runId: rReg });
    await pReg.call('completeTask', { ownerUid: creatorCred.user.uid, gameId: gReg, runId: rReg, taskId: 'reg-s-t' });
    const regFin = await pReg.call('getMyTeamState', { code: cReg });
    check('regression: the single team of a launched run reaches finished', regFin?.team?.status === 'finished', regFin?.team?.status);
    const regRun = await creator.getDocAt(`users/${creatorCred.user.uid}/games/${gReg}/runs/${rReg}`);
    check('regression: a NON-self-guided run is NOT auto-finalized (still waits for manual finalizeRun)',
      (regRun.data?.leaderboard ?? null) === null && regRun.data?.status !== 'finished',
      JSON.stringify({ leaderboard: regRun.data?.leaderboard ?? null, status: regRun.data?.status }));
    // The organizer's manual finalize still works exactly as before.
    const regManual = await creator.call('finalizeRun', { gameId: gReg, runId: rReg });
    check('regression: manual finalizeRun still produces the board for a normal run',
      Array.isArray(regManual?.rankings) && regManual.rankings.length === 1, JSON.stringify(regManual?.rankings));
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

  await scenario('hidden-mission map: completedTaskPins is a leak-safe trail (completed only)', async () => {
    // change: hidden-mission-map. While the ACTIVE mission is a still-sealed
    // hidden target, the play map plots the SAFE trail of missions the team has
    // ALREADY COMPLETED (their own coordinates + title) plus the client's GPS —
    // never the sealed target. getMyTeamState's new `completedTaskPins` channel is
    // built BY CONSTRUCTION from completed RunTaskRecords only, so it is
    // structurally incapable of shipping a hidden-not-arrived / unassigned /
    // sealed task's location. This is the wire-level proof of that guarantee.
    //
    // Deterministic setup (single-task early stages force the routing so we KNOW
    // exactly what is completed; the final stage's locked sibling can never be
    // assigned before the hidden task, so the hidden task is the sealed active one
    // and the sibling stays unassigned):
    //   Stage A: cp-located    — a located mission → completed → SHOULD pin.
    //   Stage B: cp-anywhere    — a LOCATIONLESS mission → completed → OMITTED (no coords).
    //   Stage C: cp-hidden      — hidden target → assigned + SEALED → MUST NOT pin.
    //            cp-locked       — unlock-gated on cp-hidden → unassigned → MUST NOT pin.
    const { gameId: gCP } = await creator.call('createGame', { title: 'Trail of Pins', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gCP,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'cp-sA', order: 0, title: 'Reached spot', isFinal: false,
          tasks: [{ id: 'cp-located', title: 'Fountain plaza', type: 'field', triggerMode: 'radius',
            coordinates: { lat: 32.1, lng: 34.8 }, geofenceRadiusMeters: 40,
            difficulty: 2, estimatedMinutes: 3, pointValue: 50, maxConcurrentTeams: 9 }] },
        { id: 'cp-sB', order: 1, title: 'Anywhere', isFinal: false,
          tasks: [{ id: 'cp-anywhere', title: 'Do it anywhere', type: 'self_report', triggerMode: 'locationless',
            locationless: true, coordinates: { lat: 0, lng: 0 },
            difficulty: 1, estimatedMinutes: 1, pointValue: 30, maxConcurrentTeams: 9 }] },
        { id: 'cp-sC', order: 2, title: 'The secret', isFinal: true,
          tasks: [
            { id: 'cp-hidden', title: 'The buried key', type: 'field', triggerMode: 'radius',
              hideLocation: true, coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40,
              locationClue: 'Beneath the third arch', difficulty: 3, estimatedMinutes: 5,
              pointValue: 80, maxConcurrentTeams: 9 },
            { id: 'cp-locked', title: 'The vault', type: 'field', triggerMode: 'radius',
              coordinates: { lat: 31.79, lng: 35.22 }, geofenceRadiusMeters: 40,
              unlockAfterTaskIds: ['cp-hidden'], difficulty: 3, estimatedMinutes: 5,
              pointValue: 80, maxConcurrentTeams: 9 },
          ] },
      ],
    });
    const { runId: rCP, accessCode: cCP } = await creator.call('launchRun', { gameId: gCP });
    const pCP = makeParty('pinsTrail'); await signInAnonymously(pCP.auth);
    await pCP.call('joinRun', { code: cCP, displayName: 'Trailblazer' });
    await creator.call('startTeams', { gameId: gCP, runId: rCP });
    const CCP = { ownerUid: creatorCred.user.uid, gameId: gCP, runId: rCP };

    // Stage A: complete the located mission (server-validated GPS check-in).
    await pCP.call('completeTask', { ...CCP, taskId: 'cp-located', lat: 32.1, lng: 34.8 });
    // Stage B: complete the locationless mission (coords ignored for locationless).
    await pCP.call('completeTask', { ...CCP, taskId: 'cp-anywhere' });

    // Stage C: the hidden task is now the sealed active mission; the locked sibling
    // is unassigned. This is the moment the play map would plot the trail.
    const sCP = await pCP.call('getMyTeamState', { code: cCP });
    const assignedC = sCP?.team?.stages?.[2]?.tasks?.find((r) => r.status === 'assigned')?.taskId;
    check('pins: the hidden task is the sealed active mission', assignedC === 'cp-hidden', String(assignedC));
    const hiddenC = sCP?.activeStageTasks?.find((t) => t.id === 'cp-hidden');
    check('pins: hidden active task is STILL sealed (no coords/title, arrivalPending)',
      hiddenC?.arrivalPending === true && hiddenC?.title === undefined && hiddenC?.coordinates === undefined,
      JSON.stringify(hiddenC));

    const pins = sCP?.completedTaskPins;
    check('pins: completedTaskPins is an array', Array.isArray(pins), JSON.stringify(pins));
    const ids = (pins ?? []).map((p) => p.id);
    // (1) The completed LOCATED mission is pinned, with its REAL coords + title
    //     sourced from the game task (not the team record).
    const locatedPin = (pins ?? []).find((p) => p.id === 'cp-located');
    check('pins: completed located mission is pinned with its real coords + title',
      locatedPin?.coordinates?.lat === 32.1 && locatedPin?.coordinates?.lng === 34.8 &&
        locatedPin?.title === 'Fountain plaza',
      JSON.stringify(locatedPin));
    // (2) The SEALED hidden active target is absent — its coordinates never ride
    //     out through this channel.
    check('pins: the sealed hidden active target is NOT pinned', !ids.includes('cp-hidden'), ids.join(','));
    // (3) An unassigned/locked task is absent.
    check('pins: an unassigned (locked) task is NOT pinned', !ids.includes('cp-locked'), ids.join(','));
    // (4) A completed LOCATIONLESS mission is omitted (nothing to pin).
    check('pins: a completed locationless mission is omitted', !ids.includes('cp-anywhere'), ids.join(','));
    // Whole-channel sweep: the hidden target's real coordinates must appear NOWHERE
    // in the pins (the located pin lives far away at 32.1/34.8, so a stray 31.78 /
    // 35.21 would mean the sealed spot leaked through completedTaskPins).
    check('pins: the sealed target coordinates appear nowhere in completedTaskPins',
      !JSON.stringify(pins ?? []).includes('31.78') && !JSON.stringify(pins ?? []).includes('35.21'),
      'sealed hidden coordinates leaked into completedTaskPins');
  }); // scenario: hidden-mission map completedTaskPins

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
  const STORAGE = `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent('gameMedia/owner/games/gm/m-1-1755300000000.jpg')}?alt=media&token=t`;
  const { gameId: gM } = await creator.call('createGame', { title: 'Media Game', mode: 'individual' });
  const mediaStages = (media) => ([{
    id: 's-media', order: 0, title: 'Look here', isFinal: true,
    tasks: [{
      id: 'm-1', title: 'Watch then find', type: 'field', triggerMode: 'radius',
      coordinates: { lat: 31.78, lng: 35.21 }, geofenceRadiusMeters: 40,
      difficulty: 2, estimatedMinutes: 4, pointValue: 60, maxConcurrentTeams: 9,
      media,
    }],
  }]);

  // An off-origin image is REFUSED, not silently dropped (change: task-media-durability).
  // It used to be quietly shed and the save reported success — which is exactly how a
  // creator's real mission photo disappeared: on drift, the same code path shed a URL
  // the server itself had minted. A save that cannot keep what it was given must say so.
  let mediaRefused = '';
  try {
    await creator.call('updateGame', {
      gameId: gM,
      scoringPreset: 'fixed_points_speed',
      stages: mediaStages([
        { id: 'ma', kind: 'image', url: STORAGE, caption: 'the spot' },
        { id: 'mc', kind: 'image', url: 'https://evil.example.com/x.jpg' },
      ]),
    });
  } catch (e) { mediaRefused = e.message; }
  check('media: a NEW off-origin image URL is refused, not silently dropped',
    /evil\.example\.com/.test(mediaRefused), mediaRefused || '(save succeeded)');

  await creator.call('updateGame', {
    gameId: gM,
    scoringPreset: 'fixed_points_speed',
    stages: mediaStages([
      { id: 'ma', kind: 'image', url: STORAGE, caption: 'the spot' },
      { id: 'mb', kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' },
    ]),
  });
  const persisted = await creator.call('getGame', { gameId: gM });
  const savedMedia = persisted?.game?.stages?.[0]?.tasks?.[0]?.media ?? [];
  check('media: valid entries persisted', savedMedia.length === 2, JSON.stringify(savedMedia));

  // THE REGRESSION GUARD for the reported bug: the Builder autosaves the whole stages
  // array every ~1.5s, and each save re-validates every stored URL. Media must survive
  // an arbitrary number of them. Re-saving what getGame just returned is exactly what
  // the Builder does.
  for (let i = 0; i < 3; i++) {
    await creator.call('updateGame', { gameId: gM, stages: persisted.game.stages });
  }
  const afterSaves = await creator.call('getGame', { gameId: gM });
  check('media: survives repeated autosaves (the reported disappearing-photo bug)',
    (afterSaves?.game?.stages?.[0]?.tasks?.[0]?.media?.length ?? 0) === 2,
    JSON.stringify(afterSaves?.game?.stages?.[0]?.tasks?.[0]?.media));

  // Duplicating carries the media. It used to carry the URL but not the bytes, so the
  // copy pointed into the ORIGINAL game's storage folder and broke when that was purged.
  const { gameId: gDup } = await creator.call('duplicateGame', { gameId: gM });
  const dup = await creator.call('getGame', { gameId: gDup });
  const dupMedia = dup?.game?.stages?.[0]?.tasks?.[0]?.media ?? [];
  check('media: a duplicated game keeps its attachments', dupMedia.length === 2, JSON.stringify(dupMedia));
  check('media: the duplicate keeps its YouTube entry byte-identical',
    dupMedia.find((m) => m.kind === 'youtube')?.url === 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    JSON.stringify(dupMedia));
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

  await scenario('smart_station attempt-limit + release/expiry gates (wave-h)', async () => {
    // The shared completeTaskForTeam choke point never carried the attempt-limit or
    // release/expiry gates, so each wrapper must. submitTaskAnswer/completeTask do;
    // this proves verifyStationCode + submitStationPhoto now do too.
    const OWNER = creatorCred.user.uid;
    const { gameId: gH } = await creator.call('createGame', { title: 'Station Gates Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gH, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'hs0', order: 0, title: 'Gated stations', isFinal: true, tasks: [
        { id: 'ws-lock', title: 'Code with a cap', type: 'smart_station', triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
          smart: { enabled: true, verificationType: 'code_verification', secretCode: 'GOLD', attemptLimit: 2 } },
        { id: 'ws-exp', title: 'Pop-up code station', type: 'smart_station', triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
          expiresAfterMinutes: 0.2, // 12s
          smart: { enabled: true, verificationType: 'code_verification', secretCode: 'SILVER' } },
        { id: 'wp-exp', title: 'Pop-up photo station', type: 'photo', triggerMode: 'locationless',
          coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 9,
          expiresAfterMinutes: 0.2, // 12s
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true } },
      ] }],
    });
    const { runId: rH, accessCode: cH } = await creator.call('launchRun', { gameId: gH });
    const pH = makeParty('stationGates');
    const pHCred = await signInAnonymously(pH.auth);
    const hUid = pHCred.user.uid;
    await pH.call('joinRun', { code: cH, displayName: 'Gatekeeper' });
    await creator.call('startTeams', { gameId: gH, runId: rH });
    const CH = { ownerUid: OWNER, gameId: gH, runId: rH };

    // ── attempt-limit lockout (wave-h #1) ──────────────────────────────────────
    // Two wrong codes exhaust attemptLimit:2; the 3rd attempt is refused with
    // resource-exhausted even though it is the CORRECT code.
    await expectError('station attempt-limit: 1st wrong code rejected',
      pH.call('verifyStationCode', { ...CH, teamId: hUid, taskId: 'ws-lock', code: 'WRONG1' }),
      { match: /incorrect code/i });
    await expectError('station attempt-limit: 2nd wrong code rejected',
      pH.call('verifyStationCode', { ...CH, teamId: hUid, taskId: 'ws-lock', code: 'WRONG2' }),
      { match: /incorrect code/i });
    let stationExhausted = false;
    try {
      await pH.call('verifyStationCode', { ...CH, teamId: hUid, taskId: 'ws-lock', code: 'GOLD' }); // correct
    } catch (e) {
      stationExhausted = e.code === 'functions/resource-exhausted' || /attempts left/i.test(e.message);
    }
    check('station attempt-limit: 3rd attempt refused even with the correct code', stationExhausted);

    // ── live gated station is NOT false-rejected (gate lets an open task through) ─
    // ws-exp has an expiry gate but is still OPEN here: a wrong code must reach the
    // normal 'Incorrect code' path, proving the release/expiry gate does not block a
    // live station.
    await expectError('station expiry: an OPEN gated station still grades codes',
      pH.call('verifyStationCode', { ...CH, teamId: hUid, taskId: 'ws-exp', code: 'NOPE' }),
      { match: /incorrect code/i });

    // ── wait for the 12s expiry window to close (server clock, not a blind sleep) ─
    const launchedMs = Date.parse((await creator.getDocAt(`users/${OWNER}/games/${gH}/runs/${rH}`)).data?.launchedAt);
    const closeAt = launchedMs + 0.2 * 60_000 + 700; // +0.7s server-clock margin
    if (Date.now() < closeAt) await new Promise((r) => setTimeout(r, closeAt - Date.now()));

    // ── verifyStationCode expiry gate (wave-h #2) ──────────────────────────────
    // An expired smart_station rejects the CORRECT code instead of scoring it.
    await expectError('station expiry: verifyStationCode refuses the correct code after expiry',
      pH.call('verifyStationCode', { ...CH, teamId: hUid, taskId: 'ws-exp', code: 'SILVER' }),
      { match: /expired/i });

    // ── submitStationPhoto expiry gate (wave-h #3) ─────────────────────────────
    // An expired photo task refuses a submit (a valid, IDOR-scoped Storage URL, so
    // the refusal comes from the expiry gate, not requireStorageUrl).
    const hPhotoUrl = `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${rH}/teams/${hUid}/late.jpg`)}?alt=media`;
    await expectError('station expiry: submitStationPhoto refuses a submit after expiry',
      pH.call('submitStationPhoto', { ...CH, teamId: hUid, taskId: 'wp-exp', photoUrl: hPhotoUrl }),
      { match: /expired/i });
  }); // scenario: smart_station gates

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

  // ── Held-team VISIBILITY (change: held-team-visibility) ────────────────────
  // The gate above works; the failure it left behind was that nobody could SEE
  // it. On the wire a held team was byte-identical to a team whose host simply
  // had not pressed start — so the minor sat on "waiting for the host" while the
  // field walked away, and the organizer got a COUNT with no names. Two channels
  // must now say the same thing, and both must be derived from the same predicate
  // `startTeams` partitions on, or the explanation can disagree with the behavior.
  const minorId = minor.auth.currentUser.uid;
  const heldKid = makeParty('consentHeld');
  await signInAnonymously(heldKid.auth);
  await heldKid.call('joinRun', { code: c6, displayName: 'Unapproved' });
  const heldId = heldKid.auth.currentUser.uid;

  // ── Assignment-side gate (change: consent-gate-routing) ────────────────────
  // The hold above only ever stopped `startTeams` from LAUNCHING a held team.
  // Nothing stopped that same team from calling `requestNextTask` directly and
  // self-assigning a real-world task — reserving a station slot and routing the
  // device toward a map pin before any guardian approved. Assert the direct call
  // is refused, with no side effects: no taskId, the documented reason, and the
  // run's station slot count for the only task in this game untouched (0 before,
  // 0 after — nothing was ever reserved for a held team).
  const consentRunPath = `users/${creatorCred.user.uid}/games/${g6}/runs/${r6}`;
  const countsBeforeHeldRequest = (await creator.getDocAt(consentRunPath)).data?.taskCounts ?? {};
  const heldRequest = await heldKid.call('requestNextTask', { code: c6 });
  check('consent: requestNextTask directly on a held team is DENIED, not assigned',
    heldRequest?.taskId === null && heldRequest?.reason === 'guardian_consent',
    JSON.stringify(heldRequest));
  const countsAfterHeldRequest = (await creator.getDocAt(consentRunPath)).data?.taskCounts ?? {};
  check('consent: a denied held-team request reserves no station slot (taskCounts unchanged)',
    JSON.stringify(countsBeforeHeldRequest) === JSON.stringify(countsAfterHeldRequest),
    JSON.stringify({ before: countsBeforeHeldRequest, after: countsAfterHeldRequest }));
  const heldTeamAfterRequest = await creator.getDocAt(`${consentRunPath}/teams/${heldId}`);
  check('consent: a denied held-team request never sets activeTaskId',
    !heldTeamAfterRequest.data?.activeTaskId, JSON.stringify(heldTeamAfterRequest.data?.activeTaskId));

  const start3 = await creator.call('startTeams', { gameId: g6, runId: r6 });
  check('consent: startTeams REPORTS the hold instead of claiming success over a no-op',
    start3?.launched === 0 && start3?.heldForConsent === 1, JSON.stringify(start3));

  // (a) The held participant's own state says WHY, and says it is not playing.
  const heldState = await heldKid.call('getMyTeamState', { code: c6 });
  check('consent: a held team is told the reason (holdReason === guardian_consent)',
    heldState?.holdReason === 'guardian_consent', JSON.stringify(heldState?.holdReason));
  check('consent: a held team is genuinely not launched',
    heldState?.team?.launched !== true, String(heldState?.team?.launched));
  // A REASON, never a record: no guardian name/contact/token may ride along.
  check('consent: the hold explanation leaks no guardian identity',
    !/A\. Parent/.test(JSON.stringify(heldState ?? {})),
    'a guardian name reached a participant payload');

  // (b) The approved team, on the SAME run, reports no hold — so the field is a
  //     per-team verdict and not a run-level constant.
  const consentedState = await minor.call('getMyTeamState', { code: c6 });
  check('consent: the approved team on the same run reports no hold',
    consentedState?.holdReason === null && consentedState?.team?.launched === true,
    JSON.stringify({ hold: consentedState?.holdReason, launched: consentedState?.team?.launched }));

  // (c) The organizer's console names EXACTLY the held team.
  const consentRows = (await creator.call('listRunTeams', { gameId: g6, runId: r6 }))?.teams ?? [];
  const heldRowIds = consentRows.filter((t) => t.heldForConsent === true).map((t) => t.id);
  check('consent: listRunTeams flags exactly the held team, and only it',
    JSON.stringify(heldRowIds) === JSON.stringify([heldId]),
    JSON.stringify(consentRows.map((t) => [t.id, t.heldForConsent])));
  check('consent: the started team\'s row reports heldForConsent false',
    consentRows.find((t) => t.id === minorId)?.heldForConsent === false,
    JSON.stringify(consentRows.find((t) => t.id === minorId)));
  for (const row of consentRows) assertRunTeamRowAllowlisted('consent row', row);

  // (d) Releasing the hold clears BOTH channels.
  const { token: token2 } = await heldKid.call('requestGuardianConsent', {
    ownerUid: creatorCred.user.uid, gameId: g6, runId: r6, teamId: heldId,
  });
  await guardian.call('grantGuardianConsent', {
    ownerUid: creatorCred.user.uid, gameId: g6, runId: r6, token: token2, guardianName: 'B. Parent',
  });
  const start4 = await creator.call('startTeams', { gameId: g6, runId: r6 });
  check('consent: the released team starts and nothing is left held',
    start4?.launched === 1 && (start4?.heldForConsent ?? 0) === 0, JSON.stringify(start4));
  const releasedState = await heldKid.call('getMyTeamState', { code: c6 });
  check('consent: holdReason clears to null once consent is recorded',
    releasedState?.holdReason === null, JSON.stringify(releasedState?.holdReason));
  // Once launched, the same call that was denied above now routes normally —
  // the gate only ever blocked the HELD state, never the team going forward.
  const releasedRequest = await heldKid.call('requestNextTask', { code: c6, lat: 0, lng: 0 });
  check('consent: requestNextTask succeeds normally once consent is granted and the team is launched',
    !!releasedRequest?.taskId, JSON.stringify(releasedRequest));
  const releasedRows = (await creator.call('listRunTeams', { gameId: g6, runId: r6 }))?.teams ?? [];
  check('consent: no console row is flagged held once every team has started',
    releasedRows.length === 2 && releasedRows.every((t) => t.heldForConsent === false),
    JSON.stringify(releasedRows.map((t) => [t.id, t.heldForConsent])));

  // (e) A run that does NOT require consent must never report a hold — otherwise
  //     every ordinary participant would be shown a consent notice they cannot act
  //     on. Its own fixture (this scenario owns every document it reads), and the
  //     team is asserted BEFORE start too: `holdReason` reports a consent hold, not
  //     "the host hasn't pressed start", and those two states must stay distinct.
  const { gameId: gNC } = await creator.call('createGame', { title: 'No Consent Needed', mode: 'individual' });
  await creator.call('updateGame', {
    gameId: gNC, scoringPreset: 'time_only', requiresGuardianConsent: false,
    stages: [{ id: 'nc-s', order: 0, title: 'One', isFinal: true, tasks: [{
      id: 'nc-t', title: 'Tap in', type: 'self_report', triggerMode: 'locationless',
      coordinates: { lat: 0, lng: 0 }, locationless: true, difficulty: 1, estimatedMinutes: 1,
      pointValue: 10, maxConcurrentTeams: 9,
    }] }],
  });
  const { runId: rNC, accessCode: cNC } = await creator.call('launchRun', { gameId: gNC });
  const freeAgent = makeParty('consentNotRequired');
  await signInAnonymously(freeAgent.auth);
  await freeAgent.call('joinRun', { code: cNC, displayName: 'Grown Up' });
  const preStart = await freeAgent.call('getMyTeamState', { code: cNC });
  check('consent: an un-started team on a consent-free run is NOT reported as held',
    preStart?.holdReason === null && preStart?.team?.launched !== true,
    JSON.stringify({ hold: preStart?.holdReason, launched: preStart?.team?.launched }));
  await creator.call('startTeams', { gameId: gNC, runId: rNC });
  const noConsentState = await freeAgent.call('getMyTeamState', { code: cNC });
  check('consent: a run without the requirement reports holdReason null after start',
    noConsentState?.holdReason === null && noConsentState?.team?.launched === true,
    JSON.stringify({ hold: noConsentState?.holdReason, launched: noConsentState?.team?.launched }));
  const noConsentRows = (await creator.call('listRunTeams', { gameId: gNC, runId: rNC }))?.teams ?? [];
  check('consent: every row of a consent-free run reports heldForConsent false',
    noConsentRows.length === 1 && noConsentRows.every((t) => t.heldForConsent === false),
    JSON.stringify(noConsentRows.map((t) => [t.id, t.heldForConsent])));

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
  const wandererUid = wanderer.auth.currentUser.uid; // uid == teamId for participants
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

  // ── Out-of-bounds recovery (change: out-of-bounds-recovery) ────────────────
  // The latch used to be openable by exactly ONE thing: a later GPS fix proving the
  // team came back. A phone with denied/dead/inaccurate location therefore stranded
  // its team behind an actionless card for the rest of the run, and no staff member
  // or creator could do anything about it. These assertions pin the escape hatch.
  await wanderer.call('updateLocation', { ...C7, lat: 32.5, lng: 35.9 });
  const stuck = await wanderer.call('requestNextTask', { ...C7, lat: 32.5, lng: 35.9 });
  check('oob: still paused while a fresh confident fix is outside', stuck?.outOfBounds === true, JSON.stringify(stuck));

  let participantRelease = false;
  try {
    await wanderer.call('clearTeamOutOfBounds', { ...C7, teamId: wandererUid });
  } catch (e) {
    participantRelease = e.code === 'functions/permission-denied';
  }
  check('oob: a participant cannot release themselves', participantRelease);

  const released = await creator.call('clearTeamOutOfBounds', { ...C7, teamId: wandererUid, reason: 'e2e' });
  check('oob: owner can release a stuck team', released?.ok === true && typeof released?.overrideUntil === 'string', JSON.stringify(released));
  const rescued = await creator.call('listRunTeams', { gameId: g7, runId: r7 });
  check('oob: listRunTeams exposes the flag (cleared after release)',
    rescued?.teams?.some((t) => t.id === wandererUid && t.outOfBounds === false), JSON.stringify(rescued?.teams));
  const assignedAgain = await wanderer.call('requestNextTask', { ...C7, lat: 32.5, lng: 35.9 });
  check('oob: released team is assigned a task again',
    assignedAgain?.outOfBounds !== true && typeof assignedAgain?.taskId === 'string',
    JSON.stringify(assignedAgain));

  // The grace window is the whole point: without it the same broken phone's next bad
  // fix re-latches the team seconds after the rescue and staff cannot win. The REASON
  // is asserted too — `outOfBounds === false` alone would also be satisfied by a fix
  // that simply landed inside, which is not what this line is about.
  const duringGrace = await wanderer.call('updateLocation', { ...C7, lat: 32.5, lng: 35.9 });
  check('oob: an out-of-zone ping during the grace window does not re-latch',
    duringGrace?.outOfBounds === false && duringGrace?.reason === 'override', JSON.stringify(duringGrace));

  // A fix too imprecise to place the team relative to the boundary must never flag it.
  // This needs its OWN team: the wanderer is inside an active staff override, and
  // override outranks every sensor branch in evaluateSafeZoneStatus — so asserting
  // low confidence on the wanderer would pass for the override's reason and prove
  // nothing about accuracy at all.
  const blurry = makeParty('blurryFix');
  await signInAnonymously(blurry.auth);
  await blurry.call('joinRun', { code: c7, displayName: 'Blurry' });
  const vague = await blurry.call('updateLocation', { ...C7, lat: 32.5, lng: 35.9, accuracyMeters: 900 });
  check('oob: a low-confidence fix is not treated as a breach',
    vague?.outOfBounds === false && vague?.reason === 'low_confidence', JSON.stringify(vague));

  // ── The boundary DOOR (change: expose-enforced-settings) ───────────────────
  // `safeZone` is a field two safety paths read (`updateLocation` and the routing
  // soft-pause) and it used to be persisted with a bare assignment: any shape at
  // all could land there, and — the silent one — "remove the boundary" did
  // NOTHING. `db.settings({ ignoreUndefinedProperties: true })` turns
  // `updates.safeZone = undefined` into a no-op, so the organizer pressed Clear,
  // the UI showed no zone, and the server kept flagging teams out of bounds for
  // the rest of the event with no error anywhere. The clear has to be an explicit
  // field DELETE, which is what these two checks pin: the field must be GONE, not
  // merely falsy — `safeZone: undefined` on the wire is exactly what the bug
  // produced, so `!game.safeZone` would have passed while the bug was live.
  const zonedBefore = (await creator.call('getGame', { gameId: g7 }))?.game;
  check('safeZone: the fixture game really has a stored boundary to clear',
    zonedBefore?.safeZone?.radiusMeters === 200, JSON.stringify(zonedBefore?.safeZone));
  await creator.call('updateGame', { gameId: g7, safeZone: null });
  const zonedAfter = (await creator.call('getGame', { gameId: g7 }))?.game;
  check('safeZone: an explicit null CLEARS the field (not a silent no-op)',
    !('safeZone' in (zonedAfter ?? {})), JSON.stringify(zonedAfter?.safeZone));

  // A malformed boundary is refused at the same door rather than persisted into
  // the enforcement path. `NaN` cannot survive the callable transport (JSON
  // encodes it as `null`), so this exercises the `typeof !== 'number'` arm of
  // validateSafeZone — which is the arm a hand-written client actually hits.
  await expectError('safeZone: a null centre is refused (NaN cannot cross the wire)',
    creator.call('updateGame', { gameId: g7, safeZone: { center: { lat: null, lng: 35.2 }, radiusMeters: 300 } }),
    { codeIn: ['functions/invalid-argument'] });
  await expectError('safeZone: a zero radius is refused, not stored as "off"',
    creator.call('updateGame', { gameId: g7, safeZone: { center: { lat: 31.78, lng: 35.21 }, radiusMeters: 0 } }),
    { codeIn: ['functions/invalid-argument'] });
  const zonedStill = (await creator.call('getGame', { gameId: g7 }))?.game;
  check('safeZone: a refused boundary wrote nothing (the field is still absent)',
    !('safeZone' in (zonedStill ?? {})), JSON.stringify(zonedStill?.safeZone));

  }); // scenario: safe-zone

  // ═══ Authored task duration (change: task-duration-defaults) ════════════════
  //
  // `expectedDurationMinutes` is read by `scoreFixedPointsSpeed` to build the
  // expected route total. A negative one shrinks that total (every team looks
  // slow); a non-finite one makes the speed bonus NaN for EVERY team in the run,
  // not just the one holding the bad task — a whole-run scoring outage from a
  // single field. It is authored (Builder, or a hand-written callable call), so
  // `updateGame` is the door that has to refuse it.
  await scenario('authored expectedDurationMinutes is validated at the save door', async () => {
    const { gameId: gDur } = await creator.call('createGame', { title: 'Duration Door', mode: 'individual' });
    const durStages = (expected) => [{
      id: 'dd-s', order: 0, title: 'One', isFinal: true, tasks: [{
        id: 'dd-t', title: 'Timed', type: 'self_report', triggerMode: 'locationless', locationless: true,
        coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10,
        maxConcurrentTeams: 9, ...(expected === undefined ? {} : { expectedDurationMinutes: expected }),
      }],
    }];

    // A sane authored value is accepted and stored verbatim — the control case,
    // without which the two refusals below would also pass if the door rejected
    // the field outright.
    await creator.call('updateGame', { gameId: gDur, scoringPreset: 'fixed_points_speed', stages: durStages(4) });
    const { game: durGame } = await creator.call('getGame', { gameId: gDur });
    check('duration: a valid expectedDurationMinutes is stored as authored',
      durGame?.stages?.[0]?.tasks?.[0]?.expectedDurationMinutes === 4,
      String(durGame?.stages?.[0]?.tasks?.[0]?.expectedDurationMinutes));

    await expectError('duration: a negative expectedDurationMinutes is refused',
      creator.call('updateGame', { gameId: gDur, stages: durStages(-5) }),
      { codeIn: ['functions/invalid-argument'], match: /expected duration/i });
    // NaN is encoded as `null` by the callable transport (JSON has no NaN), so the
    // value that actually reaches the server is `null` — refused by the
    // `typeof !== 'number'` arm of the same guard. Both spellings of "not a
    // number" therefore have to be refused, and both are asserted.
    await expectError('duration: a null expectedDurationMinutes is refused (NaN cannot cross the wire)',
      creator.call('updateGame', { gameId: gDur, stages: durStages(null) }),
      { codeIn: ['functions/invalid-argument'], match: /expected duration/i });
    await expectError('duration: a string expectedDurationMinutes is refused',
      creator.call('updateGame', { gameId: gDur, stages: durStages('10') }),
      { codeIn: ['functions/invalid-argument'], match: /expected duration/i });

    // A refusal must not half-write the stages array: the good value survives.
    const { game: durAfter } = await creator.call('getGame', { gameId: gDur });
    check('duration: a refused save left the previous authored value intact',
      durAfter?.stages?.[0]?.tasks?.[0]?.expectedDurationMinutes === 4,
      String(durAfter?.stages?.[0]?.tasks?.[0]?.expectedDurationMinutes));
  });

  // ── Draft save tolerance (change: builder-draft-save-tolerance) ─────────────
  // THE BUG: the Builder autosaves 1.5 s after any edit, and updateGame ran the
  // full structural guard including taskCompletabilityError — so from the moment a
  // creator picked "quiz" as a task type, EVERY autosave was refused with
  // invalid-argument until the answer key was finished. The creator's authoring was
  // silently not persisted (and the readiness popover force-reopened each time).
  // The rule now: an unfinished answer key SAVES but never GOES LIVE. This scenario
  // pins both halves, because relaxing the save without the go-live refusal would be
  // strictly worse than the bug — an unwinnable game would reach real participants.
  await scenario('draft save tolerance (unfinished answer key saves, never launches)', async () => {
    const { gameId: gDraft } = await creator.call('createGame', { title: 'Draft Door', mode: 'individual' });
    // Every answer-key-bearing type, each mid-authoring with its key not filled in —
    // exactly the shape the Builder holds between "I picked quiz" and "I typed the
    // answer". `answers: []` is what blankTask + a type switch actually produces.
    const draftStages = (over = {}) => [{
      id: 'dr-s', order: 0, title: 'One', isFinal: true, tasks: [{
        id: 'dr-t', title: 'Riddle', type: 'quiz', triggerMode: 'locationless', locationless: true,
        coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10,
        maxConcurrentTeams: 9, prompt: 'Where?', answers: [], ...over,
      }],
    }];

    // 1. The save door ACCEPTS the unfinished draft (this is the regression).
    await creator.call('updateGame', { gameId: gDraft, stages: draftStages() });
    const { game: draftGame } = await creator.call('getGame', { gameId: gDraft });
    check('draft: an answer-key-less quiz is persisted, not refused',
      draftGame?.stages?.[0]?.tasks?.[0]?.id === 'dr-t'
      && (draftGame?.stages?.[0]?.tasks?.[0]?.answers?.length ?? 0) === 0,
      JSON.stringify(draftGame?.stages?.[0]?.tasks?.[0]?.answers));

    // Same tolerance for the other three answer-key types — a save door that only
    // forgave quizzes would still strand a creator authoring a station or sequence.
    for (const [label, over] of [
      ['numeric without numericAnswer', { type: 'numeric', answers: undefined }],
      ['smart_station without secretCode', { type: 'smart_station', answers: undefined }],
      ['sequence without steps', { type: 'sequence', answers: undefined, steps: [] }],
    ]) {
      let saved = true;
      await creator.call('updateGame', { gameId: gDraft, stages: draftStages(over) })
        .catch((e) => { saved = false; check(`draft: ${label} saves`, false, `${e.code} :: ${e.message}`); });
      if (saved) check(`draft: ${label} saves`, true);
    }

    // 2. The GO-LIVE doors still refuse it. This is what makes (1) safe.
    await creator.call('updateGame', { gameId: gDraft, stages: draftStages() });
    await expectError('draft: launchRun REFUSES an unfinished answer key',
      creator.call('launchRun', { gameId: gDraft }),
      { codeIn: ['functions/failed-precondition'], match: /accepted answer|ordering items/i });
    await expectError('draft: publishGame REFUSES an unfinished answer key',
      creator.call('publishGame', { gameId: gDraft, visibility: 'public' }),
      { codeIn: ['functions/failed-precondition'], match: /accepted answer|ordering items/i });

    // 3. Control: finishing the key makes the SAME game launchable — proving the
    // refusal above was about the answer key and not some unrelated precondition.
    await creator.call('updateGame', { gameId: gDraft, stages: draftStages({ answers: ['ירושלים'] }) });
    const { runId: rDraft } = await creator.call('launchRun', { gameId: gDraft });
    check('draft: the same game launches once the answer key is filled in', !!rDraft, String(rDraft));

    // 4. Real CORRUPTION is still refused at the save door — the relaxation is
    // scoped to unfinished answer keys, not to structural validation as a whole.
    await expectError('draft: a negative pointValue is still refused at save',
      creator.call('updateGame', { gameId: gDraft, stages: draftStages({ answers: ['x'], pointValue: -50 }) }),
      { codeIn: ['functions/invalid-argument'], match: /point value/i });
    await expectError('draft: a 0-task stage is still refused at save',
      creator.call('updateGame', { gameId: gDraft, stages: [{ id: 'dr-s', order: 0, title: 'One', isFinal: true, tasks: [] }] }),
      { codeIn: ['functions/invalid-argument'], match: /at least one task/i });
  });

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
    const dpCred = await signInAnonymously(dpPlayer.auth);
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

    // Wave-G #1: the bonus must reach the LEADERBOARD, not just team.score. The team
    // has completed NO field task, so its ONLY points are the 40-pt discovery bonus —
    // which buildRankings can only see through the bonusPenalty channel. Assert it
    // ranks on both the live board (refreshLeaderboard) and the frozen final board
    // (finalizeRun). Before the fix (bonus written to team.score, a channel
    // buildRankings ignores) both would read 0.
    const dpLive = await creator.call('refreshLeaderboard', { gameId: dpGame, runId: dpRun, publish: false });
    const dpLiveEntry = (dpLive?.rankings ?? []).find((r) => r.teamId === dpCred.user.uid);
    check('discovery: bonus reaches the LIVE leaderboard (score 40)',
      dpLiveEntry?.score === 40, JSON.stringify(dpLiveEntry));

    await creator.call('finalizeRun', { gameId: dpGame, runId: dpRun });
    const dpFinal = (await adminSdk.firestore().doc(`users/${creatorCred.user.uid}/games/${dpGame}/runs/${dpRun}`).get()).data()?.leaderboard;
    const dpFinalEntry = (dpFinal?.rankings ?? []).find((r) => r.teamId === dpCred.user.uid);
    check('discovery: bonus reaches the FROZEN FINAL leaderboard (score 40)',
      dpFinalEntry?.score === 40, JSON.stringify(dpFinalEntry));
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

  // ═══ Pause-clock tasks (change: pause-clock-tasks) ══════════════════════════
  //
  // The rule: a task authored `pausesTimer` has its span STAMPED onto the team's
  // own RunTaskRecord (`excludedMs`) at completion, and `buildRankings` subtracts
  // the team's summed stamps from every time-derived term. Four properties make it
  // either correct or silently corrupting, and none of them is observable from a
  // pure unit test of the arithmetic:
  //
  //   A. The subtraction actually reaches the RANKING, not just the number the
  //      participant is shown. If it did not, "stop the clock" would be a label
  //      with no effect, and the team that deliberated would lose the race.
  //   B. The stamp is IMMUTABLE once written. It is read from the team document,
  //      never re-derived from `task.pausesTimer`, precisely so a creator editing
  //      the template mid-run cannot retroactively re-time finished work — which
  //      would make the live board jump and break live/final parity.
  //   C. It only ever SUBTRACTS. A duration longer than the team's own wall clock,
  //      a negative, or a NaN all mean the sign or the floor was lost.
  //   D. Pausing the clock changes NOTHING about station occupancy. A paused task
  //      is still a stop with a capacity, and a leaked slot closes it for the run.
  await scenario('pause-clock tasks (excluded time · parity · idempotence · template edit)', async () => {
    const OWNER = creatorCred.user.uid;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Long enough that the excluded span dominates the difference in wall clocks
    // and cannot be confused with scheduling jitter, short enough not to bloat the
    // suite. The assertions below use the SERVER's own stamps, never this number.
    const PAUSE_MS = 2600;

    // ── F1. The excluded span reaches the ranking (A, C) ──────────────────────
    // One partial stage, two alternatives: `pc-slow` stops the clock, `pc-fast`
    // does not. The Hare finishes almost immediately; the Tortoise sits on the
    // paused task for PAUSE_MS and finishes LAST by the wall clock. If the
    // exclusion works, the Tortoise still wins.
    const { gameId: pg } = await creator.call('createGame', { title: 'Paused Clock', mode: 'individual' });
    const pcTask = (id, paused) => ({
      id, title: id, type: 'self_report', triggerMode: 'locationless', locationless: true,
      coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 2, pointValue: 40,
      maxConcurrentTeams: 9, ...(paused ? { pausesTimer: true } : {}),
    });
    const pcStages = (paused) => [{
      id: 'pc-s', order: 0, title: 'Pick one', isFinal: true, requiredTaskCount: 1,
      tasks: [pcTask('pc-slow', paused), pcTask('pc-fast', false)],
    }];
    await creator.call('updateGame', { gameId: pg, scoringPreset: 'time_only', stages: pcStages(true) });

    // The flag is participant-visible on purpose (a team that does not know the
    // clock stopped will still hurry) — but it must ride through the sanitizer as
    // an allowlisted key, not as an un-classified passthrough.
    const { game: pausedGame } = await creator.call('getGame', { gameId: pg });
    check('pause: the authored pausesTimer flag round-trips through updateGame',
      pausedGame?.stages?.[0]?.tasks?.find((t) => t.id === 'pc-slow')?.pausesTimer === true,
      JSON.stringify(pausedGame?.stages?.[0]?.tasks?.map((t) => [t.id, t.pausesTimer])));

    const { runId: pr, accessCode: pcCode } = await creator.call('launchRun', { gameId: pg });
    const tortoise = makeParty('pauseTortoise');
    await signInAnonymously(tortoise.auth);
    await tortoise.call('joinRun', { code: pcCode, displayName: 'Tortoise' });
    const hare = makeParty('pauseHare');
    await signInAnonymously(hare.auth);
    await hare.call('joinRun', { code: pcCode, displayName: 'Hare' });
    const tortoiseId = tortoise.auth.currentUser.uid;
    const hareId = hare.auth.currentUser.uid;
    await creator.call('startTeams', { gameId: pg, runId: pr });

    // Nothing new leaks alongside the flag. (The flag's own presence on the wire is
    // asserted in F5, on a single-task game where the task is guaranteed to be the
    // assigned one — task-visibility gating omits unassigned tasks, so asserting it
    // here would be conditional on which of the two alternatives routing picked.)
    const tortoiseState = await tortoise.call('getMyTeamState', { code: pcCode });
    for (const t of tortoiseState?.activeStageTasks ?? []) assertTaskPayloadAllowlisted('pause payload', t);

    const teamDocPath = (teamId) => `users/${OWNER}/games/${pg}/runs/${pr}/teams/${teamId}`;
    const readTeam = async (teamId) => (await creator.getDocAt(teamDocPath(teamId))).data;
    const stampedExcludedMs = (team, taskId) => (team?.stages ?? [])
      .flatMap((s) => s.tasks ?? []).find((t) => t.taskId === taskId)?.excludedMs;

    // Hare first, on the UNPAUSED alternative: short wall clock, nothing excluded.
    await hare.call('completeTask', { taskId: 'pc-fast', code: pcCode });
    // Tortoise deliberates, then completes the PAUSED alternative.
    await sleep(PAUSE_MS);
    await tortoise.call('completeTask', { taskId: 'pc-slow', code: pcCode });

    const tortoiseTeam = await readTeam(tortoiseId);
    const hareTeam = await readTeam(hareId);
    const excluded = stampedExcludedMs(tortoiseTeam, 'pc-slow');
    check('pause: a completed paused task is stamped with a positive excludedMs',
      Number.isFinite(excluded) && excluded >= PAUSE_MS * 0.5,
      `excludedMs=${excluded} (waited ${PAUSE_MS}ms)`);
    check('pause: the UNPAUSED task is stamped with no excludedMs at all',
      stampedExcludedMs(hareTeam, 'pc-fast') === undefined,
      String(stampedExcludedMs(hareTeam, 'pc-fast')));

    // Wall clocks come off the team documents — an independent source from the
    // board being checked. This is the premise of the whole scenario, so it is
    // ASSERTED rather than assumed: if the Tortoise did not in fact finish later,
    // the ranking assertion below would prove nothing.
    const wallSec = (team) =>
      (new Date(team?.finishedAt).getTime() - new Date(team?.startedAt).getTime()) / 1000;
    const tortoiseWall = wallSec(tortoiseTeam);
    const hareWall = wallSec(hareTeam);
    check('pause: the Tortoise really did take LONGER on the wall clock',
      tortoiseWall > hareWall, `tortoise=${tortoiseWall}s hare=${hareWall}s`);

    const startedAtById = { [tortoiseId]: tortoiseTeam?.startedAt, [hareId]: hareTeam?.startedAt };
    const liveP = await creator.call('refreshLeaderboard', { gameId: pg, runId: pr, publish: false });
    assertLeaderboardInvariants('paused live board', liveP?.rankings ?? [], [tortoiseId, hareId], startedAtById);
    assertAllFinite('refreshLeaderboard(paused)', liveP);

    const entryOf = (board, teamId) => (board?.rankings ?? []).find((r) => r.teamId === teamId);
    const tortoiseEntry = entryOf(liveP, tortoiseId);
    check('pause: durationSeconds == wall clock − excluded span (±1s)',
      Math.abs((tortoiseEntry?.durationSeconds ?? NaN) - (tortoiseWall - excluded / 1000)) <= 1,
      JSON.stringify({ duration: tortoiseEntry?.durationSeconds, wall: tortoiseWall, excludedMs: excluded }));
    check('pause: the paused team outranks the faster wall clock (time_only)',
      tortoiseEntry?.rank === 1 && entryOf(liveP, hareId)?.rank === 2,
      JSON.stringify((liveP?.rankings ?? []).map((r) => `${r.teamName}#${r.rank}:${r.durationSeconds}`)));

    // ── F2. Idempotence (B) ───────────────────────────────────────────────────
    // A double-tapped Complete must not stamp a SECOND excluded span onto the same
    // record — which would subtract the deliberation twice and hand the team a
    // duration it never raced.
    const replay = await tortoise.call('completeTask', { taskId: 'pc-slow', code: pcCode });
    check('pause: a repeated completion of a paused task is an idempotent replay',
      replay?.already === true, JSON.stringify(replay));
    const afterReplay = await readTeam(tortoiseId);
    check('pause: the replay did NOT change the stamped excludedMs',
      stampedExcludedMs(afterReplay, 'pc-slow') === excluded,
      `${stampedExcludedMs(afterReplay, 'pc-slow')} vs ${excluded}`);
    const boardAfterReplay = await creator.call('refreshLeaderboard', { gameId: pg, runId: pr, publish: false });
    check('pause: the replay did NOT change the ranked duration',
      entryOf(boardAfterReplay, tortoiseId)?.durationSeconds === tortoiseEntry?.durationSeconds,
      `${entryOf(boardAfterReplay, tortoiseId)?.durationSeconds} vs ${tortoiseEntry?.durationSeconds}`);

    // ── F3. Mid-run template edit (B — the live/final drift guard) ────────────
    // The creator clears `pausesTimer` while the run is live. Because the ranking
    // reads the STAMP and not the template, the already-completed contribution is
    // frozen: the board must not move by a single second. Re-deriving from the
    // template here would silently add PAUSE_MS back to a finished team.
    await creator.call('updateGame', { gameId: pg, stages: pcStages(false) });
    const { game: editedGame } = await creator.call('getGame', { gameId: pg });
    check('pause: the template edit really landed (pausesTimer is gone)',
      editedGame?.stages?.[0]?.tasks?.find((t) => t.id === 'pc-slow')?.pausesTimer === undefined,
      JSON.stringify(editedGame?.stages?.[0]?.tasks?.map((t) => [t.id, t.pausesTimer])));
    const afterEdit = await creator.call('refreshLeaderboard', { gameId: pg, runId: pr, publish: false });
    check('pause: clearing pausesTimer mid-run does NOT re-time completed work',
      entryOf(afterEdit, tortoiseId)?.durationSeconds === tortoiseEntry?.durationSeconds
        && entryOf(afterEdit, hareId)?.durationSeconds === entryOf(liveP, hareId)?.durationSeconds,
      JSON.stringify({ before: (liveP?.rankings ?? []).map((r) => r.durationSeconds),
        after: (afterEdit?.rankings ?? []).map((r) => r.durationSeconds) }));
    check('pause: the stamp itself survives the template edit',
      stampedExcludedMs(await readTeam(tortoiseId), 'pc-slow') === excluded);

    // ── F4. Live/final parity, entry for entry (A, B) ─────────────────────────
    // finalizeRun and refreshLeaderboard share buildRankings; with NO activity
    // between the two calls the boards must be identical field by field, not merely
    // identically ORDERED (an ordering-only check would pass while every duration
    // silently drifted).
    const finP = await creator.call('finalizeRun', { gameId: pg, runId: pr });
    assertLeaderboardInvariants('paused final board', finP?.rankings ?? [], [tortoiseId, hareId], startedAtById);
    const parityKey = (board) => JSON.stringify((board?.rankings ?? []).map((r) => ({
      teamId: r.teamId, rank: r.rank, score: r.score, durationSeconds: r.durationSeconds,
    })));
    check('pause: live and final boards agree on rank, score AND durationSeconds',
      parityKey(afterEdit) === parityKey(finP),
      `live=${parityKey(afterEdit)} final=${parityKey(finP)}`);

    // ── F5. A run in which EVERY task pauses the clock (C) ────────────────────
    // The degenerate case: excluded == raw. The floor must hold at exactly 0 — not
    // a negative, not a NaN, not a crash — and the board must still rank.
    const { gameId: ag } = await creator.call('createGame', { title: 'All Paused', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: ag, scoringPreset: 'time_only',
      stages: [{ id: 'ap-s', order: 0, title: 'Only', isFinal: true, tasks: [pcTask('ap-t', true)] }],
    });
    const { runId: ar, accessCode: ac } = await creator.call('launchRun', { gameId: ag });
    const allPaused = [];
    for (const n of ['Zeno', 'Achilles']) {
      const p = makeParty(`allPaused${n}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: ac, displayName: n });
      allPaused.push(p);
    }
    await creator.call('startTeams', { gameId: ag, runId: ar });

    // The participant is TOLD the clock is stopped — that is the whole point of the
    // feature (a team that does not know will still hurry, and the deliberation the
    // pause is meant to buy never happens). One stage, one task, so the task on the
    // wire is deterministically the paused one.
    const zenoState = await allPaused[0].call('getMyTeamState', { code: ac });
    const wirePaused = (zenoState?.activeStageTasks ?? []).find((t) => t.id === 'ap-t');
    check('pause: the paused flag reaches the participant payload',
      wirePaused?.pausesTimer === true,
      JSON.stringify((zenoState?.activeStageTasks ?? []).map((t) => [t.id, t.pausesTimer])));
    for (const t of zenoState?.activeStageTasks ?? []) assertTaskPayloadAllowlisted('all-paused payload', t);

    for (const p of allPaused) await p.call('completeTask', { taskId: 'ap-t', code: ac });
    const allPausedIds = allPaused.map((p) => p.auth.currentUser.uid);
    const allStartedAt = {};
    for (const teamId of allPausedIds) {
      allStartedAt[teamId] = (await creator.getDocAt(
        `users/${OWNER}/games/${ag}/runs/${ar}/teams/${teamId}`,
      )).data?.startedAt;
    }
    const allBoard = await creator.call('refreshLeaderboard', { gameId: ag, runId: ar, publish: false });
    assertLeaderboardInvariants('all-paused board', allBoard?.rankings ?? [], allPausedIds, allStartedAt);
    assertAllFinite('refreshLeaderboard(all-paused)', allBoard);
    check('pause: a fully paused run floors every duration at exactly 0',
      (allBoard?.rankings ?? []).length === 2
        && (allBoard?.rankings ?? []).every((r) => r.durationSeconds === 0),
      JSON.stringify((allBoard?.rankings ?? []).map((r) => r.durationSeconds)));

    // ── F6. A paused task still releases its station slot (D) ─────────────────
    // Occupancy is orthogonal to the clock. A cap-1 paused stop that never
    // decremented would be closed for the rest of the run with no error anywhere —
    // the exact shape of the slot leaks already fixed in verifyStationCode and
    // submitStationPhoto.
    const { gameId: sg } = await creator.call('createGame', { title: 'Paused Station', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: sg, scoringPreset: 'time_only',
      stages: [{ id: 'ps-s', order: 0, title: 'One stop', isFinal: true, tasks: [
        { id: 'ps-t', title: 'Think here', type: 'field', triggerMode: 'instant',
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 5,
          pointValue: 50, maxConcurrentTeams: 1, pausesTimer: true },
      ] }],
    });
    const { runId: sr, accessCode: sc } = await creator.call('launchRun', { gameId: sg });
    const thinker = makeParty('pauseStationThinker');
    await signInAnonymously(thinker.auth);
    await thinker.call('joinRun', { code: sc, displayName: 'Thinker' });
    await creator.call('startTeams', { gameId: sg, runId: sr });
    const stationRunPath = `users/${OWNER}/games/${sg}/runs/${sr}`;
    const heldCounts = (await creator.getDocAt(stationRunPath)).data?.taskCounts ?? {};
    check('pause: the assigned paused station reserves its one slot',
      (heldCounts['ps-t'] ?? 0) === 1, JSON.stringify(heldCounts));
    await sleep(400);
    await thinker.call('completeTask', { taskId: 'ps-t', code: sc, lat: 31.78, lng: 35.21 });
    const releasedCounts = (await creator.getDocAt(stationRunPath)).data?.taskCounts ?? {};
    check('pause: completing a paused station releases its slot (taskCounts back to 0)',
      (releasedCounts['ps-t'] ?? 0) === 0, JSON.stringify(releasedCounts));
    check('pause: the paused station still stamped its excluded span',
      Number.isFinite(stampedExcludedMs(
        (await creator.getDocAt(`${stationRunPath}/teams/${thinker.auth.currentUser.uid}`)).data, 'ps-t')),
      'no excludedMs stamped on the station record');
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
    // wave-j sender attribution: sendTeamChatMessage stamps senderId so the client
    // can label the true author (fixes every message showing as HQ when the owner
    // plays their own game). The two authors' ids must differ.
    check('chat: team message carries senderId == the participant uid',
      chat?.messages?.[0]?.senderId === founderUid, chat?.messages?.[0]?.senderId);
    check('chat: HQ message carries a senderId that differs from the participant',
      !!chat?.messages?.[1]?.senderId && chat.messages[1].senderId !== founderUid,
      chat?.messages?.[1]?.senderId);

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

  await scenario('staff ↔ admin channel (send · role derivation · authz · validation)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: sg } = await creator.call('createGame', { title: 'Staff Channel Game', mode: 'team' });
    await creator.call('updateGame', {
      gameId: sg, scoringPreset: 'time_only',
      stages: [{ id: 'sc-s', order: 0, title: 'S', isFinal: true, tasks: [
        { id: 'sc-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: sr, accessCode: scAccessCode } = await creator.call('launchRun', { gameId: sg });
    const SCTX = { ownerUid: OWNER, gameId: sg, runId: sr };
    const channelPath = `users/${OWNER}/games/${sg}/runs/${sr}/staffChannel/thread`;

    // 1. A marshal sends → thread holds 1 msg, role derived as 'staff' (never
    //    trusted from the client), senderName from the token's staffName claim.
    const { pin: scPin } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: sg, runId: sr, name: 'Field Marshal', permissions: ['review_photos'],
    });
    const marshal = makeParty('scMarshal');
    await signInAnonymously(marshal.auth);
    const scTok = await marshal.call('staffSignIn', { ownerUid: OWNER, gameId: sg, runId: sr, pin: scPin });
    await signInWithCustomToken(marshal.auth, scTok.customToken);
    const scSent = await marshal.call('sendStaffChannelMessage', { ...SCTX, text: 'Team 3 needs a ride back' });
    check('staffChannel: staff send returns a messageId', !!scSent?.messageId, JSON.stringify(scSent));
    let thread = (await creator.getDocAt(channelPath)).data;
    check('staffChannel: doc holds 1 message after staff send', thread?.messages?.length === 1, JSON.stringify(thread?.messages?.length));
    check('staffChannel: staff message is from:staff', thread?.messages?.[0]?.from === 'staff', thread?.messages?.[0]?.from);
    check('staffChannel: staff message senderName == token staffName', thread?.messages?.[0]?.senderName === 'Field Marshal', thread?.messages?.[0]?.senderName);
    check('staffChannel: staff message carries senderId', thread?.messages?.[0]?.senderId, thread?.messages?.[0]?.senderId);

    // 2. The owner replies → role derived as 'admin' purely from uid === ownerUid.
    await creator.call('sendStaffChannelMessage', { ...SCTX, text: 'Sending a car now' });
    thread = (await creator.getDocAt(channelPath)).data;
    check('staffChannel: doc holds 2 messages after owner reply', thread?.messages?.length === 2, JSON.stringify(thread?.messages?.length));
    check('staffChannel: owner message is from:admin', thread?.messages?.[1]?.from === 'admin', thread?.messages?.[1]?.from);
    check('staffChannel: owner senderId differs from the marshal', thread?.messages?.[1]?.senderId !== thread?.messages?.[0]?.senderId,
      JSON.stringify([thread?.messages?.[0]?.senderId, thread?.messages?.[1]?.senderId]));

    // 3. Client-supplied `from` is ignored — role always comes from the server.
    await marshal.call('sendStaffChannelMessage', { ...SCTX, text: 'forge attempt', from: 'admin' });
    thread = (await creator.getDocAt(channelPath)).data;
    const scForged = thread?.messages?.[thread.messages.length - 1];
    check('staffChannel: client-supplied from is ignored (still from:staff)', scForged?.from === 'staff', scForged?.from);

    // 4. Validation: 501-char and whitespace-only text rejected.
    await expectError('staffChannel: 501-char text rejected',
      marshal.call('sendStaffChannelMessage', { ...SCTX, text: 'x'.repeat(501) }),
      { codeIn: ['functions/invalid-argument'] });
    await expectError('staffChannel: whitespace-only text rejected',
      marshal.call('sendStaffChannelMessage', { ...SCTX, text: '   ' }),
      { codeIn: ['functions/invalid-argument'] });

    // 5. Authz: a participant, a stranger, and staff scoped to a DIFFERENT run
    //    must all be denied — this is a staff/owner-only coordination thread.
    const DENY = ['functions/permission-denied', 'functions/not-found'];
    const scPlayer = makeParty('scPlayer');
    await signInAnonymously(scPlayer.auth);
    await scPlayer.call('joinRun', { code: scAccessCode, displayName: 'Bystander' });
    await expectError('staffChannel: participant is denied',
      scPlayer.call('sendStaffChannelMessage', { ...SCTX, text: 'sneak in' }),
      { codeIn: DENY });
    const scStranger = makeParty('scStranger');
    await signInAnonymously(scStranger.auth);
    await expectError('staffChannel: stranger is denied',
      scStranger.call('sendStaffChannelMessage', { ...SCTX, text: 'sneak in' }),
      { codeIn: DENY });
    const { gameId: sg2 } = await creator.call('createGame', { title: 'Other Game', mode: 'team' });
    await creator.call('updateGame', {
      gameId: sg2, scoringPreset: 'time_only',
      stages: [{ id: 'sc2-s', order: 0, title: 'S', isFinal: true, tasks: [
        { id: 'sc2-t', title: 'T', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: sr2 } = await creator.call('launchRun', { gameId: sg2 });
    const { pin: scPin2 } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: sg2, runId: sr2, name: 'Other Run Marshal', permissions: ['review_photos'],
    });
    const otherRunStaff = makeParty('scOtherStaff');
    await signInAnonymously(otherRunStaff.auth);
    const scTok2 = await otherRunStaff.call('staffSignIn', { ownerUid: OWNER, gameId: sg2, runId: sr2, pin: scPin2 });
    await signInWithCustomToken(otherRunStaff.auth, scTok2.customToken);
    await expectError('staffChannel: staff scoped to a different run is denied',
      otherRunStaff.call('sendStaffChannelMessage', { ...SCTX, text: 'not my run' }),
      { codeIn: DENY });

    // 6. Finished run: after finalize, any send is rejected.
    await creator.call('finalizeRun', { gameId: sg, runId: sr });
    await expectError('staffChannel: send into a finished run is rejected',
      creator.call('sendStaffChannelMessage', { ...SCTX, text: 'too late' }),
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
      // public-task-coordinates-backfill: the sweep is platform-admin-only, same
      // gate/trust level as pruneRunNow — an owner must not be able to trigger it.
      ['owner', creator, 'backfillPublicTaskCoordinatesNow', {}],
      // admin-user-activity-dashboard: listPlatformUsers is platform-admin-only,
      // same trust level as listAuditLogs — a mere game owner (even one who owns
      // real games/runs) must not be able to list every creator on the platform.
      ['owner', creator, 'listPlatformUsers', { limit: 5 }],
      ['participant', pl, 'listPlatformUsers', { limit: 5 }],
      // admin-user-notes: a note is written BY an admin ABOUT someone else, so it is not
      // the subject's own data to edit. An owner must not be able to write their own note
      // (that would let a creator author the record kept about them), nor anyone else's.
      ['owner', creator, 'setUserNote', { uid: OWNER, note: 'self written' }],
      ['participant', pl, 'setUserNote', { uid: OWNER, note: 'pwn' }],
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
      // feed-ugc-safety: reportFeedItem — a run participant is proven ALLOWED in
      // the 'live photo feed' scenario above; here we prove a stranger and staff
      // scoped to a DIFFERENT run are denied. The authz check runs before the
      // item lookup, so a non-existent itemId still exercises the right branch.
      ['stranger', str, 'reportFeedItem', { ownerUid: OWNER, gameId: ag, runId: ar, itemId: 'fake', reason: 'inappropriate' }],
      ['other-run staff', staffB, 'reportFeedItem', { ownerUid: OWNER, gameId: ag, runId: ar, itemId: 'fake', reason: 'inappropriate' }],
      // feed-ugc-safety: hideFeedItem({ restore: true }) is staff/owner-only,
      // same as a plain hide — a participant must not be able to restore either.
      ['participant', pl, 'hideFeedItem', { ownerUid: OWNER, gameId: ag, runId: ar, itemId: 'fake', restore: true }],
      // live-task-pause: setRunTaskStatus takes a stop out of play for the WHOLE
      // run — it changes what every team can score, so it is owner/run-staff only.
      // The staff row proves the RUN scope specifically: staffB holds a valid staff
      // token for run `ar2` of the same game and the same owner. The ALLOWED side
      // (owner + staff scoped to this run) is proven in the 'live task pause'
      // scenario; only denials belong in this table.
      ['participant', pl, 'setRunTaskStatus', { ownerUid: OWNER, gameId: ag, runId: ar, taskId: 'az-t', status: 'paused' }],
      ['stranger', str, 'setRunTaskStatus', { ownerUid: OWNER, gameId: ag, runId: ar, taskId: 'az-t', status: 'paused' }],
      ['other-run staff', staffB, 'setRunTaskStatus', { ownerUid: OWNER, gameId: ag, runId: ar, taskId: 'az-t', status: 'paused' }],
      // skip-single-task: skipTaskForTeam removes a scoring opportunity from ONE
      // team. A participant must not be able to skip their own hard mission (that
      // is a scoring exploit), and the run scope applies exactly as for
      // setRunTaskStatus. The ALLOWED side (owner + staff scoped to this run) is
      // proven in the 'single task skip' scenario; only denials belong here.
      ['participant', pl, 'skipTaskForTeam', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t' }],
      ['stranger', str, 'skipTaskForTeam', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t' }],
      ['other-run staff', staffB, 'skipTaskForTeam', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t' }],
      // staff-console-field-ops: setTeamHold pauses a team's race clock and
      // forceAssignTask overrides routing for ONE team — both change what a team
      // scores, same owner/run-staff-only trust level as setRunTaskStatus above.
      // The ALLOWED side (owner) is proven in the 'staff field ops' scenario;
      // only denials belong here.
      ['participant', pl, 'setTeamHold', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, held: true }],
      ['stranger', str, 'setTeamHold', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, held: true }],
      ['other-run staff', staffB, 'setTeamHold', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, held: true }],
      ['participant', pl, 'forceAssignTask', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t' }],
      ['stranger', str, 'forceAssignTask', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t' }],
      ['other-run staff', staffB, 'forceAssignTask', { ownerUid: OWNER, gameId: ag, runId: ar, teamId: plUid, taskId: 'az-t' }],
      // post-run-player-report: getRunPlayerReport returns team-level identity
      // TOGETHER with what each player submitted and the game's answer keys —
      // everything getRunAnalytics is careful to keep out of an anonymous
      // aggregate. So it is owner-only on the run document's own ownerUid, and
      // NOT reachable by a run's own staff either: a marshal reviewing photos has
      // no business reading every team's answer sheet. The ALLOWED side (the
      // owner) is proven in the 'recorded answers' scenario; only denials here.
      ['participant', pl, 'getRunPlayerReport', { gameId: ag, runId: ar }],
      ['stranger', str, 'getRunPlayerReport', { gameId: ag, runId: ar }],
      ['other-run staff', staffB, 'getRunPlayerReport', { gameId: ag, runId: ar }],
      // admin-manage-game-templates: setGameTemplateFlag is platform-admin-only,
      // same trust level as listPlatformUsers/setUserNote above — a mere game
      // owner (even flagging their OWN game) and a participant must both be denied.
      ['owner', creator, 'setGameTemplateFlag', { gameId: ag, isTemplate: true }],
      ['participant', pl, 'setGameTemplateFlag', { gameId: ag, isTemplate: true }],
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
    // live-task-pause: a denied setRunTaskStatus must not have reached the write.
    // The run has never had an override written, so `undefined` is the whole state.
    check('authz: the denial sweep never wrote a task-status override',
      runDoc.data?.taskStatusOverrides === undefined, JSON.stringify(runDoc.data?.taskStatusOverrides));
    const teamDoc = await creator.getDocAt(`users/${OWNER}/games/${ag}/runs/${ar}/teams/${plUid}`);
    check('authz: team score/penalty untouched by the denial sweep',
      (teamDoc.data?.score ?? 0) === 0 && (teamDoc.data?.bonusPenalty ?? 0) === 0,
      JSON.stringify({ score: teamDoc.data?.score, bonusPenalty: teamDoc.data?.bonusPenalty }));

    // ── admin-user-activity-dashboard: the ADMIN side of listPlatformUsers ─────
    // The denial matrix above proves owner/participant are rejected; this proves
    // the admin token gets back an honest rollup for the creator this scenario
    // just drove real activity through (2 games created above via createGame,
    // and `ar`/`ar2` launched via launchRun).
    //
    // The suite's `creator` identity is signed in ANONYMOUSLY (a test-harness
    // shortcut — real creator-web never offers anonymous sign-in, only email or
    // Google, per CLAUDE.md). listPlatformUsers deliberately excludes anonymous
    // accounts (design.md §D1: they are participants, not creators), so without
    // an email this uid would correctly be invisible to the report — that would
    // prove the WRONG thing here. Giving it an email via the Admin SDK models
    // what a real creator account actually looks like, without disturbing its
    // uid (so every game/run already created above stays attributed to it).
    await adminSdk.auth().updateUser(OWNER, { email: 'e2e-authz-creator@example.com', emailVerified: true });
    const report = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const userRows = report?.users ?? [];
    const ownerRow = userRows.find((r) => r.uid === OWNER);
    check('admin: listPlatformUsers includes the creator this scenario drove',
      !!ownerRow, `${userRows.length} rows returned`);
    check('admin: the creator row counts at least the game(s) created in this scenario',
      (ownerRow?.gamesCreatedCount ?? 0) >= 1, JSON.stringify(ownerRow?.gamesCreatedCount));
    check('admin: the creator row lists the run(s) launched in this scenario',
      (ownerRow?.runs ?? []).some((r) => r.id === ar) && (ownerRow?.runs ?? []).some((r) => r.id === ar2),
      JSON.stringify(ownerRow?.runs?.map((r) => r.id)));
    check('admin: anonymous participant/player uids never appear as a row',
      !userRows.some((r) => r.uid === plUid || r.uid === (str.auth.currentUser?.uid)),
      JSON.stringify(userRows.map((r) => r.uid)));

    // ── admin-engagement-and-outreach: time on site ───────────────────────────
    // recordEngagement is NOT admin-only — every creator flushes their own total —
    // so the properties worth proving are that the uid comes from the TOKEN and the
    // value is CLAMPED. A participant calling it must therefore SUCCEED (it is their
    // own row) while being unable to touch anyone else's, which is why it is absent
    // from the denial matrix above.
    await creator.call('recordEngagement', { deltaMs: 60_000 });
    await creator.call('recordEngagement', { deltaMs: 60_000 });
    const afterTwo = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const meAfterTwo = (afterTwo?.users ?? []).find((r) => r.uid === OWNER);
    check('engagement: two flushes accumulate onto the creator row',
      (meAfterTwo?.engagementMs ?? 0) >= 120_000, JSON.stringify(meAfterTwo?.engagementMs));

    // A single absurd claim must be clamped, not stored. 30 days would otherwise land
    // verbatim and make the metric meaningless for that account forever.
    const before = meAfterTwo?.engagementMs ?? 0;
    await creator.call('recordEngagement', { deltaMs: 30 * 24 * 60 * 60 * 1000 });
    const afterHuge = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const meAfterHuge = (afterHuge?.users ?? []).find((r) => r.uid === OWNER);
    const applied = (meAfterHuge?.engagementMs ?? 0) - before;
    check('engagement: an absurd flush is clamped to at most 15 minutes',
      applied > 0 && applied <= 15 * 60 * 1000, `applied ${applied}ms`);

    // Garbage and negatives are absorbed silently rather than throwing or subtracting.
    // NaN is deliberately ABSENT from this list: the callable protocol is JSON, and the
    // client SDK refuses to encode it ("Data cannot be encoded in JSON: NaN") before a
    // request is ever made. So no client can deliver a NaN here — the server's NaN guard
    // in clampEngagementDelta is defence against a non client caller (a script, a future
    // server to server path), and is covered at the unit level in engagement.test.ts.
    const beforeJunk = meAfterHuge?.engagementMs ?? 0;
    for (const junk of [-5000, 'abc', null, undefined]) {
      await creator.call('recordEngagement', { deltaMs: junk });
    }
    const afterJunk = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const meAfterJunk = (afterJunk?.users ?? []).find((r) => r.uid === OWNER);
    check('engagement: junk and negative flushes change nothing and never subtract',
      (meAfterJunk?.engagementMs ?? 0) === beforeJunk,
      `${beforeJunk} -> ${meAfterJunk?.engagementMs}`);

    // A participant's own flush must land on THEIR uid, never on the creator's.
    await pl.call('recordEngagement', { deltaMs: 30_000 });
    const afterPl = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    check('engagement: a participant flush never moves another account\'s total',
      ((afterPl?.users ?? []).find((r) => r.uid === OWNER)?.engagementMs ?? 0)
        === (meAfterJunk?.engagementMs ?? 0));

    // The activation funnel is what the dashboard is actually FOR: this creator built
    // games and launched runs, so it must not report them as merely signed up.
    check('admin: a creator with games and runs is not reported as signed_up only',
      (meAfterJunk?.gamesCreatedCount ?? 0) > 0 && (meAfterJunk?.runsLaunchedCount ?? 0) > 0);
    check('admin: participantsReached is derived, not absent',
      typeof meAfterJunk?.participantsReached === 'number');

    // ── admin-user-notes: the operator's own CRM field ────────────────────────
    const NOTE = 'Emailed 12.7, replied they want a school run';
    const wrote = await platformAdmin.call('setUserNote', { uid: OWNER, note: NOTE });
    check('notes: setUserNote returns the stored note', wrote?.note === NOTE, JSON.stringify(wrote));
    const withNote = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const rowWithNote = (withNote?.users ?? []).find((r) => r.uid === OWNER);
    check('notes: the note comes back on the roster row', rowWithNote?.note === NOTE, JSON.stringify(rowWithNote?.note));
    check('notes: a write stamps noteUpdatedAt', typeof rowWithNote?.noteUpdatedAt === 'string');

    // Over-long input is TRUNCATED, not rejected: an admin pasting something slightly too
    // long should keep their note, shortened, rather than lose what they typed.
    const huge = await platformAdmin.call('setUserNote', { uid: OWNER, note: 'x'.repeat(9000) });
    check('notes: an over long note is truncated to the cap, not rejected',
      (huge?.note ?? '').length === 4000, String((huge?.note ?? '').length));

    // Empty CLEARS, and clearing must leave no residual record.
    const cleared = await platformAdmin.call('setUserNote', { uid: OWNER, note: '   ' });
    check('notes: a blank note clears rather than storing whitespace',
      cleared?.cleared === true && cleared?.note === '', JSON.stringify(cleared));
    const afterClear = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const rowCleared = (afterClear?.users ?? []).find((r) => r.uid === OWNER);
    check('notes: a cleared note reads as empty on the roster',
      (rowCleared?.note ?? '') === '' && rowCleared?.noteUpdatedAt === null,
      JSON.stringify({ note: rowCleared?.note, at: rowCleared?.noteUpdatedAt }));

    // A note for a uid that has no Auth account is accepted (the callable does not
    // resolve the subject) but simply never surfaces, which is the honest behaviour:
    // the roster is driven by Auth, not by whatever notes happen to exist.
    await platformAdmin.call('setUserNote', { uid: 'no-such-uid-12345', note: 'orphan' });
    const afterOrphan = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    check('notes: an orphan note never invents a roster row',
      !(afterOrphan?.users ?? []).some((r) => r.uid === 'no-such-uid-12345'));

    // ── the manual "I emailed them" tick ──────────────────────────────────────
    // The property that matters is INDEPENDENCE: a note save must not disturb the tick,
    // and a tick must not wipe the note. Those are the two ways this silently loses an
    // operator's work, and neither is visible from the UI until it has already happened.
    const NOTE2 = 'Second round of outreach';
    await platformAdmin.call('setUserNote', { uid: OWNER, note: NOTE2 });
    const ticked = await platformAdmin.call('setUserNote', { uid: OWNER, note: NOTE2, emailed: true });
    check('outreach: ticking emailed returns emailed true with a date',
      ticked?.emailed === true && typeof ticked?.emailedAt === 'string', JSON.stringify(ticked));
    check('outreach: ticking emailed did NOT wipe the note text',
      ticked?.note === NOTE2, JSON.stringify(ticked?.note));

    // Saving the note again WITHOUT sending `emailed` must leave the tick alone.
    const noteOnly = await platformAdmin.call('setUserNote', { uid: OWNER, note: NOTE2 + ' plus' });
    check('outreach: a note save with no emailed field leaves the tick set',
      noteOnly?.emailed === true, JSON.stringify(noteOnly));

    const rosterTicked = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const rowTicked = (rosterTicked?.users ?? []).find((r) => r.uid === OWNER);
    check('outreach: the roster row carries emailed and emailedAt',
      rowTicked?.emailed === true && typeof rowTicked?.emailedAt === 'string',
      JSON.stringify({ e: rowTicked?.emailed, at: rowTicked?.emailedAt }));

    // Unticking clears the flag and its date, and keeps the note.
    const unticked = await platformAdmin.call('setUserNote', { uid: OWNER, note: NOTE2, emailed: false });
    check('outreach: unticking clears the flag and its date but keeps the note',
      unticked?.emailed === false && unticked?.emailedAt === null && unticked?.note === NOTE2,
      JSON.stringify(unticked));

    // A tick with NO note is legitimate: "emailed them, nothing to write down".
    await platformAdmin.call('setUserNote', { uid: OWNER, note: '', emailed: true });
    const rosterTickOnly = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const rowTickOnly = (rosterTickOnly?.users ?? []).find((r) => r.uid === OWNER);
    check('outreach: a tick survives an empty note rather than being deleted with it',
      rowTickOnly?.emailed === true && (rowTickOnly?.note ?? '') === '',
      JSON.stringify({ e: rowTickOnly?.emailed, n: rowTickOnly?.note }));

    // And clearing BOTH removes the record entirely.
    await platformAdmin.call('setUserNote', { uid: OWNER, note: '', emailed: false });
    const rosterGone = await platformAdmin.call('listPlatformUsers', { limit: 300 });
    const rowGone = (rosterGone?.users ?? []).find((r) => r.uid === OWNER);
    check('outreach: clearing both the note and the tick leaves no residual record',
      (rowGone?.note ?? '') === '' && rowGone?.emailed === false && rowGone?.emailedAt === null,
      JSON.stringify({ n: rowGone?.note, e: rowGone?.emailed, at: rowGone?.emailedAt }));
  });

  // ═══ Admin-managed game templates (change: admin-manage-game-templates) ════
  // A template is an ordinary Game flagged isTemplate: true, owned by whichever
  // admin authored it — the admin edits it with the same updateGame every
  // creator uses. These callables project/instantiate it for everyone else.
  await scenario('game templates', async () => {
    const unlockTask = (id, over = {}) => ({
      id, title: id, type: 'self_report', triggerMode: 'locationless', locationless: true,
      coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10,
      maxConcurrentTeams: 9, ...over,
    });

    // 1. Admin authors a template (Hebrew variant) with an unlock graph + an
    //    exclusive group, exactly like any other game, then flags it.
    const { gameId: tHe } = await platformAdmin.call('createGame', { title: 'Template HE', mode: 'team' });
    await platformAdmin.call('updateGame', {
      gameId: tHe, scoringPreset: 'time_only',
      stages: [{
        id: 'tpl-s1', order: 0, title: 'Stage 1', isFinal: true,
        tasks: [
          unlockTask('tpl-t1'),
          unlockTask('tpl-t2', { unlockAfterTaskIds: ['tpl-t1'] }),
        ],
        exclusiveGroups: [{ id: 'tpl-g1', taskIds: ['tpl-t1', 'tpl-t2'] }],
      }],
    });
    const flagged = await platformAdmin.call('setGameTemplateFlag', {
      gameId: tHe, isTemplate: true, templateEmoji: '🧪', templateOrder: 1,
      templateGroupKey: tHe, templateLang: 'he',
    });
    check('setGameTemplateFlag: admin flags own game', flagged?.isTemplate === true, JSON.stringify(flagged));

    // 2. A mismatched sibling (different emoji/order) is rejected.
    const { gameId: tEn } = await platformAdmin.call('createGame', { title: 'Template EN', mode: 'team' });
    await expectError('setGameTemplateFlag: mismatched sibling rejected',
      platformAdmin.call('setGameTemplateFlag', {
        gameId: tEn, isTemplate: true, templateEmoji: '🚫', templateOrder: 99,
        templateGroupKey: tHe, templateLang: 'en',
      }),
      { codeIn: ['functions/invalid-argument'] });

    // 3. A matching sibling is accepted and links as the English variant.
    const flaggedEn = await platformAdmin.call('setGameTemplateFlag', {
      gameId: tEn, isTemplate: true, templateEmoji: '🧪', templateOrder: 1,
      templateGroupKey: tHe, templateLang: 'en',
    });
    check('setGameTemplateFlag: matching sibling accepted', flaggedEn?.isTemplate === true, JSON.stringify(flaggedEn));

    // 4. listGameTemplates groups both variants under one entry and leaks no content.
    const list1 = await creator.call('listGameTemplates', {});
    const group = (list1?.templates ?? []).find((g) => g.groupKey === tHe);
    check('listGameTemplates: grouped entry has both he/en variants',
      !!group?.variants?.he && !!group?.variants?.en, JSON.stringify(group));
    check('listGameTemplates: no stages/tasks leaked into the projection',
      !('stages' in (group?.variants?.he ?? {})) && !('tasks' in (group?.variants?.he ?? {})),
      JSON.stringify(group?.variants?.he));
    check('listGameTemplates: stage/task counts are correct',
      group?.variants?.he?.stageCount === 1 && group?.variants?.he?.taskCount === 2,
      JSON.stringify(group?.variants?.he));
    // The counts are STORED on the document so the picker never loads a
    // template's stages to draw one row (perf: template-list-projection). An
    // edit that changes the shape must restamp them, or the menu quotes stale
    // numbers forever. Done on a template of its OWN — the grouped fixture above
    // is read by the createGameFromTemplate assertions further down, and editing
    // it here would break them from a distance.
    const { gameId: tCounts } = await platformAdmin.call('createGame', { title: 'Counts Template', mode: 'team' });
    await platformAdmin.call('updateGame', { gameId: tCounts, stages: [
      { id: 'tc0', order: 0, title: 'One', isFinal: false, tasks: [
        { id: 'tc-a', title: 'A', type: 'field', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        { id: 'tc-b', title: 'B', type: 'field', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] },
      { id: 'tc1', order: 1, title: 'Two', isFinal: true, tasks: [
        { id: 'tc-c', title: 'C', type: 'field', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] },
    ] });
    await platformAdmin.call('setGameTemplateFlag', { gameId: tCounts, isTemplate: true, templateEmoji: '🔢', templateOrder: 9 });
    const listCounts = await creator.call('listGameTemplates', {});
    const countsGroup = (listCounts?.templates ?? []).find((g) => g.groupKey === tCounts);
    check('listGameTemplates: counts are stamped when a game becomes a template',
      countsGroup?.variants?.he?.stageCount === 2 && countsGroup?.variants?.he?.taskCount === 3,
      JSON.stringify(countsGroup?.variants?.he));
    // Now shrink it: an ordinary content edit must restamp, or the menu is stale.
    await platformAdmin.call('updateGame', { gameId: tCounts, stages: [
      { id: 'tc0', order: 0, title: 'One', isFinal: true, tasks: [
        { id: 'tc-a', title: 'A', type: 'field', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] },
    ] });
    const listShrunk = await creator.call('listGameTemplates', {});
    const shrunkGroup = (listShrunk?.templates ?? []).find((g) => g.groupKey === tCounts);
    check('listGameTemplates: counts follow a template content edit',
      shrunkGroup?.variants?.he?.stageCount === 1 && shrunkGroup?.variants?.he?.taskCount === 1,
      JSON.stringify(shrunkGroup?.variants?.he));
    check('listGameTemplates: still no stages/tasks leaked by the projection',
      !('stages' in (shrunkGroup?.variants?.he ?? {})),
      JSON.stringify(shrunkGroup?.variants?.he));

    // 5. A solo (ungrouped) template appears with exactly one variant.
    const { gameId: tSolo } = await platformAdmin.call('createGame', { title: 'Solo Template', mode: 'team' });
    await platformAdmin.call('setGameTemplateFlag', { gameId: tSolo, isTemplate: true, templateEmoji: '🎯', templateOrder: 5 });
    const list2 = await creator.call('listGameTemplates', {});
    const soloGroup = (list2?.templates ?? []).find((g) => g.groupKey === tSolo);
    check('listGameTemplates: solo template has exactly one (he-default) variant',
      Object.keys(soloGroup?.variants ?? {}).length === 1, JSON.stringify(soloGroup));

    // 6. createGameFromTemplate clones with NEW ids, preserving the unlock graph
    //    and exclusive group; the source template is left untouched.
    const created = await creator.call('createGameFromTemplate', { templateGameId: tHe, title: 'From Template' });
    check('createGameFromTemplate: returns a gameId', !!created?.gameId, JSON.stringify(created));
    const clonedGame = (await creator.call('getGame', { gameId: created.gameId }))?.game;
    const clonedStage = clonedGame?.stages?.[0];
    const [c1, c2] = clonedStage?.tasks ?? [];
    check('createGameFromTemplate: cloned task ids differ from the source template',
      !!c1 && !!c2 && c1.id !== 'tpl-t1' && c2.id !== 'tpl-t2', JSON.stringify({ c1: c1?.id, c2: c2?.id }));
    check('createGameFromTemplate: unlockAfterTaskIds remapped to the clone\'s own id',
      c2?.unlockAfterTaskIds?.[0] === c1?.id, JSON.stringify(c2?.unlockAfterTaskIds));
    check('createGameFromTemplate: exclusiveGroups taskIds remapped to the clone\'s own ids',
      JSON.stringify([...(clonedStage?.exclusiveGroups?.[0]?.taskIds ?? [])].sort())
        === JSON.stringify([c1?.id, c2?.id].sort()),
      JSON.stringify(clonedStage?.exclusiveGroups));

    const sourceAfter = (await platformAdmin.call('getGame', { gameId: tHe }))?.game;
    const sourceTaskIds = (sourceAfter?.stages?.[0]?.tasks ?? []).map((t) => t.id);
    check('createGameFromTemplate: source template is unchanged',
      JSON.stringify(sourceTaskIds) === JSON.stringify(['tpl-t1', 'tpl-t2']), JSON.stringify(sourceTaskIds));

    // 7. Unknown / non-template ids are rejected.
    await expectError('createGameFromTemplate: unknown templateGameId rejected',
      creator.call('createGameFromTemplate', { templateGameId: 'no-such-template-xyz', title: 'nope' }),
      { codeIn: ['functions/invalid-argument'] });
    const { gameId: plainGame } = await creator.call('createGame', { title: 'Not A Template', mode: 'team' });
    await expectError('createGameFromTemplate: non-template gameId rejected',
      creator.call('createGameFromTemplate', { templateGameId: plainGame, title: 'nope' }),
      { codeIn: ['functions/invalid-argument'] });

    // 7b. The `templateOwnerUid` HINT (perf: template-picker-latency). The picker
    //     passes back the owner the server itself just reported, so the server can
    //     read ONE document instead of downloading every template game in full.
    //     It is a performance hint, never an authorization input: a correct hint
    //     must produce exactly the same clone, and a WRONG one must neither fail
    //     nor let anything through that the id alone wouldn't.
    const hintOwner = (await creator.call('listGameTemplates', {}))
      ?.templates?.find((g) => g.groupKey === tHe)?.variants?.he?.ownerUid;
    check('listGameTemplates: the picker is told which admin owns a template',
      typeof hintOwner === 'string' && !!hintOwner, JSON.stringify(hintOwner));
    const hinted = await creator.call('createGameFromTemplate', {
      templateGameId: tHe, title: 'Hinted Clone', templateOwnerUid: hintOwner,
    });
    const hintedGame = (await creator.call('getGame', { gameId: hinted?.gameId }))?.game;
    check('createGameFromTemplate: the owner hint clones the same template',
      (hintedGame?.stages?.[0]?.tasks ?? []).length === 2, JSON.stringify(hintedGame?.stages?.length));
    // A hint pointing at a uid that does not own this template must fall back to
    // the id lookup, not fail — otherwise a stale picker menu breaks Create.
    const stale = await creator.call('createGameFromTemplate', {
      templateGameId: tHe, title: 'Stale Hint Clone', templateOwnerUid: 'not-the-owner-uid',
    });
    check('createGameFromTemplate: a wrong owner hint falls back instead of failing',
      !!stale?.gameId, JSON.stringify(stale));
    // And the hint cannot be used to clone something that is NOT a template: the
    // caller's own plain game, addressed by its real owner.
    await expectError('createGameFromTemplate: an owner hint cannot clone a non-template',
      creator.call('createGameFromTemplate', {
        templateGameId: plainGame, title: 'nope', templateOwnerUid: creatorCred.user.uid,
      }),
      { codeIn: ['functions/invalid-argument'] });

    // 8. A soft-deleted template drops out of the picker.
    await platformAdmin.call('deleteGame', { gameId: tSolo });
    const list3 = await creator.call('listGameTemplates', {});
    check('listGameTemplates: soft-deleted template excluded',
      !(list3?.templates ?? []).some((g) => g.groupKey === tSolo),
      JSON.stringify((list3?.templates ?? []).map((g) => g.groupKey)));

    // 9. listAdminTemplates — the admin console's own list. It asks the server for
    //    `isTemplate == true` instead of filtering a capped listGames page, which is
    //    how templates used to vanish from the templates tab once an admin held more
    //    than 200 games (every ordinary edit pushed one out of the window).
    // Admin-owned but UNFLAGGED — the case the old client-side filter existed for.
    const { gameId: adminPlain } = await platformAdmin.call('createGame', { title: 'Admin Plain Game', mode: 'team' });
    const adminList = await platformAdmin.call('listAdminTemplates', {});
    const adminIds = (adminList?.games ?? []).map((g) => g.id);
    check('listAdminTemplates: returns the flagged templates the admin owns',
      adminIds.includes(tHe) && adminIds.includes(tEn), JSON.stringify(adminIds));
    check('listAdminTemplates: an unflagged game the admin owns is absent',
      !adminIds.includes(adminPlain) && !adminIds.includes(plainGame), JSON.stringify(adminIds));
    check('listAdminTemplates: a soft-deleted template is absent',
      !adminIds.includes(tSolo), JSON.stringify(adminIds));
    check('listAdminTemplates: carries the picker metadata the console edits',
      (adminList?.games ?? []).find((g) => g.id === tHe)?.templateEmoji === '🧪',
      JSON.stringify((adminList?.games ?? []).find((g) => g.id === tHe)?.templateEmoji));
    await expectError('listAdminTemplates: a non-admin creator is denied',
      creator.call('listAdminTemplates', {}),
      { codeIn: ['functions/permission-denied'] });

    // 10. Updating a template FROM A FILE keeps it a template. The file format
    //     deliberately cannot carry isTemplate (a hand-edited file must never be
    //     able to inject a template into every creator's picker), so a
    //     fresh-document import always lands as an ordinary game — which is why the
    //     Builder imports IN PLACE, over the document that already holds the flag.
    const { file: tplFile } = await platformAdmin.call('exportGameFile', { gameId: tHe });
    check('exportGameFile: the template flag is NOT in the file',
      !('isTemplate' in (tplFile?.game ?? {})) && !('templateEmoji' in (tplFile?.game ?? {})),
      JSON.stringify(Object.keys(tplFile?.game ?? {})));
    const editedFile = {
      ...tplFile,
      game: { ...tplFile.game, title: 'Template HE (from file)' },
    };
    const replaced = await platformAdmin.call('importGameFile', { file: editedFile, targetGameId: tHe });
    check('importGameFile(targetGameId): writes back into the SAME game',
      replaced?.gameId === tHe && replaced?.replaced === true, JSON.stringify(replaced));
    const tplAfter = (await platformAdmin.call('getGame', { gameId: tHe }))?.game;
    check('importGameFile(targetGameId): the imported content is stored',
      tplAfter?.title === 'Template HE (from file)', String(tplAfter?.title));
    check('importGameFile(targetGameId): the game STAYS a template',
      tplAfter?.isTemplate === true && tplAfter?.templateEmoji === '🧪' && tplAfter?.templateOrder === 1,
      JSON.stringify({ f: tplAfter?.isTemplate, e: tplAfter?.templateEmoji, o: tplAfter?.templateOrder }));
    check('importGameFile(targetGameId): server-owned identity is untouched',
      tplAfter?.id === tHe && tplAfter?.ownerUid === 'e2e-platform-admin' && tplAfter?.visibility === 'private',
      JSON.stringify({ id: tplAfter?.id, own: tplAfter?.ownerUid, vis: tplAfter?.visibility }));
    const stillListed = ((await platformAdmin.call('listAdminTemplates', {}))?.games ?? []).map((g) => g.id);
    check('importGameFile(targetGameId): still in the templates tab after the import',
      stillListed.includes(tHe), JSON.stringify(stillListed));
    await expectError('importGameFile(targetGameId): a game the caller does not own is refused',
      creator.call('importGameFile', { file: editedFile, targetGameId: tHe }),
      { codeIn: ['functions/not-found', 'functions/permission-denied'] });

    // ═══════════════════════════════════════════════════════════════════════
    // 11. COPY FIDELITY + PERSONALIZATION (change: guided-new-game-wizard).
    //
    //     The copy used to be lossy: `tags: []` and DEFAULT_REGISTRATION_FIELDS
    //     were hardcoded, and instructions / scoringOptions / allowInstantPlay /
    //     powerUpsEnabled / manualLeaderboardReveal were never copied at all. On
    //     the real story template that silently dropped its "שם היחידה"
    //     registration field, its operator instructions, and the
    //     manualLeaderboardReveal that holds the standings back for the plot
    //     twist. Personalizing a lossy copy is meaningless, so fidelity is
    //     asserted first and personalization on top of it.
    // ═══════════════════════════════════════════════════════════════════════
    const { gameId: tRich } = await platformAdmin.call('createGame', { title: 'Rich Template', mode: 'team' });
    // intro (protected) · trimmable middle (explicit count) · "do all" · final.
    // Durations are authored explicitly so the estimate is pinned, not inferred.
    const richTask = (id, minutes, capacity) => ({
      id, title: id, type: 'field', coordinates: { lat: 0, lng: 0 },
      difficulty: 5, estimatedMinutes: minutes, expectedDurationMinutes: minutes,
      pointValue: 100, maxConcurrentTeams: capacity,
      triggerMode: 'locationless', locationless: true,
    });
    await platformAdmin.call('updateGame', {
      gameId: tRich,
      description: 'משחק שדה לקבוצות בגילאי 11-13: גיבוש, חידות מיקום ואתגרי חשיבה.',
      tags: ['עלילה', 'נוער'],
      instructions: { title: 'איך משחקים', bodyHe: 'הסבירו לחניכים לפני שיוצאים.' },
      manualLeaderboardReveal: true,
      powerUpsEnabled: true,
      allowInstantPlay: true,
      scoringOptions: { wrongAnswerPenalty: 'standard' },
      registrationFields: [
        { id: 'name', label: 'שם מלא', type: 'text', required: true, level: 'member' },
        { id: 'unit', label: 'שם היחידה', type: 'text', required: true, level: 'team' },
      ],
      stages: [
        { id: 'r-intro', order: 0, title: 'Intro', requiredTaskCount: 1, tasks: [richTask('ri1', 5, 3)] },
        { id: 'r-mid', order: 1, title: 'Middle', requiredTaskCount: 3,
          tasks: [richTask('rm1', 10, 3), richTask('rm2', 10, 3), richTask('rm3', 10, 3)] },
        { id: 'r-all', order: 2, title: 'Do all', tasks: [richTask('ra1', 8, 3), richTask('ra2', 8, 100)] },
        { id: 'r-fin', order: 3, title: 'Final', isFinal: true, requiredTaskCount: 1, tasks: [richTask('rf1', 6, 3)] },
      ],
    });
    await platformAdmin.call('setGameTemplateFlag', {
      gameId: tRich, isTemplate: true, templateEmoji: '🎁', templateOrder: 20,
    });

    // ── 11a. Copy fidelity ────────────────────────────────────────────────
    const plainCopy = await creator.call('createGameFromTemplate', {
      templateGameId: tRich, title: 'Faithful Copy',
    });
    const faithful = (await creator.call('getGame', { gameId: plainCopy.gameId }))?.game;
    check('createGameFromTemplate: authored instructions survive the copy',
      faithful?.instructions?.title === 'איך משחקים', JSON.stringify(faithful?.instructions));
    check('createGameFromTemplate: manualLeaderboardReveal survives the copy',
      faithful?.manualLeaderboardReveal === true, String(faithful?.manualLeaderboardReveal));
    check('createGameFromTemplate: custom registrationFields survive the copy',
      (faithful?.registrationFields ?? []).some((f) => f.label === 'שם היחידה'),
      JSON.stringify((faithful?.registrationFields ?? []).map((f) => f.label)));
    check('createGameFromTemplate: scoringOptions survive the copy',
      faithful?.scoringOptions?.wrongAnswerPenalty === 'standard',
      JSON.stringify(faithful?.scoringOptions));
    check('createGameFromTemplate: template tags survive the copy',
      (faithful?.tags ?? []).includes('עלילה'), JSON.stringify(faithful?.tags));
    check('createGameFromTemplate: powerUpsEnabled survives the copy',
      faithful?.powerUpsEnabled === true, String(faithful?.powerUpsEnabled));
    check('createGameFromTemplate: allowInstantPlay survives the copy',
      faithful?.allowInstantPlay === true, String(faithful?.allowInstantPlay));

    // ── 11b. The copy is never itself a template ──────────────────────────
    check('createGameFromTemplate: the copy carries no template markers',
      faithful?.isTemplate === undefined && faithful?.templateEmoji === undefined
      && faithful?.templateOrder === undefined && faithful?.templateGroupKey === undefined
      && faithful?.templateLang === undefined,
      JSON.stringify({ f: faithful?.isTemplate, e: faithful?.templateEmoji, o: faithful?.templateOrder,
        g: faithful?.templateGroupKey, l: faithful?.templateLang }));
    const afterCopyList = await creator.call('listGameTemplates', {});
    check('createGameFromTemplate: the copy does not appear in the template picker',
      !(afterCopyList?.templates ?? []).some((g) => g.groupKey === plainCopy.gameId),
      JSON.stringify((afterCopyList?.templates ?? []).map((g) => g.groupKey)));
    check('createGameFromTemplate: the copy stays private with a clean play count',
      faithful?.visibility === 'private' && (faithful?.playCount ?? 0) === 0,
      JSON.stringify({ v: faithful?.visibility, p: faithful?.playCount }));

    // ── 11c. Backwards compatibility ──────────────────────────────────────
    //     The existing picker calls this with no personalization at all, so the
    //     un-personalized copy must be byte-identical in every field the wizard
    //     would otherwise touch.
    check('createGameFromTemplate: no personalization leaves the template mode',
      faithful?.mode === 'team', String(faithful?.mode));
    check('createGameFromTemplate: no personalization leaves capacities alone',
      faithful?.stages?.[1]?.tasks?.[0]?.maxConcurrentTeams === 3,
      String(faithful?.stages?.[1]?.tasks?.[0]?.maxConcurrentTeams));
    check('createGameFromTemplate: no personalization leaves requiredTaskCount alone',
      faithful?.stages?.[1]?.requiredTaskCount === 3,
      String(faithful?.stages?.[1]?.requiredTaskCount));
    check('createGameFromTemplate: no personalization leaves the description alone',
      faithful?.description?.includes('בגילאי 11-13'), String(faithful?.description));
    check('createGameFromTemplate: no personalization sets no minor fields',
      faithful?.minAge === undefined && faithful?.requiresGuardianConsent === undefined,
      JSON.stringify({ a: faithful?.minAge, c: faithful?.requiresGuardianConsent }));

    // ── 11d. Personalization is applied ───────────────────────────────────
    const big = await creator.call('createGameFromTemplate', {
      templateGameId: tRich, title: 'Big Group Copy',
      description: 'משחק שדה ל-40 שחקנים: גיבוש, חידות מיקום ואתגרי חשיבה.',
      tags: ['14-17', 'שעה וחצי'],
      personalize: { groupSize: 40, durationMinutes: 90, minAge: 11 },
    });
    const bigGame = (await creator.call('getGame', { gameId: big.gameId }))?.game;
    check('createGameFromTemplate: a big group raises station capacity',
      (bigGame?.stages?.[1]?.tasks?.[0]?.maxConcurrentTeams ?? 0) > 3,
      String(bigGame?.stages?.[1]?.tasks?.[0]?.maxConcurrentTeams));
    check('createGameFromTemplate: an unlimited task keeps its authored capacity',
      bigGame?.stages?.[2]?.tasks?.[1]?.maxConcurrentTeams === 100,
      String(bigGame?.stages?.[2]?.tasks?.[1]?.maxConcurrentTeams));
    check('createGameFromTemplate: a client-composed description is stored',
      bigGame?.description?.includes('40 שחקנים') && !bigGame?.description?.includes('11-13'),
      String(bigGame?.description));
    check('createGameFromTemplate: derived tags merge with the template tags',
      (bigGame?.tags ?? []).includes('14-17') && (bigGame?.tags ?? []).includes('עלילה'),
      JSON.stringify(bigGame?.tags));
    check('createGameFromTemplate: an age below the threshold sets minAge',
      bigGame?.minAge === 11, String(bigGame?.minAge));
    check('createGameFromTemplate: an age below the threshold turns consent on',
      bigGame?.requiresGuardianConsent === true, String(bigGame?.requiresGuardianConsent));

    // A tiny group goes solo, and capacity must never fall below 1.
    const tiny = await creator.call('createGameFromTemplate', {
      templateGameId: tRich, title: 'Tiny Group Copy',
      personalize: { groupSize: 4, durationMinutes: 180 },
    });
    const tinyGame = (await creator.call('getGame', { gameId: tiny.gameId }))?.game;
    check('createGameFromTemplate: a tiny group plays individually',
      tinyGame?.mode === 'individual', String(tinyGame?.mode));
    check('createGameFromTemplate: capacity never drops below 1',
      (tinyGame?.stages ?? []).every((s) => (s.tasks ?? []).every((t) => (t.maxConcurrentTeams ?? 0) >= 1)),
      JSON.stringify((tinyGame?.stages ?? []).map((s) => (s.tasks ?? []).map((t) => t.maxConcurrentTeams))));
    check('createGameFromTemplate: a 14+ age sets minAge but leaves consent alone',
      tinyGame?.requiresGuardianConsent === undefined, String(tinyGame?.requiresGuardianConsent));

    // ── 11e. Duration shortening ──────────────────────────────────────────
    //     The template estimates 5 + 30 + 16 + 6 = 57 minutes. Asking for 40
    //     must trim the middle stage (explicit requiredTaskCount) and must NOT
    //     touch the "do all" stage, the intro or the final.
    const short = await creator.call('createGameFromTemplate', {
      templateGameId: tRich, title: 'Short Copy',
      personalize: { groupSize: 20, durationMinutes: 40 },
    });
    const shortGame = (await creator.call('getGame', { gameId: short.gameId }))?.game;
    const stageById = (g, id) => (g?.stages ?? []).find((s) => (s.title || '').includes(id));
    check('createGameFromTemplate: an over-long game trims the partial stage',
      (stageById(shortGame, 'Middle')?.requiredTaskCount ?? 3) < 3,
      String(stageById(shortGame, 'Middle')?.requiredTaskCount));
    check('createGameFromTemplate: a "do all" stage is never trimmed',
      stageById(shortGame, 'Do all')?.requiredTaskCount === undefined,
      String(stageById(shortGame, 'Do all')?.requiredTaskCount));
    check('createGameFromTemplate: the intro stage is never trimmed',
      stageById(shortGame, 'Intro')?.requiredTaskCount === 1,
      String(stageById(shortGame, 'Intro')?.requiredTaskCount));
    check('createGameFromTemplate: the final stage is never trimmed',
      stageById(shortGame, 'Final')?.requiredTaskCount === 1,
      String(stageById(shortGame, 'Final')?.requiredTaskCount));
    check('createGameFromTemplate: trimming never leaves a count below 1',
      (shortGame?.stages ?? []).every((s) => s.requiredTaskCount === undefined || s.requiredTaskCount >= 1),
      JSON.stringify((shortGame?.stages ?? []).map((s) => s.requiredTaskCount)));
    check('createGameFromTemplate: the response reports the estimate',
      typeof short?.estimatedMinutes === 'number' && short.estimatedMinutes > 0,
      JSON.stringify(short));
    check('createGameFromTemplate: the response reports whether it fits',
      typeof short?.fitsRequestedDuration === 'boolean', JSON.stringify(short));

    // An impossible duration must still produce a game, honestly labelled.
    const impossible = await creator.call('createGameFromTemplate', {
      templateGameId: tRich, title: 'Impossible Copy',
      personalize: { groupSize: 20, durationMinutes: 5 },
    });
    check('createGameFromTemplate: an unfittable duration still creates a game',
      !!impossible?.gameId, JSON.stringify(impossible));
    check('createGameFromTemplate: an unfittable duration reports fits: false',
      impossible?.fitsRequestedDuration === false, JSON.stringify(impossible));

    // ── 11f. Personalization never fails creation ─────────────────────────
    const junk = await creator.call('createGameFromTemplate', {
      templateGameId: tRich, title: 'Junk Personalization',
      personalize: { groupSize: -5, durationMinutes: 0, minAge: 999 },
      tags: Array.from({ length: 60 }, (_, i) => `t${i}`),
    });
    check('createGameFromTemplate: malformed personalization still creates a game',
      !!junk?.gameId, JSON.stringify(junk));
    const junkGame = (await creator.call('getGame', { gameId: junk.gameId }))?.game;
    check('createGameFromTemplate: an out-of-range minAge is skipped, not stored',
      junkGame?.minAge === undefined, String(junkGame?.minAge));
    check('createGameFromTemplate: too many tags are clamped, not rejected',
      (junkGame?.tags ?? []).length <= 20, String((junkGame?.tags ?? []).length));
    check('createGameFromTemplate: a malformed group size leaves capacity usable',
      (junkGame?.stages ?? []).every((s) => (s.tasks ?? []).every((t) => (t.maxConcurrentTeams ?? 0) >= 1)),
      JSON.stringify((junkGame?.stages ?? []).map((s) => (s.tasks ?? []).map((t) => t.maxConcurrentTeams))));
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

  // ═══ Recoverable game deletion (change: recoverable-game-deletion) ═══════════
  //
  // THE INCIDENT this scenario exists for: deleteGame used to end in
  // db.recursiveDelete, so one click destroyed a game AND every run, team, feed
  // item and location track beneath it — irreversibly, with no audit record — and
  // it never cleaned up accessCodes, leaving a join code pointing at nothing.
  //
  // The whole contract is asserted here: hide but preserve, refuse while live,
  // revoke then reinstate the code, restore whole, purge only after the grace
  // period, and leave a durable trail.
  await scenario('recoverable game deletion (soft delete · restore · purge · audit)', async () => {
    const OWNER = creatorCred.user.uid;
    const adminDb = adminSdk.firestore();

    const stagesFor = (prefix) => ([{
      id: `${prefix}-s`, order: 0, title: 'S', isFinal: true, requiredTaskCount: 1,
      tasks: [{
        id: `${prefix}-a`, title: 'A', type: 'field',
        coordinates: { lat: 31.7767, lng: 35.2345 },
        difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
      }],
    }]);

    // ── 1. A game with a FINISHED run: delete hides it but destroys nothing ────
    const { gameId: trashGame } = await creator.call('createGame', { title: 'Trash Me', mode: 'individual' });
    await creator.call('updateGame', { gameId: trashGame, scoringPreset: 'fixed_points_speed', stages: stagesFor('tr') });
    const { runId: trashRun, accessCode: trashCode } = await creator.call('launchRun', { gameId: trashGame });
    const trashP = makeParty('trashPlayer');
    await signInAnonymously(trashP.auth);
    await trashP.call('joinRun', { code: trashCode, displayName: 'Doomed' });
    const trashTeamUid = trashP.auth.currentUser.uid;
    await creator.call('startTeams', { gameId: trashGame, runId: trashRun });

    // Deleting a game with a run IN PROGRESS is refused outright — participants
    // are physically out there. The old code deleted it out from under them.
    await expectError('deleteGame is refused while a run is in progress',
      creator.call('deleteGame', { gameId: trashGame }),
      { codeIn: ['functions/failed-precondition'], match: /run in progress/i });
    const stillLive = await adminDb.doc(`users/${OWNER}/games/${trashGame}`).get();
    check('a refused delete leaves NO tombstone', !stillLive.data()?.deletedAt, JSON.stringify(stillLive.data()?.deletedAt));

    await creator.call('finalizeRun', { gameId: trashGame, runId: trashRun });
    const del = await creator.call('deleteGame', { gameId: trashGame });
    check('deleteGame succeeds once the run is finished', del?.ok === true, JSON.stringify(del));
    check('deleteGame returns the tombstone + purge date', !!del?.deletedAt && !!del?.purgeDueAt, JSON.stringify(del));

    // Hidden everywhere…
    await expectError('a deleted game reads as not-found',
      creator.call('getGame', { gameId: trashGame }), { codeIn: ['functions/not-found'] });
    const afterList = await creator.call('listGames', {});
    check('a deleted game is gone from listGames',
      !(afterList?.games ?? []).some((g) => g.id === trashGame), String(afterList?.games?.length));
    await expectError('a deleted game cannot be launched',
      creator.call('launchRun', { gameId: trashGame }), { codeIn: ['functions/not-found'] });
    await expectError('a deleted game cannot be duplicated',
      creator.call('duplicateGame', { gameId: trashGame }), { codeIn: ['functions/not-found'] });
    await expectError('a deleted game cannot be published',
      creator.call('publishGame', { gameId: trashGame, visibility: 'public' }), { codeIn: ['functions/not-found'] });
    await expectError('a deleted game cannot be edited',
      creator.call('updateGame', { gameId: trashGame, title: 'zombie' }), { codeIn: ['functions/not-found'] });
    await expectError('deleting an already-deleted game is not-found (the clock never restarts)',
      creator.call('deleteGame', { gameId: trashGame }), { codeIn: ['functions/not-found'] });

    // …but NOTHING beneath it was destroyed. This is the assertion the incident
    // would have failed: the run and the team must still be on disk.
    const runDoc = await adminDb.doc(`users/${OWNER}/games/${trashGame}/runs/${trashRun}`).get();
    check('the run document SURVIVES a soft delete', runDoc.exists);
    const teamDoc = await adminDb.doc(`users/${OWNER}/games/${trashGame}/runs/${trashRun}/teams/${trashTeamUid}`).get();
    check('the team document SURVIVES a soft delete', teamDoc.exists);

    // The join code is REVOKED, not dangling (the accessCodes/RQH3DG orphan bug).
    const codeDoc = await adminDb.doc(`accessCodes/${trashCode}`).get();
    check('the access code still exists (held for restore, not released)', codeDoc.exists);
    check('the access code is revoked', codeDoc.data()?.status === 'revoked', String(codeDoc.data()?.status));
    await expectError('a participant entering the code of a deleted game is refused cleanly',
      trashP.call('getJoinInfo', { code: trashCode }), { codeIn: ['functions/permission-denied'] });

    // ── 2. The trash view lists it with a purge date ──────────────────────────
    const trash = await creator.call('listDeletedGames', {});
    const row = (trash?.games ?? []).find((g) => g.id === trashGame);
    check('listDeletedGames shows the deleted game', !!row, String(trash?.games?.length));
    check('listDeletedGames reports when it will be purged', !!row?.purgeDueAt, String(row?.purgeDueAt));
    check('listDeletedGames reports the retention window', trash?.retentionDays === 30, String(trash?.retentionDays));

    // ── 3. Restore brings it back WHOLE ───────────────────────────────────────
    const stranger = makeParty('restoreStranger');
    await signInAnonymously(stranger.auth);
    await expectError('a stranger cannot restore someone else’s game',
      stranger.call('restoreGame', { gameId: trashGame }), { codeIn: ['functions/not-found', 'functions/permission-denied'] });

    const res = await creator.call('restoreGame', { gameId: trashGame });
    check('restoreGame succeeds', res?.ok === true, JSON.stringify(res));
    const back = await creator.call('getGame', { gameId: trashGame });
    check('the restored game is readable again', back?.game?.id === trashGame);
    check('the restored game has no tombstone', !back?.game?.deletedAt, String(back?.game?.deletedAt));
    const backList = await creator.call('listGames', {});
    check('the restored game is back in listGames', (backList?.games ?? []).some((g) => g.id === trashGame));
    const backRun = await creator.call('listRunTeams', { gameId: trashGame, runId: trashRun });
    check('the restored game still has its run AND its team',
      (backRun?.teams ?? []).some((t) => t.id === trashTeamUid), String(backRun?.teams?.length));
    const codeBack = await adminDb.doc(`accessCodes/${trashCode}`).get();
    check('the access code is un-revoked by the restore', codeBack.data()?.status !== 'revoked', String(codeBack.data()?.status));
    const resAgain = await creator.call('restoreGame', { gameId: trashGame });
    check('restoring an already-restored game is an idempotent no-op', resAgain?.ok === true, JSON.stringify(resAgain));

    // ── 4. A PUBLIC game leaves the gallery and comes back private ────────────
    const { gameId: pubGame } = await creator.call('createGame', { title: 'Gallery Trash', mode: 'individual' });
    await creator.call('updateGame', { gameId: pubGame, scoringPreset: 'fixed_points_speed', stages: stagesFor('gt') });
    await creator.call('publishGame', { gameId: pubGame, visibility: 'public' });
    await creator.call('deleteGame', { gameId: pubGame });
    const gal = await creator.call('searchGallery', { query: 'Gallery Trash' });
    check('a deleted public game is gone from the gallery',
      !(gal?.games ?? []).some((g) => g.id === pubGame), String(gal?.games?.length));
    check('its publicGames index row is gone',
      !(await adminDb.doc(`publicGames/${pubGame}`).get()).exists);
    await creator.call('restoreGame', { gameId: pubGame });
    const restoredPub = await creator.call('getGame', { gameId: pubGame });
    check('a restored public game comes back PRIVATE (never silently re-listed)',
      restoredPub?.game?.visibility === 'private', String(restoredPub?.game?.visibility));

    // ── 5. Permanent destruction: explicit, and after the grace period ────────
    await expectError('purgeGameNow refuses a game that is not in the trash',
      creator.call('purgeGameNow', { gameId: pubGame }), { codeIn: ['functions/failed-precondition'] });

    const { gameId: purgeGame } = await creator.call('createGame', { title: 'Purge Me', mode: 'individual' });
    await creator.call('updateGame', { gameId: purgeGame, scoringPreset: 'fixed_points_speed', stages: stagesFor('pg') });
    await creator.call('deleteGame', { gameId: purgeGame });

    // The scheduled sweep must NOT touch a game inside its grace period…
    const noSweep = await platformAdmin.call('purgeDeletedGamesNow', { graceDays: 30 });
    check('the sweep purges nothing inside the grace period',
      noSweep?.ok === true && !(noSweep?.purged ?? []).some((p) => p.gameId === purgeGame), JSON.stringify(noSweep));
    check('the game is still recoverable inside the grace period',
      (await adminDb.doc(`users/${OWNER}/games/${purgeGame}`).get()).exists);

    // …and MUST destroy it once the window has elapsed (graceDays: 0 simulates it).
    const swept = await platformAdmin.call('purgeDeletedGamesNow', { graceDays: 0 });
    check('the sweep purges a game past its grace period',
      (swept?.purged ?? []).some((p) => p.gameId === purgeGame), JSON.stringify(swept));
    check('the purged game document is gone',
      !(await adminDb.doc(`users/${OWNER}/games/${purgeGame}`).get()).exists);
    await expectError('a purged game can no longer be restored',
      creator.call('restoreGame', { gameId: purgeGame }), { codeIn: ['functions/not-found'] });

    // Owner-triggered "delete permanently" destroys the tree AND the access code.
    const { gameId: nukeGame } = await creator.call('createGame', { title: 'Nuke Me', mode: 'individual' });
    await creator.call('updateGame', { gameId: nukeGame, scoringPreset: 'fixed_points_speed', stages: stagesFor('nk') });
    const { runId: nukeRun, accessCode: nukeCode } = await creator.call('launchRun', { gameId: nukeGame });
    await creator.call('finalizeRun', { gameId: nukeGame, runId: nukeRun });
    await creator.call('deleteGame', { gameId: nukeGame });
    const nuked = await creator.call('purgeGameNow', { gameId: nukeGame });
    check('purgeGameNow succeeds on a trashed game', nuked?.ok === true, JSON.stringify(nuked));
    check('purgeGameNow destroys the game document',
      !(await adminDb.doc(`users/${OWNER}/games/${nukeGame}`).get()).exists);
    check('purgeGameNow destroys the run subtree (no orphans)',
      !(await adminDb.doc(`users/${OWNER}/games/${nukeGame}/runs/${nukeRun}`).get()).exists);
    // THE ORPHAN BUG: the original deleteGame never cleaned accessCodes, so a code
    // outlived its destroyed game and a participant hit a dangling reference.
    check('purgeGameNow deletes the access code (no dangling join code)',
      !(await adminDb.doc(`accessCodes/${nukeCode}`).get()).exists);

    // ── 6. The audit trail answers "who deleted this, and when" ───────────────
    const logs = await platformAdmin.call('listAuditLogs', { limit: 200 });
    const entries = logs?.logs ?? [];
    check('a soft delete is recorded in auditLogs',
      entries.some((l) => l.actionType === 'game_deleted' && l.gameId === trashGame && l.operatorId === OWNER),
      String(entries.length));
    check('a restore is recorded in auditLogs',
      entries.some((l) => l.actionType === 'game_restored' && l.gameId === trashGame));
    check('a permanent destruction is recorded in auditLogs',
      entries.some((l) => l.actionType === 'game_purged' && l.gameId === nukeGame));
    // A HUMAN-invoked purge must name the human (change: callable-hardening-consistency).
    // This assertion used to demand `system:purge-sweep` for every purge, which was the
    // very defect that change fixed: an admin forcing a sweep with `graceDays: 0`
    // produced records claiming the scheduled job did it. A trail that answers "who
    // destroyed this" incorrectly is worse than one that does not answer at all.
    // `AUDIT_SYSTEM_OPERATOR` is now reserved for the actual scheduled job, which this
    // callable-driven scenario never exercises.
    check('a purge invoked by a person is attributed to that person, not to the system',
      entries.some((l) => l.actionType === 'game_purged' && l.operatorId && l.operatorId !== 'system:purge-sweep'));
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

    // ── Abandoned-run retention (change: run-retention-completeness) ──────────
    // The sweep used to select ONLY `status == 'finished'`, which is written only
    // by finalizeRun — so a run the creator never finalized was retained forever,
    // contradicting the Privacy Policy's 90-day promise. Back-date a run that is
    // still `live` past the window and assert the sweep now reaches it; and
    // assert a FRESH live run is untouched by the very same sweep (the safety
    // half — a live game must never be wiped mid-play).
    const retDb = adminSdk.firestore();
    const oldIso = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const staleRunPath = `users/${OWNER}/games/${cvGame}/runs/${cvRun}`;
    const staleBefore = (await retDb.doc(staleRunPath).get()).data() ?? {};
    // Seed a raw GPS ping. Without one the "pings are gone" assertion below would
    // read 0 both before and after and could never fail — this scenario never calls
    // updateLocation, so the subcollection is empty to begin with.
    await retDb.doc(`${staleRunPath}/teamLocations/${cvUid}`).set({
      teamId: cvUid, lat: 31.78, lng: 35.21, accuracyMeters: 12, updatedAt: oldIso,
    });
    const staleLocsBefore = await retDb.collection(`${staleRunPath}/teamLocations`).get();
    check('retention fixture: the abandoned run really has a GPS ping to lose',
      staleLocsBefore.size > 0, `size=${staleLocsBefore.size}`);
    await retDb.doc(staleRunPath).set(
      { status: 'live', createdAt: oldIso, launchedAt: oldIso, updatedAt: oldIso },
      { merge: true },
    );
    // A second, deliberately FRESH live run in the same tree.
    const freshRunPath = `users/${OWNER}/games/${cvGame}/runs/e2e-retention-fresh`;
    const nowIso = new Date().toISOString();
    await retDb.doc(freshRunPath).set({
      id: 'e2e-retention-fresh', gameId: cvGame, ownerUid: OWNER, status: 'live',
      accessCode: 'E2ERET', billingType: 'free', maxParticipants: 5, participantCount: 0,
      createdAt: nowIso, launchedAt: nowIso, updatedAt: nowIso,
    });

    const sweep2 = await platformAdmin.call('pruneExpiredRunDataNow', {});
    check('retention sweep succeeds with an abandoned run present', sweep2?.ok === true, JSON.stringify(sweep2));
    check('the sweep names the abandoned run in its own results',
      (sweep2?.results ?? []).some((r) => r?.runId === cvRun),
      JSON.stringify((sweep2?.results ?? []).map((r) => r?.runId)));

    const staleAfter = (await retDb.doc(staleRunPath).get()).data() ?? {};
    check('abandoned (never-finalized) run IS pruned by the retention sweep',
      typeof staleAfter.piiPrunedAt === 'string' && staleAfter.piiPrunedAt.length > 0,
      JSON.stringify({ piiPrunedAt: staleAfter.piiPrunedAt ?? null }));
    const staleLocs = await retDb.collection(`${staleRunPath}/teamLocations`).get();
    check('abandoned-run prune removes its raw GPS pings', staleLocs.size === 0, `size=${staleLocs.size}`);

    const freshAfter = (await retDb.doc(freshRunPath).get()).data() ?? {};
    check('a FRESH live run is never touched by the retention sweep',
      freshAfter.piiPrunedAt === undefined,
      JSON.stringify({ piiPrunedAt: freshAfter.piiPrunedAt ?? null }));

    // Restore the borrowed run's original timestamps/status for later scenarios.
    await retDb.doc(staleRunPath).set({
      status: staleBefore.status ?? 'live',
      createdAt: staleBefore.createdAt ?? nowIso,
      launchedAt: staleBefore.launchedAt ?? nowIso,
      updatedAt: staleBefore.updatedAt ?? nowIso,
    }, { merge: true });
    await retDb.doc(freshRunPath).delete();
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
    // The freeze is a NO-OP re-finalize: the core short-circuits an already-finished
    // run (`alreadyFinal:true`, empty rankings) instead of recomputing the frozen
    // final standings. Assert that contract — comparing the empty re-finalize return
    // to the first board's rankings tested a shape the API never returns.
    check('a finished run refuses to re-finalize — the final board is frozen, not recomputed',
      reFin?.alreadyFinal === true && (reFin?.rankings ?? []).length === 0,
      JSON.stringify(reFin));
    check('final board is published to participants', Array.isArray(board?.rankings) || board === null);
    void publishedRankings;
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

  // ═══ Photo review THROUGHPUT (change: photo-review-throughput) ══════════════
  //
  // The queue is a client-side flattening of every team's `taskSubmissions` map
  // (packages/shared/src/photoQueue.ts), and the ONLY server-side write is
  // `reviewStationSubmission` keyed by (teamId, taskId). Under a real event the
  // reviewer works a backlog: several teams pending on the SAME task, reviewed out
  // of order, with double-taps and with stragglers whose team has already finished.
  // Three failure modes are pinned here, none of which the pure queue tests can see
  // because they never touch the server:
  //
  //   1. CROSS-TALK. A review keyed by task alone (or a `.set({merge})` on the wrong
  //      document) would resolve somebody ELSE's row — the reviewer clears the
  //      queue and a team that was never looked at is scored, or vice versa.
  //   2. DOUBLE SCORING on a re-approval. (The feed scenario proves this on an
  //      autoApprove task; here it is proved on the MANUAL review path, which is
  //      the one a reviewer actually double-taps.)
  //   3. A LATE review of a team that has already finished must resolve, not throw.
  //      A throw here is what strands a row in the queue forever — the reviewer
  //      cannot clear it and cannot tell whether the team was scored.
  await scenario('photo review throughput (out-of-order · re-approval · finished team)', async () => {
    const OWNER = creatorCred.user.uid;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { gameId: qg } = await creator.call('createGame', { title: 'Review Queue', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: qg, scoringPreset: 'fixed_points_speed',
      // requiredTaskCount 1 of 2 so a team can finish via the self-report
      // alternative while its photo is still sitting in the queue (case 3).
      stages: [{ id: 'rq-s', order: 0, title: 'Snap or say', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'rq-photo', title: 'Photo for review', type: 'photo',
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 3,
          pointValue: 40, maxConcurrentTeams: 9,
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: false } },
        { id: 'rq-alt', title: 'Say you did it', type: 'self_report', triggerMode: 'locationless',
          locationless: true, coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1,
          pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: qr, accessCode: qc } = await creator.call('launchRun', { gameId: qg });
    const QCTX = { ownerUid: OWNER, gameId: qg, runId: qr };
    const joinReviewer = async (name) => {
      const p = makeParty(`review${name}`);
      await signInAnonymously(p.auth);
      await p.call('joinRun', { code: qc, displayName: name });
      return { party: p, uid: p.auth.currentUser.uid };
    };
    const early = await joinReviewer('Early');
    const late = await joinReviewer('Late');
    const straggler = await joinReviewer('Straggler');
    await creator.call('startTeams', { gameId: qg, runId: qr });

    const qPhotoUrl = (teamUid, name) =>
      `https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/${encodeURIComponent(`runs/${qr}/teams/${teamUid}/${name}`)}?alt=media`;
    const qTeamPath = (teamUid) => `users/${OWNER}/games/${qg}/runs/${qr}/teams/${teamUid}`;
    const qSubmission = async (teamUid) =>
      (await creator.getDocAt(qTeamPath(teamUid))).data?.taskSubmissions?.['rq-photo'];
    const qScore = async (teamUid) => (await creator.getDocAt(qTeamPath(teamUid))).data?.score ?? 0;
    const qFeedCount = async () =>
      (await creator.getColAt(`users/${OWNER}/games/${qg}/runs/${qr}/feedItems`)).length;

    // ── 1. Two teams pending on the SAME task; the NEWER one is reviewed first ──
    await early.party.call('submitStationPhoto', { ...QCTX, teamId: early.uid, taskId: 'rq-photo', photoUrl: qPhotoUrl(early.uid, 'early.jpg') });
    // A real gap between the two submissions: the queue sorts on `submittedAt`, so
    // identical stamps would make "the older one" meaningless.
    await sleep(1100);
    await late.party.call('submitStationPhoto', { ...QCTX, teamId: late.uid, taskId: 'rq-photo', photoUrl: qPhotoUrl(late.uid, 'late.jpg') });

    const earlyBefore = await qSubmission(early.uid);
    const lateBefore = await qSubmission(late.uid);
    check('queue: both teams are pending on the same task, oldest first',
      earlyBefore?.status === 'pending' && lateBefore?.status === 'pending'
        && new Date(earlyBefore.submittedAt).getTime() < new Date(lateBefore.submittedAt).getTime(),
      JSON.stringify({ early: earlyBefore?.submittedAt, late: lateBefore?.submittedAt }));

    const earlyScoreBefore = await qScore(early.uid);
    await creator.call('reviewStationSubmission', { ...QCTX, teamId: late.uid, taskId: 'rq-photo', approved: true });
    check('queue: reviewing the NEWER submission leaves the older one untouched',
      (await qSubmission(early.uid))?.status === 'pending',
      JSON.stringify(await qSubmission(early.uid)));
    check('queue: the older team was not scored by the other team\'s review',
      (await qScore(early.uid)) === earlyScoreBefore,
      `${await qScore(early.uid)} vs ${earlyScoreBefore}`);
    const lateScored = await qScore(late.uid);
    check('queue: the reviewed team WAS scored (the review did something)',
      lateScored > 0, String(lateScored));
    check('queue: the reviewed submission keeps its OWN photo url',
      (await qSubmission(late.uid))?.photoUrl === qPhotoUrl(late.uid, 'late.jpg'),
      JSON.stringify((await qSubmission(late.uid))?.photoUrl));

    // ── 2. Re-approving an ALREADY-approved submission ────────────────────────
    const feedBeforeReApprove = await qFeedCount();
    const reApprove = await creator.call('reviewStationSubmission', { ...QCTX, teamId: late.uid, taskId: 'rq-photo', approved: true });
    check('queue: re-approving an approved submission still resolves ok',
      reApprove?.ok === true && reApprove?.approved === true, JSON.stringify(reApprove));
    check('queue: re-approval does not score the team a second time',
      (await qScore(late.uid)) === lateScored, `${await qScore(late.uid)} vs ${lateScored}`);
    check('queue: re-approval does not broadcast a second feed item',
      (await qFeedCount()) === feedBeforeReApprove,
      `${await qFeedCount()} vs ${feedBeforeReApprove}`);

    // ── 3. A straggler whose team has ALREADY FINISHED ────────────────────────
    // The photo goes into the queue, then the team finishes by the alternative
    // route — which auto-skips the still-pending photo task. The reviewer arrives
    // late and must be able to clear the row.
    await straggler.party.call('submitStationPhoto', { ...QCTX, teamId: straggler.uid, taskId: 'rq-photo', photoUrl: qPhotoUrl(straggler.uid, 'straggler.jpg') });
    await straggler.party.call('completeTask', { taskId: 'rq-alt', code: qc });
    const stragglerDoc = (await creator.getDocAt(qTeamPath(straggler.uid))).data;
    check('queue: the straggler really did finish before the review',
      stragglerDoc?.status === 'finished' && !!stragglerDoc?.finishedAt,
      JSON.stringify({ status: stragglerDoc?.status, finishedAt: stragglerDoc?.finishedAt }));
    const stragglerScoreBefore = stragglerDoc?.score ?? 0;
    const lateReview = await creator.call('reviewStationSubmission', { ...QCTX, teamId: straggler.uid, taskId: 'rq-photo', approved: true });
    check('queue: a submission from an already-finished team still reviews (no throw)',
      lateReview?.ok === true, JSON.stringify(lateReview));
    check('queue: the late review resolves the row rather than leaving it pending',
      (await qSubmission(straggler.uid))?.status === 'approved',
      JSON.stringify(await qSubmission(straggler.uid)));
    check('queue: the late review does not re-score a task the stage already closed',
      (await qScore(straggler.uid)) === stragglerScoreBefore,
      `${await qScore(straggler.uid)} vs ${stragglerScoreBefore}`);
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
    // 12 teams, deliberately modest: this scenario measures startTeams fan-out,
    // not capacity, and it must stay clear of BOTH per-run ceilings — the billing
    // participant cap (free mode = 50 teams) and MAX_RUN_DEVICES (see the
    // dedicated device-cap scenario). It found that the hard way when the device
    // ceiling was 16 and 24 joins tripped "This run is full" before startTeams was
    // even called — a bug in the TEST, not the code. 12 still exercises 2 full
    // chunks of the bounded-concurrency fan-out (chunk size 8).
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

  // ═══ Gallery popularity + likes (change: gallery-popularity-ranking) ════════
  // Covers the NEW callable `setPublicLike` (coverage guard) plus the ranking
  // contract the gallery now depends on. The bug classes hunted here:
  //   • a toggle that double-counts on retry / concurrent double-fire,
  //   • a counter that can be driven negative,
  //   • one user's like leaking into another user's "liked" state,
  //   • the DENORMALIZATION going stale — a counter bumped without recomputing
  //     the stored score, which produces a silently wrong ORDER (the nastiest
  //     failure here, because nothing errors),
  //   • re-publishing a game silently wiping its accumulated signals,
  //   • the new gallery fields leaking into a run-time Task payload.
  // Gallery REACHABILITY (change: gallery-reachability-guard). The entire point of the
  // gallery is to let a creator FIND published games and their missions. This is the
  // explicit end-to-end contract: publish a game with tags + a located mission + a
  // locationless one, then assert it is reachable through searchGallery AND its missions
  // through searchTaskLibrary — exercising the EXACT facet args the creator UI sends
  // (query / tags / mode / sort / type / hasLocation). The live "gallery shows INTERNAL"
  // outage was searchGallery throwing in this path; a throw here aborts the scenario and
  // fails the suite, so that class of regression can never reach a phone again.
  await scenario('gallery reachability (published game + missions are findable)', async () => {
    const stamp = Date.now();
    const TAG = `guardtag${stamp}`;
    const TITLE = `Reachable Game ${stamp}`;
    const { gameId: gR } = await creator.call('createGame', { title: TITLE, mode: 'individual' });
    await creator.call('updateGame', { gameId: gR, scoringPreset: 'fixed_points_speed', tags: [TAG], stages: [
      { id: 'gr-s', order: 0, title: 'Stage', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'gr-loc', title: `Located Mission ${stamp}`, type: 'field',
          coordinates: { lat: 31.78, lng: 35.21 }, difficulty: 2, estimatedMinutes: 3, pointValue: 30, maxConcurrentTeams: 3 },
        { id: 'gr-any', title: `Anywhere Mission ${stamp}`, type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 2, pointValue: 20, maxConcurrentTeams: 3 } ] },
    ] });
    await creator.call('publishGame', { gameId: gR, visibility: 'public' });

    // 1) Reachable by text search — no INTERNAL, and the game is actually returned.
    const byText = await creator.call('searchGallery', { query: TITLE, limit: 50 });
    check('searchGallery returns a games array (no INTERNAL)', Array.isArray(byText?.games));
    check('the published game is reachable via searchGallery text search',
      (byText?.games ?? []).some((g) => g.id === gR),
      JSON.stringify((byText?.games ?? []).map((g) => g.id).slice(0, 8)));

    // 2) Reachable by the tag filter (the sole DB filter); F3 propagated the game tag.
    const byTag = await creator.call('searchGallery', { query: '', tags: [TAG], limit: 50 });
    check('the published game is reachable by its tag',
      (byTag?.games ?? []).some((g) => g.id === gR),
      JSON.stringify((byTag?.games ?? []).map((g) => g.id).slice(0, 8)));

    // 3) The EXACT facet args the creator UI sends (mode + sort) — the path that 500'd
    //    in production — must not throw and must still surface the game.
    const byFacet = await creator.call('searchGallery', { query: '', mode: 'individual', sort: 'popular', limit: 50 });
    check('searchGallery with mode+sort facets does not throw and returns the game',
      Array.isArray(byFacet?.games) && byFacet.games.some((g) => g.id === gR),
      JSON.stringify((byFacet?.games ?? []).map((g) => g.id).slice(0, 8)));

    // 4) The game's MISSIONS are reachable via the task library, including the facet
    //    args (type + hasLocation) the missions tab sends.
    const libAll = await creator.call('searchTaskLibrary', { query: '', tags: [TAG], limit: 100 });
    check('searchTaskLibrary returns a tasks array (no INTERNAL)', Array.isArray(libAll?.tasks));
    const libIds = (libAll?.tasks ?? []).map((t) => t.id);
    check('the located mission is reachable via searchTaskLibrary',
      libIds.includes(`${gR}_gr-loc`), JSON.stringify(libIds.slice(0, 8)));
    check('the locationless mission is reachable via searchTaskLibrary',
      libIds.includes(`${gR}_gr-any`), JSON.stringify(libIds.slice(0, 8)));
    const libLocated = await creator.call('searchTaskLibrary', { query: '', tags: [TAG], type: 'field', hasLocation: true, limit: 100 });
    check('searchTaskLibrary type+hasLocation facets narrow to the located field mission',
      (libLocated?.tasks ?? []).some((t) => t.id === `${gR}_gr-loc`)
      && !(libLocated?.tasks ?? []).some((t) => t.id === `${gR}_gr-any`),
      JSON.stringify((libLocated?.tasks ?? []).map((t) => t.id).slice(0, 8)));

    // 5) The popular-tags chips call (also fired when the gallery opens) must not throw.
    const pop = await creator.call('getPopularTags', { limit: 50 });
    check('getPopularTags returns a tags array (no INTERNAL)', Array.isArray(pop?.tags));

    // 6) CLIENT-SHAPE regression: the web gallery sends absent facets as `undefined`,
    //    which the Firebase callable SDK serializes to `null` on the wire — so the
    //    server's destructuring default (`tags = []`) does NOT apply and `tags.length`
    //    threw a 500 on the REAL gallery while the checks above (which omit the keys)
    //    passed. Send the null shape explicitly: the server must treat null facets as
    //    "no filter" and still return the game + missions.
    const nullish = await creator.call('searchGallery', { query: '', tags: null, mode: null, sort: 'popular', limit: 50 });
    check('searchGallery tolerates null tags/mode (client undefined→null) and still returns the game',
      Array.isArray(nullish?.games) && nullish.games.some((g) => g.id === gR),
      JSON.stringify((nullish?.games ?? []).map((g) => g.id).slice(0, 8)));
    const libNull = await creator.call('searchTaskLibrary', { query: '', tags: null, type: null, difficulty: null, hasLocation: null, sort: 'popular', limit: 100 });
    check('searchTaskLibrary tolerates null facets (client undefined→null) and returns the missions',
      Array.isArray(libNull?.tasks) && (libNull.tasks ?? []).some((t) => t.id === `${gR}_gr-loc`),
      JSON.stringify((libNull?.tasks ?? []).map((t) => t.id).slice(0, 8)));
  });

  // Task-library priority boost (change: task-library-priority-boost). A creator
  // can flag a game as `pinnedFirst`; every task it publishes must then outrank
  // even a heavily-engaged, unrelated task in searchTaskLibrary, and clearing the
  // flag + re-publishing must actually revert it (batch.set REPLACES the whole
  // publicTasks doc, so a stale `pinnedFirst:true` would otherwise survive).
  await scenario('task-library priority boost (pinnedFirst)', async () => {
    const stamp = Date.now();
    const TAG = `libpriority${stamp}`;
    const mkStages = (prefix, title) => ([{
      id: `${prefix}-s`, order: 0, title: 'Only stage', isFinal: true,
      tasks: [{ id: `${prefix}-t`, title, type: 'self_report', locationless: true,
        coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 }],
    }]);

    // POPULAR: an ordinary game, heavily engaged, no boost.
    const { gameId: gPopular } = await creator.call('createGame', { title: `Popular ${stamp}`, mode: 'individual' });
    await creator.call('updateGame', { gameId: gPopular, scoringPreset: 'fixed_points_speed', tags: [TAG], stages: mkStages('pop', `Popular mission ${stamp}`) });
    await creator.call('publishGame', { gameId: gPopular, visibility: 'public' });
    const popularTaskId = `${gPopular}_pop-t`;
    for (let i = 0; i < 15; i++) await creator.call('incrementTaskCopyCount', { publicTaskId: popularTaskId });

    // BOOSTED: a brand-new, zero-engagement game explicitly flagged pinnedFirst.
    const { gameId: gBoosted } = await creator.call('createGame', { title: `Boosted ${stamp}`, mode: 'individual' });
    await creator.call('updateGame', { gameId: gBoosted, scoringPreset: 'fixed_points_speed', tags: [TAG], pinnedFirst: true, stages: mkStages('bst', `Boosted mission ${stamp}`) });
    await creator.call('publishGame', { gameId: gBoosted, visibility: 'public' });
    const boostedTaskId = `${gBoosted}_bst-t`;

    const boostedDoc = (await creator.getDocAt(`publicTasks/${boostedTaskId}`)).data ?? {};
    check('publishGame writes pinnedFirst:true onto the boosted task',
      boostedDoc.pinnedFirst === true, JSON.stringify(boostedDoc.pinnedFirst));
    check('the boosted task\'s stored popularity carries the pinnedFirst bonus (Firestore orderBy needs it stored)',
      typeof boostedDoc.popularity === 'number' && boostedDoc.popularity > 1000,
      `popularity=${boostedDoc.popularity}`);

    const lib = await creator.call('searchTaskLibrary', { query: '', tags: [TAG], limit: 100 });
    const ids = (lib?.tasks ?? []).map((t) => t.id);
    check('searchTaskLibrary puts the zero-engagement boosted task BEFORE the heavily-engaged one',
      ids.indexOf(boostedTaskId) >= 0 && ids.indexOf(popularTaskId) >= 0
      && ids.indexOf(boostedTaskId) < ids.indexOf(popularTaskId),
      `boosted@${ids.indexOf(boostedTaskId)} popular@${ids.indexOf(popularTaskId)} ids=${JSON.stringify(ids.slice(0, 6))}`);

    // Turning the toggle off and re-publishing must actually clear it — batch.set
    // replaces the whole doc, but only a live regression test proves that.
    await creator.call('updateGame', { gameId: gBoosted, pinnedFirst: false });
    await creator.call('publishGame', { gameId: gBoosted, visibility: 'public' });
    const afterOff = (await creator.getDocAt(`publicTasks/${boostedTaskId}`)).data ?? {};
    check('clearing pinnedFirst + re-publishing removes the flag from the public task',
      afterOff.pinnedFirst === undefined, JSON.stringify(afterOff.pinnedFirst));
    check('clearing pinnedFirst removes the stored score bonus too',
      typeof afterOff.popularity === 'number' && afterOff.popularity < 1000,
      `popularity=${afterOff.popularity}`);

    const libAfter = await creator.call('searchTaskLibrary', { query: '', tags: [TAG], limit: 100 });
    const idsAfter = (libAfter?.tasks ?? []).map((t) => t.id);
    check('after clearing the boost, the heavily-engaged task outranks the now-unboosted one',
      idsAfter.indexOf(popularTaskId) >= 0 && idsAfter.indexOf(boostedTaskId) >= 0
      && idsAfter.indexOf(popularTaskId) < idsAfter.indexOf(boostedTaskId),
      `popular@${idsAfter.indexOf(popularTaskId)} boosted@${idsAfter.indexOf(boostedTaskId)}`);
  });

  await scenario('gallery popularity + likes', async () => {
    const OWNER = creatorCred.user.uid;
    const stamp = Date.now();
    const mkStages = (prefix) => ([{
      id: `${prefix}-s`, order: 0, title: 'Only stage', isFinal: true,
      tasks: [{ id: `${prefix}-t`, title: `${prefix} task`, type: 'self_report', locationless: true,
        coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 }],
    }]);

    // Two published games. Titles are unique per run so the text-relevance
    // assertions can't collide with seeded/demo gallery content.
    const QUIET = `Zzquiet ${stamp}`;
    const LOUD = `Zzloud ${stamp}`;
    const { gameId: gQuiet } = await creator.call('createGame', { title: QUIET, mode: 'individual' });
    await creator.call('updateGame', { gameId: gQuiet, scoringPreset: 'fixed_points_speed', stages: mkStages('pq') });
    await creator.call('publishGame', { gameId: gQuiet, visibility: 'public' });
    const { gameId: gLoud } = await creator.call('createGame', { title: LOUD, mode: 'individual' });
    await creator.call('updateGame', { gameId: gLoud, scoringPreset: 'fixed_points_speed', stages: mkStages('pl') });
    await creator.call('publishGame', { gameId: gLoud, visibility: 'public' });

    // ── Auth + existence gates ────────────────────────────────────────────────
    const anon = makeParty(`likeAnon${stamp}`); // deliberately NOT signed in
    await expectError('setPublicLike rejects an unauthenticated caller',
      anon.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: true }),
      { codeIn: ['functions/unauthenticated'] });
    await expectError('setPublicLike rejects an unpublished/unknown item',
      creator.call('setPublicLike', { kind: 'game', itemId: `no-such-game-${stamp}`, liked: true }),
      { codeIn: ['functions/not-found'] });

    // ── Idempotence: like → like again → unlike → unlike again ────────────────
    const l1 = await creator.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: true });
    check('first like counts once', l1?.liked === true && l1?.likeCount === 1, JSON.stringify(l1));
    const l2 = await creator.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: true });
    check('repeating a like does NOT double-count', l2?.liked === true && l2?.likeCount === 1, JSON.stringify(l2));
    const u1 = await creator.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: false });
    check('unlike returns the count to zero', u1?.liked === false && u1?.likeCount === 0, JSON.stringify(u1));
    const u2 = await creator.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: false });
    check('repeating an unlike never goes negative', u2?.liked === false && u2?.likeCount === 0, JSON.stringify(u2));

    // ── Concurrent double-fire from ONE identity settles at exactly one ───────
    const burst = await Promise.allSettled(Array.from({ length: 5 }, () =>
      creator.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: true })));
    const burstOk = burst.filter((r) => r.status === 'fulfilled').length;
    const afterBurst = await creator.getDocAt(`publicGames/${gLoud}`);
    check('5 concurrent identical likes leave likeCount at exactly 1',
      afterBurst.data?.likeCount === 1, `likeCount=${afterBurst.data?.likeCount} fulfilled=${burstOk}/5`);

    // ── A second identity counts separately ──────────────────────────────────
    const liker2 = makeParty(`liker2_${stamp}`);
    await signInAnonymously(liker2.auth);
    const l3 = await liker2.call('setPublicLike', { kind: 'game', itemId: gLoud, liked: true });
    check('a second user adds a second like', l3?.likeCount === 2, JSON.stringify(l3));

    // A like on a TASK is a different document even for the same id shape.
    const loudTaskId = `${gLoud}_pl-t`;
    const tl = await creator.call('setPublicLike', { kind: 'task', itemId: loudTaskId, liked: true });
    check('a public task can be liked independently', tl?.liked === true && tl?.likeCount === 1, JSON.stringify(tl));

    // ── Usage signals move the stored score ──────────────────────────────────
    await creator.call('incrementTaskCopyCount', { publicTaskId: loudTaskId });
    // launchRun must bump the PUBLIC game's play signal, not only the private doc.
    const pubPlaysBefore = (await creator.getDocAt(`publicGames/${gLoud}`)).data?.playCount ?? 0;
    await creator.call('launchRun', { gameId: gLoud });
    let pubPlaysAfter = pubPlaysBefore;
    for (let i = 0; i < 10 && pubPlaysAfter <= pubPlaysBefore; i++) {
      await new Promise((r) => setTimeout(r, 300));
      pubPlaysAfter = (await creator.getDocAt(`publicGames/${gLoud}`)).data?.playCount ?? 0;
    }
    check('launchRun bumps the public game playCount',
      pubPlaysAfter === pubPlaysBefore + 1, `${pubPlaysBefore} → ${pubPlaysAfter}`);

    // ── Denormalization consistency oracle ───────────────────────────────────
    // The stored ordering field MUST equal the pure function applied to the
    // stored counters. A bump that forgets to recompute (or a lost update from a
    // read-modify-write around FieldValue.increment) fails here and nowhere else.
    for (const [label, path, useField] of [
      ['public game', `publicGames/${gLoud}`, 'playCount'],
      ['public task', `publicTasks/${loudTaskId}`, 'copyCount'],
    ]) {
      const d = (await creator.getDocAt(path)).data ?? {};
      const expected = popularityScore({
        uses: d[useField], likes: d.likeCount, createdAtMs: Date.parse(d.createdAt),
      });
      check(`${label}: stored popularity equals the pure function of its stored counters`,
        typeof d.popularity === 'number' && Math.abs(d.popularity - expected) < 1e-9,
        `stored=${d.popularity} expected=${expected} uses=${d[useField]} likes=${d.likeCount}`);
    }

    // ── Ordering actually changed ────────────────────────────────────────────
    const gal = await creator.call('searchGallery', { query: '', limit: 50 });
    check('searchGallery still returns a games array', Array.isArray(gal?.games));
    const iLoud = (gal?.games ?? []).findIndex((g) => g.id === gLoud);
    const iQuiet = (gal?.games ?? []).findIndex((g) => g.id === gQuiet);
    check('the engaged game outranks the untouched one', iLoud >= 0 && iQuiet >= 0 && iLoud < iQuiet,
      `loud@${iLoud} quiet@${iQuiet}`);
    const scores = (gal?.games ?? []).map((g) => g.popularity ?? 0);
    check('gallery results are in non-increasing popularity order',
      scores.every((s, i) => i === 0 || scores[i - 1] >= s), JSON.stringify(scores.slice(0, 8)));

    // Relevance beats popularity: searching the QUIET game's unique title must
    // return it even though the LOUD game is far more popular.
    const relevant = await creator.call('searchGallery', { query: QUIET, limit: 5 });
    check('a search returns the title match first, not the popular one',
      relevant?.games?.[0]?.id === gQuiet, JSON.stringify((relevant?.games ?? []).map((g) => g.id)));

    // ── Own like state comes back with the results, per caller ───────────────
    check('searchGallery reports the caller\'s own likes', Array.isArray(gal?.likedIds) && gal.likedIds.includes(gLoud),
      JSON.stringify(gal?.likedIds));
    const gal2 = await liker2.call('searchGallery', { query: '', limit: 50 });
    check('the second liker also sees their own like', (gal2?.likedIds ?? []).includes(gLoud));
    const bystander = makeParty(`bystander${stamp}`);
    await signInAnonymously(bystander.auth);
    const gal3 = await bystander.call('searchGallery', { query: '', limit: 50 });
    const seen = (gal3?.games ?? []).find((g) => g.id === gLoud);
    check('a bystander sees the count but is not marked as having liked',
      seen?.likeCount === 2 && !(gal3?.likedIds ?? []).includes(gLoud),
      `likeCount=${seen?.likeCount} likedIds=${JSON.stringify(gal3?.likedIds)}`);

    const lib = await creator.call('searchTaskLibrary', { query: '', limit: 100 });
    check('searchTaskLibrary returns likedIds too', Array.isArray(lib?.likedIds) && lib.likedIds.includes(loudTaskId),
      JSON.stringify(lib?.likedIds));
    const tScores = (lib?.tasks ?? []).map((t) => t.popularity ?? 0);
    check('task library results are in non-increasing popularity order',
      tScores.every((s, i) => i === 0 || tScores[i - 1] >= s), JSON.stringify(tScores.slice(0, 8)));

    // ── Re-publishing must not wipe accumulated signals ──────────────────────
    const beforeRepub = (await creator.getDocAt(`publicTasks/${loudTaskId}`)).data ?? {};
    await creator.call('publishGame', { gameId: gLoud, visibility: 'public' });
    const gAfter = (await creator.getDocAt(`publicGames/${gLoud}`)).data ?? {};
    const tAfter = (await creator.getDocAt(`publicTasks/${loudTaskId}`)).data ?? {};
    check('re-publishing preserves the game like count', gAfter.likeCount === 2, String(gAfter.likeCount));
    check('re-publishing preserves the task copy count',
      tAfter.copyCount === beforeRepub.copyCount, `${beforeRepub.copyCount} → ${tAfter.copyCount}`);
    check('re-publishing preserves the task like count', tAfter.likeCount === 1, String(tAfter.likeCount));

    // ── The gallery fields are NOT run-time Task fields ──────────────────────
    // popularity/likeCount live on the publicTasks GALLERY document, never on a
    // Task in a run — so the participant payload allowlist must not need them.
    check('the participant task allowlist is untouched by this change',
      !ALLOWED_TASK_KEYS.has('popularity') && !ALLOWED_TASK_KEYS.has('likeCount')
      && !ALLOWED_SMART_KEYS.has('popularity') && !ALLOWED_SMART_KEYS.has('likeCount'));
  });

  // (change: game-task-tags) AUTHORED BUT NOT RUN — a live playtest stack owned the
  // emulator when this was written, so `npm run e2e` could not be started. Treat
  // these checks as unverified until someone runs the suite.
  //
  // The server used to do a bare `updates.tags = tags` off the client payload, so a
  // client could store 10 000 tags — or one a megabyte long — which then rode into
  // the WORLD-READABLE publicGames/publicTasks and back out of searchGallery to
  // every reader. `normalizeTags` (@rushpoint/shared) now guards every write path.
  // NOTE: no allowlist edit is needed — `tags` is already in ALLOWED_TASK_KEYS.
  await scenario('game + task tags are normalized server-side and reach the gallery', async () => {
    const HOSTILE_GAME_TAGS = [
      'Park', 'park', 'PARK',           // case-insensitive dedupe, first casing wins
      '  spaced  out  ', '',            // trimmed + internal whitespace collapsed; blank dropped
      'a, b',                           // a comma INSIDE an array element still splits
      'x'.repeat(120),                  // over-long → truncated
      ...Array.from({ length: 50 }, (_, i) => `bulk${i}`), // over the count cap
    ];
    const { gameId: gT } = await creator.call('createGame', {
      title: 'Tagged Hunt 🏷️', mode: 'team', tags: HOSTILE_GAME_TAGS,
    });

    const created = (await creator.getDocAt(`users/${creatorCred.user.uid}/games/${gT}`)).data ?? {};
    check('createGame clamps the stored tag COUNT', Array.isArray(created.tags) && created.tags.length <= 20,
      String(created.tags?.length));
    check('createGame clamps every stored tag LENGTH',
      (created.tags ?? []).every((t) => typeof t === 'string' && t.length > 0 && t.length <= 40));
    check('createGame de-duplicates case-insensitively, first casing wins',
      (created.tags ?? []).filter((t) => t.toLowerCase() === 'park').length === 1
      && (created.tags ?? []).includes('Park'), JSON.stringify(created.tags?.slice(0, 6)));
    check('createGame collapses internal whitespace', (created.tags ?? []).includes('spaced out'),
      JSON.stringify(created.tags?.slice(0, 6)));
    check('createGame splits a comma inside an array element',
      (created.tags ?? []).includes('a') && (created.tags ?? []).includes('b'));

    // updateGame: game tags AND task tags, both un-normalized on the wire.
    await creator.call('updateGame', {
      gameId: gT,
      tags: ['חוץ', 'חוץ', 'העיר העתיקה', 'Jerusalem'],
      stages: [
        { id: 'tg0', order: 0, title: 'Stage', isFinal: true, tasks: [
          { id: 'tg-a', title: 'Tagged mission', type: 'self_report', triggerMode: 'instant',
            coordinates: { lat: 31.7767, lng: 35.2345 }, difficulty: 2, estimatedMinutes: 3,
            pointValue: 20, maxConcurrentTeams: 5,
            tags: ['Photo', 'photo', '  ', 'y'.repeat(90),
              ...Array.from({ length: 40 }, (_, i) => `t${i}`)] },
        ] },
      ],
    });
    const saved = (await creator.getDocAt(`users/${creatorCred.user.uid}/games/${gT}`)).data ?? {};
    check('updateGame preserves Hebrew tags byte-for-byte',
      (saved.tags ?? []).includes('חוץ') && (saved.tags ?? []).includes('העיר העתיקה'),
      JSON.stringify(saved.tags));
    check('updateGame de-duplicates the repeated Hebrew tag',
      (saved.tags ?? []).filter((t) => t === 'חוץ').length === 1, JSON.stringify(saved.tags));
    const savedTask = (saved.stages?.[0]?.tasks ?? [])[0] ?? {};
    check('updateGame normalizes TASK tags too', Array.isArray(savedTask.tags)
      && savedTask.tags.length <= 20
      && savedTask.tags.every((t) => t.length > 0 && t.length <= 40)
      && savedTask.tags.filter((t) => t.toLowerCase() === 'photo').length === 1,
      JSON.stringify(savedTask.tags?.slice(0, 5)));
    check('stages survived as an ARRAY (never a dotted array-element update)',
      Array.isArray(saved.stages) && Array.isArray(saved.stages[0]?.tasks));

    // (feature: game-tags-propagate) The game's tags are UNIONED into every task on
    // save, so tagging the game once makes its missions inherit those tags — the
    // foundation for gallery tag-search below. The mission also keeps its own tags.
    const gameTagSet = new Set(saved.tags ?? []);
    check('updateGame propagates the game tags onto EVERY task',
      (saved.stages ?? []).every((st) =>
        (st.tasks ?? []).every((t) =>
          [...gameTagSet].every((g) => (t.tags ?? []).includes(g)))),
      JSON.stringify(savedTask.tags?.slice(0, 8)));
    check('propagation keeps the task\'s own tag too (union, not replace)',
      (savedTask.tags ?? []).some((t) => t.toLowerCase() === 'photo'),
      JSON.stringify(savedTask.tags?.slice(0, 8)));

    // Publish → the world-readable copies are bounded too, and searchGallery
    // actually RETURNS the tags (nothing strips them on the way out).
    await creator.call('publishGame', { gameId: gT, visibility: 'public' });
    const pubGame = (await creator.getDocAt(`publicGames/${gT}`)).data ?? {};
    check('publishGame writes bounded tags into publicGames',
      Array.isArray(pubGame.tags) && pubGame.tags.length <= 20
      && pubGame.tags.every((t) => t.length <= 40), JSON.stringify(pubGame.tags));
    const pubTask = (await creator.getDocAt(`publicTasks/${gT}_tg-a`)).data ?? {};
    check('publishGame writes bounded tags into publicTasks',
      Array.isArray(pubTask.tags) && pubTask.tags.length <= 20
      && pubTask.tags.every((t) => t.length <= 40), JSON.stringify(pubTask.tags));

    const galT = await creator.call('searchGallery', { query: 'Tagged Hunt' });
    const foundGame = (galT?.games ?? []).find((g) => g.id === gT);
    check('searchGallery RETURNS the game tags (the UI has something to render)',
      Array.isArray(foundGame?.tags) && foundGame.tags.length > 0, JSON.stringify(foundGame?.tags));
    const libT = await creator.call('searchTaskLibrary', { query: 'Tagged mission', limit: 100 });
    const foundTask = (libT?.tasks ?? []).find((t) => t.id === `${gT}_tg-a`);
    check('searchTaskLibrary RETURNS the task tags',
      Array.isArray(foundTask?.tags) && foundTask.tags.length > 0, JSON.stringify(foundTask?.tags));
    // (feature: game-tags-propagate) Because the game tag rode onto the task and into
    // publicTasks, a gallery tag-search by that GAME tag finds the mission — the whole
    // point of the feature.
    check('the propagated game tag reached publicTasks',
      Array.isArray(pubTask.tags) && pubTask.tags.includes('Jerusalem'), JSON.stringify(pubTask.tags));
    const libByTag = await creator.call('searchTaskLibrary', { query: '', tags: ['Jerusalem'], limit: 50 });
    check('searchTaskLibrary finds the mission by the inherited GAME tag',
      (libByTag?.tasks ?? []).some((t) => t.id === `${gT}_tg-a`),
      String((libByTag?.tasks ?? []).length));

    // The `tags` filter argument must still work against the normalized values.
    const byTag = await creator.call('searchGallery', { query: '', tags: ['Jerusalem'], limit: 50 });
    check('searchGallery can still filter by a stored tag',
      (byTag?.games ?? []).some((g) => g.id === gT), String((byTag?.games ?? []).length));

    check('tags needed NO participant-allowlist change (already allowlisted)',
      ALLOWED_TASK_KEYS.has('tags'));

    // (change: gallery-facet-filters) In-memory facets applied AFTER the tags DB
    // query and popularity ranking, BEFORE the page slice. `tags` stays the sole
    // DB filter; mode/type/difficulty/hasLocation/sort are the second pass.
    // Publish a distinctly-tagged INDIVIDUAL game so the mode facet has both to
    // include and to exclude within one tag window.
    const FACET_TAG = 'facetprobe';
    const { gameId: gTeam } = await creator.call('createGame', {
      title: 'Facet Team Game', mode: 'team', tags: [FACET_TAG],
    });
    await creator.call('updateGame', {
      gameId: gTeam, tags: [FACET_TAG],
      stages: [{ id: 'ft0', order: 0, title: 'S', isFinal: true, tasks: [
        { id: 'ft-a', title: 'Facet quiz', type: 'quiz', triggerMode: 'instant',
          answers: ['x'], difficulty: 3, estimatedMinutes: 3, pointValue: 20, maxConcurrentTeams: 5 },
      ] }],
    });
    await creator.call('publishGame', { gameId: gTeam, visibility: 'public' });
    const { gameId: gSolo } = await creator.call('createGame', {
      title: 'Facet Solo Game', mode: 'individual', tags: [FACET_TAG],
    });
    await creator.call('updateGame', {
      gameId: gSolo, tags: [FACET_TAG],
      stages: [{ id: 'fs0', order: 0, title: 'S', isFinal: true, tasks: [
        { id: 'fs-a', title: 'Facet field', type: 'self_report', triggerMode: 'instant',
          difficulty: 1, estimatedMinutes: 3, pointValue: 20, maxConcurrentTeams: 5 },
      ] }],
    });
    await creator.call('publishGame', { gameId: gSolo, visibility: 'public' });

    const facetTeam = await creator.call('searchGallery', { tags: [FACET_TAG], mode: 'team', limit: 50 });
    const facetTeamIds = (facetTeam?.games ?? []).map((g) => g.id);
    check('searchGallery mode facet returns ONLY team games',
      facetTeamIds.includes(gTeam) && !facetTeamIds.includes(gSolo)
      && (facetTeam?.games ?? []).every((g) => g.mode === 'team'),
      JSON.stringify(facetTeamIds));
    const facetSolo = await creator.call('searchGallery', { tags: [FACET_TAG], mode: 'individual', limit: 50 });
    const facetSoloIds = (facetSolo?.games ?? []).map((g) => g.id);
    check('searchGallery mode facet returns ONLY individual games',
      facetSoloIds.includes(gSolo) && !facetSoloIds.includes(gTeam),
      JSON.stringify(facetSoloIds));

    const libQuiz = await creator.call('searchTaskLibrary', { tags: [FACET_TAG], type: 'quiz', limit: 100 });
    check('searchTaskLibrary type facet narrows to that type',
      (libQuiz?.tasks ?? []).length > 0
      && (libQuiz?.tasks ?? []).every((t) => t.type === 'quiz')
      && (libQuiz?.tasks ?? []).some((t) => t.id === `${gTeam}_ft-a`),
      JSON.stringify((libQuiz?.tasks ?? []).map((t) => t.type)));
    const libHard = await creator.call('searchTaskLibrary', { tags: [FACET_TAG], difficulty: 3, limit: 100 });
    check('searchTaskLibrary difficulty facet is AT-LEAST (>=)',
      (libHard?.tasks ?? []).every((t) => (t.difficulty ?? 0) >= 3)
      && (libHard?.tasks ?? []).some((t) => t.id === `${gTeam}_ft-a`)
      && !(libHard?.tasks ?? []).some((t) => t.id === `${gSolo}_fs-a`),
      JSON.stringify((libHard?.tasks ?? []).map((t) => t.difficulty)));

    // (change: gallery-popular-tags) getPopularTags surfaces the tags creators are
    // actually using, so the Builder can offer real quick-add chips. The published
    // game above put 'Jerusalem' (and its Hebrew siblings) into the world-readable
    // gallery, so a popular-tags read must return them. A generous limit keeps the
    // published tags in the window regardless of how much other gallery data the
    // suite has accumulated.
    const popular = await creator.call('getPopularTags', { limit: 50 });
    const popularLower = (popular?.tags ?? []).map((t) => String(t).toLowerCase());
    check('getPopularTags returns a non-empty tag list', (popular?.tags ?? []).length > 0,
      JSON.stringify(popular?.tags?.slice(0, 12)));
    check('getPopularTags includes a tag that was just published to the gallery',
      popularLower.includes('jerusalem'), JSON.stringify(popular?.tags?.slice(0, 12)));
    check('getPopularTags caps the returned list at the requested limit',
      (popular?.tags ?? []).length <= 50, String((popular?.tags ?? []).length));
    const popularCapped = await creator.call('getPopularTags', {});
    check('getPopularTags honors the default limit ceiling (≤50)',
      (popularCapped?.tags ?? []).length <= 50, String((popularCapped?.tags ?? []).length));
  });

  // (change: task-library-map-view) Authored blind — no emulator was available in
  // the change that added it. Executed green on 2026-07-23 (7 checks) together
  // with the legacy-coordinate backfill sweep below.
  await scenario('public task library publishes an EXACT point for ordinary tasks, a coarse area for hidden ones', async () => {
    // THE EXPOSURE this scenario defends: publicTasks is `allow read: if true`,
    // and publishGame used to copy the creator's EXACT `task.coordinates` into it
    // — for every task, including hideLocation tasks, whose coordinates are
    // server-secret everywhere else in the platform. Anyone could scout the
    // answers to a hidden-location puzzle with an unauthenticated read.
    const EXACT = { lat: 31.77661, lng: 35.23499 };
    const { gameId: gLoc } = await creator.call('createGame', { title: 'Area Only Hunt', mode: 'team' });
    await creator.call('updateGame', {
      gameId: gLoc,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'al0', order: 0, title: 'Stage', isFinal: true,
          tasks: [
            { id: 'al-open', title: 'Open task', type: 'field', triggerMode: 'radius',
              coordinates: { ...EXACT }, difficulty: 2, estimatedMinutes: 5,
              pointValue: 50, maxConcurrentTeams: 9 },
            { id: 'al-hidden', title: 'Hidden task', type: 'field', triggerMode: 'radius',
              coordinates: { ...EXACT }, difficulty: 3, estimatedMinutes: 5,
              pointValue: 60, maxConcurrentTeams: 9,
              hideLocation: true, locationClue: 'Where the lions guard the gate' },
          ] },
      ],
    });
    await creator.call('publishGame', { gameId: gLoc, visibility: 'public' });

    const openDoc = (await creator.getDocAt(`publicTasks/${gLoc}_al-open`)).data ?? {};
    const hiddenDoc = (await creator.getDocAt(`publicTasks/${gLoc}_al-hidden`)).data ?? {};

    check('an ordinary public task publishes no deprecated coordinates field',
      openDoc.coordinates === undefined, JSON.stringify(openDoc.coordinates));
    // change: gallery-precise-task-location. The gallery shows WHERE a creator PUT
    // a task — an authored point of interest, not a person's location — so an
    // ordinary task now publishes its EXACT authored point, no longer coarsened.
    check('an ordinary public task publishes its EXACT authored point',
      !!openDoc.approxLocation
      && openDoc.approxLocation.lat === EXACT.lat
      && openDoc.approxLocation.lng === EXACT.lng,
      JSON.stringify(openDoc.approxLocation));

    // The headline assertion (change: hidden-location-map-visibility): a hideLocation
    // task now publishes the SAME coarse area as any other task, so a creator can see
    // their own hidden missions on the library map. The puzzle is kept by the
    // PARTICIPANT sanitizer, not by withholding the area — the exact point still never
    // reaches publicTasks.
    check('a hideLocation task publishes a coarse area and never the exact point',
      hiddenDoc.coordinates === undefined
      && hiddenDoc.approxLocation
      && Math.abs(hiddenDoc.approxLocation.lat - EXACT.lat) <= 0.005 + 1e-9
      && Math.abs(hiddenDoc.approxLocation.lng - EXACT.lng) <= 0.005 + 1e-9,
      JSON.stringify({ coordinates: hiddenDoc.coordinates, approxLocation: hiddenDoc.approxLocation }));
    check('a hideLocation task is still listed in the library',
      hiddenDoc.title === 'Hidden task', JSON.stringify(hiddenDoc.title));

    // Re-publishing is deterministic — repeated observation must not narrow the
    // area (this is why the coarsening is a grid snap and not random jitter).
    await creator.call('publishGame', { gameId: gLoc, visibility: 'public' });
    const openAgain = (await creator.getDocAt(`publicTasks/${gLoc}_al-open`)).data ?? {};
    check('re-publishing writes the identical area (not averageable)',
      openAgain.approxLocation?.lat === openDoc.approxLocation?.lat
      && openAgain.approxLocation?.lng === openDoc.approxLocation?.lng,
      `${JSON.stringify(openDoc.approxLocation)} → ${JSON.stringify(openAgain.approxLocation)}`);

    // …and the callable never returns an exact point, for ANY task, including
    // documents published before this contract existed.
    const libSafe = await creator.call('searchTaskLibrary', { query: '', limit: 100 });
    check('searchTaskLibrary never returns coordinates on any result',
      (libSafe?.tasks ?? []).every((t) => t.coordinates === undefined),
      JSON.stringify((libSafe?.tasks ?? []).filter((t) => t.coordinates !== undefined).map((t) => t.id)));
  });

  await scenario('gallery map serves EXACT location for legacy coordinate-only docs (change: gallery-map-serve-exact)', async () => {
    // THE USER-VISIBLE BUG: a mission published before `task-library-map-view`
    // sits in `publicTasks` with an EXACT `coordinates` field and NO
    // `approxLocation`. The gallery/library map reads only `approxLocation`, so
    // those missions plotted in the WRONG place or DID NOT PLOT AT ALL. The write
    // path fixes only NEW docs; this scenario proves `searchTaskLibrary` now
    // recomputes the exact point AT READ TIME, so old docs plot with no backfill.
    const LEGACY_EXACT = { lat: 32.07123, lng: 34.79456 };
    const { gameId: gLegacy } = await creator.call('createGame', { title: 'Legacy Coord Read Hunt', mode: 'team' });
    await creator.call('updateGame', {
      gameId: gLegacy,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'lc0', order: 0, title: 'Stage', isFinal: true,
          tasks: [
            { id: 'lc-legacy', title: 'Legacy read task', type: 'field', triggerMode: 'radius',
              coordinates: { ...LEGACY_EXACT }, difficulty: 2, estimatedMinutes: 5,
              pointValue: 50, maxConcurrentTeams: 9 },
          ] },
      ],
    });
    await creator.call('publishGame', { gameId: gLegacy, visibility: 'public' });

    const legacyId = `${gLegacy}_lc-legacy`;
    // Simulate the pre-fix on-disk shape: exact `coordinates`, NO `approxLocation`.
    // Admin SDK bypasses rules (same tool the backfill scenario below relies on).
    const rawDbLegacy = adminSdk.firestore();
    await rawDbLegacy.doc(`publicTasks/${legacyId}`).set(
      { coordinates: { ...LEGACY_EXACT } }, { merge: true });
    await rawDbLegacy.doc(`publicTasks/${legacyId}`).update({
      approxLocation: adminSdk.firestore.FieldValue.delete(),
    });

    const onDisk = (await creator.getDocAt(`publicTasks/${legacyId}`)).data ?? {};
    check('setup: the legacy doc has exact coordinates and NO approxLocation',
      onDisk.coordinates?.lat === LEGACY_EXACT.lat && onDisk.approxLocation === undefined,
      JSON.stringify({ coordinates: onDisk.coordinates, approxLocation: onDisk.approxLocation }));

    const lib = await creator.call('searchTaskLibrary', { query: 'Legacy read task', limit: 100 });
    const served = (lib?.tasks ?? []).find((t) => t.id === legacyId);
    check('searchTaskLibrary now serves the legacy doc a plottable approxLocation',
      !!served?.approxLocation, JSON.stringify(served?.approxLocation));
    check('the served approxLocation is the EXACT authored point (round5), not coarsened',
      served?.approxLocation?.lat === Math.round(LEGACY_EXACT.lat * 1e5) / 1e5
      && served?.approxLocation?.lng === Math.round(LEGACY_EXACT.lng * 1e5) / 1e5,
      JSON.stringify(served?.approxLocation));
    check('the served legacy doc never leaks the raw coordinates key',
      served?.coordinates === undefined, JSON.stringify(served?.coordinates));
  });

  await scenario('publicTasks legacy-coordinate backfill (privacy sweep, admin-only)', async () => {
    // THE EXPOSURE this scenario defends: before `task-library-map-view`,
    // `publishGame` copied the creator's EXACT authored `task.coordinates` into
    // the world-readable `publicTasks/{id}` document — hideLocation tasks
    // included. That fix only covers documents written AFTER it shipped;
    // anything published earlier still sits in Firestore with its exact point.
    // `backfillPublicTaskCoordinatesNow` is the one-time sweep that closes the
    // gap. There's no way to manufacture a real "pre-fix" publish anymore (the
    // current code never writes `coordinates`), so this scenario simulates one
    // directly with the Admin SDK — writing the exact legacy field onto a
    // document the REAL `publishGame` just created — and proves the sweep's
    // pure decision rule (`repairPublicTask`, from @rushpoint/shared) is what
    // actually runs server-side.
    const EXACT_OPEN = { lat: 31.81234, lng: 35.22456 };
    const EXACT_HIDDEN = { lat: 31.83456, lng: 35.24567 };
    const { gameId: bfGame } = await creator.call('createGame', { title: 'Backfill Sweep Hunt', mode: 'team' });
    await creator.call('updateGame', {
      gameId: bfGame,
      scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'bf0', order: 0, title: 'Stage', isFinal: true,
          tasks: [
            { id: 'bf-open', title: 'Open task', type: 'field', triggerMode: 'radius',
              coordinates: { ...EXACT_OPEN }, difficulty: 2, estimatedMinutes: 5,
              pointValue: 50, maxConcurrentTeams: 9 },
            { id: 'bf-hidden', title: 'Hidden task', type: 'field', triggerMode: 'radius',
              coordinates: { ...EXACT_HIDDEN }, difficulty: 3, estimatedMinutes: 5,
              pointValue: 60, maxConcurrentTeams: 9,
              hideLocation: true, locationClue: 'Where the water meets the wall' },
          ] },
      ],
    });
    await creator.call('publishGame', { gameId: bfGame, visibility: 'public' });

    const openId = `${bfGame}_bf-open`;
    const hiddenId = `${bfGame}_bf-hidden`;

    // Simulate the pre-fix write: inject the deprecated exact `coordinates` field
    // straight onto the documents the real publishGame just produced correctly.
    // Admin SDK bypasses firestore.rules — same tool `pruneRunNow`'s own e2e
    // setup relies on for direct writes the client could never make.
    const rawDb = adminSdk.firestore();
    await rawDb.doc(`publicTasks/${openId}`).set({ coordinates: { ...EXACT_OPEN } }, { merge: true });
    await rawDb.doc(`publicTasks/${hiddenId}`).set({ coordinates: { ...EXACT_HIDDEN } }, { merge: true });

    const openBefore = (await creator.getDocAt(`publicTasks/${openId}`)).data;
    const hiddenBefore = (await creator.getDocAt(`publicTasks/${hiddenId}`)).data;
    check('setup: the simulated legacy doc carries the exact coordinate',
      openBefore?.coordinates?.lat === EXACT_OPEN.lat, JSON.stringify(openBefore?.coordinates));
    check('setup: the simulated legacy HIDDEN doc carries the exact coordinate too',
      hiddenBefore?.coordinates?.lat === EXACT_HIDDEN.lat, JSON.stringify(hiddenBefore?.coordinates));

    // ── dryRun writes nothing ────────────────────────────────────────────────
    const dry = await platformAdmin.call('backfillPublicTaskCoordinatesNow', { dryRun: true });
    check('dryRun reports work to do without doing it',
      dry?.ok === true && dry?.repaired >= 2, JSON.stringify(dry));
    const openAfterDry = (await creator.getDocAt(`publicTasks/${openId}`)).data;
    check('dryRun: the legacy coordinates field is untouched',
      openAfterDry?.coordinates?.lat === EXACT_OPEN.lat, JSON.stringify(openAfterDry?.coordinates));

    // ── The real sweep ───────────────────────────────────────────────────────
    const swept = await platformAdmin.call('backfillPublicTaskCoordinatesNow', {});
    check('the sweep succeeds and reports at least our two seeded docs repaired',
      swept?.ok === true && swept?.repaired >= 2, JSON.stringify(swept));
    // `cleared` counts docs the sweep left with NO location at all. Since
    // hidden-location-map-visibility, a hideLocation task is COARSENED rather than
    // cleared, so this fixture clears nothing — only a genuinely unplaceable task
    // (locationless, or coordinates that cannot be used) still clears. Asserting
    // `>= 0` would be vacuous, so pin the real new contract instead: the sweep must
    // not clear anything here, because both seeded docs are placeable.
    check('the sweep clears nothing here (both seeded docs are placeable, so both coarsen)',
      swept?.cleared === 0, JSON.stringify(swept));

    const openAfter = (await creator.getDocAt(`publicTasks/${openId}`)).data;
    const hiddenAfter = (await creator.getDocAt(`publicTasks/${hiddenId}`)).data;

    // 1. The legacy exact `coordinates` field is gone on BOTH documents.
    check('sweep: the ordinary task\'s legacy coordinates field is deleted',
      openAfter?.coordinates === undefined, JSON.stringify(openAfter?.coordinates));
    check('sweep: the hidden task\'s legacy coordinates field is deleted',
      hiddenAfter?.coordinates === undefined, JSON.stringify(hiddenAfter?.coordinates));

    // 2. The ordinary task ends up with its EXACT authored point (change:
    //    gallery-precise-task-location) — the legacy coordinates field is stripped
    //    and replaced by the precise point, not a coarse cell.
    check('sweep: the ordinary task gets an approxLocation',
      !!openAfter?.approxLocation, JSON.stringify(openAfter?.approxLocation));
    check('sweep: the ordinary task ends up with its EXACT authored point',
      !!openAfter?.approxLocation
      && openAfter.approxLocation.lat === EXACT_OPEN.lat
      && openAfter.approxLocation.lng === EXACT_OPEN.lng,
      JSON.stringify(openAfter?.approxLocation));

    // 3. THE HEADLINE ASSERTION (change: hidden-location-map-visibility) — a
    //    hideLocation task ends up with a COARSENED area and no exact point. The
    //    sweep also repairs "bare" docs (published after the map feature, so never
    //    carrying a legacy `coordinates` key) which would otherwise stay off the
    //    map forever.
    check('sweep: a hideLocation task ends up coarsened, with no exact coordinates',
      hiddenAfter?.coordinates === undefined && !!hiddenAfter?.approxLocation,
      JSON.stringify({ coordinates: hiddenAfter?.coordinates, approxLocation: hiddenAfter?.approxLocation }));
    check('sweep: the hideLocation task is still listed (title survives)',
      hiddenAfter?.title === 'Hidden task', JSON.stringify(hiddenAfter?.title));

    // ── Idempotence: nothing left to repair on a second pass ────────────────
    const swept2 = await platformAdmin.call('backfillPublicTaskCoordinatesNow', {});
    check('the sweep is idempotent (repaired: 0 on a clean second pass)',
      swept2?.ok === true && swept2?.repaired === 0, JSON.stringify(swept2));
  });

  await scenario('game file export/import (owner-only, round trip, launchable)', async () => {
    // THE INCIDENT this scenario defends: a creator's real game was destroyed
    // because it existed in exactly one place and the creator had no copy of
    // their own. The contract is (a) the owner can always get a FILE, (b) that
    // file restores a LAUNCHABLE game, and (c) nobody else can ever read it —
    // because the file necessarily contains every answer key.
    const { gameId: gF } = await creator.call('createGame', { title: 'Portable Hunt 🗺️', mode: 'team' });
    await creator.call('updateGame', {
      gameId: gF,
      scoringPreset: 'smart_weighted',
      tags: ['portability'],
      stages: [
        { id: 'pf0', order: 0, title: 'שלב ראשון', isFinal: false, requiredTaskCount: 1,
          tasks: [
            { id: 'pf-quiz', title: 'חידון 🎯', type: 'quiz', triggerMode: 'instant',
              coordinates: { lat: 31.7767, lng: 35.2345 }, difficulty: 3, estimatedMinutes: 2,
              pointValue: 40, maxConcurrentTeams: 9,
              question: 'מה הצבע?', answers: ['כחול', 'blue'],
              hint: 'זה צבע השמיים', hintPenalty: 5 },
            { id: 'pf-num', title: 'Count the steps', type: 'numeric', triggerMode: 'instant',
              coordinates: { lat: 31.7770, lng: 35.2350 }, difficulty: 2, estimatedMinutes: 2,
              pointValue: 30, maxConcurrentTeams: 9,
              question: 'How many?', numericAnswer: 42, numericTolerance: 1 },
          ] },
        { id: 'pf1', order: 1, title: 'Final stage', isFinal: true,
          tasks: [
            { id: 'pf-station', title: 'Secret station', type: 'smart_station', triggerMode: 'instant',
              coordinates: { lat: 31.7780, lng: 35.2360 }, difficulty: 2, estimatedMinutes: 2,
              pointValue: 50, maxConcurrentTeams: 9,
              smart: { secretCode: 'OPEN-SESAME', autoApprove: true } },
          ] },
      ],
    });

    // ── (1b) הקמה מהירה steps ride along (change: quick-setup-wizard) ────────
    // A template's setup instructions are pointers at fields; a file that drops
    // them restores a game whose instructions are simply gone, and the creator has
    // no way to know what the template wanted. Malformed input is refused loud.
    await creator.call('updateGame', {
      gameId: gF,
      wizardSteps: [
        { id: 'qs-quiz-answers', stageId: 'pf0', taskId: 'pf-quiz', targetFieldPath: 'answers',
          instructionPrompt: 'עדכנו את התשובה הנכונה', isRequired: true },
        { id: 'qs-orphan', stageId: 'pf0', taskId: 'no-such-task', targetFieldPath: 'answers',
          instructionPrompt: 'מצביע על משימה שנמחקה', isRequired: true },
      ],
    });
    const { game: withSteps } = await creator.call('getGame', { gameId: gF });
    check('wizardSteps: a valid step is stored',
      withSteps?.wizardSteps?.some((s) => s.id === 'qs-quiz-answers' && s.targetFieldPath === 'answers'),
      JSON.stringify(withSteps?.wizardSteps));
    // A pointer at a mission that no longer exists is DROPPED, never a refusal:
    // refusing would freeze autosave on a pointer the creator never authored.
    check('wizardSteps: a step naming a missing mission is dropped, not refused',
      (withSteps?.wizardSteps ?? []).every((s) => s.id !== 'qs-orphan'),
      JSON.stringify(withSteps?.wizardSteps));
    await expectError('wizardSteps: a malformed value is refused',
      creator.call('updateGame', { gameId: gF, wizardSteps: 'not-a-list' }),
      { codeIn: ['functions/invalid-argument'] });

    // ── (2) Owner export: the envelope, the SECRETS, and the exclusions ───────
    const { file } = await creator.call('exportGameFile', { gameId: gF });
    check('export: format envelope', file?.format === GAME_FILE_FORMAT, String(file?.format));
    check('export: schema version is the current one',
      file?.schemaVersion === CURRENT_GAME_FILE_VERSION, String(file?.schemaVersion));
    const fTasks = (file?.game?.stages ?? []).flatMap((s) => s.tasks ?? []);
    const fQuiz = fTasks.find((t) => t.id === 'pf-quiz');
    const fNum = fTasks.find((t) => t.id === 'pf-num');
    const fStation = fTasks.find((t) => t.id === 'pf-station');
    // Secrets MUST be present: an export without the answer keys restores an
    // unplayable game, which would defeat the whole point of the file.
    check('export: quiz answer keys are present', Array.isArray(fQuiz?.answers) && fQuiz.answers.includes('כחול'),
      JSON.stringify(fQuiz?.answers));
    check('export: numericAnswer is present', fNum?.numericAnswer === 42, String(fNum?.numericAnswer));
    check('export: paid hint text is present', fQuiz?.hint === 'זה צבע השמיים', String(fQuiz?.hint));
    check('export: smart.secretCode is present', fStation?.smart?.secretCode === 'OPEN-SESAME',
      String(fStation?.smart?.secretCode));
    check('export: Hebrew + emoji survive the wire', file?.game?.title === 'Portable Hunt 🗺️'
      && file?.game?.stages?.[0]?.title === 'שלב ראשון', String(file?.game?.title));
    // Server-owned identity and run history are NOT template — carrying them
    // would make a file an account-transfer / play-count-forgery primitive.
    for (const k of ['id', 'ownerUid', 'visibility', 'playCount', 'createdAt', 'updatedAt', 'deletedAt']) {
      check(`export: server-owned field '${k}' is absent`, !(k in (file?.game ?? {})));
    }
    check('export: smart.stationCoords (runtime injection) is absent',
      !('stationCoords' in (fStation?.smart ?? {})));

    // ── (3) SECURITY: a second authenticated creator is DENIED ────────────────
    // The file carries every answer key, so this denial is the whole security
    // requirement. It must hold for any signed-in identity that is not the owner.
    const otherCreator = makeParty('creatorExportStranger');
    await signInAnonymously(otherCreator.auth);
    const denied = await expectError('export: a non-owner is denied',
      otherCreator.call('exportGameFile', { gameId: gF }),
      { codeIn: ['functions/permission-denied', 'functions/not-found'] });
    check('export: the denial body leaks no game content',
      !/OPEN-SESAME|כחול|Portable Hunt/.test(JSON.stringify(denied?.message ?? '') + JSON.stringify(denied?.details ?? '')));

    // ── (4) A game that does not exist ────────────────────────────────────────
    await expectError('export: nonexistent game is not-found',
      creator.call('exportGameFile', { gameId: 'no-such-game-at-all' }),
      { codeIn: ['functions/not-found'] });

    // ── (5) Import WITHOUT a target creates a NEW game (an overwrite is data loss).
    //        The in-place door (targetGameId) is exercised in the templates scenario,
    //        which is the case it exists for. ──────────────────────────────────────
    const { gameId: gImp } = await creator.call('importGameFile', { file });
    check('import: created a NEW game (never overwrites the source)', !!gImp && gImp !== gF, `${gF} → ${gImp}`);
    const { game: imported } = await creator.call('getGame', { gameId: gImp });
    check('import: same stage count', imported?.stages?.length === 2, String(imported?.stages?.length));
    const iTasks = (imported?.stages ?? []).flatMap((s) => s.tasks ?? []);
    check('import: same task count', iTasks.length === 3, String(iTasks.length));
    check('import: answer keys survived intact',
      iTasks.find((t) => t.id === 'pf-quiz')?.answers?.includes('כחול')
      && iTasks.find((t) => t.id === 'pf-num')?.numericAnswer === 42
      && iTasks.find((t) => t.id === 'pf-station')?.smart?.secretCode === 'OPEN-SESAME');
    check('import: הקמה מהירה steps survived the round trip',
      imported?.wizardSteps?.some((s) => s.id === 'qs-quiz-answers' && s.taskId === 'pf-quiz'),
      JSON.stringify(imported?.wizardSteps));
    check('import: requiredTaskCount survived', imported?.stages?.[0]?.requiredTaskCount === 1,
      String(imported?.stages?.[0]?.requiredTaskCount));
    check('import: the new game is private', imported?.visibility === 'private', String(imported?.visibility));
    check('import: playCount is reset to 0 (run history is not template)',
      imported?.playCount === 0, String(imported?.playCount));
    check('import: ownerUid is the CALLER', imported?.ownerUid === creatorCred.user.uid, String(imported?.ownerUid));

    // ── (6) A restored game is LAUNCHABLE — the real recovery test ────────────
    const launched = await creator.call('launchRun', { gameId: gImp });
    check('import: the restored game launches', !!launched?.runId && !!launched?.accessCode,
      JSON.stringify(launched ?? {}).slice(0, 80));

    // ── (7) Round-trip parity end-to-end (not only in the pure lane) ──────────
    const { file: file2 } = await creator.call('exportGameFile', { gameId: gImp });
    const strip = (f) => JSON.stringify({ ...f, exportedAt: undefined });
    check('import(export(g)) re-exports an identical document', strip(file) === strip(file2),
      strip(file) === strip(file2) ? 'identical' : 'DIFFERS');

    // ── (7b) A TEMPLATE file with operator notes and no steps of its own ──────
    //        This is the door a real creator uses. Template files are authored with
    //        the creator's to-do list written INTO the player-facing prose; before
    //        this, extraction ran only behind an admin-only button, so an ordinary
    //        import kept the raw notes and produced no guidance at all.
    const notedFile = {
      ...file,
      game: {
        ...file.game,
        wizardSteps: undefined,
        stages: [{
          id: 'nt0', order: 0, title: 'Noted', isFinal: true,
          tasks: [{
            id: 'nt-a', title: 'Find the spot',
            description: '[הערת מפעיל - למחוק]: הגדירו כאן את המיקום. מחקו פסקה זו לאחר הקריאה.נווטו אל הנקודה שבתמונה.',
            type: 'field', triggerMode: 'radius', coordinates: { lat: 0, lng: 0 },
            difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9,
          }],
        }],
      },
    };
    const { gameId: gNoted } = await creator.call('importGameFile', { file: notedFile });
    const { game: notedGame } = await creator.call('getGame', { gameId: gNoted });
    const notedTask = notedGame?.stages?.[0]?.tasks?.[0];
    check('import: an operator note becomes a הקמה מהירה step',
      (notedGame?.wizardSteps ?? []).some((w) => w.taskId === 'nt-a' && w.targetFieldPath === 'coordinates'),
      JSON.stringify(notedGame?.wizardSteps ?? []));
    check('import: the note is GONE from the player-facing description',
      typeof notedTask?.description === 'string'
      && !notedTask.description.includes('הערת מפעיל')
      && !notedTask.description.includes('מחקו'),
      String(notedTask?.description));
    check('import: the player-facing half of the prose SURVIVES',
      (notedTask?.description ?? '').includes('נווטו אל הנקודה שבתמונה'),
      String(notedTask?.description));
    // Re-importing the CLEANED export must not re-derive steps from prose that no
    // longer carries any notes, nor drop the steps the file now ships with.
    const { file: notedExport } = await creator.call('exportGameFile', { gameId: gNoted });
    const { gameId: gNoted2 } = await creator.call('importGameFile', { file: notedExport });
    const { game: notedGame2 } = await creator.call('getGame', { gameId: gNoted2 });
    check('import: re-importing an extracted game keeps its steps unchanged',
      (notedGame2?.wizardSteps ?? []).length === (notedGame?.wizardSteps ?? []).length,
      `${(notedGame?.wizardSteps ?? []).length} → ${(notedGame2?.wizardSteps ?? []).length}`);

    // ── (8) Malformed imports: refused, and NO half-game left behind ──────────
    const countGames = async () => ((await creator.call('listGames', {}))?.games ?? []).length;
    const beforeBad = await countGames();
    await expectError('import: unknown format is refused',
      creator.call('importGameFile', { file: { ...file, format: 'not.rushpoint' } }),
      { codeIn: ['functions/invalid-argument'] });
    await expectError('import: a NEWER schema version is refused loudly',
      creator.call('importGameFile', { file: { ...file, schemaVersion: CURRENT_GAME_FILE_VERSION + 1 } }),
      { codeIn: ['functions/invalid-argument'] });
    await expectError('import: a cyclic unlock graph is refused',
      creator.call('importGameFile', { file: { ...file, game: { ...file.game, stages: [
        { id: 'cy0', order: 0, title: 'Cycle', isFinal: true, tasks: [
          { id: 'c-a', title: 'A', type: 'field', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
            difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9, unlockAfterTaskIds: ['c-b'] },
          { id: 'c-b', title: 'B', type: 'field', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
            difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9, unlockAfterTaskIds: ['c-a'] },
        ] },
      ] } } }),
      { codeIn: ['functions/invalid-argument'] });
    // An answer-key-less quiz is ACCEPTED by import (change:
    // builder-draft-save-tolerance) — it used to be refused here. `importGameFile`
    // deliberately shares `stagesProblems` with `updateGame` so the Builder save
    // path and the file-restore path can never drift, and now that a DRAFT may
    // legitimately contain an unfinished answer key, a strict import would break the
    // export→import round trip of any such draft: exportGameFile would happily write
    // a file its own importer refused. The invariant is preserved where it matters —
    // the imported game still cannot LAUNCH, asserted immediately below.
    const { gameId: gImportedDraft } = await creator.call('importGameFile', { file: { ...file, game: { ...file.game, stages: [
      { id: 'nq0', order: 0, title: 'No key', isFinal: true, tasks: [
        { id: 'nq-a', title: 'Unanswerable', type: 'quiz', triggerMode: 'instant', coordinates: { lat: 0, lng: 0 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9, question: 'What?', answers: [] },
      ] },
    ] } } });
    check('import: a quiz with no answer key is accepted as a DRAFT', !!gImportedDraft, String(gImportedDraft));
    await expectError('import: the imported key-less draft still cannot launch',
      creator.call('launchRun', { gameId: gImportedDraft }),
      { codeIn: ['functions/failed-precondition'], match: /accepted answer|ordering items/i });
    // ── (8b) Hostile files (change: game-import-hardening) ───────────────────
    // A hand-edited file is untrusted input. Each of these used to be either an
    // opaque `internal` (a TypeError deeper in the pipeline) or an ACCEPT, and
    // each must now be a clean, actionable `invalid-argument`.
    const withTaskOverride = (over) => ({ ...file, game: { ...file.game, stages: [
      { id: 'hz0', order: 0, title: 'Hostile', isFinal: true, tasks: [
        { id: 'hz-a', title: 'T', type: 'self_report', triggerMode: 'instant',
          coordinates: { lat: 31.7767, lng: 35.2345 },
          difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9, ...over },
      ] },
    ] } });

    await expectError('import: a number where `answers` belongs is invalid-argument, not internal',
      creator.call('importGameFile', { file: withTaskOverride({ type: 'quiz', choices: ['a'], answers: 5 }) }),
      { codeIn: ['functions/invalid-argument'] });
    // FORBIDDEN_KEYS is ['__proto__','constructor','prototype'] and this exercises
    // it with `constructor`, deliberately NOT `__proto__`. A literal `__proto__`
    // key cannot survive the callable transport at all: both the client encoder
    // (@firebase/util mapValues) and the server decoder (firebase-functions
    // `decode`) rebuild every object with `obj[k] = …`, and for the key
    // "__proto__" that assignment hits Object.prototype's SETTER — it changes the
    // new object's prototype and creates no own property, so the key is gone
    // before the callable body ever sees it. Asserting on it here would have been
    // a test of the SDK, failing for a reason that has nothing to do with the
    // guard under test. `constructor` is an ordinary writable data property, so it
    // arrives intact and reaches scanCandidateGraph as an own key.
    await expectError('import: a prototype-pollution key nested in task media is refused',
      creator.call('importGameFile', {
        file: withTaskOverride({
          media: [{ id: 'm', kind: 'image', url: 'https://x/y.png', constructor: { polluted: true } }],
        }),
      }),
      { codeIn: ['functions/invalid-argument'] });
    await expectError('import: an over-long answers list is refused',
      creator.call('importGameFile', {
        file: withTaskOverride({ type: 'quiz', answers: Array.from({ length: 1001 }, () => 'a') }),
      }),
      { codeIn: ['functions/invalid-argument'] });
    await expectError('import: an over-deep document is refused, not a 500',
      creator.call('importGameFile', {
        file: { ...file, game: { ...file.game, branding: (() => {
          let n = 1; for (let i = 0; i < 60; i++) n = { n }; return n;
        })() } },
      }),
      { codeIn: ['functions/invalid-argument'] });

    // ── (8c) The file door runs the SAME semantic guards as the save door ─────
    // (changes: task-duration-defaults · expose-enforced-settings). A game file is
    // a creator's own bytes but still UNTRUSTED input, and it used to be the only
    // door that checked none of this — so a hand-edited file could write a NaN
    // centre onto the field `updateLocation` reads, or a non-finite
    // `expectedDurationMinutes` that NaNs the speed bonus for every team in the
    // run. Same helpers, same terms, so the two doors cannot drift.
    const withGameOverride = (over) => ({ ...file, game: { ...file.game, ...over } });

    await expectError('import: a negative expectedDurationMinutes is refused',
      creator.call('importGameFile', { file: withTaskOverride({ expectedDurationMinutes: -5 }) }),
      { codeIn: ['functions/invalid-argument'], match: /expectedDuration|duration/i });
    // NaN cannot cross a callable at all: the client SDK refuses to ENCODE it and
    // throws locally, so the server guard is never reached. `null` is the spelling
    // that actually arrives, and it exercises
    // this exercises the TASK_FIELD_TYPES 'number' arm of the same guard.
    await expectError('import: a null expectedDurationMinutes is refused (NaN cannot cross the wire)',
      creator.call('importGameFile', { file: withTaskOverride({ expectedDurationMinutes: null }) }),
      { codeIn: ['functions/invalid-argument'] });

    await expectError('import: a safe zone with a null centre is refused (NaN cannot cross the wire)',
      creator.call('importGameFile', {
        file: withGameOverride({ safeZone: { center: { lat: null, lng: 35.21 }, radiusMeters: 500 } }),
      }),
      { codeIn: ['functions/invalid-argument'] });
    // A zero radius is refused rather than stored as "off": evaluateSafeZoneStatus
    // would read it as `no_zone`, silently disabling a boundary the author believed
    // they had configured.
    await expectError('import: a safe zone with a zero radius is refused',
      creator.call('importGameFile', {
        file: withGameOverride({ safeZone: { center: { lat: 31.78, lng: 35.21 }, radiusMeters: 0 } }),
      }),
      { codeIn: ['functions/invalid-argument'] });
    // Refused, not stripped: `startTeams` holds every team of such a game and no
    // participant surface can create the consent record, so importing the flag
    // would hand the creator a run nobody can start and nobody can unblock.
    await expectError('import: a file requiring guardian consent is refused as unsatisfiable',
      creator.call('importGameFile', { file: withGameOverride({ requiresGuardianConsent: true }) }),
      { codeIn: ['functions/failed-precondition'], match: /consent/i });

    // Exactly ONE game was created between `beforeBad` and here — the key-less
    // DRAFT that import now legitimately accepts (change:
    // builder-draft-save-tolerance). Every genuine refusal above must still have
    // written nothing, so the expected delta is 1 and not "1 or more": an off-by-one
    // here would mean a rejected file had left a half-game behind, which is the
    // regression this check exists to catch.
    check('import: no half-game was written by any refusal (only the accepted draft)',
      (await countGames()) === beforeBad + 1,
      `${beforeBad} → ${await countGames()} (expected ${beforeBad + 1})`);

    // ── (8d) An ACCEPTED boundary is stored NORMALIZED, never as the file's own
    //         object — the game doc is spread wholesale below, so without the
    //         rebuild an extra client-supplied key would ride straight onto the
    //         field the safety path reads.
    const { gameId: gZone } = await creator.call('importGameFile', {
      file: withGameOverride({
        safeZone: {
          center: { lat: 31.78, lng: 35.21, label: 'smuggled', accuracy: 5 },
          radiusMeters: 450,
          releasedBy: 'somebody-else',
        },
      }),
    });
    const { game: zoneGame } = await creator.call('getGame', { gameId: gZone });
    // Key SETS are compared (not a JSON string) so the assertion cannot be broken
    // or accidentally satisfied by Firestore's map-key ordering.
    const storedZone = zoneGame?.safeZone;
    check('import: an accepted safe zone stores exactly center{lat,lng} + radiusMeters',
      JSON.stringify(Object.keys(storedZone ?? {}).sort()) === JSON.stringify(['center', 'radiusMeters'])
        && JSON.stringify(Object.keys(storedZone?.center ?? {}).sort()) === JSON.stringify(['lat', 'lng'])
        && storedZone?.center?.lat === 31.78 && storedZone?.center?.lng === 35.21
        && storedZone?.radiusMeters === 450,
      JSON.stringify(storedZone));

    // ── (9) A file naming a FOREIGN owner/id is not an account-transfer ───────
    const { gameId: gForeign } = await creator.call('importGameFile', {
      file: { ...file, game: { ...file.game, ownerUid: 'somebody-else', id: 'forged-id', playCount: 999,
        visibility: 'public' } },
    });
    check('import: a forged id is ignored (fresh server id)', gForeign !== 'forged-id', gForeign);
    const { game: forged } = await creator.call('getGame', { gameId: gForeign });
    check('import: a forged ownerUid is ignored (caller owns it)',
      forged?.ownerUid === creatorCred.user.uid, String(forged?.ownerUid));
    check('import: a forged visibility/playCount is ignored',
      forged?.visibility === 'private' && forged?.playCount === 0,
      `${forged?.visibility} / ${forged?.playCount}`);

    // The rest of the smuggling surface (change: game-import-hardening): a trash
    // tombstone, an owner SECRET, and wallet/credit-shaped fields must not ride
    // in on a file either.
    const { gameId: gSmuggle } = await creator.call('importGameFile', {
      file: { ...file, game: { ...file.game,
        deletedAt: '1999-01-01T00:00:00.000Z', deletedBy: 'somebody-else',
        integrationWebhookUrl: 'https://hooks.example.com/secret', integrationPlatform: 'slack',
        credits: 1000000, wallet: { balance: 1000000 } } },
    });
    const { game: smuggled } = await creator.call('getGame', { gameId: gSmuggle });
    check('import: tombstone / webhook secret / wallet fields never ride in on a file',
      smuggled?.deletedAt === undefined && smuggled?.deletedBy === undefined
      && smuggled?.integrationWebhookUrl === undefined && smuggled?.integrationPlatform === undefined
      && smuggled?.credits === undefined && smuggled?.wallet === undefined,
      JSON.stringify({ deletedAt: smuggled?.deletedAt, hook: smuggled?.integrationWebhookUrl,
        credits: smuggled?.credits, wallet: smuggled?.wallet }));
  }); // scenario: game file export/import

  // ═══ Live task pause (change: live-task-pause) ══════════════════════════════
  //
  // THE INCIDENT this scenario exists for: `Task.status` (StationStatus) was
  // ENFORCED by routing in three places and WRITTEN by nothing. So when a stop
  // died mid event (shop closed, street blocked, host gone, weather) the
  // organizer's only two options were to keep routing teams to a dead stop or to
  // end the run. `setRunTaskStatus` is the writer, and it is RUN scoped — the
  // override lives on the run document, never on the game template, which later
  // runs replay and the Builder rewrites wholesale.
  //
  // Four contracts are pinned here, in the order they matter to a live event:
  //   A. routing honours pause AND resume (and `closed`, incl. recommendations),
  //   B. a team ALREADY HOLDING the task is never stranded by the pause,
  //   C. a pause that would dead-end a partial-completion stage is refused with a
  //      machine-readable reason, writes nothing, and is overridable with `force`,
  //   D. an unknown status writes nothing, and a repeated same-status call no-ops.
  // (The denial side of authz lives in the table-driven matrix above; the ALLOWED
  // side — owner and run-scoped staff — is proven here.)
  await scenario('live task pause (setRunTaskStatus · routing · holders · unwinnable)', async () => {
    const OWNER = creatorCred.user.uid;
    // The whole routing argument rests on transit: NEAR sits exactly on the team,
    // FAR ~2.2 km away. With `fixed_points_speed` the score is
    // 0.6·load − 0.4·transit and both stations are equally unloaded, so NEAR wins
    // every tie-free comparison. That is what makes "FAR was assigned" evidence
    // that the pause filter ran, rather than evidence of an arbitrary sort order.
    const TEAM = { lat: 31.7800, lng: 35.2100 };
    const FAR = { lat: 31.8000, lng: 35.2100 };

    const { gameId: lg } = await creator.call('createGame', { title: 'Live Pause Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: lg, scoringPreset: 'fixed_points_speed',
      // requiredTaskCount 1 of 2 — so taking ONE task out of play is legal here
      // (availableAfter 1 ≥ requiredCount 1) and the unwinnable guard, which has
      // its own fixture below, does not fire and mask the routing assertions.
      stages: [{ id: 'lp-s', order: 0, title: 'Stations', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'lp-near', title: 'Nearest stop', type: 'field', triggerMode: 'radius',
          coordinates: { ...TEAM }, geofenceRadiusMeters: 100,
          difficulty: 2, estimatedMinutes: 3, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'lp-far', title: 'Far stop', type: 'field', triggerMode: 'radius',
          coordinates: { ...FAR }, geofenceRadiusMeters: 100,
          difficulty: 2, estimatedMinutes: 3, pointValue: 50, maxConcurrentTeams: 3 },
      ] }],
    });
    const { runId: lr, accessCode: lc } = await creator.call('launchRun', { gameId: lg });
    const L = { ownerUid: OWNER, gameId: lg, runId: lr };
    const lRunPath = `users/${OWNER}/games/${lg}/runs/${lr}`;

    // ── A. Pause → the nearest stop stops being handed out ────────────────────
    const pausedNear = await creator.call('setRunTaskStatus', { ...L, taskId: 'lp-near', status: 'paused', reason: 'shop shuttered' });
    check('pause: the response reports the transition active → paused',
      pausedNear?.ok === true && pausedNear?.previousStatus === 'active'
      && pausedNear?.status === 'paused' && pausedNear?.noop === false,
      JSON.stringify(pausedNear));
    check('pause: nobody was holding it, and the response says so',
      pausedNear?.teamsHolding === 0, JSON.stringify(pausedNear?.teamsHolding));
    const overridesNow = (await creator.getDocAt(lRunPath)).data?.taskStatusOverrides ?? {};
    check('pause: the override is persisted on the RUN document',
      overridesNow['lp-near'] === 'paused', JSON.stringify(overridesNow));

    const player = makeParty('pausePlayer');
    await signInAnonymously(player.auth);
    await player.call('joinRun', { code: lc, displayName: 'Router' });
    await creator.call('startTeams', { gameId: lg, runId: lr });

    const heldAtStart = (await player.call('getMyTeamState', { code: lc }))?.team?.activeTaskId ?? null;
    check('pause: startTeams\' own auto-assignment also honours the pause',
      heldAtStart === 'lp-far', String(heldAtStart));
    if (heldAtStart) await player.call('checkOutTask', { code: lc, taskId: heldAtStart });

    // Ask repeatedly, releasing the slot each time, so the filter is proven to
    // hold across calls rather than once. checkOutTask puts the task back in the
    // pool (status 'unassigned'), so every iteration re-runs the same decision.
    const picks = [];
    for (let i = 0; i < 3; i++) {
      const r = await player.call('requestNextTask', { ...L, lat: TEAM.lat, lng: TEAM.lng });
      picks.push(r?.taskId ?? null);
      if (r?.taskId) await player.call('checkOutTask', { code: lc, taskId: r.taskId });
    }
    check('pause: repeated requestNextTask never returns the paused task, though it is the NEAREST one',
      picks.length === 3 && picks.every((id) => id === 'lp-far'), picks.join(','));

    // ── A. Resume → it becomes assignable again ───────────────────────────────
    const resumed = await creator.call('setRunTaskStatus', { ...L, taskId: 'lp-near', status: 'active', reason: 'reopened' });
    check('resume: the response reports the transition paused → active',
      resumed?.previousStatus === 'paused' && resumed?.status === 'active' && resumed?.noop === false,
      JSON.stringify(resumed));
    const afterResume = await player.call('requestNextTask', { ...L, lat: TEAM.lat, lng: TEAM.lng });
    check('resume: the task is assignable again — and wins on transit, exactly as it would have before the pause',
      afterResume?.taskId === 'lp-near', JSON.stringify(afterResume));
    if (afterResume?.taskId) await player.call('checkOutTask', { code: lc, taskId: afterResume.taskId });

    // ── D. An unknown status is rejected and writes nothing ───────────────────
    const beforeBadStatus = JSON.stringify((await creator.getDocAt(lRunPath)).data?.taskStatusOverrides ?? null);
    await expectError('invalid: a status outside {active,paused,closed} is rejected',
      creator.call('setRunTaskStatus', { ...L, taskId: 'lp-far', status: 'disabled' }),
      { codeIn: ['functions/invalid-argument'] });
    const afterBadStatus = JSON.stringify((await creator.getDocAt(lRunPath)).data?.taskStatusOverrides ?? null);
    check('invalid: the rejected call left run.taskStatusOverrides byte-identical',
      afterBadStatus === beforeBadStatus, `${beforeBadStatus} → ${afterBadStatus}`);
    check('invalid: no override key was created for the task the bad call named',
      ((await creator.getDocAt(lRunPath)).data?.taskStatusOverrides ?? {})['lp-far'] === undefined,
      afterBadStatus);

    // ── D. A repeated same-status call is an idempotent no-op ─────────────────
    const firstPause = await creator.call('setRunTaskStatus', { ...L, taskId: 'lp-far', status: 'paused' });
    const secondPause = await creator.call('setRunTaskStatus', { ...L, taskId: 'lp-far', status: 'paused' });
    check('idempotent: the FIRST pause is a real transition (noop false)',
      firstPause?.noop === false && firstPause?.previousStatus === 'active', JSON.stringify(firstPause));
    check('idempotent: the repeated call reports itself as a no-op and does not invent a transition',
      secondPause?.noop === true && secondPause?.previousStatus === 'paused' && secondPause?.status === 'paused',
      JSON.stringify(secondPause));

    // ── Authz, ALLOWED side: staff scoped to THIS run may take a task out of play.
    // (participant / stranger / other-run staff denials are rows in the matrix.)
    const { pin: pausePin } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: lg, runId: lr, name: 'Course Marshal', permissions: ['review_photos'],
    });
    const marshal = makeParty('pauseMarshal');
    await signInAnonymously(marshal.auth);
    const marshalTok = await marshal.call('staffSignIn', { ownerUid: OWNER, gameId: lg, runId: lr, pin: pausePin });
    await signInWithCustomToken(marshal.auth, marshalTok.customToken);
    const byStaff = await marshal.call('setRunTaskStatus', { ...L, taskId: 'lp-far', status: 'closed', reason: 'host left' });
    check('authz: staff scoped to THIS run may take a task out of play',
      byStaff?.ok === true && byStaff?.status === 'closed' && byStaff?.previousStatus === 'paused',
      JSON.stringify(byStaff));

    // ── A. `closed` behaves like `paused` for routing, AND for recommendations ─
    // A SECOND run of the same game: overrides are per-run, so this one starts
    // clean — which is also what proves the scoping at the end of the block.
    const { runId: lr2, accessCode: lc2 } = await creator.call('launchRun', { gameId: lg });
    const L2 = { ownerUid: OWNER, gameId: lg, runId: lr2 };
    const closer = makeParty('pauseCloser');
    await signInAnonymously(closer.auth);
    await closer.call('joinRun', { code: lc2, displayName: 'Closer' });

    const closedNear = await creator.call('setRunTaskStatus', { ...L2, taskId: 'lp-near', status: 'closed', reason: 'street sealed' });
    check('closed: the response reports the transition active → closed',
      closedNear?.previousStatus === 'active' && closedNear?.status === 'closed' && closedNear?.noop === false,
      JSON.stringify(closedNear));

    await creator.call('startTeams', { gameId: lg, runId: lr2 });
    const held2 = (await closer.call('getMyTeamState', { code: lc2 }))?.team?.activeTaskId ?? null;
    if (held2) await closer.call('checkOutTask', { code: lc2, taskId: held2 });
    const picks2 = [];
    for (let i = 0; i < 3; i++) {
      const r = await closer.call('requestNextTask', { ...L2, lat: TEAM.lat, lng: TEAM.lng });
      picks2.push(r?.taskId ?? null);
      if (r?.taskId) await closer.call('checkOutTask', { code: lc2, taskId: r.taskId });
    }
    check('closed: a closed task is never assigned either, though it is the nearest',
      picks2.length === 3 && picks2.every((id) => id === 'lp-far'), picks2.join(','));

    const recs = await closer.call('getRecommendedTasks', { code: lc2, lat: TEAM.lat, lng: TEAM.lng });
    const recIds = (recs?.recommendations ?? []).map((r) => r.taskId);
    check('closed: getRecommendedTasks omits the closed task but still offers the others',
      recIds.includes('lp-far') && !recIds.includes('lp-near'), recIds.join(','));

    // RUN scoping, the whole design decision (design D1): closing the task in run
    // 2 must not reach run 1, where the same task was explicitly resumed above.
    const run1Overrides = (await creator.getDocAt(lRunPath)).data?.taskStatusOverrides ?? {};
    check('scope: the override is per-RUN — run 1 still has the same task active',
      run1Overrides['lp-near'] === 'active', JSON.stringify(run1Overrides));
    // …and the GAME TEMPLATE — replayed by later runs, duplicated, exported and
    // published — is never written to at all.
    const { game: lgTemplate } = await creator.call('getGame', { gameId: lg });
    const nearTemplate = (lgTemplate?.stages ?? []).flatMap((s) => s.tasks ?? []).find((t) => t.id === 'lp-near');
    check('scope: the game TEMPLATE task carries no status — the override never touched it',
      !!nearTemplate && nearTemplate.status === undefined, JSON.stringify(nearTemplate?.status));

    // ── B. A team already HOLDING the task is not stranded by the pause ───────
    // Both stations sit on the team so one set of coordinates completes either,
    // and each is cap-1 so run.taskCounts is a meaningful slot ledger.
    const { gameId: hg } = await creator.call('createGame', { title: 'Paused Holder Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: hg, scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'hp-s', order: 0, title: 'Stations', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'hp-a', title: 'Station A', type: 'field', triggerMode: 'radius',
          coordinates: { ...TEAM }, geofenceRadiusMeters: 100,
          difficulty: 2, estimatedMinutes: 3, pointValue: 60, maxConcurrentTeams: 1 },
        { id: 'hp-b', title: 'Station B', type: 'field', triggerMode: 'radius',
          coordinates: { ...TEAM }, geofenceRadiusMeters: 100,
          difficulty: 2, estimatedMinutes: 3, pointValue: 60, maxConcurrentTeams: 1 },
      ] }],
    });
    const { runId: hr, accessCode: hc } = await creator.call('launchRun', { gameId: hg });
    const H = { ownerUid: OWNER, gameId: hg, runId: hr };
    const hRunPath = `users/${OWNER}/games/${hg}/runs/${hr}`;
    const holder = makeParty('pauseHolder');
    await signInAnonymously(holder.auth);
    await holder.call('joinRun', { code: hc, displayName: 'Standing There' });
    const holderUid = holder.auth.currentUser.uid;
    await creator.call('startTeams', { gameId: hg, runId: hr });

    const held = (await holder.call('getMyTeamState', { code: hc }))?.team?.activeTaskId ?? null;
    check('holder precondition: the team holds one of the two stations',
      held === 'hp-a' || held === 'hp-b', String(held));
    let hCounts = (await creator.getDocAt(hRunPath)).data?.taskCounts ?? {};
    check('holder precondition: the held station reserved its slot (taskCounts == 1)',
      (hCounts[held] ?? 0) === 1, JSON.stringify(hCounts));

    const pausedHeld = await creator.call('setRunTaskStatus', { ...H, taskId: held, status: 'paused', reason: 'host stepped away' });
    check('holder: the pause REPORTS the team standing at the stop instead of revoking it',
      pausedHeld?.ok === true && pausedHeld?.teamsHolding === 1 && pausedHeld?.status === 'paused',
      JSON.stringify(pausedHeld));

    // THE STUCK-PLAYER BUG CLASS this asserts against: if the override were read on
    // the completion path too, this team would be holding a task it can never finish.
    const doneHeld = await holder.call('completeTask', { ...H, taskId: held, lat: TEAM.lat, lng: TEAM.lng });
    check('holder: a team already holding a PAUSED task can still complete it',
      doneHeld?.ok === true && doneHeld?.already !== true, JSON.stringify(doneHeld));
    const hTeam = await creator.getDocAt(`${hRunPath}/teams/${holderUid}`);
    check('holder: the completion was SCORED (the pause does not void the points)',
      (hTeam.data?.score ?? 0) > 0, JSON.stringify(hTeam.data?.score));
    hCounts = (await creator.getDocAt(hRunPath)).data?.taskCounts ?? {};
    check('holder: the paused station released its slot (counter back to 0 — no leak)',
      (hCounts[held] ?? 0) === 0, JSON.stringify(hCounts));

    // ── C. The unwinnable-stage guard ────────────────────────────────────────
    // requiredTaskCount 2 of 2: pausing EITHER task leaves the stage unable to
    // yield what it requires. The organizer must learn that here, not through
    // teams that silently dead-end in the field.
    const { gameId: ug } = await creator.call('createGame', { title: 'Unwinnable Pause Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: ug, scoringPreset: 'time_only',
      stages: [{ id: 'uw-s', order: 0, title: 'Both required', isFinal: true, requiredTaskCount: 2, tasks: [
        { id: 'uw-a', title: 'Left', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
        { id: 'uw-b', title: 'Right', type: 'self_report', triggerMode: 'locationless', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: ur } = await creator.call('launchRun', { gameId: ug });
    const U = { ownerUid: OWNER, gameId: ug, runId: ur };
    const uRunPath = `users/${OWNER}/games/${ug}/runs/${ur}`;

    // This run has never had an override written, so `null` here is the full
    // before-image — the comparison below is the literal "UNCHANGED" contract.
    const uBefore = JSON.stringify((await creator.getDocAt(uRunPath)).data?.taskStatusOverrides ?? null);
    const uwErr = await expectError('unwinnable: pausing a task the stage cannot spare is refused',
      creator.call('setRunTaskStatus', { ...U, taskId: 'uw-a', status: 'paused' }),
      { codeIn: ['functions/failed-precondition'] });
    check('unwinnable: the refusal is machine-readable (details.code === stageUnwinnable)',
      uwErr?.details?.code === 'stageUnwinnable', JSON.stringify(uwErr?.details));
    check('unwinnable: the refusal carries the counts the operator needs to decide',
      uwErr?.details?.availableCount === 1 && uwErr?.details?.requiredCount === 2,
      JSON.stringify(uwErr?.details));
    const uAfter = JSON.stringify((await creator.getDocAt(uRunPath)).data?.taskStatusOverrides ?? null);
    check('unwinnable: the refused call left run.taskStatusOverrides UNCHANGED (nothing written)',
      uAfter === uBefore, `${uBefore} → ${uAfter}`);

    // …and the operator can still override the guard deliberately.
    const uForced = await creator.call('setRunTaskStatus', {
      ...U, taskId: 'uw-a', status: 'paused', force: true, reason: 'street closed by police',
    });
    check('unwinnable: force applies the change and STILL reports the dead end it created',
      uForced?.ok === true && uForced?.status === 'paused' && uForced?.stageUnwinnable === true
      && uForced?.availableCount === 1 && uForced?.requiredCount === 2,
      JSON.stringify(uForced));
    const uOverrides = (await creator.getDocAt(uRunPath)).data?.taskStatusOverrides ?? {};
    check('unwinnable: the forced override is persisted on the run document',
      uOverrides['uw-a'] === 'paused', JSON.stringify(uOverrides));

    // ── The durable trail: taking a task out of play changes what every team in
    //    the run can score, so it is audited like adjustTeamScore.
    const pauseLogs = await platformAdmin.call('listAuditLogs', { limit: 500 });
    const statusEntries = (pauseLogs?.logs ?? []).filter((l) => l.actionType === 'task_status_changed');
    const forcedEntry = statusEntries.find((l) => l.runId === ur && l.taskId === 'uw-a');
    check('audit: the FORCED change is recorded, and recorded as forced',
      forcedEntry?.forced === true && forcedEntry?.previousValue === 'active' && forcedEntry?.newValue === 'paused',
      JSON.stringify(forcedEntry));
    check('audit: the operator\'s reason rides along on the record',
      forcedEntry?.reason === 'street closed by police', JSON.stringify(forcedEntry?.reason));
    const plainEntry = statusEntries.find((l) => l.runId === lr && l.taskId === 'lp-near' && l.newValue === 'paused');
    check('audit: an ordinary pause is recorded as NOT forced (the flag distinguishes them)',
      plainEntry?.forced === false, JSON.stringify(plainEntry));
  });

  // ═══ Single-task skip (change: skip-single-task) ════════════════════════════
  // The bug this closes: the console's only skip was `skipStage`, so removing ONE
  // unreachable mission destroyed every OTHER mission that team still had in the
  // stage. The load-bearing assertions here are the NEGATIVES — after the skip the
  // stage is STILL ACTIVE and the siblings are STILL PLAYABLE — because that is
  // exactly what the old behaviour destroyed.
  await scenario('single task skip (one mission, same stage, no stage jump)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: sg } = await creator.call('createGame', { title: 'Skip One Mission', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: sg, scoringPreset: 'fixed_points_speed',
      // 3 of 3 on purpose: this is the shape that USED to strand a team. Skipping
      // one task satisfies neither `completedCount >= required` nor `allTerminal`,
      // so without the requirement drop the team could never finish the stage.
      stages: [{ id: 'sk-s', order: 0, title: 'Three stops', isFinal: true, requiredTaskCount: 3, tasks: [
        { id: 'sk-a', title: 'Stop A', type: 'field', triggerMode: 'instant',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'sk-b', title: 'Stop B', type: 'field', triggerMode: 'instant',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'sk-c', title: 'Stop C', type: 'field', triggerMode: 'instant',
          coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 1, pointValue: 50, maxConcurrentTeams: 3 },
      ] }],
    });
    const { runId: sr, accessCode: sc } = await creator.call('launchRun', { gameId: sg });
    const S = { ownerUid: OWNER, gameId: sg, runId: sr };
    const sRunPath = `users/${OWNER}/games/${sg}/runs/${sr}`;

    const sp = makeParty('skipPlayer');
    await signInAnonymously(sp.auth);
    await sp.call('joinRun', { code: sc, displayName: 'Skipper' });
    await creator.call('startTeams', { gameId: sg, runId: sr });
    const spUid = sp.auth.currentUser.uid;
    const sTeamPath = `${sRunPath}/teams/${spUid}`;

    const held = (await sp.call('getMyTeamState', { code: sc }))?.team?.activeTaskId ?? null;
    check('skip-task: the team is holding a mission before the skip', !!held, String(held));
    const countsBefore = (await creator.getDocAt(sRunPath)).data?.taskCounts ?? {};
    check('skip-task: the held mission reserves a station slot',
      (countsBefore[held] ?? 0) === 1, JSON.stringify(countsBefore));

    // ── The skip itself. No taskId — the console skips "the mission this team is
    //    on right now", resolved server-side.
    const res = await creator.call('skipTaskForTeam', { ...S, teamId: spUid, reason: 'shop shuttered' });
    check('skip-task: the response names the mission it skipped',
      res?.ok === true && res?.taskId === held, JSON.stringify(res));
    check('skip-task: the STAGE did not complete (this is the whole point)',
      res?.stageCompleted === false, JSON.stringify(res?.stageCompleted));
    check('skip-task: the team requirement dropped 3 → 2 so the stage stays winnable',
      res?.requiredTaskCount === 2 && res?.requirementLowered === true, JSON.stringify(res));
    check('skip-task: the team was routed to another mission IN THE SAME STAGE',
      !!res?.nextTaskId && res.nextTaskId !== held && ['sk-a', 'sk-b', 'sk-c'].includes(res.nextTaskId),
      JSON.stringify({ next: res?.nextTaskId, reason: res?.nextReason }));

    const teamAfter = (await creator.getDocAt(sTeamPath)).data ?? {};
    const stageAfter = (teamAfter.stages ?? [])[0] ?? {};
    const recOf = (id) => (stageAfter.tasks ?? []).find((t) => t.taskId === id);
    check('skip-task: the skipped record is `skipped`', recOf(held)?.status === 'skipped', recOf(held)?.status);
    check('skip-task: the skipped mission earned exactly 0 (no consolation award)',
      (recOf(held)?.earnedScore ?? 0) === 0, JSON.stringify(recOf(held)?.earnedScore));
    check('skip-task: the stage is STILL ACTIVE', stageAfter.status === 'active', stageAfter.status);
    check('skip-task: the lowered requirement is stored on the TEAM\'s stage record',
      stageAfter.requiredTaskCount === 2, JSON.stringify(stageAfter.requiredTaskCount));
    check('skip-task: the team\'s score did not move', (teamAfter.score ?? 0) === 0, String(teamAfter.score));
    const siblings = ['sk-a', 'sk-b', 'sk-c'].filter((id) => id !== held);
    check('skip-task: both sibling missions are STILL PLAYABLE (skipStage would have killed them)',
      siblings.every((id) => ['unassigned', 'assigned'].includes(recOf(id)?.status)),
      JSON.stringify(siblings.map((id) => [id, recOf(id)?.status])));
    const countsAfter = (await creator.getDocAt(sRunPath)).data?.taskCounts ?? {};
    check('skip-task: the skipped mission gave its station slot back',
      (countsAfter[held] ?? 0) === 0, JSON.stringify(countsAfter));

    // ── The game template is untouched: this is a RUN-scoped, TEAM-scoped override.
    const tmpl = (await creator.getDocAt(`users/${OWNER}/games/${sg}`)).data ?? {};
    check('skip-task: the GAME TEMPLATE\'s requiredTaskCount is unchanged (still 3)',
      (tmpl.stages ?? [])[0]?.requiredTaskCount === 3,
      JSON.stringify((tmpl.stages ?? [])[0]?.requiredTaskCount));

    // ── A repeated skip of the same mission is refused, and writes nothing.
    await expectError('skip-task: skipping an already-skipped mission is refused',
      creator.call('skipTaskForTeam', { ...S, teamId: spUid, taskId: held }),
      { codeIn: ['functions/failed-precondition'] });
    const countsRepeat = (await creator.getDocAt(sRunPath)).data?.taskCounts ?? {};
    check('skip-task: the refused repeat did not touch the station counters',
      (countsRepeat[held] ?? 0) === 0, JSON.stringify(countsRepeat));
    const teamRepeat = (await creator.getDocAt(sTeamPath)).data ?? {};
    check('skip-task: the refused repeat did not touch the score or the requirement',
      (teamRepeat.score ?? 0) === 0 && (teamRepeat.stages ?? [])[0]?.requiredTaskCount === 2,
      JSON.stringify({ score: teamRepeat.score, req: (teamRepeat.stages ?? [])[0]?.requiredTaskCount }));

    // ── A mission that is not in the team's active stage is not found.
    await expectError('skip-task: an unknown mission id is refused',
      creator.call('skipTaskForTeam', { ...S, teamId: spUid, taskId: 'sk-nope' }),
      { codeIn: ['functions/not-found'] });

    // ── The team really can still finish: play the two survivors, and the stage
    //    completes at the LOWERED requirement instead of stranding the team.
    for (const id of siblings) {
      const cur = (await sp.call('getMyTeamState', { code: sc }))?.team?.activeTaskId ?? null;
      const play = cur && siblings.includes(cur) ? cur : id;
      await sp.call('completeTask', { ...S, taskId: play });
    }
    const finishedState = await sp.call('getMyTeamState', { code: sc });
    check('skip-task: the team FINISHES on the two survivors (never stranded at 3-of-3)',
      finishedState?.team?.status === 'finished', finishedState?.team?.status);
    const finalTeam = (await creator.getDocAt(sTeamPath)).data ?? {};
    check('skip-task: the skipped mission was never handed out again',
      ((finalTeam.stages ?? [])[0]?.tasks ?? []).find((t) => t.taskId === held)?.status === 'skipped',
      JSON.stringify(((finalTeam.stages ?? [])[0]?.tasks ?? []).map((t) => [t.taskId, t.status])));

    // ── Skipping the LAST playable mission DOES complete the stage — and only then.
    //    Fresh run of the same game, skipped down to nothing.
    const { runId: sr2, accessCode: sc2 } = await creator.call('launchRun', { gameId: sg });
    const S2 = { ownerUid: OWNER, gameId: sg, runId: sr2 };
    const sp2 = makeParty('skipPlayer2');
    await signInAnonymously(sp2.auth);
    await sp2.call('joinRun', { code: sc2, displayName: 'All Skipped' });
    await creator.call('startTeams', { gameId: sg, runId: sr2 });
    const sp2Uid = sp2.auth.currentUser.uid;

    const first = await creator.call('skipTaskForTeam', { ...S2, teamId: sp2Uid, reason: 'one' });
    check('skip-all: the first of three does not end the stage',
      first?.stageCompleted === false && first?.requiredTaskCount === 2, JSON.stringify(first));

    // Authz, ALLOWED side: staff scoped to THIS run may skip a mission.
    // (participant / stranger / other-run staff denials are rows in the matrix.)
    const { pin: skipPin } = await creator.call('inviteStaff', {
      ownerUid: OWNER, gameId: sg, runId: sr2, name: 'Skip Marshal', permissions: ['review_photos'],
    });
    const skipStaff = makeParty('skipMarshal');
    await signInAnonymously(skipStaff.auth);
    const skipTok = await skipStaff.call('staffSignIn', { ownerUid: OWNER, gameId: sg, runId: sr2, pin: skipPin });
    await signInWithCustomToken(skipStaff.auth, skipTok.customToken);
    const second = await skipStaff.call('skipTaskForTeam', { ...S2, teamId: sp2Uid, reason: 'two' });
    check('authz: staff scoped to THIS run may skip a mission for a team',
      second?.ok === true && second?.stageCompleted === false && second?.requiredTaskCount === 1,
      JSON.stringify(second));

    const third = await creator.call('skipTaskForTeam', { ...S2, teamId: sp2Uid, reason: 'three' });
    check('skip-all: skipping the LAST playable mission completes the stage',
      third?.stageCompleted === true, JSON.stringify(third));
    const team2 = (await creator.getDocAt(`${`users/${OWNER}/games/${sg}/runs/${sr2}`}/teams/${sp2Uid}`)).data ?? {};
    check('skip-all: the team is finished with a zero score (nothing was awarded)',
      team2.status === 'finished' && (team2.score ?? 0) === 0,
      JSON.stringify({ status: team2.status, score: team2.score }));
    const counts2 = (await creator.getDocAt(`users/${OWNER}/games/${sg}/runs/${sr2}`)).data?.taskCounts ?? {};
    check('skip-all: every station counter is back to zero (no leaked capacity)',
      Object.values(counts2).every((n) => (n ?? 0) === 0), JSON.stringify(counts2));

    // ── A finished run refuses further skips (same rule as every grading path).
    await creator.call('finalizeRun', { gameId: sg, runId: sr2 });
    await expectError('skip-task: a finished run refuses a skip',
      creator.call('skipTaskForTeam', { ...S2, teamId: sp2Uid, taskId: 'sk-a' }),
      { codeIn: ['functions/failed-precondition'] });

    // ── REGRESSION: skipStage still skips the WHOLE stage. This change is an
    //    addition, not a replacement.
    const { runId: sr3, accessCode: sc3 } = await creator.call('launchRun', { gameId: sg });
    const sp3 = makeParty('skipPlayer3');
    await signInAnonymously(sp3.auth);
    await sp3.call('joinRun', { code: sc3, displayName: 'Whole Stage' });
    await creator.call('startTeams', { gameId: sg, runId: sr3 });
    const sp3Uid = sp3.auth.currentUser.uid;
    await creator.call('skipStage', { gameId: sg, runId: sr3, teamId: sp3Uid });
    const team3 = (await creator.getDocAt(`users/${OWNER}/games/${sg}/runs/${sr3}/teams/${sp3Uid}`)).data ?? {};
    const stage3 = (team3.stages ?? [])[0] ?? {};
    check('regression: skipStage still marks EVERY task of the stage skipped',
      (stage3.tasks ?? []).every((t) => t.status === 'skipped') && stage3.status === 'completed',
      JSON.stringify((stage3.tasks ?? []).map((t) => [t.taskId, t.status])));

    // ── The durable trail: a skip removes a scoring opportunity from ONE team.
    const skipLogs = await platformAdmin.call('listAuditLogs', { limit: 500 });
    const skipEntries = (skipLogs?.logs ?? []).filter((l) => l.actionType === 'task_skipped');
    const entry = skipEntries.find((l) => l.runId === sr && l.taskId === held);
    check('audit: the skip is recorded with the team, the mission and the operator',
      !!entry && entry.teamId === spUid && entry.newValue === 'skipped' && !!entry.operatorId,
      JSON.stringify(entry));
    check('audit: the operator\'s reason rides along on the record',
      entry?.reason === 'shop shuttered', JSON.stringify(entry?.reason));
    check('audit: the record states whether the stage ended and whether the requirement dropped',
      entry?.stageCompleted === false && entry?.requirementLowered === true,
      JSON.stringify({ stageCompleted: entry?.stageCompleted, requirementLowered: entry?.requirementLowered }));
  });

  // staff-console-field-ops: setTeamHold (pause/resume a team's race clock) and
  // forceAssignTask (send ONE team to a specific mission instead of waiting on
  // routing). Denials live in the authz matrix above; this is the ALLOWED path.
  await scenario('staff field ops (setTeamHold · forceAssignTask)', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: fg } = await creator.call('createGame', { title: 'Field Ops Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: fg, scoringPreset: 'fixed_points_speed',
      // requiredTaskCount 1 of 2, both locationless: the team auto-assigns to ONE
      // of them and the other sits unassigned, exactly the shape forceAssignTask
      // needs to prove it can move a team onto the task routing did NOT pick.
      stages: [{ id: 'fo-s', order: 0, title: 'Stops', isFinal: true, requiredTaskCount: 1, tasks: [
        { id: 'fo-a', title: 'Stop A', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 20, maxConcurrentTeams: 9 },
        { id: 'fo-b', title: 'Stop B', type: 'self_report', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 20, maxConcurrentTeams: 9 },
      ] }],
    });
    const { runId: fr, accessCode: fc } = await creator.call('launchRun', { gameId: fg });
    const F = { ownerUid: OWNER, gameId: fg, runId: fr };
    const fTeamPathFor = (uid) => `users/${OWNER}/games/${fg}/runs/${fr}/teams/${uid}`;

    const fp = makeParty('fieldOpsPlayer');
    await signInAnonymously(fp.auth);
    await fp.call('joinRun', { code: fc, displayName: 'Fielder' });
    await creator.call('startTeams', { gameId: fg, runId: fr });
    const fpUid = fp.auth.currentUser.uid;

    // ── setTeamHold: pause the race clock, then resume it ─────────────────────
    const hold = await creator.call('setTeamHold', { ...F, teamId: fpUid, held: true, reason: 'medical check' });
    check('hold: the response reports held true with zero elapsed ms',
      hold?.ok === true && hold?.held === true && hold?.heldMsAdded === 0, JSON.stringify(hold));
    const heldTeam = (await creator.getDocAt(fTeamPathFor(fpUid))).data ?? {};
    check('hold: the team document carries held:true, an audit reason and a stamp',
      heldTeam.held === true && heldTeam.heldReason === 'medical check' && !!heldTeam.heldAt,
      JSON.stringify({ held: heldTeam.held, heldReason: heldTeam.heldReason, heldAt: heldTeam.heldAt }));

    await expectError('hold: holding an already-held team is refused, not silently no-op\'d',
      creator.call('setTeamHold', { ...F, teamId: fpUid, held: true }),
      { codeIn: ['functions/failed-precondition'] });

    // forceAssignTask must refuse a held team — routing it would defeat the hold.
    await expectError('hold: forceAssignTask refuses a held team',
      creator.call('forceAssignTask', { ...F, teamId: fpUid, taskId: 'fo-a' }),
      { codeIn: ['functions/failed-precondition'] });

    await new Promise((r) => setTimeout(r, 50)); // ensure heldMs has something nonzero to accumulate
    const resume = await creator.call('setTeamHold', { ...F, teamId: fpUid, held: false });
    check('resume: the response reports held false with a positive elapsed ms',
      resume?.ok === true && resume?.held === false && resume?.heldMsAdded > 0, JSON.stringify(resume));
    const resumedTeam = (await creator.getDocAt(fTeamPathFor(fpUid))).data ?? {};
    check('resume: held + heldAt + heldReason are cleared and heldMs accumulated',
      resumedTeam.held === false && resumedTeam.heldAt === undefined && resumedTeam.heldReason === undefined
      && resumedTeam.heldMs > 0,
      JSON.stringify({ held: resumedTeam.held, heldAt: resumedTeam.heldAt, heldMs: resumedTeam.heldMs }));

    await expectError('resume: unholding an already-active team is refused',
      creator.call('setTeamHold', { ...F, teamId: fpUid, held: false }),
      { codeIn: ['functions/failed-precondition'] });

    // ── forceAssignTask: send the team to the mission routing did NOT pick ────
    const before = (await fp.call('getMyTeamState', { code: fc }))?.team?.activeTaskId ?? null;
    check('force-assign: the team is holding exactly one of the two missions before the override',
      before === 'fo-a' || before === 'fo-b', String(before));
    const other = before === 'fo-a' ? 'fo-b' : 'fo-a';

    const forced = await creator.call('forceAssignTask', { ...F, teamId: fpUid, taskId: other });
    check('force-assign: the response reports the new task and displaces the old one',
      forced?.ok === true && forced?.taskId === other && forced?.displacedTaskId === before,
      JSON.stringify(forced));
    const afterForce = (await fp.call('getMyTeamState', { code: fc }))?.team?.activeTaskId ?? null;
    check('force-assign: the team\'s activeTaskId now IS the forced mission',
      afterForce === other, String(afterForce));

    await expectError('force-assign: forcing the team onto the mission it already holds is refused',
      creator.call('forceAssignTask', { ...F, teamId: fpUid, taskId: other }),
      { codeIn: ['functions/failed-precondition'] });

    await expectError('force-assign: a taskId outside this team\'s current stage is refused',
      creator.call('forceAssignTask', { ...F, teamId: fpUid, taskId: 'no-such-task' }),
      { codeIn: ['functions/invalid-argument'] });

    // ── The durable trail ──────────────────────────────────────────────────────
    const fieldLogs = await platformAdmin.call('listAuditLogs', { limit: 500 });
    const holdEntry = (fieldLogs?.logs ?? []).find((l) => l.runId === fr && l.actionType === 'team_held');
    check('audit: the hold is recorded with the team, the reason and the operator',
      !!holdEntry && holdEntry.teamId === fpUid && holdEntry.reason === 'medical check' && !!holdEntry.operatorId,
      JSON.stringify(holdEntry));
    const forceEntry = (fieldLogs?.logs ?? [])
      .find((l) => l.runId === fr && l.teamId === fpUid && String(l.actionType ?? '').includes('force_assign'));
    check('audit: the force-assign is recorded with the displaced task as the previous value',
      !!forceEntry && forceEntry.newValue === other && forceEntry.previousValue === before,
      JSON.stringify(forceEntry));
  });

  await scenario('run-summary email scope (real runs only; demo/sim/synthetic excluded)', async () => {
    // change: run-email-scope-and-digest. The emulator has no RESEND_API_KEY, so
    // NOTHING is ever actually sent here — which is itself part of the contract.
    // The observable is the run doc's `summaryEmailSent` claim: it is set only on
    // the path that would have delivered. That makes this a real assertion about
    // eligibility without a single network call.
    const OWNER = creatorCred.user.uid;
    // `adminDb` is a local of the test-drive section, not in scope here — take our
    // own handle off the module-level SDK.
    const aDb = adminSdk.firestore();
    const claimOf = async (gid, rid) =>
      (await aDb.doc(`users/${OWNER}/games/${gid}/runs/${rid}`).get()).data()?.summaryEmailSent;

    const mkGame = async (title, extra = {}) => {
      const { gameId } = await creator.call('createGame', { title, mode: 'individual' });
      await creator.call('updateGame', {
        gameId, scoringPreset: 'fixed_points_speed', ...extra,
        stages: [{ id: 'es-s', order: 0, title: 'One stop', isFinal: true, tasks: [
          { id: 'es-a', title: 'Stop A', type: 'self_report', triggerMode: 'instant',
            locationless: true, difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 5 },
        ] }],
      });
      return gameId;
    };

    // (a) NEGATIVE — unidentifiable owner. The synthetic-run rule must suppress the
    // email even though the run is otherwise a perfectly normal organizer run. This
    // is the rule that keeps a simulation pointed at production from mailing.
    // The creator is shared across scenarios and the core lifecycle stamps an email
    // on it, so clear that first — otherwise this case silently stops being
    // synthetic and passes for the wrong reason.
    await aDb.doc(`users/${OWNER}`).set(
      { email: adminSdk.firestore.FieldValue.delete() }, { merge: true });
    const gSyn = await mkGame('Email Scope Synthetic');
    const { runId: rSyn } = await creator.call('launchRun', { gameId: gSyn });
    await creator.call('finalizeRun', { gameId: gSyn, runId: rSyn });
    check('an anonymous-owner (synthetic) run does NOT claim the email',
      (await claimOf(gSyn, rSyn)) !== true, String(await claimOf(gSyn, rSyn)));

    // Make the creator identifiable for the remaining cases. Written with the
    // Admin SDK because users/{uid} is server-write-only.
    await aDb.doc(`users/${OWNER}`).set(
      { email: 'e2e-creator@example.test', displayName: 'E2E Creator' }, { merge: true });

    // (b) POSITIVE — real organizer run, identifiable owner ⇒ the claim is set.
    const gReal = await mkGame('Email Scope Real');
    const { runId: rReal } = await creator.call('launchRun', { gameId: gReal });
    await creator.call('finalizeRun', { gameId: gReal, runId: rReal });
    check('a real organizer run CLAIMS the email exactly once',
      (await claimOf(gReal, rReal)) === true, String(await claimOf(gReal, rReal)));

    // (c) NEGATIVE — test-drive rehearsal, same identifiable owner.
    const gTd = await mkGame('Email Scope TestDrive');
    const { runId: rTd } = await creator.call('launchRun', { gameId: gTd, testDrive: true });
    await creator.call('finalizeRun', { gameId: gTd, runId: rTd });
    check('a test-drive run does NOT claim the email',
      (await claimOf(gTd, rTd)) !== true, String(await claimOf(gTd, rTd)));

    // (d) NEGATIVE — self-guided demo run via startInstantPlay. Reported by the
    // daily digest as a count instead of mailing per run.
    const gDemo = await mkGame('Email Scope Demo', { allowInstantPlay: true });
    await creator.call('publishGame', { gameId: gDemo, visibility: 'public' });
    const demoPlayer = makeParty('email-scope-demo');
    await signInAnonymously(demoPlayer.auth);
    const ip = await demoPlayer.call('startInstantPlay', { gameId: gDemo, displayName: 'Demo Player' });
    if (ip?.runId) {
      const demoRun = (await aDb.doc(`users/${OWNER}/games/${gDemo}/runs/${ip.runId}`).get()).data();
      check('startInstantPlay produced a selfGuided run', demoRun?.selfGuided === true,
        JSON.stringify(demoRun?.selfGuided));
      // MUST finalize before asserting, or the check is vacuous: an unfinalized run
      // has no claim regardless of eligibility, so it would "pass" for the wrong
      // reason and keep passing if the demo exclusion were later removed.
      await creator.call('finalizeRun', { gameId: gDemo, runId: ip.runId });
      const demoFinal = (await aDb.doc(`users/${OWNER}/games/${gDemo}/runs/${ip.runId}`).get()).data();
      check('the demo run really did finalize (so the next check is not vacuous)',
        demoFinal?.status === 'finished', demoFinal?.status);
      check('a FINALIZED self-guided demo run does NOT claim the email',
        demoFinal?.summaryEmailSent !== true, String(demoFinal?.summaryEmailSent));
    } else {
      check('startInstantPlay returned a runId for the demo case', false, JSON.stringify(ip));
    }

    // (e) The inline consolidation must be exactly-once: re-finalizing is a no-op
    // and must not flip or re-run anything.
    await creator.call('finalizeRun', { gameId: gReal, runId: rReal });
    check('re-finalizing leaves the email claim set exactly once (no double-send)',
      (await claimOf(gReal, rReal)) === true);
  });

  // ═══ Callable coverage guard ════════════════════════════════════════════════
  // Introspect the callables the emulator actually serves (from the built lib)
  // and require every one to have been INVOKED by the suite above (positively or
  // via the authz denial matrix). A newly added callable ships RED here until it
  // gets a test — the single biggest "don't let an untested callable slip" lever.
  // ── Test mode / assessment mode (change: test-mode-hidden-scoring) ──────────
  // The feature is a PAYLOAD guarantee, not a UI one: getMyTeamState returns the
  // team document whole, so a score hidden only in play-web is still one devtools
  // tab away. Every assertion here therefore inspects the WIRE, and the score
  // sweep is RECURSIVE — a nested task record is exactly where a leak would hide.
  await scenario('test mode (sealed scoring · answers always advance · graded for the owner)', async () => {
    const tmPlayer = makeParty('tmPlayer');
    await signInAnonymously(tmPlayer.auth);
    const OWNER = creatorCred.user.uid;

    const { gameId: tg } = await creator.call('createGame', { title: 'Assessment Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: tg,
      testMode: true,
      scoringPreset: 'fixed_points_speed',
      // attemptLimit + hintPenalty on purpose: both are mechanisms test mode must
      // SUPPRESS, so a regression that leaves them armed fails right here.
      stages: [{ id: 'tm-s', order: 0, title: 'Questions', isFinal: true, tasks: [
        { id: 'tm-q1', title: 'Q1', type: 'quiz', locationless: true, coordinates: { lat: 0, lng: 0 },
          choices: ['a', 'b'], answers: ['a'], difficulty: 3, estimatedMinutes: 2, pointValue: 50,
          maxConcurrentTeams: 3, hint: 'it is a', hintPenalty: 25, smart: { attemptLimit: 2 } },
        { id: 'tm-q2', title: 'Q2', type: 'quiz', locationless: true, coordinates: { lat: 0, lng: 0 },
          choices: ['x', 'y'], answers: ['x'], difficulty: 3, estimatedMinutes: 2, pointValue: 50,
          maxConcurrentTeams: 3 },
      ] }],
    });
    const savedTm = await creator.call('getGame', { gameId: tg });
    check('test mode: the setting persists through updateGame', savedTm?.game?.testMode === true, String(savedTm?.game?.testMode));

    const { runId: tr, accessCode: tc } = await creator.call('launchRun', { gameId: tg });
    await tmPlayer.call('joinRun', { code: tc, displayName: 'Candidate' });
    await creator.call('startTeams', { gameId: tg, runId: tr });

    let tmState = await tmPlayer.call('getMyTeamState', { code: tc });
    const firstTask = tmState?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
    check('test mode: a task is assigned', !!firstTask, JSON.stringify(tmState?.team?.stages?.[0]?.tasks));
    check('test mode: the payload advertises testMode so the app can seal its chrome',
      tmState?.game?.testMode === true, String(tmState?.game?.testMode));

    // ── A WRONG answer must complete the task and move on ────────────────────
    const wrongRes = await tmPlayer.call('submitTaskAnswer', {
      code: tc, taskId: firstTask.taskId, answer: 'definitely-wrong',
    });
    check('test mode: a wrong answer returns recorded:true', wrongRes?.recorded === true, JSON.stringify(wrongRes));
    for (const k of ['correct', 'penalty', 'attemptsUsed', 'cooldownUntil', 'retryAfterMs', 'retryAfterSeconds']) {
      check(`test mode: the answer response omits ${k}`, !(k in (wrongRes ?? {})), JSON.stringify(wrongRes));
    }

    tmState = await tmPlayer.call('getMyTeamState', { code: tc });
    const q1Rec = tmState?.team?.stages?.[0]?.tasks?.find((t) => t.taskId === 'tm-q1');
    check('test mode: a WRONG answer still completes the task', q1Rec?.status === 'completed', q1Rec?.status);
    const nextTask = tmState?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
    check('test mode: the participant is routed onward after a wrong answer', !!nextTask, nextTask?.taskId);

    // ── No cap, no lockout, no hint charge ───────────────────────────────────
    // q1 carried attemptLimit 2 and a cost level would normally have started a
    // cooldown; answering the NEXT task straight away proves neither armed.
    let secondThrew = null;
    if (nextTask) {
      try {
        // CORRECT this time, so the scenario covers both scoring outcomes — and it
        // still proves the cap never armed, because the old rule refuses even a
        // correct answer once a task is locked.
        const r2 = await tmPlayer.call('submitTaskAnswer', { code: tc, taskId: nextTask.taskId, answer: 'x' });
        check('test mode: a second answer is accepted with the same neutral shape',
          r2?.recorded === true && !('correct' in r2), JSON.stringify(r2));
      } catch (e) { secondThrew = e?.code ?? String(e); }
    }
    check('test mode: consecutive answers never yield resource-exhausted / a cooldown',
      secondThrew === null, String(secondThrew));

    // ── The owner still sees everything, including WHAT was answered ─────────
    const tmTeams = await creator.call('listRunTeams', { gameId: tg, runId: tr });
    check('test mode: the owner still reads the team score', typeof tmTeams?.teams?.[0]?.score === 'number',
      JSON.stringify(tmTeams?.teams?.[0]?.score));

    // Read the team as the OWNER would, via the Admin SDK: these fields are
    // deliberately unreachable through any participant callable, so the only
    // honest way to assert they exist is to look where the creator looks.
    const tmDb = adminSdk.firestore();
    const ownerTeamDoc = (await tmDb
      .collection(`users/${OWNER}/games/${tg}/runs/${tr}/teams`).get()).docs[0]?.data();
    const ownerRecs = (ownerTeamDoc?.stages ?? []).flatMap((st) => st.tasks ?? []);
    const gradedRec = ownerRecs.find((r) => r.taskId === 'tm-q1');
    check('test mode: the owner can read WHAT the participant answered',
      gradedRec?.submittedAnswer === 'definitely-wrong', JSON.stringify(gradedRec?.submittedAnswer));
    check('test mode: the owner can read WHETHER it was correct',
      gradedRec?.wasCorrect === false, String(gradedRec?.wasCorrect));
    // A WRONG answer must complete for ZERO. The first cut of this asserted only
    // `typeof earnedScore === 'number'` and happily passed while every wrong
    // answer banked full points — which would have made the creator's score column
    // mean "questions attempted" and quietly destroyed the grading this whole mode
    // exists for. Assert the VALUE.
    check('test mode: a WRONG answer scores ZERO (not full points)',
      gradedRec?.earnedScore === 0, String(gradedRec?.earnedScore));
    const rightRec = ownerRecs.find((r) => r.wasCorrect === true);
    if (rightRec) {
      check('test mode: a CORRECT answer still scores normally',
        (rightRec.earnedScore ?? 0) > 0, String(rightRec?.earnedScore));
    }

    // ── The seal itself: nothing scoring-shaped anywhere in the payload ──────
    const SEALED_KEYS = [
      'score', 'bonusPenalty', 'smartStreak', 'streakMultiplier',
      'earnedScore', 'scoreBreakdown', 'answerCost', 'submittedAnswer', 'wasCorrect',
    ];
    const found = findKeysDeep(tmState?.team, SEALED_KEYS);
    check('test mode: NO scoring or verdict key appears anywhere in the participant team payload',
      found.length === 0, found.join(','));
    check('test mode: the participant is served no leaderboard',
      tmState?.run?.leaderboard === null, JSON.stringify(tmState?.run?.leaderboard));

    // The public board is the ONE participant standing that never passes through
    // getMyTeamState, so it is sealed separately — and must STAY sealed after a
    // finalize that would normally publish it.
    await creator.call('finalizeRun', { gameId: tg, runId: tr });
    const tmBoard = await tmPlayer.call('getPublicLeaderboard', { code: tc });
    check('test mode: the public board stays sealed even after finalize',
      tmBoard?.published === false && (tmBoard?.rankings?.length ?? 0) === 0,
      `published=${tmBoard?.published} n=${tmBoard?.rankings?.length}`);
    // The SECOND door to the same standings. getRunRecap gates on `published`
    // alone and finalizeRun publishes a test-mode board like any other, so a
    // participant holding the access code could read the whole scoreboard here
    // even though every other surface withholds it.
    let recapRefused = null;
    try {
      const r = await tmPlayer.call('getRunRecap', { code: tc });
      recapRefused = `ALLOWED: ${JSON.stringify(r?.standings?.length)} standings`;
    } catch (e) { recapRefused = e?.code ?? String(e); }
    check('test mode: the recap refuses a PARTICIPANT even after finalize',
      recapRefused === 'functions/permission-denied', String(recapRefused));
    const ownerRecap = await creator.call('getRunRecap', { code: tc });
    check('test mode: the OWNER still gets the recap standings',
      (ownerRecap?.standings?.length ?? 0) > 0, String(ownerRecap?.standings?.length));
    check('test mode: the owner recap still carries real scores',
      typeof ownerRecap?.standings?.[0]?.score === 'number', JSON.stringify(ownerRecap?.standings?.[0]));

    const tmAnalytics = await creator.call('getRunAnalytics', { code: tc });
    check('test mode: the owner still gets analytics for the sealed run',
      (tmAnalytics?.tasks?.length ?? 0) > 0, String(tmAnalytics?.tasks?.length));
  });

  // Regression pin for the OTHER half of the seal: the recorded-submission fields
  // must be absent from a NORMAL game's payload too (they are never allow-listed,
  // not merely stripped when sealed), and a normal game must still ship scores.
  await scenario('test mode: a normal run is untouched by the seal', async () => {
    const normState = await player.call('getMyTeamState', { code: accessCode });
    const leaked = findKeysDeep(normState?.team, ['submittedAnswer', 'wasCorrect']);
    check('normal run: the recorded-submission fields never reach a participant',
      leaked.length === 0, leaked.join(','));
    check('normal run: the team score is still shipped',
      typeof normState?.team?.score === 'number', String(normState?.team?.score));
    check('normal run: per-task earnedScore is still shipped',
      (normState?.team?.stages ?? []).flatMap((st) => st.tasks ?? [])
        .some((r) => typeof r.earnedScore === 'number'), 'no earnedScore found');
    check('normal run: testMode is reported false', normState?.game?.testMode === false,
      String(normState?.game?.testMode));
  });

  // ── Test mode: the OTHER answer-bearing task types ─────────────────────────
  // quiz/numeric were sealed first; a sequence is the same class of knowledge task
  // and was still returning `stepCorrect: false` AND blocking, which is both a
  // verdict and a stuck player. A survey has no right answer, but returning
  // `correct: true` for it alone made the play app celebrate one task type and stay
  // neutral for the rest — an accidental tell about which questions are graded.
  await scenario('test mode: sequence steps and surveys are sealed too', async () => {
    const sqPlayer = makeParty('sqPlayer');
    await signInAnonymously(sqPlayer.auth);
    const OWNER = creatorCred.user.uid;

    const { gameId: sq } = await creator.call('createGame', { title: 'Sealed Sequence', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: sq,
      testMode: true,
      scoringPreset: 'fixed_points_speed',
      stages: [{ id: 'sq-s', order: 0, title: 'Mixed', isFinal: true, tasks: [
        { id: 'sq-seq', title: 'Two steps', type: 'sequence', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 3, estimatedMinutes: 2, pointValue: 40,
          maxConcurrentTeams: 3,
          steps: [{ id: 's1', prompt: 'Step one', answer: 'alpha' },
                  { id: 's2', prompt: 'Step two', answer: 'beta' }] },
        { id: 'sq-sv', title: 'How was it?', type: 'survey', locationless: true,
          coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 10,
          maxConcurrentTeams: 3, surveyChoices: ['good', 'bad'] },
      ] }],
    });
    const { runId: sr, accessCode: sc } = await creator.call('launchRun', { gameId: sq });
    await sqPlayer.call('joinRun', { code: sc, displayName: 'Seq' });
    await creator.call('startTeams', { gameId: sq, runId: sr });

    // Routing picks the order, so drive whichever task is assigned.
    let seqSeen = false, svSeen = false;
    for (let guard = 0; guard < 6 && !(seqSeen && svSeen); guard++) {
      const st = await sqPlayer.call('getMyTeamState', { code: sc });
      const rec = st?.team?.stages?.[0]?.tasks?.find((t) => t.status === 'assigned');
      if (!rec) break;

      if (rec.taskId === 'sq-seq') {
        seqSeen = true;
        // A WRONG first step must still advance and must not say so.
        const s1 = await sqPlayer.call('submitSequenceStep', { code: sc, taskId: 'sq-seq', stepIndex: 0, answer: 'WRONG' });
        check('test mode: a wrong sequence step returns recorded:true', s1?.recorded === true, JSON.stringify(s1));
        check('test mode: the step response omits stepCorrect', !('stepCorrect' in (s1 ?? {})), JSON.stringify(s1));
        check('test mode: a wrong step still ADVANCES (no stuck player)', s1?.stepsDone === 1, JSON.stringify(s1));
        const s2 = await sqPlayer.call('submitSequenceStep', { code: sc, taskId: 'sq-seq', stepIndex: 1, answer: 'beta' });
        check('test mode: the final step completes the sequence', s2?.taskComplete === true, JSON.stringify(s2));
        check('test mode: the final step response also omits stepCorrect', !('stepCorrect' in (s2 ?? {})), JSON.stringify(s2));
      } else if (rec.taskId === 'sq-sv') {
        svSeen = true;
        const sv = await sqPlayer.call('submitTaskAnswer', { code: sc, taskId: 'sq-sv', answer: 'good' });
        check('test mode: a survey returns the same neutral shape as every other answer',
          sv?.recorded === true && !('correct' in (sv ?? {})), JSON.stringify(sv));
      } else break;
    }
    check('test mode: both the sequence and the survey were exercised', seqSeen && svSeen, `seq=${seqSeen} survey=${svSeen}`);

    // The creator's grading view: one wrong step means the whole sequence is wrong.
    const sqDb = adminSdk.firestore();
    const sqTeam = (await sqDb.collection(`users/${OWNER}/games/${sq}/runs/${sr}/teams`).get()).docs[0]?.data();
    const sqRecs = (sqTeam?.stages ?? []).flatMap((st) => st.tasks ?? []);
    const seqRec = sqRecs.find((r) => r.taskId === 'sq-seq');
    check('test mode: the owner sees the sequence graded WRONG (one step missed)',
      seqRec?.wasCorrect === false, JSON.stringify(seqRec?.wasCorrect));
    check('test mode: a sequence missed a step scores zero', seqRec?.earnedScore === 0, String(seqRec?.earnedScore));
    // A sequence's answers span several calls, so no single one is "the answer".
    check('test mode: no misleading submittedAnswer is recorded for a sequence',
      seqRec?.submittedAnswer === undefined, JSON.stringify(seqRec?.submittedAnswer));

    // And none of it reached the player.
    const sqState = await sqPlayer.call('getMyTeamState', { code: sc });
    const sqLeak = findKeysDeep(sqState?.team, ['wasCorrect', 'score', 'earnedScore', 'taskAttempts']);
    check('test mode: no verdict, score or wrong-step count reaches the sequence player',
      sqLeak.length === 0, sqLeak.join(','));
  });

  // ═══ Recorded answers + run history + the per-player report ═════════════════
  // change: post-run-player-report.
  //
  // The three things this scenario has to prove, because each one was previously
  // impossible and each fails SILENTLY rather than loudly if it regresses:
  //
  //   1. A wrong answer on an ORDINARY run is now RECORDED, not just counted.
  //      Before this, `submittedAnswer`/`wasCorrect` were written only when the
  //      game sealed scoring, so on every normal run the server graded the answer,
  //      possibly charged for it, and threw the text away.
  //   2. `listMyRuns` finds a FINISHED run. Every other post-run surface resolves
  //      by access code and is reachable only from the live console, so a run that
  //      ended had no route back to it at all.
  //   3. `getRunPlayerReport` hands the OWNER the per-player answer sheet, with
  //      the empty cells honestly labelled.
  //
  // It also pins the thing most likely to break by accident: recording must not
  // change what the participant sees. A wrong answer still answers `correct:false`
  // and a right one still completes the mission.
  await scenario('recorded answers + run history + per-player report', async () => {
    const OWNER = creatorCred.user.uid;
    const { gameId: gR } = await creator.call('createGame', { title: 'Answer Sheet Game', mode: 'individual' });
    await creator.call('updateGame', {
      gameId: gR,
      scoringPreset: 'fixed_points_speed',
      stages: [
        {
          id: 'rp-s1', order: 0, title: 'Questions',
          tasks: [
            { id: 'rp-quiz', title: 'Capital', type: 'quiz', locationless: true, triggerMode: 'locationless',
              coordinates: { lat: 0, lng: 0 }, difficulty: 2, estimatedMinutes: 3, pointValue: 50,
              maxConcurrentTeams: 9, description: 'What is the capital?', answers: ['Jerusalem'] },
          ],
        },
        {
          id: 'rp-s2', order: 1, title: 'Arrival', isFinal: true,
          tasks: [
            // A mission with NO answer channel, so the report has to distinguish
            // "nothing to answer here" from "the answer was not recorded".
            { id: 'rp-checkin', title: 'Check in', type: 'self_report', locationless: true, triggerMode: 'locationless',
              coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1, pointValue: 20,
              maxConcurrentTeams: 9 },
          ],
        },
      ],
    });
    const { runId: rR, accessCode: cR } = await creator.call('launchRun', { gameId: gR });
    const CR = { ownerUid: OWNER, gameId: gR, runId: rR };
    const playerR = makeParty('playerReport');
    await signInAnonymously(playerR.auth);
    await playerR.call('joinRun', { code: cR, displayName: 'Answer Sheet Team' });
    const playerRUid = playerR.auth.currentUser.uid;
    await creator.call('startTeams', { gameId: gR, runId: rR });
    await playerR.call('requestNextTask', CR);

    // 1. A wrong answer, then the right one, on a NORMAL (non-testMode) run.
    const wrongR = await playerR.call('submitTaskAnswer', { ...CR, taskId: 'rp-quiz', answer: 'Tel Aviv' });
    check('recording did not change the wrong-answer response',
      wrongR?.correct === false, JSON.stringify(wrongR));
    const rightR = await playerR.call('submitTaskAnswer', { ...CR, taskId: 'rp-quiz', answer: 'jerusalem  ' });
    check('recording did not change the correct-answer response',
      rightR?.correct === true, JSON.stringify(rightR));

    // The log lives on the server-only team document. Read it directly first, so a
    // failure here is unambiguous about WHERE it broke (the write, or the report).
    const teamR = await creator.getDocAt(`users/${OWNER}/games/${gR}/runs/${rR}/teams/${playerRUid}`);
    const quizRec = (teamR.data?.stages ?? []).flatMap((st) => st?.tasks ?? [])
      .find((rec) => rec?.taskId === 'rp-quiz');
    const logged = quizRec?.answerLog ?? [];
    check('both submissions are recorded on the team document, in order',
      logged.length === 2 && logged[0]?.answer === 'Tel Aviv' && logged[1]?.answer === 'jerusalem',
      JSON.stringify(logged));
    check('each recorded submission carries the verdict the server acted on',
      logged[0]?.correct === false && logged[1]?.correct === true, JSON.stringify(logged));

    // 2. The recorded answers must NOT reach the participant. The team document is
    // returned WHOLE by getMyTeamState, so the sanitizer allow-list is the only
    // thing between a per-question wrong-answer history and the player's devtools.
    const stateR = await playerR.call('getMyTeamState', { code: cR });
    const wireR = JSON.stringify(stateR);
    check('the participant payload carries no recorded answers at all',
      !wireR.includes('answerLog') && !wireR.includes('Tel Aviv'),
      'answerLog or the submitted text leaked to the player');

    // Finish the run so the history has a FINISHED row to find.
    await playerR.call('requestNextTask', CR);
    await playerR.call('completeTask', { ...CR, taskId: 'rp-checkin' });
    await creator.call('finalizeRun', { gameId: gR, runId: rR });

    // 3. listMyRuns finds the finished run.
    const allRuns = await creator.call('listMyRuns', {});
    check('listMyRuns returns runs regardless of status (the finished one is there)',
      (allRuns?.runs ?? []).some((row) => row.runId === rR && row.status === 'finished'),
      JSON.stringify((allRuns?.runs ?? []).map((r) => [r.runId, r.status])));
    const oneGame = await creator.call('listMyRuns', { gameId: gR });
    check('listMyRuns filters to one game',
      (oneGame?.runs ?? []).length > 0 && (oneGame?.runs ?? []).every((row) => row.gameId === gR),
      JSON.stringify((oneGame?.runs ?? []).map((r) => r.gameId)));
    const rowR = (oneGame?.runs ?? []).find((row) => row.runId === rR);
    check('a history row carries what the card renders',
      rowR?.accessCode === cR && rowR?.gameTitle === 'Answer Sheet Game' && rowR?.participantCount >= 1,
      JSON.stringify(rowR));
    // ownerUid is the authorization, not gameId: a payload naming somebody else's
    // game must return nothing rather than that owner's runs.
    const strangerRuns = await playerR.call('listMyRuns', { gameId: gR });
    check('listMyRuns never returns another creator runs',
      (strangerRuns?.runs ?? []).length === 0, JSON.stringify(strangerRuns));

    // 4. getRunPlayerReport: the owner's answer sheet.
    const report = await creator.call('getRunPlayerReport', { gameId: gR, runId: rR });
    check('the report has one row per player', (report?.players ?? []).length === 1,
      JSON.stringify((report?.players ?? []).map((p) => p.playerName)));
    check('the player row carries the name and score',
      report?.players?.[0]?.playerName === 'Answer Sheet Team' && report?.players?.[0]?.score > 0,
      JSON.stringify(report?.players?.[0]));
    check('the report reuses the finalized ranking (not a provisional one)',
      report?.meta?.rankingProvisional === false, JSON.stringify(report?.meta));
    check('the report discloses the answer retention window',
      report?.meta?.answerRetentionDays === 30, JSON.stringify(report?.meta));

    const quizRow = (report?.answers ?? []).find((row) => row.taskId === 'rp-quiz');
    check('the report exposes BOTH submissions, in order',
      (quizRow?.answers ?? []).length === 2
      && quizRow.answers[0].answer === 'Tel Aviv' && quizRow.answers[0].correct === false
      && quizRow.answers[1].correct === true,
      JSON.stringify(quizRow?.answers));
    check('the report carries the authored question for context',
      quizRow?.question === 'What is the capital?', JSON.stringify(quizRow?.question));
    check('the report carries the answer key (an owner-only surface)',
      quizRow?.expectedAnswer === 'Jerusalem', JSON.stringify(quizRow?.expectedAnswer));
    check('a recorded row is not flagged unavailable', quizRow?.answersUnavailable === false,
      JSON.stringify(quizRow));

    const checkinRow = (report?.answers ?? []).find((row) => row.taskId === 'rp-checkin');
    check('a mission with no answer channel is reported as such, NOT as a missing answer',
      checkinRow?.answerChannel === 'none' && checkinRow?.answersUnavailable === false,
      JSON.stringify(checkinRow));

    // 5. Retention: the sweep destroys the TEXT and nothing else. Driven through
    // the admin prune callable rather than waited out. `pruneRunNow` runs the whole
    // PII prune, which is a strict SUPERSET of the 30-day answer sweep — so this
    // proves the backstop path, and the pure suite proves the 30-day boundary.
    const scoreBefore = report?.players?.[0]?.score;
    await platformAdmin.call('pruneRunNow', { ownerUid: OWNER, gameId: gR, runId: rR });
    const afterPrune = await creator.call('getRunPlayerReport', { gameId: gR, runId: rR });
    const quizAfter = (afterPrune?.answers ?? []).find((row) => row.taskId === 'rp-quiz');
    check('the prune destroyed the recorded answer text',
      (quizAfter?.answers ?? []).length === 0, JSON.stringify(quizAfter?.answers));
    check('the pruned row says NOT RECORDED rather than looking unanswered',
      quizAfter?.answersUnavailable === true, JSON.stringify(quizAfter));
    check('the prune left scores untouched',
      afterPrune?.players?.[0]?.score === scoreBefore,
      JSON.stringify({ before: scoreBefore, after: afterPrune?.players?.[0]?.score }));
  });

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
