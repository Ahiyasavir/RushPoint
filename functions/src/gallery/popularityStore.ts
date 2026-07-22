// The ONE writer of the public gallery's ranking signals (change: gallery-popularity-ranking).
//
// Firestore can only order by a STORED field, so `popularity` is denormalized onto
// publicGames/{id} and publicTasks/{id}. That makes it a derived value with a
// classic hazard: any code path that bumps a counter without recomputing the score
// leaves the ordering stale, and nothing errors — the gallery is just quietly
// wrong. So every signal change in the codebase funnels through bumpPublicSignals()
// and nowhere else.
//
// Why a TRANSACTION and not FieldValue.increment: increment is atomic for the
// counter, but `popularity` cannot be incremented — it has to be recomputed from
// the POST-increment counter, and a read-modify-write wrapped around an increment
// is exactly the lost update that produces a wrong order. Two concurrent launches
// would each read playCount 5, each write popularity(6), and the counter would land
// on 7 carrying a score for 6. Inside a transaction the read is re-run on
// contention, so counter and score commit together and are always consistent.
//
// (The repo's "never put a transaction in completeTask's hot path" rule does not
// apply here: these are gallery bumps — one per launch/copy/like — not per-answer
// traffic.)

import { FIRESTORE_PATHS, popularityScore, type PublicLikeKind } from '@rushpoint/shared';
import { db } from '../firebase';

/** The usage counter each public collection ranks on. */
const USE_FIELD: Record<PublicLikeKind, 'playCount' | 'copyCount'> = {
  game: 'playCount',
  task: 'copyCount',
};

export function publicItemPath(kind: PublicLikeKind, itemId: string): string {
  return kind === 'game' ? FIRESTORE_PATHS.publicGame(itemId) : FIRESTORE_PATHS.publicTask(itemId);
}

/**
 * Recompute the stored score from a document's own counters. Used both by the
 * incremental bump below and by publishGame when it (re)writes a gallery doc.
 */
export function scoreFor(
  kind: PublicLikeKind,
  data: { playCount?: number; copyCount?: number; likeCount?: number; createdAt?: string },
): number {
  return popularityScore({
    uses: data[USE_FIELD[kind]],
    likes: data.likeCount,
    createdAtMs: data.createdAt ? Date.parse(data.createdAt) : undefined,
  });
}

export interface SignalDelta {
  /** Launches/copies to add (may be negative). */
  uses?: number;
  /** Likes to add (may be negative). */
  likes?: number;
}

export interface SignalResult {
  /** False when the item has no public document (unpublished/deleted). */
  applied: boolean;
  uses: number;
  likes: number;
  popularity: number;
}

/**
 * Apply a signal delta to a public gallery document and recompute its stored
 * popularity in the SAME transaction. Counters are clamped at 0 so a stray
 * negative delta can never drive a public count below zero.
 *
 * No-ops (applied:false) when the document does not exist — an unpublished or
 * deleted item has nothing to rank, and inventing a stub here would put a blank
 * card in the gallery.
 */
export async function bumpPublicSignals(
  kind: PublicLikeKind,
  itemId: string,
  delta: SignalDelta,
): Promise<SignalResult> {
  const ref = db.doc(publicItemPath(kind, itemId));
  const useField = USE_FIELD[kind];

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { applied: false, uses: 0, likes: 0, popularity: 0 };
    const data = snap.data() ?? {};

    const uses = Math.max(0, (Number(data[useField]) || 0) + (delta.uses ?? 0));
    const likes = Math.max(0, (Number(data.likeCount) || 0) + (delta.likes ?? 0));
    const popularity = scoreFor(kind, { ...data, [useField]: uses, likeCount: likes } as never);

    // Flat top-level keys only. No dotted paths (a dotted key in .set({merge})
    // writes a LITERAL "a.b" field) and no array element is ever touched.
    tx.update(ref, { [useField]: uses, likeCount: likes, popularity });
    return { applied: true, uses, likes, popularity };
  });
}
