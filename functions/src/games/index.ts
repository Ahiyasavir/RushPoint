// ─── Game CRUD callables ──────────────────────────────────────────────────────
//
// All callables require the caller to be authenticated (Firebase Auth).
// Ownership is enforced: only the creator (ownerUid === context.auth.uid)
// may update/delete their own games.

import * as functions from 'firebase-functions';
import { db } from '../firebase';
import * as admin from 'firebase-admin';
import {
  type Game,
  type Stage,
  type Task,
  type CreateGamePayload,
  type UpdateGamePayload,
  type PublicGame,
  type PublicTask,
  DEFAULT_REGISTRATION_FIELDS,
  DEFAULT_SCORING_PRESET,
  describeGameRequirements,
} from '@rushpoint/shared';
import { deleteRunsPhotos } from '../storageUtil';

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

function gamesCol(uid: string) {
  return `users/${uid}/games`;
}
function gamePath(uid: string, gameId: string) {
  return `users/${uid}/games/${gameId}`;
}

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  return context.auth.uid;
}

// ─── createGame ───────────────────────────────────────────────────────────────

export const createGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { title, description, mode = 'individual', tags = [] } = data as CreateGamePayload;

  if (!title?.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'title is required');
  }

  const now = new Date().toISOString();
  const ref = db.collection(gamesCol(uid)).doc();

  const game: Game = {
    id: ref.id,
    ownerUid: uid,
    title: title.trim(),
    description: description?.trim(),
    mode,
    stages: [],
    scoringPreset: DEFAULT_SCORING_PRESET,
    registrationFields: DEFAULT_REGISTRATION_FIELDS,
    visibility: 'private',
    tags,
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(game);
  return { gameId: ref.id };
});


// ─── updateGame ───────────────────────────────────────────────────────────────

export const updateGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const {
    gameId,
    title, description, mode, stages, scoringPreset, scoringOptions,
    registrationFields, branding, tags, coverImage, approxLocation,
    requiresGuardianConsent, minAge,
  } = data as UpdateGamePayload;

  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if ((snap.data() as Game).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }

  const updates: Partial<Game> & { updatedAt: string } = { updatedAt: new Date().toISOString() };
  if (title !== undefined)              updates.title = title.trim();
  if (description !== undefined)        updates.description = description?.trim();
  if (mode !== undefined)               updates.mode = mode;
  if (stages !== undefined)             updates.stages = stages;
  if (scoringPreset !== undefined)      updates.scoringPreset = scoringPreset;
  if (scoringOptions !== undefined)     updates.scoringOptions = scoringOptions;
  if (registrationFields !== undefined) updates.registrationFields = registrationFields;
  if (branding !== undefined)           updates.branding = branding;
  if (tags !== undefined)               updates.tags = tags;
  if (coverImage !== undefined)         updates.coverImage = coverImage;
  if (approxLocation !== undefined)     updates.approxLocation = approxLocation;
  if (requiresGuardianConsent !== undefined) updates.requiresGuardianConsent = requiresGuardianConsent;
  if (minAge !== undefined)             updates.minAge = minAge;

  await ref.update(updates);
  return { ok: true };
});


// ─── deleteGame ───────────────────────────────────────────────────────────────

export const deleteGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if ((snap.data() as Game).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }

  // Remove the public index if the game was public
  const game = snap.data() as Game;
  if (game.visibility === 'public') {
    await db.doc(`publicGames/${gameId}`).delete().catch(() => undefined);
    // Remove public tasks from this game
    const publicTasksSnap = await db.collection('publicTasks')
      .where('sourceGameId', '==', gameId).get();
    const batch = db.batch();
    for (const d of publicTasksSnap.docs) batch.delete(d.ref);
    if (!publicTasksSnap.empty) await batch.commit();
  }

  // Purge uploaded photos for every run of this game, then recursively delete
  // the game and all its subcollections (runs → teams → locations …). A plain
  // doc delete would orphan those subcollections in Firestore.
  const runsSnap = await db.collection(`${gamePath(uid, gameId)}/runs`).get();
  await deleteRunsPhotos(runsSnap.docs.map((d) => d.id));

  await db.recursiveDelete(ref);
  return { ok: true };
});


// ─── duplicateGame ────────────────────────────────────────────────────────────

export const duplicateGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, sourceOwnerUid } = data as { gameId: string; sourceOwnerUid?: string };

  // Can duplicate own private games OR any public game by any creator
  const ownerUid = sourceOwnerUid ?? uid;
  const sourceRef = db.doc(gamePath(ownerUid, gameId));
  const sourceSnap = await sourceRef.get();

  if (!sourceSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const sourceGame = sourceSnap.data() as Game;

  // Enforce: can only copy public games from other creators
  if (ownerUid !== uid && sourceGame.visibility !== 'public') {
    throw new functions.https.HttpsError('permission-denied', 'Game is not public');
  }

  const now = new Date().toISOString();
  const newRef = db.collection(gamesCol(uid)).doc();
  const copy: Game = {
    ...sourceGame,
    id: newRef.id,
    ownerUid: uid,
    title: `${sourceGame.title} (copy)`,
    visibility: 'private',
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await newRef.set(copy);

  // Increment original's playCount (best-effort)
  if (ownerUid !== uid) {
    sourceRef.update({ playCount: admin.firestore.FieldValue.increment(1) }).catch(() => undefined);
    db.doc(`publicGames/${gameId}`).update({ playCount: admin.firestore.FieldValue.increment(1) }).catch(() => undefined);
  }

  return { gameId: newRef.id };
});


// ─── publishGame ─────────────────────────────────────────────────────────────
// Toggles game visibility and syncs/removes the publicGames + publicTasks index.

export const publishGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, visibility } = data as { gameId: string; visibility: 'public' | 'private' };

  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');
  if (visibility !== 'public' && visibility !== 'private') {
    throw new functions.https.HttpsError('invalid-argument', 'visibility must be "public" or "private"');
  }

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if ((snap.data() as Game).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }

  const game = snap.data() as Game;
  const now = new Date().toISOString();

  if (visibility === 'public') {
    // Compute summary stats
    const allTasks = game.stages.flatMap((s) => s.tasks);
    const estimatedTotalMinutes = allTasks.reduce((s, t) => s + t.estimatedMinutes, 0);

    // Get creator display name
    const creatorSnap = await admin.auth().getUser(uid).catch(() => null);
    const ownerDisplayName = creatorSnap?.displayName ?? undefined;

    const publicGame: PublicGame = {
      id: gameId,
      ownerUid: uid,
      ownerDisplayName,
      title: game.title,
      description: game.description,
      mode: game.mode,
      scoringPreset: game.scoringPreset,
      tags: game.tags,
      coverImage: game.coverImage,
      approxLocation: game.approxLocation,
      playCount: game.playCount,
      stageCount: game.stages.length,
      taskCount: allTasks.length,
      estimatedTotalMinutes,
      // Accurate GPS requirement derived from task trigger modes at publish time,
      // so the welcome screen never trusts free-text "no GPS" claims in copy.
      requirement: describeGameRequirements(game),
      createdAt: game.createdAt,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.doc(`publicGames/${gameId}`), publicGame);

    // Index each task individually for the task library
    for (const task of allTasks) {
      const publicTaskRef = db.doc(`publicTasks/${gameId}_${task.id}`);
      const publicTask: PublicTask = {
        id: `${gameId}_${task.id}`,
        sourceGameId: gameId,
        sourceGameTitle: game.title,
        ownerUid: uid,
        ownerDisplayName,
        title: task.title,
        description: task.description,
        type: task.type,
        coordinates: task.coordinates,
        difficulty: task.difficulty,
        estimatedMinutes: task.estimatedMinutes,
        pointValue: task.pointValue,
        tags: task.tags,
        copyCount: 0,
        createdAt: now,
      };
      batch.set(publicTaskRef, publicTask);
    }
    await batch.commit();
  } else {
    // Remove from public index
    const batch = db.batch();
    batch.delete(db.doc(`publicGames/${gameId}`));
    const publicTasksSnap = await db.collection('publicTasks')
      .where('sourceGameId', '==', gameId).get();
    for (const d of publicTasksSnap.docs) batch.delete(d.ref);
    await batch.commit();
  }

  await ref.update({ visibility, updatedAt: now });
  return { ok: true, visibility };
});


// ─── getGame ──────────────────────────────────────────────────────────────────

export const getGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const snap = await db.doc(gamePath(uid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  return { game };
});


// ─── listGames ────────────────────────────────────────────────────────────────

export const listGames = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await db.collection(gamesCol(uid))
    .orderBy('updatedAt', 'desc')
    .get();
  const games = snap.docs.map((d) => d.data() as Game);
  return { games };
});
