// ─── Daily retention sweep for the self-hosted deployment ────────────────────
//
// On Cloud Functions this ran as the `pruneExpiredRunData` pubsub SCHEDULE
// (every 24h, Asia/Jerusalem). Off Cloud Functions that schedule never fires, so
// this standalone entry runs the EXACT SAME sweep the schedule ran —
// `sweepExpiredRuns()` (90-day PII prune of finished/abandoned runs) followed by
// `sweepPurgeableGames()` (destroy games past their 30-day trash window) — with
// Admin privileges, then exits. Drive it from a daily systemd timer or cron
// (see deploy/rushpoint-prune.service / .timer). It is idempotent and capped
// (RUN_SWEEP_MAX_RUNS per run), so a missed day drains on the next.
//
// Bundled to `lib/prune-cron.js` by `npm run build:cron`.
import * as admin from 'firebase-admin';

async function main(): Promise<void> {
  if (!admin.apps.length) admin.initializeApp();
  // Import the sweep AFTER initializeApp so the module's Firestore handle is live.
  const { sweepExpiredRuns, sweepPurgeableGames } = await import('./maintenance/index');
  const runs = await sweepExpiredRuns();
  // eslint-disable-next-line no-console
  console.log(`prune-cron: pruned ${runs.length} run(s) past the retention window`);
  const games = await sweepPurgeableGames();
  // eslint-disable-next-line no-console
  console.log(`prune-cron: purged ${games.length} game(s) past their trash window`);
}

main().then(
  () => process.exit(0),
  (e) => {
    // eslint-disable-next-line no-console
    console.error('prune-cron: FAILED', e);
    process.exit(1);
  },
);
