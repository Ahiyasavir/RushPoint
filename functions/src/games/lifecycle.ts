// Tombstone guard for every path that can surface a game
// (change: recoverable-game-deletion).
//
// deleteGame no longer destroys anything: it writes a `deletedAt` tombstone and
// the game is expected to vanish from EVERY surface until it is restored or the
// grace period elapses. That only holds if each read path refuses a tombstoned
// game, so the refusal lives in exactly one place here and
// scripts/test-game-tombstone-readpaths.ts statically proves each caller uses it.
//
// The error is always `not-found` — the SAME code a game that never existed
// produces. A distinct code (e.g. `failed-precondition: deleted`) would let any
// caller, including an unauthenticated join attempt, probe which game ids once
// existed under which creator.

import * as functions from 'firebase-functions';
import { db } from '../firebase';
import { FIRESTORE_PATHS, isGameDeleted, type Game } from '@rushpoint/shared';

/** Refuse a tombstoned game. Safe to call with any loaded game document. */
export function assertGameNotDeleted(game: Pick<Game, 'deletedAt'> | undefined | null): void {
  if (isGameDeleted(game)) {
    throw new functions.https.HttpsError('not-found', 'Game not found');
  }
}

/**
 * Load a game the caller owns and that is NOT in the trash. The four checks that
 * every owner-scoped game callable needs, in one place: exists, owned, live, typed.
 */
export async function loadOwnedLiveGame(ownerUid: string, gameId: string): Promise<Game> {
  const snap = await db.doc(FIRESTORE_PATHS.game(ownerUid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  assertGameNotDeleted(game);
  return game;
}

/**
 * Load a game the caller owns that IS in the trash (restore / permanent delete).
 * A game that is not tombstoned is `failed-precondition`, never a silent hard
 * delete: purgeGameNow must never become a one-call destroy and re-create the
 * defect this change exists to fix.
 */
export async function loadOwnedTrashedGame(ownerUid: string, gameId: string): Promise<Game> {
  const snap = await db.doc(FIRESTORE_PATHS.game(ownerUid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  if (!isGameDeleted(game)) {
    throw new functions.https.HttpsError('failed-precondition', 'Game is not in the trash');
  }
  return game;
}
