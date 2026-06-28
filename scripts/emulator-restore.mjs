// Restore the emulator from the newest valid crash-safe snapshot
// (change: emulator-data-backup). Copies the chosen snapshot into
// .firebase/emulator-data so the next `--import` boot picks it up.
//
//   npm run emulator:restore
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRestoreTarget } from './lib/emulatorBackup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = path.join(ROOT, '.firebase', 'backups');
const DATA_DIR = path.join(ROOT, '.firebase', 'emulator-data');

function isValidSnapshot(name) {
  return fs.existsSync(path.join(BACKUP_DIR, name, 'firebase-export-metadata.json'));
}

if (!fs.existsSync(BACKUP_DIR)) {
  console.error(`No backups directory at ${BACKUP_DIR}`);
  process.exit(1);
}

const entries = fs.readdirSync(BACKUP_DIR)
  .filter((n) => n.startsWith('backup-'))
  .map((name) => ({ name, valid: isValidSnapshot(name) }));

const target = selectRestoreTarget(entries);
if (!target) {
  console.error('No valid snapshot found to restore from.');
  process.exit(1);
}

const src = path.join(BACKUP_DIR, target);
// Replace the import dir with the chosen snapshot.
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.cpSync(src, DATA_DIR, { recursive: true });

console.log(`[restore] restored ${path.join('.firebase', 'backups', target)} → ${path.join('.firebase', 'emulator-data')}`);
console.log('[restore] start the emulator (it imports .firebase/emulator-data) to resume.');
