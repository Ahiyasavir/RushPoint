// A guest's games survive signing in to an account they already had (change: creator-stays-to-the-end).
// Registering links a credential onto the anonymous user, so the uid and the games stay. An EXISTING
// account is a different uid, and the sign-in form is only reachable by signing the guest out, so the
// games were left under a uid nobody could reach again. The sheet even said so.
//
// Two steps, because the two identities never exist in one session: while still the guest, the phone
// asks for a claim code; once signed in, it spends the code. The code is the proof that the caller held
// the guest, the same shape as a share link: its document id is the credential, closed to clients.
// It lives 7 days so a forgotten password does not cost the game.
import * as functions from 'firebase-functions';
import { randomBytes } from 'node:crypto';
import { loggedCallable } from '../obs/log';
import { db } from '../firebase';
import { requireAuth } from '../auth';
import { enforceRateLimit } from '../rateLimitStore';
import { chunk } from '../batchUtil';
import { rehostGameMedia } from '../games/rehost';
import type { Game } from '@rushpoint/shared';

const CLAIM_MS = 7 * 86_400_000;
const CODE = /^[A-Za-z0-9_-]{32}$/;

const isAnonymous = (context: functions.https.CallableContext) =>
  context.auth?.token?.firebase?.sign_in_provider === 'anonymous';

export const createGuestClaim = loggedCallable('createGuestClaim', async (_data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'createGuestClaim');
  if (!isAnonymous(context)) throw new functions.https.HttpsError('failed-precondition', 'guest only');
  const code = randomBytes(24).toString('base64url');
  const now = Date.now();
  await db.doc(`guestClaims/${code}`).set({
    guestUid: uid, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + CLAIM_MS).toISOString(),
  });
  return { code };
});

export const claimGuestGames = loggedCallable('claimGuestGames', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'claimGuestGames');
  if (isAnonymous(context)) throw new functions.https.HttpsError('failed-precondition', 'account only');
  const code = (data as { code?: unknown })?.code;
  if (typeof code !== 'string' || !CODE.test(code)) throw new functions.https.HttpsError('invalid-argument', 'bad code');

  // Taken in a transaction, so one code can never hand the same games to two accounts. The same account
  // may spend it again: that is how a move cut off half way finishes.
  const claimRef = db.doc(`guestClaims/${code}`);
  const guestUid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimRef);
    const claim = snap.data() as { guestUid: string; expiresAt: string; claimedBy?: string } | undefined;
    if (!claim) throw new functions.https.HttpsError('not-found', 'unknown code');
    if (claim.claimedBy && claim.claimedBy !== uid) throw new functions.https.HttpsError('permission-denied', 'already claimed');
    if (!claim.claimedBy && Date.parse(claim.expiresAt) < Date.now()) throw new functions.https.HttpsError('deadline-exceeded', 'expired');
    tx.update(claimRef, { claimedBy: uid, claimedAt: new Date().toISOString() });
    return claim.guestUid;
  });

  const now = new Date().toISOString();
  const games = await db.collection(`users/${guestUid}/games`).get();
  const moved: string[] = [];
  // The id is kept, so a link to the game and the page the creator stands on still work. Copied before the
  // source goes, in one batch per game, so a failure leaves the game in one place and never in none.
  // A guest cannot launch (accountGateFor), so there is no run under a guest's game to carry.
  for (const doc of games.docs) {
    const game = doc.data() as Game;
    if (game.deletedAt) continue;
    const stages = await rehostGameMedia(game.stages, guestUid, doc.id, uid, doc.id);
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}/games/${doc.id}`), { ...game, ...(stages ? { stages } : {}), ownerUid: uid, updatedAt: now });
    batch.delete(doc.ref);
    await batch.commit();
    moved.push(doc.id);
  }

  // A link the guest already sent to friends keeps working.
  const links = await db.collection('gameShareLinks').where('ownerUid', '==', guestUid).get();
  for (const part of chunk(links.docs, 450)) {
    const batch = db.batch();
    for (const d of part) batch.update(d.ref, { ownerUid: uid });
    await batch.commit();
  }
  return { moved };
});
