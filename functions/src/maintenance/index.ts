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
import { RUN_DATA_RETENTION_DAYS } from '@rushpoint/shared';
import { deleteDocsInChunks } from '../batchUtil';

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

// Admin only (platform maintenance). In the emulator we allow any caller so the
// e2e suite can exercise the logic without minting an admin token.
function assertAdmin(context: functions.https.CallableContext): void {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  if (!EMULATOR && !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
}

interface RunRef {
  ownerUid: string;
  gameId: string;
  runId: string;
}

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

  // 1) Delete the live GPS ping docs (teamLocations subcollection). This can run
  //    to thousands of docs, so it must be deleted in batch-sized chunks.
  const locSnap = await db.collection(`${runPath}/teamLocations`).get();
  const locationsDeleted = await deleteDocsInChunks(locSnap.docs.map((d) => d.ref));

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


// ─── Scheduled daily sweep ──────────────────────────────────────────────────
export const pruneExpiredRunData = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('Asia/Jerusalem')
  .onRun(async () => {
    const results = await sweepExpiredRuns();
    functions.logger.info(`pruneExpiredRunData: pruned ${results.length} run(s)`, { results });
    return null;
  });


// ─── On-demand admin callables (testable) ─────────────────────────────────────
export const pruneExpiredRunDataNow = loggedCallable('pruneExpiredRunDataNow', async (_data, context) => {
  assertAdmin(context);
  const results = await sweepExpiredRuns();
  return { ok: true, prunedCount: results.length, results };
});

export const pruneRunNow = loggedCallable('pruneRunNow', async (data, context) => {
  assertAdmin(context);
  const { ownerUid, gameId, runId } = data as RunRef;
  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }
  const result = await pruneRunPII({ ownerUid, gameId, runId });
  return { ok: true, ...result };
});
