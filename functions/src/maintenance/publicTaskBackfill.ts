// ─── Backfill: strip exact coordinates from legacy publicTasks documents ──────
//
// `task-library-map-view` fixed the WRITE (publishGame no longer copies the
// authored point into the world-readable `publicTasks/{id}`). It did nothing for
// documents already stored. Those still carry the exact coordinate of every
// published task — hideLocation tasks included — in a collection whose rule is
// `allow read: if true`. This sweep is the other half of that change.
//
// The decision rule is pure and lives in @rushpoint/shared (`repairPublicTask`);
// everything here is I/O: page the collection, resolve each document's authored
// task, apply the rule, write.
//
// SCAN, DON'T QUERY. There is no "field exists" filter in Firestore, and the
// `orderBy(field)` trick that approximates one would need a dedicated index for
// a job that runs a handful of times, ever. Paging by document id and filtering
// in memory costs one read per public task and needs no index — and it means the
// sweep also sees documents whose `coordinates` value is malformed.

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { db } from '../firebase';
import { chunk, MAX_BATCH_OPS } from '../batchUtil';
import {
  FIRESTORE_PATHS,
  repairPublicTask,
  hasLegacyCoordinates,
  type Game,
  type BackfillSourceTask,
} from '@rushpoint/shared';

export interface BackfillResult {
  scanned: number;
  repaired: number;
  /** Of the repaired docs, how many ended up with NO published location. */
  cleared: number;
  /** Docs whose owning game/task could not be resolved (repaired fail-closed). */
  orphaned: number;
  /** Last document id examined — pass back as `startAfter` to continue. */
  cursor: string | null;
  /** False when the page filled the limit, i.e. there may be more to do. */
  done: boolean;
}

const DEFAULT_LIMIT = 500;

/** Field-removal sentinel. Deleting beats writing null: a null would still be a
 *  stored field, and `repairPublicTask` treats a present key as legacy. */
const DELETE = admin.firestore.FieldValue.delete();

/** Every task of a game, flattened, keyed by task id. */
function tasksOf(game: Game | undefined): Map<string, BackfillSourceTask> {
  const out = new Map<string, BackfillSourceTask>();
  for (const stage of game?.stages ?? []) {
    for (const task of stage.tasks ?? []) out.set(task.id, task as BackfillSourceTask);
  }
  return out;
}

/**
 * One page of the sweep. Idempotent: a conformant document is skipped, and a
 * repaired document becomes conformant, so re-running repairs nothing.
 *
 * Games are read once each and cached for the page — a game with 30 published
 * tasks costs one game read, not thirty.
 */
export async function backfillPublicTaskCoordinates(opts: {
  limit?: number;
  startAfter?: string | null;
  dryRun?: boolean;
} = {}): Promise<BackfillResult> {
  const limit = Math.min(Math.max(Number(opts.limit) || DEFAULT_LIMIT, 1), 1000);
  const dryRun = opts.dryRun === true;

  let q = db.collection('publicTasks').orderBy('__name__').limit(limit);
  if (opts.startAfter) q = q.startAfter(opts.startAfter);
  const snap = await q.get();

  // ownerUid/gameId → its authored tasks. A game that does not exist caches an
  // EMPTY map, which is what makes every one of its tasks resolve to "not found"
  // and take the fail-closed branch, at the cost of a single read.
  const gameCache = new Map<string, Map<string, BackfillSourceTask>>();
  // Writes are accumulated and committed in ≤MAX_BATCH_OPS chunks below. They are
  // NOT put on one batch: a WriteBatch is hard-capped at 500 ops, and `limit`
  // clamps to 1000 — so a page with >500 repairs would throw on commit and, being
  // atomic, would repair NOTHING while returning no cursor to advance past it.
  const writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  let repaired = 0, cleared = 0, orphaned = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as {
      coordinates?: { lat?: unknown; lng?: unknown };
      approxLocation?: { lat?: unknown; lng?: unknown };
      ownerUid?: string;
      sourceGameId?: string;
    };
    // Cheap pre-check before spending a game read: only legacy docs need work.
    if (!hasLegacyCoordinates(data)) continue;

    let source: BackfillSourceTask | null = null;
    if (data.ownerUid && data.sourceGameId) {
      const key = `${data.ownerUid}/${data.sourceGameId}`;
      let tasks = gameCache.get(key);
      if (!tasks) {
        // A transient read failure must NOT abort the page: without this catch a
        // single DEADLINE_EXCEEDED discards every repair accumulated so far and
        // returns no cursor, so re-running hits the same documents and the sweep
        // wedges forever on one unreadable game. Degrade to the module's declared
        // stance instead — unresolvable source ⇒ fail closed, strip the point.
        let game: Game | undefined;
        try {
          const gameSnap = await db.doc(FIRESTORE_PATHS.game(data.ownerUid, data.sourceGameId)).get();
          game = gameSnap.exists ? (gameSnap.data() as Game) : undefined;
        } catch (err) {
          functions.logger.warn('backfill: game read failed, failing closed', {
            ownerUid: data.ownerUid, gameId: data.sourceGameId, err: String(err),
          });
        }
        tasks = tasksOf(game);
        gameCache.set(key, tasks);
      }
      // The public id is `${gameId}_${taskId}` — recover the task id by removing
      // the prefix rather than splitting on '_', which a task id may contain.
      const taskId = doc.id.startsWith(`${data.sourceGameId}_`)
        ? doc.id.slice(data.sourceGameId.length + 1)
        : doc.id;
      source = tasks.get(taskId) ?? null;
    }
    if (!source) orphaned++;

    const repair = repairPublicTask(data, source);
    if (!repair) continue; // unreachable given the pre-check; kept as a guard.
    repaired++;
    if (!repair.approxLocation) cleared++;

    if (!dryRun) {
      // `set({merge:true})`, not `update()`. update() requires the document to
      // still exist, and publicTasks rows are deleted concurrently by
      // publishGame(private), removeGalleryIndex on soft-delete and
      // deleteMyAccount. A creator unpublishing between this page's read and its
      // commit would fail the whole atomic batch NOT_FOUND and lose every other
      // repair in it. merge tolerates the race; the delete sentinels behave the
      // same either way, and a recreated doc gets the same correct end state.
      writes.push({
        ref: doc.ref,
        data: { coordinates: DELETE, approxLocation: repair.approxLocation ?? DELETE },
      });
    }
  }

  for (const group of chunk(writes, MAX_BATCH_OPS)) {
    const batch = db.batch();
    for (const w of group) batch.set(w.ref, w.data, { merge: true });
    await batch.commit();
  }

  const last = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;
  return {
    scanned: snap.size,
    repaired,
    cleared,
    orphaned,
    cursor: last,
    done: snap.size < limit,
  };
}
