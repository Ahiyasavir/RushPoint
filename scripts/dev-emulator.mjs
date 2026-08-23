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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { ensureModernJava, MIN_JAVA } from './lib/resolve-java.mjs';
import { snapshotTimeMs, selectImportSource, shouldStartBackupLoop } from './lib/emulatorBackup.mjs';

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

// Pick an import source: the FRESHEST of the primary snapshot and the newest
// crash-safe backup under .firebase/backups. This is what makes a non-graceful
// restart safe — when the always-on supervisor kills the emulator to relaunch it
// (so --export-on-exit never fired), we recover the last snapshot instead of coming
// up empty. The supervisor now writes the primary dir on every PLANNED teardown
// (git-update restart / clean stop), so on those paths there's zero loss. But after
// an UNPLANNED crash the primary dir holds only the last planned export, which can be
// OLDER than the newest periodic backup — so we compare timestamps and import
// whichever is newer rather than blindly preferring the primary dir.
// Freshness alone is NOT enough to pick a dataset, and it never was. The old
// comparison put the primary export's file mtime against the backup's folder-name
// timestamp (two different events) and checked nothing about content — so anything
// that touched the primary dir's mtime could hand victory to a far smaller dataset,
// which then silently became the baseline every later snapshot was taken from. That
// is how games AND their creator uids disappear together. selectImportSource compares
// like for like, disqualifies empty/invalid candidates, and refuses a drastic shrink.
function dirBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = join(dir, e.name);
    try { total += e.isDirectory() ? dirBytes(full) : statSync(full).size; } catch { /* ignore */ }
  }
  return total;
}
function candidateOf(dir) {
  if (!dir || !existsSync(dir)) return { present: false, valid: false, bytes: 0 };
  const meta = join(dir, 'firebase-export-metadata.json');
  const valid = existsSync(meta);
  return {
    present: true,
    valid,
    metaMtimeMs: valid ? statSync(meta).mtimeMs : NaN,
    nameMs: snapshotTimeMs(basename(dir)),
    bytes: dirBytes(dir),
  };
}

let importDir = null;
const latest = spawnSync('node', ['scripts/emulator-backup.mjs', '--latest'], { cwd: ROOT, env, encoding: 'utf8', shell: true });
const backupCand = (latest.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
const primary = candidateOf(DATA_DIR);
const backupInfo = latest.status === 0 && backupCand ? candidateOf(backupCand) : { present: false, valid: false, bytes: 0 };

const decision = selectImportSource({
  primary,
  backup: backupInfo,
  allowShrink: process.env.RUSHPOINT_ALLOW_SHRINK === '1' || process.env.RUSHPOINT_ALLOW_SHRINK === 'true',
});
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
if (decision.shrink) {
  const lines = [
    'DATASET SIZE MISMATCH BETWEEN IMPORT CANDIDATES',
    `freshest candidate: ${mb(decision.shrink.freshestBytes)}`,
    `alternative:        ${mb(decision.shrink.alternativeBytes)}`,
    decision.reason === 'shrink-guard'
      ? 'Refusing to replace the larger dataset with the much smaller one.'
      : 'RUSHPOINT_ALLOW_SHRINK is set - importing the smaller dataset anyway.',
    decision.reason === 'shrink-guard'
      ? 'If the shrink is real, re-run with RUSHPOINT_ALLOW_SHRINK=1.'
      : 'The larger dataset is still on disk if this was a mistake.',
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '!'.repeat(width);
  process.stderr.write(`\n\x1b[1;31m${bar}\n${lines.map((l) => `! ${l.padEnd(width - 4)} !`).join('\n')}\n${bar}\x1b[0m\n`);
}
if (decision.usedFallbackTime) {
  console.log('[dev-emulator] NOTE: an import candidate had no export metadata mtime; used its folder-name timestamp.');
}
if (decision.source === 'primary') {
  importDir = DATA_DIR;
  console.log(`[dev-emulator] Importing saved data from ${DATA_DIR} (${decision.reason}, ${mb(primary.bytes)}).`);
} else if (decision.source === 'backup') {
  importDir = backupCand;
  console.log(`[dev-emulator] Restoring backup ${backupCand} (${decision.reason}, ${mb(backupInfo.bytes)}).`);
} else {
  console.log('[dev-emulator] No saved snapshot or backup yet - starting fresh (will export on exit).');
}

let cmd = `firebase emulators:start --project ${PROJECT_ID} --export-on-exit "${DATA_DIR}"`;
if (importDir) cmd += ` --import "${importDir}"`;

// â”€â”€ Spawn + forward signals so --export-on-exit fires on Ctrl+C â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const child = spawn(cmd, { env, shell: true, stdio: 'inherit' });

// â”€â”€ Optional crash-safe backup loop (emulator-data-backup) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ON BY DEFAULT. This used to be opt-in behind RUSHPOINT_BACKUP=1, which
// `npm run dev:all` never set -- so every ordinary dev session ran with ZERO snapshot
// protection, and that is how a real creator's game became unrecoverable.
// RUSHPOINT_BACKUP is now an opt-OUT (0/false). Cost: one `firebase emulators:export`
// child every 2 minutes (~1s, ~900 KB), disk bounded by EMU_BACKUP_MAX_BYTES.
//
// Interlock: `npm run playtest` runs its own BACKUP process, so starting one here
// unconditionally would give two loops exporting against one emulator -- the wedge
// free-ports.mjs was written to clean up. Skip ONLY when a heartbeat is recent AND its
// pid is alive; everything else fails open, because an extra loop is noisy and
// recoverable while no loop is silent.
const STATUS_FILE = join(ROOT, '.firebase', 'backups', 'STATUS.json');
const readBackupStatus = () => {
  try { return JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch { return null; }
};
const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};
const backupStatus = readBackupStatus();
const optOut = process.env.RUSHPOINT_BACKUP === '0' || process.env.RUSHPOINT_BACKUP === 'false';
const startLoop = shouldStartBackupLoop({
  optOut,
  status: backupStatus,
  nowMs: Date.now(),
  pidAlive: backupStatus ? isAlive(backupStatus.pid) : false,
  intervalMs: Number(process.env.EMU_BACKUP_INTERVAL_MS || 120_000),
});
let backup = null;
if (!startLoop && optOut) {
  console.log('[dev-emulator] RUSHPOINT_BACKUP=0 -> snapshot loop DISABLED. This emulator is UNPROTECTED.');
} else if (!startLoop) {
  console.log(`[dev-emulator] a snapshot loop is already running (pid ${backupStatus && backupStatus.pid}) -> not starting a second one`);
} else {
  backup = spawn('node', [join(ROOT, 'scripts', 'emulator-backup.mjs')], { env, shell: true, stdio: 'inherit' });
  console.log('[dev-emulator] crash-safe snapshot loop started (set RUSHPOINT_BACKUP=0 to disable)');
}

const forward = (sig) => {
  if (backup && !backup.killed) backup.kill(sig);
  if (!child.killed) child.kill(sig);
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code) => { if (backup && !backup.killed) backup.kill('SIGTERM'); process.exit(code ?? 0); });
