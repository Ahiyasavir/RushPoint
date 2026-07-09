// ─────────────────────────────────────────────────────────────────────────────
// One-time backfill for the `activeTaskId` station-occupancy mirror.
//
// The `syncActiveTaskId` Cloud Function keeps `gameState.activeTaskId` in sync
// with the active slot's taskId going forward (it fires on every gameState
// write). This script seeds that field on gameState docs that already existed
// before the trigger was deployed — so `getStationTeams` (which now queries the
// field) sees them immediately, without waiting for their next write.
//
// Idempotent: only writes when the derived value differs. Safe to re-run.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/backfill-active-task.mjs
// (defaults to the local emulator host below)
// ─────────────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';

const PROJECT_ID = 'rushpoint-pwa-7daaa';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const snap = await db.collectionGroup('gameState').get();
let updated = 0;
let skipped = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  const active = (data.slots ?? []).find((s) => s.status === 'active');
  const desired = active?.taskId ?? null;
  const current = data.activeTaskId ?? null;
  if (desired === current) { skipped += 1; continue; }
  await doc.ref.update({ activeTaskId: desired });
  updated += 1;
}

console.log(`[backfill-active-task] ${updated} updated, ${skipped} already in sync (${snap.size} total).`);
process.exit(0);
