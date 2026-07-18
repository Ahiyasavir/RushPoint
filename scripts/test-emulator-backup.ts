// Pure-logic tests for emulator-data-backup (timing / rotation / selection).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  isSnapshotDue,
  snapshotName,
  selectSnapshotsToPrune,
  selectRestoreTarget,
  isEmulatorReady,
  canAttemptExport,
} from './lib/emulatorBackup.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── isSnapshotDue ────────────────────────────────────────────────────────────
ok(isSnapshotDue(null, 1000, 500) === true, 'never taken → due');
ok(isSnapshotDue(undefined, 1000, 500) === true, 'undefined last → due');
ok(isSnapshotDue(1000, 1400, 500) === false, 'within interval → not due');
ok(isSnapshotDue(1000, 1500, 500) === true, 'at interval → due');
ok(isSnapshotDue(1000, 5000, 500) === true, 'past interval → due');

// ── snapshotName ─────────────────────────────────────────────────────────────
const t1 = Date.UTC(2026, 5, 28, 12, 34, 56, 789);
ok(snapshotName(t1) === 'backup-2026-06-28T12-34-56-789Z', `deterministic name (got ${snapshotName(t1)})`);
// Chronological = lexicographic.
const a = snapshotName(Date.UTC(2026, 0, 1, 0, 0, 0));
const b = snapshotName(Date.UTC(2026, 0, 1, 0, 0, 1));
const c = snapshotName(Date.UTC(2026, 11, 31, 23, 59, 59));
ok(a < b && b < c, 'names sort lexicographically in time order');

// ── selectSnapshotsToPrune ───────────────────────────────────────────────────
const names = ['backup-1', 'backup-3', 'backup-2', 'backup-5', 'backup-4'];
ok(JSON.stringify(selectSnapshotsToPrune(names, 3)) === JSON.stringify(['backup-1', 'backup-2']), 'prunes oldest over the limit');
ok(selectSnapshotsToPrune(names, 5).length === 0, 'at the limit → prune none');
ok(selectSnapshotsToPrune(names, 10).length === 0, 'keepN ≥ count → prune none');
ok(selectSnapshotsToPrune(['x'], 1).length === 0, 'single under limit → none');
ok(JSON.stringify(selectSnapshotsToPrune(names, 0)) === JSON.stringify(['backup-1', 'backup-2', 'backup-3', 'backup-4', 'backup-5']), 'keepN 0 → prune all (sorted)');

// ── selectRestoreTarget ──────────────────────────────────────────────────────
ok(selectRestoreTarget([{ name: 'backup-1', valid: true }, { name: 'backup-3', valid: true }, { name: 'backup-2', valid: true }]) === 'backup-3', 'newest valid');
ok(selectRestoreTarget([{ name: 'backup-3', valid: false }, { name: 'backup-2', valid: true }, { name: 'backup-1', valid: true }]) === 'backup-2', 'skips newest-but-invalid → older valid');
ok(selectRestoreTarget([]) === null, 'empty → null');
ok(selectRestoreTarget([{ name: 'backup-1', valid: false }]) === null, 'all invalid → null');
ok(selectRestoreTarget(undefined as never) === null, 'undefined → null');

// ── isEmulatorReady ──────────────────────────────────────────────────────────
ok(isEmulatorReady(null) === false, 'null hub → not ready');
ok(isEmulatorReady(undefined as never) === false, 'undefined hub → not ready');
ok(isEmulatorReady({}) === false, 'empty hub map → not ready');
ok(isEmulatorReady({ firestore: {} }) === false, 'firestore only → not ready (functions still loading)');
ok(isEmulatorReady({ functions: {} }) === false, 'functions only → not ready');
ok(isEmulatorReady({ firestore: {}, functions: {}, auth: {} }) === true, 'firestore + functions present → ready');

// ── canAttemptExport ─────────────────────────────────────────────────────────
ok(canAttemptExport({ ready: false, lastTs: null, nowTs: 1000, intervalMs: 500 }) === false, 'not ready → no export even when due');
ok(canAttemptExport({ ready: true, lastTs: null, nowTs: 1000, intervalMs: 500 }) === true, 'ready + never snapshotted → export');
ok(canAttemptExport({ ready: true, lastTs: 1000, nowTs: 1400, intervalMs: 500 }) === false, 'ready but within interval → no export');
ok(canAttemptExport({ ready: true, lastTs: 1000, nowTs: 1500, intervalMs: 500 }) === true, 'ready + interval elapsed → export');

console.log(failed === 0
  ? `\n✅ ALL EMULATOR-BACKUP TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
