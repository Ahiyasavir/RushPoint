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
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import process from 'node:process';

const ROOT       = process.cwd();
const DATA_DIR   = join(ROOT, '.firebase', 'emulator-data');
const PROJECT_ID = 'rushpoint-pwa-7daaa';
const isWin      = process.platform === 'win32';
const MIN_JAVA   = 21;

// `java -version` prints to stderr in formats like:
//   openjdk version "21.0.11" 2024-...     -> 21
//   java version "1.8.0_392"               -> 8
function parseMajor(text) {
  const m = (text || '').match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  let major = parseInt(m[1], 10);
  if (major === 1 && m[2]) major = parseInt(m[2], 10);
  return Number.isFinite(major) ? major : null;
}

function javaMajorOf(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return parseMajor(`${r.stderr || ''}${r.stdout || ''}`);
}

function javaMajorOnPath(env) {
  const r = spawnSync('java', ['-version'], { env, shell: true, encoding: 'utf8' });
  return parseMajor(`${r.stderr || ''}${r.stdout || ''}`);
}

// Find a JDK >= MIN_JAVA: prefer a modern-enough JAVA_HOME, else scan common roots.
function findModernJdk() {
  const javaBin = isWin ? 'java.exe' : 'java';

  if (process.env.JAVA_HOME) {
    const bin = join(process.env.JAVA_HOME, 'bin', javaBin);
    if (existsSync(bin)) {
      const major = javaMajorOf(bin);
      if (major && major >= MIN_JAVA) return process.env.JAVA_HOME;
    }
  }
  if (!isWin) return null;

  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\BellSoft',
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const m = dir.match(/(?:jdk|jre|zulu)-?(\d+)/i);
      if (!m || parseInt(m[1], 10) < MIN_JAVA) continue;
      const bin = join(root, dir, 'bin', 'java.exe');
      if (existsSync(bin) && (javaMajorOf(bin) ?? 0) >= MIN_JAVA) {
        return join(root, dir);
      }
    }
  }
  return null;
}

// â”€â”€ Resolve Java >= 21 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const env = { ...process.env };
let major = javaMajorOnPath(env);

if (!major || major < MIN_JAVA) {
  const home = findModernJdk();
  if (home) {
    env.JAVA_HOME = home;
    env.PATH = `${join(home, 'bin')}${delimiter}${env.PATH}`;
    major = javaMajorOnPath(env);
    console.log(`[dev-emulator] PATH Java was too old (or missing); switched to JDK ${major} at ${home}`);
  }
}

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
const hasSnapshot = existsSync(join(DATA_DIR, 'firebase-export-metadata.json'));

let cmd = `firebase emulators:start --project ${PROJECT_ID} --export-on-exit "${DATA_DIR}"`;
if (hasSnapshot) {
  cmd += ` --import "${DATA_DIR}"`;
  console.log(`[dev-emulator] Importing saved data from ${DATA_DIR}`);
} else {
  console.log('[dev-emulator] No saved snapshot yet - starting fresh (will export on exit).');
}

// â”€â”€ Spawn + forward signals so --export-on-exit fires on Ctrl+C â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const child = spawn(cmd, { env, shell: true, stdio: 'inherit' });
const forward = (sig) => { if (!child.killed) child.kill(sig); };
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
