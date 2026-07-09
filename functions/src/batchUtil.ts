// Firestore batched-write helpers. A single WriteBatch is capped at 500 ops, so
// any delete/sweep over an unbounded subcollection (e.g. a run's teamLocations
// GPS pings, which can number in the thousands) MUST be split — otherwise the
// commit throws and the whole operation aborts. `chunk` is pure (unit-tested);
// `deleteDocsInChunks` is the I/O wrapper used by the retention prune + cascades.
import { db } from './firebase';
import type { firestore } from 'firebase-admin';

/** Firestore hard-caps a WriteBatch at 500 ops; leave margin for safety. */
export const MAX_BATCH_OPS = 450;

/** Split `items` into ordered groups of at most `size`. Pure. Throws if size < 1. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Delete every doc ref, committing in ≤MAX_BATCH_OPS batches so the operation
 * never exceeds Firestore's per-batch limit. Returns the number deleted.
 */
export async function deleteDocsInChunks(refs: firestore.DocumentReference[]): Promise<number> {
  for (const group of chunk(refs, MAX_BATCH_OPS)) {
    const batch = db.batch();
    for (const ref of group) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}
