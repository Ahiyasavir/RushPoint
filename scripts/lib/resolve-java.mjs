// Java >= 21 resolver (extracted from dev-emulator.mjs so emulator-exec.mjs can
// reuse it — change: emulator-gate hardening). The Firebase emulator needs a
// modern JVM; an OLD Java first on PATH silently breaks it, so we check the
// real version and auto-switch to a JDK 21+ found under Program Files.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import process from 'node:process';

export const MIN_JAVA = 21;
const isWin = process.platform === 'win32';

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

export function javaMajorOnPath(env) {
  const r = spawnSync('java', ['-version'], { env, shell: true, encoding: 'utf8' });
  return parseMajor(`${r.stderr || ''}${r.stdout || ''}`);
}

// Find a JDK >= MIN_JAVA: prefer a modern-enough JAVA_HOME, else scan common roots.
export function findModernJdk() {
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

// Mutates `env` (PATH/JAVA_HOME) if a switch is needed; returns the resolved
// major version or null when no modern-enough Java exists anywhere.
export function ensureModernJava(env, log = console.log) {
  let major = javaMajorOnPath(env);
  if (!major || major < MIN_JAVA) {
    const home = findModernJdk();
    if (home) {
      env.JAVA_HOME = home;
      env.PATH = `${join(home, 'bin')}${delimiter}${env.PATH}`;
      major = javaMajorOnPath(env);
      log(`[java] PATH Java was too old (or missing); switched to JDK ${major} at ${home}`);
    }
  }
  return major && major >= MIN_JAVA ? major : null;
}
