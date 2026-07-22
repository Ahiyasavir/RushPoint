// Crash-safe periodic emulator snapshot loop (change: emulator-data-backup,
// extended by emulator-backup-tiered-retention).
//
// While the stack is up it exports the running emulator's data into timestamped
// folders under .firebase/backups/, independent of the clean-exit export. Retention
// is TIERED (recent + hourly + daily) under an absolute disk cap, and the loop
// publishes its own health so a stopped safety net cannot go unnoticed. Pure
// timing/rotation/selection/health logic lives in scripts/lib/emulatorBackup.mjs.
//
//   node scripts/emulator-backup.mjs                # run the snapshot loop
//   node scripts/emulator-backup.mjs --latest       # print the newest valid snapshot to restore from
//   node scripts/emulator-backup.mjs --status       # report loop health; EXITS NON-ZERO when stalled/absent
//   node scripts/emulator-backup.mjs --snapshot-now [--pin]
//                                                   # one-shot snapshot, then exit (--pin = never tier-pruned)
//
// Env (all optional):
//   EMU_BACKUP_INTERVAL_MS      snapshot interval                     (default 120000)
//   EMU_BACKUP_KEEP             recent tier — newest N kept outright  (default 10)
//   EMU_BACKUP_KEEP_HOURLY      hourly tier — most recent H hours     (default 24)
//   EMU_BACKUP_KEEP_DAILY       daily tier  — most recent D days      (default 14)
//   EMU_BACKUP_MAX_BYTES        absolute footprint cap                (default 512 MiB)
//   EMU_BACKUP_EXPORT_TIMEOUT_MS  kill a wedged export after this     (default 90000)
//
// RECOMMENDED (not wired here): call `--snapshot-now --pin` at the top of
// scripts/emulator-restore.mjs and of `npm run seed:reset`. Both overwrite emulator
// data, and an import-driven overwrite is exactly how the lost-game incident happened —
// a pinned snapshot taken one second before is the difference between "undo" and "gone".
//
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  snapshotName, selectRestoreTarget, snapshotTimeMs,
  isEmulatorReady, canAttemptExport, canStartExport, didExportSucceed,
  planRetention, assessLoopHealth,
} from './lib/emulatorBackup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = path.join(ROOT, '.firebase', 'backups');
// The heartbeat lives beside the snapshots but must NEVER look like one: listBackups()
// filters on the `backup-` prefix, and planRetention must never consider it a candidate.
const STATUS_FILE = path.join(BACKUP_DIR, 'STATUS.json');
const PIN_MARKER = 'PINNED';
const INTERVAL_MS = Number(process.env.EMU_BACKUP_INTERVAL_MS || 2 * 60_000); // default 2 min
const RETENTION = {
  recent: Number(process.env.EMU_BACKUP_KEEP || 10),               // ~20 min of fine grain
  hourly: Number(process.env.EMU_BACKUP_KEEP_HOURLY || 24),        // hourly back one day
  daily: Number(process.env.EMU_BACKUP_KEEP_DAILY || 14),          // daily back two weeks
  maxBytes: Number(process.env.EMU_BACKUP_MAX_BYTES || 512 * 1024 * 1024),
};
const EXPORT_TIMEOUT_MS = Number(process.env.EMU_BACKUP_EXPORT_TIMEOUT_MS || 90_000);
const PROJECT = process.env.RUSHPOINT_APP_ID || 'rushpoint-pwa-7daaa';
// Emulator Hub — the authoritative "suite is up" signal. An open Firestore port
// (what wait-on gates on) is NOT readiness: auth import + loading ~66 functions
// still follow, and an export against that mid-boot state wedges Firestore and
// cascade-kills the whole playtest stack. Probe the same host:port that
// `emulators:export` itself talks to.
const HUB = process.env.FIREBASE_EMULATOR_HUB || '127.0.0.1:4400';
const READY_POLL_MS = 2_000;

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((n) => n.startsWith('backup-'));
}

// A snapshot is valid/importable iff it carries the export metadata the emulator
// reads on --import (matches dev-emulator's import gate).
function isValidSnapshot(name) {
  return fs.existsSync(path.join(BACKUP_DIR, name, 'firebase-export-metadata.json'));
}

/** Recursive byte total of a directory — the input the disk cap reasons over. */
function dirBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirBytes(full);
      else total += fs.statSync(full).size;
    } catch { /* raced with a write — ignore */ }
  }
  return total;
}

function printLatest() {
  const entries = listBackups().map((name) => ({ name, valid: isValidSnapshot(name) }));
  const target = selectRestoreTarget(entries);
  if (target) {
    console.log(path.join(BACKUP_DIR, target));
  } else {
    console.error('No valid snapshot found in ' + BACKUP_DIR);
    process.exit(1);
  }
}

// ── Liveness ─────────────────────────────────────────────────────────────────
// The incident: no snapshot was written for 16+ minutes while this process was alive
// and the emulator was up, and NOTHING said so. One grey console.warn in a multiplexed
// terminal is not a signal. The status file is the mechanism a human (or a supervising
// script) can actually rely on, because `--status` exits non-zero when the net is down.

const state = {
  pid: process.pid,
  startedAt: Date.now(),
  updatedAt: Date.now(),
  lastSuccessAt: null,
  lastSuccessName: null,
  lastError: null,
  consecutiveFailures: 0,
  intervalMs: INTERVAL_MS,
  health: 'starting',
  snapshotCount: 0,
  totalBytes: 0,
};

function writeStatus() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`[backup] could not write ${STATUS_FILE}: ${err.message}`);
  }
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { return null; }
}

function humanAge(ms) {
  if (!Number.isFinite(ms)) return 'never';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

/** A banner, not a log line. Repeated every tick while the condition holds, on stderr. */
function shout(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '!'.repeat(width);
  process.stderr.write(`\n\x1b[1;31m${bar}\n${lines.map((l) => `! ${l.padEnd(width - 4)} !`).join('\n')}\n${bar}\x1b[0m\n`);
}

function reportHealth() {
  state.health = assessLoopHealth({
    lastSuccessMs: state.lastSuccessAt,
    nowMs: Date.now(),
    intervalMs: INTERVAL_MS,
    consecutiveFailures: state.consecutiveFailures,
    startedMs: state.startedAt,
  });
  if (state.health === 'stalled' || state.health === 'degraded') {
    const age = state.lastSuccessAt ? humanAge(Date.now() - state.lastSuccessAt) : 'NEVER (no snapshot has ever succeeded)';
    shout([
      `BACKUP LOOP ${state.health.toUpperCase()} — THE EMULATOR IS NOT BEING BACKED UP`,
      `last successful snapshot: ${age}`,
      `consecutive export failures: ${state.consecutiveFailures}${state.lastError ? ` (${state.lastError})` : ''}`,
      `check: node scripts/emulator-backup.mjs --status`,
    ]);
  }
}

function printStatus() {
  const s = readStatus();
  if (!s) {
    console.error(`[backup] NO SNAPSHOT LOOP STATE at ${STATUS_FILE} — no loop has ever run here.`);
    process.exit(1);
  }
  const health = assessLoopHealth({
    lastSuccessMs: s.lastSuccessAt, nowMs: Date.now(), intervalMs: s.intervalMs || INTERVAL_MS,
    consecutiveFailures: s.consecutiveFailures, startedMs: s.startedAt,
  });
  console.log(`[backup] health=${health} pid=${s.pid} heartbeat=${humanAge(Date.now() - s.updatedAt)}`);
  console.log(`         last success: ${s.lastSuccessName || '(none)'} ${s.lastSuccessAt ? humanAge(Date.now() - s.lastSuccessAt) : 'never'}`);
  console.log(`         consecutive failures: ${s.consecutiveFailures}   snapshots: ${s.snapshotCount}   footprint: ${(s.totalBytes / 1048576).toFixed(1)} MB`);
  if (health === 'stalled') {
    console.error('[backup] STALLED — the emulator is running WITHOUT a working safety net.');
    process.exit(1);
  }
}

// Success is judged by the metadata file's mtime, NOT the child's exit code — on
// Windows `firebase emulators:export` hits a libuv assertion during its OWN shutdown
// (unrelated to whether the export itself worked) and returns a garbage non-zero
// status even after genuinely writing a valid snapshot. Trusting the exit code made
// every single periodic backup log as "failed" while silently still writing good
// data — see didExportSucceed's doc comment for the full mechanism.
//
// The timeout is the other half of the silent-stop fix: an export that never returns
// used to leave the loop pending forever with no signal. Now it is killed and counted
// as a failure, which drives health → stalled → banner.
function exportSnapshot(name) {
  return new Promise((resolve) => {
    const dest = path.join(BACKUP_DIR, name);
    const metaPath = path.join(dest, 'firebase-export-metadata.json');
    const beforeMtimeMs = fs.existsSync(metaPath) ? fs.statSync(metaPath).mtimeMs : null;
    const proc = spawn('npx', ['firebase', 'emulators:export', dest, '--force', '--project', PROJECT], {
      cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
    });
    let settled = false;
    const timer = setTimeout(() => {
      state.lastError = `export exceeded ${EXPORT_TIMEOUT_MS}ms and was killed`;
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      finish();
    }, EXPORT_TIMEOUT_MS);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const afterExists = fs.existsSync(metaPath);
      const afterMtimeMs = afterExists ? fs.statSync(metaPath).mtimeMs : undefined;
      resolve(didExportSucceed({ beforeMtimeMs, afterExists, afterMtimeMs }));
    }
    proc.on('exit', finish);
    proc.on('error', finish);
  });
}

// Tiered prune. Retention is decided by planRetention — a pure, clock-free function —
// and this only carries out its verdict. Snapshots carrying a PINNED marker are
// tier-exempt (they were captured deliberately, before something destructive).
function prune() {
  const snapshots = listBackups().map((name) => {
    const dir = path.join(BACKUP_DIR, name);
    return {
      name,
      ts: snapshotTimeMs(name),
      bytes: dirBytes(dir),
      pinned: fs.existsSync(path.join(dir, PIN_MARKER)),
    };
  });
  const { prune: toPrune, keptBytes, keep } = planRetention({ snapshots, policy: RETENTION });
  for (const name of toPrune) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
  }
  state.snapshotCount = keep.length;
  state.totalBytes = keptBytes;
  return toPrune.length;
}

// GET http://<HUB>/emulators — the parsed running-emulator map, or null on any
// failure (hub not up yet, connection refused, bad JSON). Never throws.
async function probeHubReady() {
  try {
    const res = await fetch(`http://${HUB}/emulators`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function isReadyNow() {
  return isEmulatorReady(await probeHubReady());
}

/** One-shot snapshot for use immediately before a destructive operation. */
async function snapshotNow({ pin }) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!(await isReadyNow())) {
    console.error('[backup] emulator is not ready — refusing to export (a mid-boot export wedges Firestore).');
    process.exit(1);
  }
  const name = snapshotName(Date.now());
  const okExport = await exportSnapshot(name);
  if (!okExport) {
    console.error('[backup] one-shot snapshot FAILED.');
    process.exit(1);
  }
  if (pin) fs.writeFileSync(path.join(BACKUP_DIR, name, PIN_MARKER), 'pinned: exempt from tiered retention\n');
  console.log(path.join(BACKUP_DIR, name));
}

async function loop() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`[backup] snapshots every ${Math.round(INTERVAL_MS / 1000)}s → ${BACKUP_DIR}`);
  console.log(`[backup] retention: ${RETENTION.recent} recent + ${RETENTION.hourly} hourly + ${RETENTION.daily} daily, cap ${(RETENTION.maxBytes / 1048576).toFixed(0)} MB`);
  writeStatus();

  // Wait for the emulator suite to be FULLY ready before the first export — a
  // snapshot taken mid-boot wedges Firestore. Bounded backoff, one quiet notice,
  // no hard timeout (never exporting is strictly safer than crashing the stack).
  let announced = false;
  while (!(await isReadyNow())) {
    if (!announced) { console.log('[backup] waiting for emulator to be ready before first snapshot…'); announced = true; }
    state.updatedAt = Date.now();
    writeStatus();
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }

  let lastTs = null;
  let inFlight = false;
  const tick = async () => {
    const now = Date.now();
    state.updatedAt = now;
    // Re-probe readiness each tick so a not-ready blip skips the export.
    const ready = await isReadyNow();
    if (!canStartExport({ inFlight, ready, lastTs, nowTs: now, intervalMs: INTERVAL_MS })) {
      reportHealth();
      writeStatus();
      return;
    }
    inFlight = true;
    const name = snapshotName(now);
    let okExport = false;
    try {
      okExport = await exportSnapshot(name);
    } finally {
      inFlight = false;
    }
    if (okExport) {
      lastTs = now;
      state.lastSuccessAt = now;
      state.lastSuccessName = name;
      state.consecutiveFailures = 0;
      state.lastError = null;
      const pruned = prune();
      console.log(`[backup] wrote ${path.join('.firebase', 'backups', name)}${pruned ? ` (pruned ${pruned} old)` : ''}`);
    } else {
      state.consecutiveFailures += 1;
      state.lastError = state.lastError || 'emulators:export wrote no new metadata';
      console.warn('[backup] export failed (will retry next tick)');
    }
    state.updatedAt = Date.now();
    reportHealth();
    writeStatus();
  };
  // Now that the suite is ready, take the first snapshot promptly, then on the interval.
  await tick();
  setInterval(tick, Math.min(INTERVAL_MS, 30_000));
}

const argv = process.argv;
if (argv.includes('--latest')) {
  printLatest();
} else if (argv.includes('--status')) {
  printStatus();
} else if (argv.includes('--snapshot-now')) {
  snapshotNow({ pin: argv.includes('--pin') });
} else {
  loop();
}
