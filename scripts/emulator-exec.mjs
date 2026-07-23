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
import { spawn } from 'node:child_process';
import process from 'node:process';
import { ensureModernJava, MIN_JAVA } from './lib/resolve-java.mjs';
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

const cmd = `npx --yes firebase-tools@${FIREBASE_TOOLS_VERSION} emulators:exec --only ${only} --project ${PROJECT_ID} "${script}"`;
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
