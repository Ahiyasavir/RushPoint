// Impure shell for emulator-exec-orphan-reap: enumerate the process table, read this
// repo's exec-session record, ask the PURE decision function what to reap, kill exactly
// that — and nothing else.
//
// There is deliberately NO selection logic in this file. Every `if` about *whether* a
// process may die lives in scripts/lib/emulatorReap.mjs, which imports nothing and is
// tested adversarially by scripts/test-emulator-reap.ts. This file only does the three
// things a pure function cannot: list processes, read/write a small JSON file, and signal.
//
// Env vars (all optional):
//   RUSHPOINT_REAP_DISABLE=1     skip the reap entirely (one-variable rollback)
//   RUSHPOINT_REAP_DEBUG=1       print the full keep/reap verdict table and kill NOTHING
//   RUSHPOINT_REAP_MIN_AGE_MS    age floor below which a process is never reaped (default 5000)
//
// Session record: .firebase/emulator-exec-sessions.json (gitignored, additive, capped at
// the 20 most recent entries). A missing / empty / unparseable file is treated as "no
// sessions", which only makes the reaper MORE conservative — with no sessions recorded,
// nothing can be attributed and nothing is reaped.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { planEmulatorExecReap } from './emulatorReap.mjs';

const isWin = process.platform === 'win32';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSION_FILE = join(REPO_ROOT, '.firebase', 'emulator-exec-sessions.json');
const MAX_SESSIONS = 20;
const DEFAULT_MIN_AGE_MS = 5_000;

// ── Session record ───────────────────────────────────────────────────────────

/** Read the recorded sessions. ANY problem → `[]` (fail closed: nothing attributable). */
export function readExecSessions() {
  try {
    if (!existsSync(SESSION_FILE)) return [];
    const parsed = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return list.filter((s) => s && Number.isFinite(Number(s.rootPid)));
  } catch {
    return [];
  }
}

function writeExecSessions(sessions) {
  try {
    mkdirSync(dirname(SESSION_FILE), { recursive: true });
    const trimmed = sessions.slice(-MAX_SESSIONS);
    writeFileSync(SESSION_FILE, JSON.stringify({ sessions: trimmed }, null, 2));
  } catch (e) {
    console.warn(`[reap] Could not write the session record (non-fatal): ${e.message}`);
  }
}

/** Record that an `emulators:exec` run just started, rooted at `rootPid`. */
export function recordExecSessionStart(rootPid, cmd) {
  if (!Number.isFinite(Number(rootPid))) return;
  const sessions = readExecSessions();
  sessions.push({ rootPid: Number(rootPid), startedAt: Date.now(), endedAt: null, cmd: String(cmd ?? '') });
  writeExecSessions(sessions);
}

/** Stamp the end of that run. Until this happens, its tree is treated as LIVE. */
export function recordExecSessionEnd(rootPid) {
  if (!Number.isFinite(Number(rootPid))) return;
  const sessions = readExecSessions();
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (Number(sessions[i].rootPid) === Number(rootPid) && sessions[i].endedAt == null) {
      sessions[i].endedAt = Date.now();
      break;
    }
  }
  writeExecSessions(sessions);
}

// ── Process enumeration ──────────────────────────────────────────────────────

/**
 * Snapshot the process table as `{ pid, ppid, commandLine, startedAt }[]`.
 * ANY failure (no PowerShell, no `ps`, unparseable output) returns `[]` — an empty
 * snapshot makes the reap a no-op rather than a guess.
 */
export function enumerateProcesses() {
  try {
    return isWin ? enumerateWindows() : enumerateUnix();
  } catch {
    return [];
  }
}

function enumerateWindows() {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,' +
    "@{n='StartedAt';e={ if ($_.CreationDate) { [int64]([datetimeoffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null } }} | " +
    'ConvertTo-Json -Compress -Depth 2';
  const res = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(res.stdout || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter(Boolean).map((r) => ({
    pid: Number(r.ProcessId),
    ppid: Number(r.ParentProcessId),
    commandLine: String(r.CommandLine ?? ''),
    startedAt: Number(r.StartedAt),
  }));
}

function enumerateUnix() {
  const res = spawnSync('ps', ['-eo', 'pid=,ppid=,etimes=,args='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const now = Date.now();
  return (res.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) return null;
      return {
        pid: Number(m[1]),
        ppid: Number(m[2]),
        commandLine: m[4],
        startedAt: now - Number(m[3]) * 1000,
      };
    })
    .filter(Boolean);
}

function killPid(pid) {
  const res = isWin
    ? spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' })
    : spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
  return res.status === 0;
}

// ── The reap ─────────────────────────────────────────────────────────────────

/**
 * Enumerate → decide → kill. Best-effort by contract: it never throws into its caller and
 * never changes an exit code, because a cleanup step that can fail a green gate gets
 * disabled within a week. Returns the number of processes actually terminated.
 */
export function reapOrphanEmulatorProcesses({ label = 'reap' } = {}) {
  try {
    if (/^(1|true)$/i.test(String(process.env.RUSHPOINT_REAP_DISABLE ?? ''))) return 0;
    const debug = /^(1|true)$/i.test(String(process.env.RUSHPOINT_REAP_DEBUG ?? ''));
    const minAgeMs = Number(process.env.RUSHPOINT_REAP_MIN_AGE_MS) > 0
      ? Number(process.env.RUSHPOINT_REAP_MIN_AGE_MS)
      : DEFAULT_MIN_AGE_MS;

    const processes = enumerateProcesses();
    if (processes.length === 0) return 0;

    const plan = planEmulatorExecReap({
      processes,
      repoRoot: REPO_ROOT,
      selfPid: process.pid,
      protectedPids: [process.ppid].filter((p) => Number.isFinite(Number(p))),
      sessions: readExecSessions(),
      nowMs: Date.now(),
      minAgeMs,
    });

    if (debug) {
      console.log(`[${label}] verdicts (DEBUG — nothing will be killed):`);
      for (const v of plan.keep) console.log(`  keep  ${v.pid}  ${v.reason}`);
      for (const v of plan.reap) console.log(`  REAP  ${v.pid}  ${v.reason}  ${v.commandLine}`);
      return 0;
    }

    let killed = 0;
    for (const v of plan.reap) {
      if (killPid(v.pid)) {
        killed++;
        console.log(`[${label}] Reaped orphaned emulator process (PID ${v.pid}) — ${v.reason}`);
      }
    }
    return killed;
  } catch (e) {
    console.warn(`[${label}] Orphan reap skipped (non-fatal): ${e.message}`);
    return 0;
  }
}
