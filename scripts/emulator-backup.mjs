// Crash-safe periodic emulator snapshot loop (change: emulator-data-backup).
// While the stack is up it exports the running emulator's data into rotating,
// timestamped folders under .firebase/backups/, independent of the clean-exit
// export. Pure timing/rotation/selection live in scripts/lib/emulatorBackup.mjs.
//
//   node scripts/emulator-backup.mjs            # run the snapshot loop
//   node scripts/emulator-backup.mjs --latest   # print the newest valid snapshot to restore from
//
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSnapshotDue, snapshotName, selectSnapshotsToPrune, selectRestoreTarget,
  isEmulatorReady, canAttemptExport,
} from './lib/emulatorBackup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = path.join(ROOT, '.firebase', 'backups');
const INTERVAL_MS = Number(process.env.EMU_BACKUP_INTERVAL_MS || 2 * 60_000); // default 2 min
const KEEP_N = Number(process.env.EMU_BACKUP_KEEP || 10);                      // default keep 10
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

function exportSnapshot(name) {
  return new Promise((resolve) => {
    const dest = path.join(BACKUP_DIR, name);
    const proc = spawn('npx', ['firebase', 'emulators:export', dest, '--force', '--project', PROJECT], {
      cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
    });
    proc.on('exit', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function prune() {
  const toPrune = selectSnapshotsToPrune(listBackups(), KEEP_N);
  for (const name of toPrune) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
  }
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

async function loop() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`[backup] crash-safe snapshots every ${Math.round(INTERVAL_MS / 1000)}s, keeping ${KEEP_N} → ${BACKUP_DIR}`);

  // Wait for the emulator suite to be FULLY ready before the first export — a
  // snapshot taken mid-boot wedges Firestore. Bounded backoff, one quiet notice,
  // no hard timeout (never exporting is strictly safer than crashing the stack).
  let announced = false;
  while (!(await isReadyNow())) {
    if (!announced) { console.log('[backup] waiting for emulator to be ready before first snapshot…'); announced = true; }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }

  let lastTs = null;
  const tick = async () => {
    const now = Date.now();
    // Re-probe readiness each tick so a not-ready blip skips the export.
    const ready = await isReadyNow();
    if (!canAttemptExport({ ready, lastTs, nowTs: now, intervalMs: INTERVAL_MS })) return;
    const name = snapshotName(now);
    const okExport = await exportSnapshot(name);
    if (okExport) {
      lastTs = now;
      const pruned = prune();
      console.log(`[backup] wrote ${path.join('.firebase', 'backups', name)}${pruned ? ` (pruned ${pruned} old)` : ''}`);
    } else {
      console.warn('[backup] export failed (will retry next tick)');
    }
  };
  // Now that the suite is ready, take the first snapshot promptly, then on the interval.
  await tick();
  setInterval(tick, Math.min(INTERVAL_MS, 30_000));
}

if (process.argv.includes('--latest')) {
  printLatest();
} else {
  loop();
}
