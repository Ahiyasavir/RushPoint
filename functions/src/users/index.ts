// ─── Account management callables ─────────────────────────────────────────────
//
// User-facing control over their own RushPoint account:
//   • updateMyProfile — rename (syncs Auth, the profile doc, and gallery denorm)
//   • exportMyData    — a full JSON export of everything we hold (privacy law:
//                       data portability / right of access)
//   • deleteMyAccount — irreversible cascade delete of ALL the user's data plus
//                       the Auth identity (privacy law: right to erasure)
//
// These honour the promises made in our Privacy Policy (access, correction,
// portability, deletion). Every callable acts ONLY on the caller's own uid.

import * as functions from 'firebase-functions';
import { loggedCallable, logBestEffort } from '../obs/log';
import { db, auth } from '../firebase';
import { deleteRunsPhotos, deleteGameMedia } from '../storageUtil';
import { deleteDocsInChunks } from '../batchUtil';
import { isGameDeleted, type Game, type Wallet } from '@rushpoint/shared';

import { requireAuth } from '../auth';


// ─── updateMyProfile ────────────────────────────────────────────────────────
// Renames the creator. Updates the Auth record, the users/{uid} profile doc,
// and the denormalized ownerDisplayName carried on every public gallery entry
// so the gallery doesn't show a stale name.

export const updateMyProfile = loggedCallable('updateMyProfile', async (data, context) => {
  const uid = requireAuth(context);
  const { displayName } = data as { displayName: string };

  const name = (displayName ?? '').trim();
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'displayName required');
  if (name.length > 80) throw new functions.https.HttpsError('invalid-argument', 'displayName too long');

  const now = new Date().toISOString();

  // 1) Auth profile (so future tokens + getUser carry the new name)
  await auth.updateUser(uid, { displayName: name });

  // 2) Profile doc
  await db.doc(`users/${uid}`).set({ displayName: name, updatedAt: now }, { merge: true });

  // 3) Gallery denormalization (best-effort, batched)
  const [pubGames, pubTasks] = await Promise.all([
    db.collection('publicGames').where('ownerUid', '==', uid).get(),
    db.collection('publicTasks').where('ownerUid', '==', uid).get(),
  ]);
  if (!pubGames.empty || !pubTasks.empty) {
    const batch = db.batch();
    for (const d of pubGames.docs) batch.update(d.ref, { ownerDisplayName: name });
    for (const d of pubTasks.docs) batch.update(d.ref, { ownerDisplayName: name });
    await batch.commit().catch((e) => logBestEffort('profile.galleryDenorm.commit', { uid }, e));
  }

  return { ok: true, displayName: name };
});


// ─── exportMyData ─────────────────────────────────────────────────────────────
// Returns a structured snapshot of everything we hold about the caller, for the
// "right of access" / data-portability obligation. The client offers it as a
// downloadable JSON file.

export const exportMyData = loggedCallable('exportMyData', async (_data, context) => {
  const uid = requireAuth(context);

  const [authUser, profileSnap, gamesSnap, walletSnap, txSnap] = await Promise.all([
    auth.getUser(uid).catch((e) => { logBestEffort('auth.getUser', { uid }, e); return null; }),
    db.doc(`users/${uid}`).get(),
    db.collection(`users/${uid}/games`).get(),
    db.doc(`wallets/${uid}`).get(),
    db.collection(`wallets/${uid}/transactions`).orderBy('createdAt', 'desc').get().catch((e) => { logBestEffort('wallet.transactions.get', { uid }, e); return null; }),
  ]);

  // Per-game run summaries (counts only — full team data can be very large).
  const games = await Promise.all(
    gamesSnap.docs.map(async (g) => {
      const game = g.data() as Game;
      const runsSnap = await db.collection(`users/${uid}/games/${g.id}/runs`).get().catch((e) => { logBestEffort('runs.get', { uid, gameId: g.id }, e); return null; });
      return {
        ...game,
        runCount: runsSnap?.size ?? 0,
        // Trashed games are DELIBERATELY included (change: recoverable-game-deletion).
        // A right-of-access export must describe the data we actually still hold;
        // silently omitting a soft-deleted game would make the export a false
        // statement. Flagged so the creator can see which ones are in the trash.
        deleted: isGameDeleted(game),
      };
    }),
  );

  return {
    exportedAt: new Date().toISOString(),
    account: {
      uid,
      email: authUser?.email ?? null,
      displayName: authUser?.displayName ?? null,
      createdAt: authUser?.metadata.creationTime ?? null,
      lastSignIn: authUser?.metadata.lastSignInTime ?? null,
      providers: authUser?.providerData.map((p) => p.providerId) ?? [],
    },
    profile: profileSnap.exists ? profileSnap.data() : null,
    games,
    wallet: walletSnap.exists ? (walletSnap.data() as Wallet) : null,
    transactions: txSnap ? txSnap.docs.map((d) => d.data()) : [],
  };
});


// ─── deleteMyAccount ──────────────────────────────────────────────────────────
// IRREVERSIBLE. Removes every trace of the caller:
//   • public gallery entries (publicGames + publicTasks)
//   • access codes pointing at the user's runs
//   • the wallet + its transaction ledger
//   • the user tree (users/{uid} → games → runs → teams …) via recursiveDelete
//   • the Firebase Auth identity (last, so a failure mid-way is retry-safe)

export const deleteMyAccount = loggedCallable('deleteMyAccount', async (data, context) => {
  const uid = requireAuth(context);
  const { confirm } = data as { confirm?: boolean };
  if (confirm !== true) {
    throw new functions.https.HttpsError('failed-precondition', 'confirm flag required');
  }

  // 1) Public gallery denorm + access codes (queries across top-level collections)
  const [pubGames, pubTasks, codes] = await Promise.all([
    db.collection('publicGames').where('ownerUid', '==', uid).get(),
    db.collection('publicTasks').where('ownerUid', '==', uid).get(),
    db.collection('accessCodes').where('ownerUid', '==', uid).get(),
  ]);
  // Chunked so a prolific creator with >500 combined gallery entries + codes
  // can't blow the per-batch cap and silently orphan right-to-erasure data.
  await deleteDocsInChunks(
    [...pubGames.docs, ...pubTasks.docs, ...codes.docs].map((d) => d.ref),
  ).catch((e) => logBestEffort('account.galleryCodes.delete', { uid }, e));

  // 2) Purge uploaded photos for every run the user owns, BEFORE the Firestore
  // tree (which holds the runIds) is deleted. Otherwise they orphan in Storage.
  const gamesSnap = await db.collection(`users/${uid}/games`).get();
  const runIds: string[] = [];
  for (const g of gamesSnap.docs) {
    const runs = await db.collection(`users/${uid}/games/${g.id}/runs`).get();
    for (const r of runs.docs) runIds.push(r.id);
  }
  await deleteRunsPhotos(runIds);
  // Creator-authored task media lives under gameMedia/{uid}/… — purge the whole
  // tree (right to erasure), not just run photos.
  await deleteGameMedia(uid);

  // 3) Wallet + transactions, then the whole user tree (games → runs → teams).
  await db.recursiveDelete(db.doc(`wallets/${uid}`)).catch((e) => logBestEffort('wallet.recursiveDelete', { uid }, e));
  await db.recursiveDelete(db.doc(`users/${uid}`));

  // 3b) Admin-side records ABOUT this person, which live OUTSIDE users/{uid} and so are
  // not swept by the recursiveDelete above (changes: admin-engagement-and-outreach,
  // admin-user-notes):
  //   • userEngagement/{uid} — their measured time on site
  //   • userNotes/{uid}      — free text an operator wrote about them
  // Both are personal data and both must go, or erasure would leave a named record of
  // someone who asked to be forgotten. They are separate top level collections precisely
  // because clients must not be able to write them, which is exactly what makes it easy
  // to forget them here — so they are deleted explicitly and named in the comment above
  // the callable. Best effort: a missing document is the normal case.
  await Promise.all([
    db.doc(`userEngagement/${uid}`).delete().catch((e) => logBestEffort('userEngagement.delete', { uid }, e)),
    db.doc(`userNotes/${uid}`).delete().catch((e) => logBestEffort('userNotes.delete', { uid }, e)),
  ]);

  // 4) The Auth identity itself — done last so data is gone before the login is.
  await auth.deleteUser(uid).catch((e) => {
    // If the auth record is already gone, treat as success; otherwise surface it.
    if ((e as { code?: string })?.code !== 'auth/user-not-found') throw e;
  });

  return { ok: true };
});
