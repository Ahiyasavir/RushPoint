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
} from './lib/emulatorBackup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = path.join(ROOT, '.firebase', 'backups');
const INTERVAL_MS = Number(process.env.EMU_BACKUP_INTERVAL_MS || 2 * 60_000); // default 2 min
const KEEP_N = Number(process.env.EMU_BACKUP_KEEP || 10);                      // default keep 10
const PROJECT = process.env.RUSHPOINT_APP_ID || 'rushpoint-pwa-7daaa';

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

async function loop() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`[backup] crash-safe snapshots every ${Math.round(INTERVAL_MS / 1000)}s, keeping ${KEEP_N} → ${BACKUP_DIR}`);
  let lastTs = null;
  const tick = async () => {
    const now = Date.now();
    if (!isSnapshotDue(lastTs, now, INTERVAL_MS)) return;
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
  // First snapshot shortly after boot, then on the interval.
  setTimeout(tick, 10_000);
  setInterval(tick, Math.min(INTERVAL_MS, 30_000));
}

if (process.argv.includes('--latest')) {
  printLatest();
} else {
  loop();
}
