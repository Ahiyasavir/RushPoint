// ─── Data-retention maintenance ───────────────────────────────────────────────
//
// Honours the Privacy Policy commitment: raw participant PII captured during a
// run — GPS location pings (teamLocations) and uploaded photos (Storage +
// photoUrl fields on team submissions) — is purged RUN_DATA_RETENTION_DAYS
// after the run finishes. Aggregate results (scores/rankings) are retained.
//
// Three surfaces share one core (`pruneRunPII`):
//   • pruneExpiredRunData  — scheduled daily sweep (production)
//   • pruneExpiredRunDataNow — admin callable, runs the same sweep on demand
//   • pruneRunNow          — admin callable, prunes one named run (e2e-testable)
//
// Storage deletion is best-effort (catch + continue) so the job is safe whether
// or not a run actually had photo uploads, and is idempotent.

import * as functions from 'firebase-functions';
import { loggedCallable } from '../obs/log';
import { db, storage } from '../firebase';
import {
  RUN_DATA_RETENTION_DAYS,
  GAME_TRASH_RETENTION_DAYS, isPurgeDue, type Game,
} from '@rushpoint/shared';
import { deleteDocsInChunks } from '../batchUtil';
// Game trash purge (change: recoverable-game-deletion). purgeGameTree is the ONE
// destruction implementation, shared with the owner-triggered purgeGameNow.
import { purgeGameTree } from '../games/index';
import { AUDIT_SYSTEM_OPERATOR } from '../obs/audit';
import { backfillPublicTaskCoordinates } from './publicTaskBackfill';

// Admin only (platform maintenance). No emulator bypass — the e2e suite mints
// a real `admin` custom-token claim against the Auth emulator, so tests hit
// the same gate production runs.
function assertAdmin(context: functions.https.CallableContext): void {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  if (!context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
}

interface RunRef {
  ownerUid: string;
  gameId: string;
  runId: string;
}

// Run-level subcollections whose docs are bulk-deleted wholesale by the retention
// prune. Every one holds raw participant PII — GPS pings or names/photo URLs:
//   • teamLocations / locationTrack — live GPS pings + append-only movement track
//   • zones                         — capture zones carry the owning team's name
//   • feedItems                     — live photo feed: photo URLs + team names
//   • alerts                        — SOS + safe_zone_breach docs carry raw lat/lng
//                                     (functions/src/index.ts triggerSOS + breach),
//                                     exactly the "GPS location pings" the policy purges
//   • chat                          — team↔HQ threads: free-typed message text +
//                                     senderName (change: feed-ugc-safety). Added when
//                                     the privacy policy gained a participant-deletion
//                                     clause promising chat is purged with the run —
//                                     a Play Data Safety declaration has to match what
//                                     the code actually does.
// Pure list (no I/O) so the delete-set is unit-testable without an emulator.
export const PII_BULK_SUBCOLLECTIONS = [
  'teamLocations',
  'locationTrack',
  'zones',
  'feedItems',
  'alerts',
  'chat',
] as const;

interface PruneResult {
  runId: string;
  locationsDeleted: number;
  photoUrlsCleared: number;
  consentCleared: number;
  storagePurged: boolean;
}

// Core: strip raw PII from a single finished run. Idempotent.
export async function pruneRunPII({ ownerUid, gameId, runId }: RunRef): Promise<PruneResult> {
  const runPath = `users/${ownerUid}/games/${gameId}/runs/${runId}`;

  // 1) Delete every wholesale-purged raw-PII subcollection (GPS pings + names/URLs).
  //    These can run to thousands of docs, so they're deleted in batch-sized chunks.
  //    PII_BULK_SUBCOLLECTIONS covers teamLocations, the append-only movement track
  //    (locationTrack), capture zones, the live photo feed, and — critically — the
  //    `alerts` subcollection whose SOS/safe_zone_breach docs carry raw lat/lng.
  const bulkRefs: FirebaseFirestore.DocumentReference[] = [];
  for (const sub of PII_BULK_SUBCOLLECTIONS) {
    const snap = await db.collection(`${runPath}/${sub}`).get();
    for (const d of snap.docs) bulkRefs.push(d.ref);
  }
  // Trackable travel-log entries name teams (PII) — purge them (keep the trackable docs).
  const trackablesSnap = await db.collection(`${runPath}/trackables`).get();
  for (const td of trackablesSnap.docs) {
    const logSnap = await td.ref.collection('log').get();
    for (const ld of logSnap.docs) bulkRefs.push(ld.ref);
  }
  const locationsDeleted = await deleteDocsInChunks(bulkRefs);

  // 2) Clear photo URLs from each team's submissions (keep scores/answers), and
  //    clear any guardian-consent PII (the guardian's name).
  const teamsSnap = await db.collection(`${runPath}/teams`).get();
  let photoUrlsCleared = 0;
  let consentCleared = 0;
  for (const teamDoc of teamsSnap.docs) {
    const data = teamDoc.data() as {
      taskSubmissions?: Record<string, { photoUrl?: string }>;
      guardianConsent?: { guardianName?: string | null; grantedAt?: string };
    };
    const subs = data.taskSubmissions;
    const cleared: Record<string, { photoUrl: null; pruned: true }> = {};
    let touched = false;
    if (subs) {
      for (const [taskId, sub] of Object.entries(subs)) {
        if (sub && sub.photoUrl) { cleared[taskId] = { photoUrl: null, pruned: true }; photoUrlsCleared++; touched = true; }
      }
    }
    const patch: Record<string, unknown> = {};
    if (touched) patch.taskSubmissions = cleared;
    if (data.guardianConsent?.guardianName) {
      // Keep the grantedAt fact (aggregate), drop the name (PII).
      patch.guardianConsent = { guardianName: null, grantedAt: data.guardianConsent.grantedAt ?? null, pruned: true };
      consentCleared++;
    }
    if (Object.keys(patch).length > 0) {
      await teamDoc.ref.set(patch, { merge: true });
    }
  }

  // 2b) Delete the single-use consent tokens (they carry team identifiers).
  const tokSnap = await db.collection(`${runPath}/consentTokens`).get();
  consentCleared += await deleteDocsInChunks(tokSnap.docs.map((d) => d.ref));

  // 3) Delete uploaded photo objects under this run's Storage prefix.
  let storagePurged = false;
  try {
    await storage.bucket().deleteFiles({ prefix: `runs/${runId}/` });
    storagePurged = true;
  } catch (e) {
    functions.logger.warn(`pruneRunPII: storage purge failed for run ${runId}`, e);
  }

  // 4) Stamp the run so the scheduled sweep skips it next time.
  await db.doc(runPath).set({ piiPrunedAt: new Date().toISOString() }, { merge: true });

  return { runId, locationsDeleted, photoUrlsCleared, consentCleared, storagePurged };
}

// Finds finished runs older than the retention window that have not yet been
// pruned, and prunes each. Uses a collection-group query over `runs`.
export async function sweepExpiredRuns(now = new Date()): Promise<PruneResult[]> {
  const cutoff = new Date(now.getTime() - RUN_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const snap = await db
    .collectionGroup('runs')
    .where('status', '==', 'finished')
    .where('finishedAt', '<', cutoff)
    .get();

  const results: PruneResult[] = [];
  for (const runDoc of snap.docs) {
    const data = runDoc.data() as { piiPrunedAt?: string };
    if (data.piiPrunedAt) continue; // already pruned
    // path: users/{ownerUid}/games/{gameId}/runs/{runId}
    const parts = runDoc.ref.path.split('/');
    const ownerUid = parts[1];
    const gameId = parts[3];
    const runId = parts[5];
    results.push(await pruneRunPII({ ownerUid, gameId, runId }));
  }
  return results;
}


// ─── Game trash purge sweep (change: recoverable-game-deletion) ──────────────
//
// deleteGame no longer destroys anything: it writes a `deletedAt` tombstone and
// the game stays recoverable for GAME_TRASH_RETENTION_DAYS. This is the other end
// of that contract — the sweep that actually destroys a game once its grace
// period has elapsed.
//
// It DELIBERATELY reuses the existing daily retention schedule below instead of
// adding a second scheduler: same cadence, same timezone, one job to reason about.
//
// The query is an inequality on a COLLECTION-GROUP scope, which Firestore does not
// auto-index — see the `games.deletedAt` COLLECTION_GROUP fieldOverride in
// firestore.indexes.json. `isPurgeDue` (shared, pure) makes the final call, so a
// corrupt/unparseable tombstone is never destroyed.

export async function sweepPurgeableGames(
  now = new Date(),
  days: number = GAME_TRASH_RETENTION_DAYS,
): Promise<Array<{ ownerUid: string; gameId: string }>> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const snap = await db
    .collectionGroup('games')
    .where('deletedAt', '<=', cutoff)
    .get();

  const purged: Array<{ ownerUid: string; gameId: string }> = [];
  for (const gameDoc of snap.docs) {
    const game = gameDoc.data() as Game;
    // Re-check with the shared predicate: the query is the cheap filter, this is
    // the authority (and it fails closed on an unparseable timestamp).
    if (!isPurgeDue(game.deletedAt, now, days)) continue;
    // path: users/{ownerUid}/games/{gameId}
    const parts = gameDoc.ref.path.split('/');
    const ownerUid = parts[1];
    const gameId = parts[3];
    await purgeGameTree(ownerUid, gameId, AUDIT_SYSTEM_OPERATOR);
    purged.push({ ownerUid, gameId });
  }
  return purged;
}


// ─── Scheduled daily sweep ──────────────────────────────────────────────────
export const pruneExpiredRunData = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('Asia/Jerusalem')
  .onRun(async () => {
    const results = await sweepExpiredRuns();
    functions.logger.info(`pruneExpiredRunData: pruned ${results.length} run(s)`, { results });
    // Same daily job destroys games whose 30-day trash window has elapsed.
    const purgedGames = await sweepPurgeableGames();
    functions.logger.info(`pruneExpiredRunData: purged ${purgedGames.length} deleted game(s)`, { purgedGames });
    return null;
  });


// ─── On-demand admin callables (testable) ─────────────────────────────────────
export const pruneExpiredRunDataNow = loggedCallable('pruneExpiredRunDataNow', async (_data, context) => {
  assertAdmin(context);
  const results = await sweepExpiredRuns();
  return { ok: true, prunedCount: results.length, results };
});

// Game trash purge, on demand (change: recoverable-game-deletion). Mirrors
// pruneExpiredRunDataNow: the scheduled sweep is not callable, so without this
// there is no way to exercise or force the purge path.
//
// `graceDays` is an ADMIN-ONLY override, and it is what makes the grace period
// provable in both directions without waiting a month (30 ⇒ nothing purged,
// 0 ⇒ purged). Same gate and same trust level as pruneRunNow — assertAdmin has no
// emulator bypass, and it can only ever destroy games that are ALREADY tombstoned.
export const purgeDeletedGamesNow = loggedCallable('purgeDeletedGamesNow', async (data, context) => {
  assertAdmin(context);
  const { graceDays } = (data ?? {}) as { graceDays?: number };
  const days = typeof graceDays === 'number' && Number.isFinite(graceDays) && graceDays >= 0
    ? graceDays
    : GAME_TRASH_RETENTION_DAYS;
  const purged = await sweepPurgeableGames(new Date(), days);
  return { ok: true, purgedCount: purged.length, graceDays: days, purged };
});

// publicTasks legacy-coordinate backfill (change: public-task-coordinates-backfill).
// Admin-only and paged: `startAfter` continues from a previous call's `cursor`,
// so a large library is swept in bounded chunks instead of one timeout-prone
// pass. `dryRun` reports what would change and writes nothing.
export const backfillPublicTaskCoordinatesNow = loggedCallable(
  'backfillPublicTaskCoordinatesNow',
  async (data, context) => {
    assertAdmin(context);
    const { limit, startAfter, dryRun } = (data ?? {}) as {
      limit?: number; startAfter?: string | null; dryRun?: boolean;
    };
    const result = await backfillPublicTaskCoordinates({ limit, startAfter, dryRun });
    return { ok: true, ...result };
  },
);

export const pruneRunNow = loggedCallable('pruneRunNow', async (data, context) => {
  assertAdmin(context);
  const { ownerUid, gameId, runId } = data as RunRef;
  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }
  const result = await pruneRunPII({ ownerUid, gameId, runId });
  return { ok: true, ...result };
});
