// Hardened `firebase emulators:exec` wrapper (change: emulator-gate hardening).
//
//   node scripts/emulator-exec.mjs "<script to run against the emulator>"
//   node scripts/emulator-exec.mjs --only=firestore,auth "<script>"
//
// Why this exists — the raw `npx --yes firebase-tools emulators:exec` chain kept
// dying mid-gate on this machine (Firestore gRPC ECONNRESET + a rules-runtime
// java.lang.NullPointerException), and each factor below was implicated:
//   1. PINNED CLI: `firebase-tools@latest` re-resolved every run → version drift
//      and a re-download. We pin a known-good version in one place here.
//   2. JVM HEADROOM: the emulator JVM ran on default heap; under a sustained
//      multi-scenario load GC pressure eventually drops the rules-runtime stdin
//      pipe and resets gRPC streams. JAVA_TOOL_OPTIONS gives every emulator JVM
//      a higher cap (a cap, not a reservation — idle cost is unchanged).
//   3. JAVA >= 21: same auto-switch dev-emulator.mjs does, so an old PATH Java
//      can't degrade the emulator (shared ./lib/resolve-java.mjs).
// Fresh-JVM-per-phase (verify:emulator invoking this wrapper once per heavy
// phase instead of one long exec) is wired in package.json.
//
// ORPHAN REAPING (change: emulator-exec-orphan-reap). A FINISHED exec run could
// still leave its firebase-tools parent, emulator JVMs and functionsEmulatorRuntime
// workers alive holding 8080/9099/5001/4000 — wedging the NEXT gate (observed: a
// rules run blocked for ~an hour). Cleanup used to happen only on the next
// `dev:all`/`playtest` (free-ports.mjs), which the next *gate* never calls. So this
// wrapper now records its session while it runs and reaps that session's leftovers
// when the wrapped command exits — success, failure or signal. The reap is
// best-effort and NEVER changes the exit code. Which processes are eligible is
// decided by the pure, fail-closed planEmulatorExecReap (scripts/lib/emulatorReap.mjs):
// only processes positively attributed to a FINISHED exec session of THIS repo — a
// live dev/playtest stack, another checkout's emulator, or anything unidentifiable is
// never selected.
//   RUSHPOINT_REAP_DISABLE=1  skip it · RUSHPOINT_REAP_DEBUG=1  verdicts only, no kills
//   RUSHPOINT_REAP_MIN_AGE_MS age floor (default 5000 ms)
//
// OFFSET PORT BLOCK (change: emulator-port-offset). A live `playtest:forever` stack
// owns the default emulator block, so this gate used to be unrunnable during a
// playtest — and killing a playtest that may be serving a live event is not an
// option. Set RUSHPOINT_EMULATOR_PORT_OFFSET=<n> and the whole suite moves to a
// second, provably non-overlapping block:
//
//   RUSHPOINT_EMULATOR_PORT_OFFSET=1000 npm run verify:emulator
//
// The Firebase CLI has NO per-emulator port flag (verified against the pinned
// firebase-tools: emulators:exec registers only --only/--inspect-functions/--import/
// --export-on-exit/--log-verbosity/--ui), so ports can only come from a config file.
// We therefore GENERATE `firebase.emulator-offset.json` from firebase.json and pass
// `--config`. It must live in the REPO ROOT: firebase-tools derives the project root
// from dirname(configPath) (lib/detectProjectRoot.js), so a config under .firebase/
// would break every relative path inside it (functions source, rules, indexes). Same
// pattern as the generated firebase.tunnel.json; both are gitignored.
//
// At offset 0 nothing is generated and no --config flag is passed: the spawned command
// line is character-identical to what it was before this feature existed, so CI and
// anyone not opting in are structurally unaffected.
//
// HUB ISOLATION (change: emulator-gate-isolation). Moving the ports was not enough. The
// CLI's Emulator Hub LOCATOR is keyed by PROJECT ID ALONE and lives in os.tmpdir()
// (firebase-tools@15.18.0 lib/emulator/hub.js:24-32), and it is the only routing mechanism
// `firebase emulators:export` has (lib/emulator/controller.js:730-745 → hubClient.js:10 —
// there is no --host and no --port flag). So the live playtest's 120-second backup loop
// (scripts/emulator-backup.mjs:246) could aim its export at THIS gate's Firestore and wedge
// it: an offset gate really did die mid-suite with a completely clean firestore-debug.log.
// An offset run therefore ALSO gets a private temp directory (TEMP/TMP/TMPDIR →
// .firebase/emulator-offset-tmp/offset-<n>), which gives it a private locator neither suite
// can read or overwrite. Decision in the pure scripts/lib/emulatorIsolation.mjs.
//   RUSHPOINT_EMULATOR_ISOLATE_DISABLE=1  turn it off in one variable
// At offset 0 the plan is empty and NOTHING is overridden, so the child environment stays
// byte-identical to what it was before this change existed.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { ensureModernJava, MIN_JAVA } from './lib/resolve-java.mjs';
import {
  resolveEmulatorPortOffset,
  resolveEmulatorPorts,
  buildOffsetFirebaseConfig,
  describeEmulatorPorts,
  PORT_OFFSET_ENV,
} from './lib/emulatorPorts.mjs';
import {
  planEmulatorIsolation,
  describeEmulatorIsolation,
} from './lib/emulatorIsolation.mjs';
import {
  recordExecSessionStart,
  recordExecSessionEnd,
  reapOrphanEmulatorProcesses,
} from './lib/reapEmulatorExec.mjs';

// Bump deliberately after testing a newer CLI — never float on @latest.
const FIREBASE_TOOLS_VERSION = '15.18.0';
const PROJECT_ID = 'rushpoint-pwa-7daaa';
const DEFAULT_ONLY = 'firestore,auth,functions,storage';
const HEAP_OPTS = '-Xmx4g';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : DEFAULT_ONLY;
const script = args.find((a) => !a.startsWith('--'));

if (!script) {
  console.error('usage: node scripts/emulator-exec.mjs [--only=a,b,c] "<script>"');
  process.exit(1);
}

const env = { ...process.env };
const major = ensureModernJava(env, (msg) => console.log(`[emulator-exec] ${msg}`));
if (!major || major < MIN_JAVA) {
  console.error(`[emulator-exec] ERROR: Firebase Emulator needs Java ${MIN_JAVA}+. Detected: ${major ? 'Java ' + major : 'none'}.`);
  process.exit(1);
}
// Applies to every JVM the CLI launches (Firestore emulator + rules runtimes).
env.JAVA_TOOL_OPTIONS = env.JAVA_TOOL_OPTIONS ? `${env.JAVA_TOOL_OPTIONS} ${HEAP_OPTS}` : HEAP_OPTS;
console.log(`[emulator-exec] Java ${major} · firebase-tools@${FIREBASE_TOOLS_VERSION} · JAVA_TOOL_OPTIONS="${env.JAVA_TOOL_OPTIONS}" · only=${only}`);

// ── Port block (default = today's ports, and then literally no extra flag) ────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFSET_CONFIG = path.join(ROOT, 'firebase.emulator-offset.json');
const offsetInfo = resolveEmulatorPortOffset(env);
let configFlag = '';

if (offsetInfo.notice === 'invalid' || offsetInfo.notice === 'negative') {
  console.warn(
    `[emulator-exec] IGNORING ${PORT_OFFSET_ENV}="${env[PORT_OFFSET_ENV]}" (${offsetInfo.notice}); using the default port block.`,
  );
}
if (offsetInfo.offset > 0) {
  if (offsetInfo.notice === 'snapped' || offsetInfo.notice === 'clamped') {
    console.warn(
      `[emulator-exec] ${PORT_OFFSET_ENV}=${offsetInfo.requested} ${offsetInfo.notice} to ${offsetInfo.offset} ` +
        '(offsets are multiples of 1000 so no shifted port can land on a live emulator port).',
    );
  }
  const ports = resolveEmulatorPorts(env);
  const baseConfig = JSON.parse(readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  writeFileSync(OFFSET_CONFIG, `${JSON.stringify(buildOffsetFirebaseConfig(baseConfig, ports), null, 2)}\n`, 'utf8');
  // Relative on purpose: resolved against cwd (= repo root) by the CLI, and shorter in logs.
  configFlag = ' --config firebase.emulator-offset.json';
  // Children of emulators:exec inherit this, so every gate script resolves the SAME block.
  env[PORT_OFFSET_ENV] = String(offsetInfo.offset);
  console.log(`[emulator-exec] ports :: ${describeEmulatorPorts(ports, offsetInfo)}`);

  // Private hub locator — see the HUB ISOLATION note at the top of this file. Inside the
  // `offset > 0` branch on purpose: the default path must not so much as touch `env`.
  const isolation = planEmulatorIsolation({ offset: offsetInfo.offset, repoRoot: ROOT, env });
  if (isolation.isolated) {
    // GetTempPath / os.tmpdir() do not create the directory; a missing TEMP would make the
    // CLI (and every emulator JVM) fail on its first temp write.
    mkdirSync(isolation.tmpDir, { recursive: true });
    Object.assign(env, isolation.envOverrides);
  }
  console.log(`[emulator-exec] ${describeEmulatorIsolation(isolation)}`);
}

const cmd = `npx --yes firebase-tools@${FIREBASE_TOOLS_VERSION} emulators:exec --only ${only} --project ${PROJECT_ID}${configFlag} "${script}"`;
const child = spawn(cmd, { env, shell: true, stdio: 'inherit' });

// The session root is this child's pid: every emulator JVM / functions worker descends
// from it, and on Windows an orphan keeps naming it as its (now absent) parent — which is
// exactly how a leftover is attributed to a finished run.
recordExecSessionStart(child.pid, cmd);

process.on('SIGINT', () => { if (!child.killed) child.kill('SIGINT'); });
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM'); });
child.on('exit', (code) => {
  // Order matters: mark the session finished FIRST, so the reaper can tell this run's
  // leftovers from a still-running session's live processes.
  recordExecSessionEnd(child.pid);
  const killed = reapOrphanEmulatorProcesses({ label: 'emulator-exec' });
  if (killed > 0) console.warn(`[emulator-exec] Reaped ${killed} orphaned emulator process(es) left by this run.`);
  process.exit(code ?? 1);
});
