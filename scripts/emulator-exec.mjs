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
import { spawn } from 'node:child_process';
import process from 'node:process';
import { ensureModernJava, MIN_JAVA } from './lib/resolve-java.mjs';

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

process.on('SIGINT', () => { if (!child.killed) child.kill('SIGINT'); });
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM'); });
child.on('exit', (code) => process.exit(code ?? 1));
