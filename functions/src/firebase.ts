import * as admin from 'firebase-admin';
import { createDocCachePolicy } from '@rushpoint/shared';
import { wrapFirestore } from './docCache';

if (!admin.apps.length) {
  admin.initializeApp();
}

const rawDb = admin.firestore();
// Optional fields (e.g. a gold slot with no taskTitle) must not crash writes.
// Firestore rejects `undefined` in documents/arrays unless told to ignore it.
// Applied to the RAW handle — settings() must reach the real Firestore instance.
rawDb.settings({ ignoreUndefinedProperties: true });

/**
 * The process-wide cache policy (change: vps-firestore-read-offload).
 *
 * Bounds chosen against the workload that caused the 2026-08-26 outage: a 29-team run holds
 * ~30 team documents plus its run and game documents, so a few thousand entries covers many
 * concurrent runs comfortably while staying small in memory.
 *
 * The TTL is a SAFETY NET, not the coherence mechanism — coherence comes from write
 * invalidation. It only bounds how long an entry could survive if a write ever reached
 * Firestore without passing through the interceptor. 30s is far longer than the 5s Run
 * Console poll and the 12s participant poll, so it costs almost no hit rate.
 */
export const docCachePolicy = createDocCachePolicy({
  maxEntries: 20_000,
  ttlMs: 30_000,
  // OPT-IN, and off by default. Serving reads from memory is only correct where ONE process
  // is the sole writer. That is true of the VPS API container (functions/server.js, a single
  // Express process) and is set there via RUSHPOINT_DOC_CACHE=1 in docker-compose.api.yml.
  // It is NOT true under the Firebase Functions emulator, which runs a RuntimeWorkerPool of
  // separate Node processes, nor on real Cloud Functions, which auto-scales to many
  // instances — in both, one process's write cannot invalidate another's copy. Defaulting
  // off means a wrong topology costs a speed-up rather than corrupting a live game.
  enabled: process.env.RUSHPOINT_DOC_CACHE === '1',
});

/**
 * The Firestore handle every module imports. Writes route through `docCachePolicy` so a
 * cached document is dropped the moment the server changes it; reads are untouched here and
 * are cached explicitly at chosen call sites via `cachedGetDoc` / `cachedGetCollection`.
 *
 * See functions/src/docCache.ts for the sole-writer + single-process precondition this rests
 * on. `scripts/test-doc-cache-interception.ts` fails the build if a module reaches around it.
 */
export const db = wrapFirestore(rawDb, docCachePolicy);

export const auth = admin.auth();
export const storage = admin.storage();
