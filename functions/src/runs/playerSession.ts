/**
 * change: signup-quota-fallback. Firebase Auth creates at most 100 accounts an hour from one IP
 * address (firebase.google.com/docs/auth/limits). Every phone that opens the player link signs in
 * anonymously, which is one new account, and at an event on the venue WiFi every phone leaves from the
 * same address: the 101st phone in the hour was refused and could not join. When that happens the
 * phone calls this instead. The API creates the account with the Admin SDK and returns a custom token
 * (claim `player`), the same way staff already sign in; from there everything is identical
 * (uid == teamId, the same join callables, the same recovery).
 *
 * PUBLIC by necessity: the caller is exactly a phone that could not sign in. What authentication would
 * carry is carried by the join code (it must resolve to a run that is live, not revoked, not trashed),
 * a budget keyed on the CONNECTION and never on the payload, and a budget per run, so a leaked code
 * can mint at most a bounded number of empty accounts.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FIRESTORE_PATHS, normalizeAccessCode, type AccessCode, type Game, type Run } from '@rushpoint/shared';
import { db } from '../firebase';
import { loggedCallable } from '../obs/log';
import { enforceRateLimit } from '../rateLimitStore';
import { assertGameNotDeleted } from '../games/lifecycle';

export const PLAYER_SESSION_CONNECTION_BUCKET = 'startPlayerSession';
export const PLAYER_SESSION_RUN_BUCKET = 'startPlayerSessionRun';

/** The rate key for this unauthenticated path: the connection, never anything the caller sends. */
export function playerSessionRateKey(context: functions.https.CallableContext): string {
  const raw = context.rawRequest as { ip?: string; headers?: Record<string, unknown> } | undefined;
  const forwarded = raw?.headers?.['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
  const ip = first || raw?.ip;
  return `playerSession:${ip && ip.length > 0 ? ip : 'unknown'}`;
}

export const startPlayerSession = loggedCallable('startPlayerSession', async (data, context) => {
  await enforceRateLimit(playerSessionRateKey(context), PLAYER_SESSION_CONNECTION_BUCKET);
  const raw = (data ?? {}) as { code?: unknown };
  if (typeof raw.code !== 'string' || !raw.code.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'code required');
  }
  let code: string;
  try { code = normalizeAccessCode(raw.code); } catch { throw new functions.https.HttpsError('invalid-argument', 'Invalid access code'); }

  const codeSnap = await db.doc(`accessCodes/${code}`).get();
  if (!codeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  const c = codeSnap.data() as AccessCode;
  if (c.status === 'revoked') throw new functions.https.HttpsError('permission-denied', 'Code revoked');
  const [gameSnap, runSnap] = await Promise.all([
    db.doc(FIRESTORE_PATHS.game(c.ownerUid, c.gameId)).get(),
    db.doc(FIRESTORE_PATHS.run(c.ownerUid, c.gameId, c.runId)).get(),
  ]);
  if (!gameSnap.exists || !runSnap.exists) throw new functions.https.HttpsError('not-found', 'Invalid access code');
  assertGameNotDeleted(gameSnap.data() as Game);
  if ((runSnap.data() as Run).status === 'finished') {
    throw new functions.https.HttpsError('failed-precondition', 'This race has already finished.');
  }
  await enforceRateLimit(`run:${c.runId}`, PLAYER_SESSION_RUN_BUCKET);

  const user = await admin.auth().createUser({});
  const token = await admin.auth().createCustomToken(user.uid, { player: true });
  functions.logger.info('playerSession.created', { runId: c.runId, uid: user.uid });
  return { token };
});
