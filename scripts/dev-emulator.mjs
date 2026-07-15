// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Robust Firebase Emulator launcher (Windows-friendly, monorepo-aware).
//
//   1. Resolves a Java >= 21 even when an OLDER Java is first on PATH â€” it checks
//      the actual version and auto-switches to a JDK 21+ found under Program Files.
//   2. Builds Cloud Functions so the emulator loads the latest code.
//   3. Persists data: imports the saved snapshot on start (if present) and
//      exports on exit, so accessCodes / Auth users survive restarts.
//
// Run via:  npm run emulator        (also used inside  npm run dev:all)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { ensureModernJava, MIN_JAVA } from './lib/resolve-java.mjs';

const ROOT       = process.cwd();
const DATA_DIR   = join(ROOT, '.firebase', 'emulator-data');
const PROJECT_ID = 'rushpoint-pwa-7daaa';

// Java-version parsing + JDK discovery live in ./lib/resolve-java.mjs (shared
// with emulator-exec.mjs — change: emulator-gate hardening).

// â”€â”€ Resolve Java >= 21 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const env = { ...process.env };
const major = ensureModernJava(env, (msg) => console.log(`[dev-emulator] ${msg}`));

// â”€â”€ Functions discovery timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The emulator loads functions by running the built bundle once to read its backend
// spec, with a 10s default limit. On a cold/slow start (a fresh boot, or a stack
// restart after a git auto-update) our large index can blow past 10s â†’ "Failed to
// load function definition ... Timeout after 10000" â†’ every callable resolves as
// `not-found` until the next reload. Give discovery generous headroom so functions
// register reliably on the always-on runner. (firebase-tools reads this in seconds.)
if (!env.FUNCTIONS_DISCOVERY_TIMEOUT) env.FUNCTIONS_DISCOVERY_TIMEOUT = '60';

if (!major || major < MIN_JAVA) {
  console.error(`[dev-emulator] ERROR: Firebase Emulator needs Java ${MIN_JAVA}+. Detected: ${major ? 'Java ' + major : 'none'}.`);
  console.error('  Install Eclipse Temurin 21: https://adoptium.net/temurin/releases/?version=21');
  console.error('  Or set JAVA_HOME to a JDK 21 folder and retry.');
  process.exit(1);
}
console.log(`[dev-emulator] Using Java ${major}.`);

// â”€â”€ Build Cloud Functions (non-fatal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('[dev-emulator] Building Cloud Functions...');
const build = spawnSync('npm', ['run', 'build', '--workspace=functions'], { env, shell: true, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('[dev-emulator] ERROR: Functions build failed. Aborting so the emulator never starts with stale/missing functions.'); process.exit(1);
}

// â”€â”€ Persistence (first-run safe) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
mkdirSync(DATA_DIR, { recursive: true });

// Pick an import source: the primary snapshot if present, otherwise the newest
// crash-safe backup under .firebase/backups. This is what makes a non-graceful
// restart safe — when the always-on supervisor kills the emulator to relaunch it
// (so --export-on-exit never fired), we recover the last backup instead of coming
// up empty. Worst case we lose one backup interval (~2 min), not everything.
let importDir = null;
if (existsSync(join(DATA_DIR, 'firebase-export-metadata.json'))) {
  importDir = DATA_DIR;
  console.log(`[dev-emulator] Importing saved data from ${DATA_DIR}`);
} else {
  const latest = spawnSync('node', ['scripts/emulator-backup.mjs', '--latest'], { cwd: ROOT, env, encoding: 'utf8', shell: true });
  const cand = (latest.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
  if (latest.status === 0 && cand && existsSync(join(cand, 'firebase-export-metadata.json'))) {
    importDir = cand;
    console.log(`[dev-emulator] No primary snapshot — restoring newest backup: ${cand}`);
  } else {
    console.log('[dev-emulator] No saved snapshot or backup yet - starting fresh (will export on exit).');
  }
}

let cmd = `firebase emulators:start --project ${PROJECT_ID} --export-on-exit "${DATA_DIR}"`;
if (importDir) cmd += ` --import "${importDir}"`;

// â”€â”€ Spawn + forward signals so --export-on-exit fires on Ctrl+C â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const child = spawn(cmd, { env, shell: true, stdio: 'inherit' });

// â”€â”€ Optional crash-safe backup loop (emulator-data-backup) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Gated behind RUSHPOINT_BACKUP so normal dev:all is unaffected. It snapshots
// into .firebase/backups/ (never DATA_DIR) on its own interval and is torn down
// with the emulator. `npm run playtest` enables it via its own BACKUP process.
let backup = null;
if (process.env.RUSHPOINT_BACKUP === '1' || process.env.RUSHPOINT_BACKUP === 'true') {
  backup = spawn('node', [join(ROOT, 'scripts', 'emulator-backup.mjs')], { env, shell: true, stdio: 'inherit' });
  console.log('[dev-emulator] RUSHPOINT_BACKUP enabled â†’ crash-safe snapshot loop started');
}

const forward = (sig) => {
  if (backup && !backup.killed) backup.kill(sig);
  if (!child.killed) child.kill(sig);
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code) => { if (backup && !backup.killed) backup.kill('SIGTERM'); process.exit(code ?? 0); });
