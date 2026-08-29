/**
 * Share links for an UNPUBLISHED game (change: game-share-link).
 *
 * A creator wants to hand ONE person a URL that opens their game read-only —
 * every stage, every mission, the whole map — and lets that person take a copy,
 * without the game appearing in the public gallery. Publishing is the wrong lever
 * for that: it writes publicGames/publicTasks and exposes the game to everybody.
 *
 * ── The shape, and why ───────────────────────────────────────────────────────
 * `gameShareLinks/{token}` is top-level and keyed by an unguessable token, the
 * same design as `accessCodes/{CODE}`: the holder resolves owner + game FROM the
 * address, so the link can be sent to someone who is never told either. One game
 * may hold several links, so revoking the one sent to a person leaves the rest
 * alive. The collection is closed to clients in BOTH directions (firestore.rules)
 * — everything here goes through a callable.
 *
 * `getSharedGame` is the second unauthenticated callable on the platform (after
 * the marketing contact form), for the same reason: the recipient is by
 * definition someone who may not have an account, and demanding one would defeat
 * the point of sending them a link. What authentication would normally carry is
 * carried by a 128-bit token, a connection-keyed rate limit, and a projection
 * that copies fields out by name (packages/shared/src/sharedGameView.ts) rather
 * than stripping secrets out of the stored document.
 *
 * Taking a COPY does require an account — the copy has to land somewhere.
 */
import * as functions from 'firebase-functions';
import { randomBytes } from 'node:crypto';

import { db } from '../firebase';
import { requireAuth } from '../auth';
import { loggedCallable, logBestEffort } from '../obs/log';
import { auditBestEffort } from '../obs/audit';
import { enforceRateLimit } from '../rateLimitStore';
import { deleteDocsInChunks } from '../batchUtil';
import { launchRunCore } from '../runs/index';
import { createRunStaffInvite } from '../runs/staffInvite';
import { assertGameNotDeleted } from './lifecycle';
import {
  FIRESTORE_PATHS,
  isValidShareToken,
  shareLinkRefusal,
  shareLinkCopyRefusal,
  shareLinkLaunchRefusal,
  shareLinkExpiryIso,
  sanitizeGameForShare,
  SHARE_TOKEN_BYTES,
  type Game,
  type GameShareLink,
  type ShareLinkRefusal,
} from '@rushpoint/shared';

export const AUDIT_SHARE_LINK_CREATED = 'game_share_link_created';
export const AUDIT_SHARE_LINK_REVOKED = 'game_share_link_revoked';
export const AUDIT_SHARE_LINK_LAUNCH  = 'game_share_link_run_launched';

/** How many live links one game may hold. Bounded so the list stays reviewable. */
export const MAX_SHARE_LINKS_PER_GAME = 20;

function shareLinkPath(token: string): string {
  return FIRESTORE_PATHS.gameShareLink(token);
}

function newShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/**
 * Every refusal reads as `not-found` to the CALLER, whatever the real reason.
 * A holder of a dead link learns only that it does not work — never that the
 * game exists, nor whose it is. The reason is returned separately so the UI can
 * say "this link was turned off" when the SERVER is willing to say so, which it
 * is: the person already held the link.
 */
function refuseShareLink(reason: ShareLinkRefusal): never {
  throw new functions.https.HttpsError('not-found', `share-link:${reason}`);
}

/** Load the link document behind a token, or refuse. Never leaks why to a stranger. */
async function loadUsableLink(
  token: unknown,
  mode: 'read' | 'copy' | 'launch',
): Promise<{ link: GameShareLink; ref: FirebaseFirestore.DocumentReference }> {
  if (!isValidShareToken(token)) refuseShareLink('not-found');
  const ref = db.doc(shareLinkPath(token));
  const snap = await ref.get();
  const link = snap.exists ? (snap.data() as GameShareLink) : undefined;
  const now = new Date().toISOString();
  const refusal = mode === 'copy' ? shareLinkCopyRefusal(link, now)
    : mode === 'launch' ? shareLinkLaunchRefusal(link, now)
    : shareLinkRefusal(link, now);
  if (refusal) refuseShareLink(refusal);
  return { link: link as GameShareLink, ref };
}

/** The owner's own game, refusing a tombstoned one. Used by every owner-side callable. */
async function loadOwnGame(uid: string, gameId: unknown): Promise<Game> {
  if (typeof gameId !== 'string' || !gameId.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId required');
  }
  const snap = await db.doc(FIRESTORE_PATHS.game(uid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  assertGameNotDeleted(game);
  return game;
}

/**
 * The rate-limit key for the unauthenticated read path. Derived from the
 * CONNECTION, never from the payload: a key the caller supplies is a key the
 * caller can vary, which turns the limit off for exactly whoever is abusing it.
 * An unresolvable address shares one bucket — throttling harder, which is the
 * correct direction to fail here. (Same helper shape as the contact form's.)
 */
export function shareRateKeyFor(context: functions.https.CallableContext): string {
  const raw = context.rawRequest as { ip?: string; headers?: Record<string, unknown> } | undefined;
  const forwarded = raw?.headers?.['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
  const ip = first || raw?.ip;
  return `share:${ip && ip.length > 0 ? ip : 'unknown'}`;
}


// ─── createGameShareLink ──────────────────────────────────────────────────────

export const createGameShareLink = loggedCallable('createGameShareLink', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'createGameShareLink');

  const { gameId, allowCopy, revealAnswers, allowLaunch, expiresInDays } = (data ?? {}) as {
    gameId?: string; allowCopy?: boolean; revealAnswers?: boolean;
    allowLaunch?: boolean; expiresInDays?: number;
  };
  const game = await loadOwnGame(uid, gameId);

  // Bound the list rather than letting it grow forever: a creator who cannot see
  // their links cannot revoke them, and an unbounded list is unreadable.
  const existing = await db.collection(FIRESTORE_PATHS.gameShareLinksCol())
    .where('ownerUid', '==', uid)
    .where('gameId', '==', game.id)
    .get();
  const live = existing.docs.filter((d) => !shareLinkRefusal(d.data(), new Date().toISOString()));
  if (live.length >= MAX_SHARE_LINKS_PER_GAME) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `This game already has ${MAX_SHARE_LINKS_PER_GAME} active share links — revoke one first`,
    );
  }

  const now = new Date().toISOString();
  const token = newShareToken();
  const link: GameShareLink = {
    token,
    ownerUid: uid,
    gameId: game.id,
    createdAt: now,
    createdBy: uid,
    // Both default to the conservative answer. `!== false` would make a client
    // that omits the field opt IN, which is the wrong direction for a disclosure.
    allowCopy: allowCopy === true,
    revealAnswers: revealAnswers === true,
    // The only permission here that WRITES into the owner's account. Same
    // `=== true` posture as the others, and read back through
    // shareLinkLaunchRefusal, which refuses on absence rather than on falsity.
    allowLaunch: allowLaunch === true,
    viewCount: 0,
    copyCount: 0,
    launchCount: 0,
  };
  const expiresAt = shareLinkExpiryIso(now, expiresInDays);
  if (expiresAt) link.expiresAt = expiresAt;

  await db.doc(shareLinkPath(token)).set(link);

  // Handing out read access to private content is exactly the kind of act that
  // must be answerable after the fact.
  await auditBestEffort({
    operatorId: uid,
    actionType: AUDIT_SHARE_LINK_CREATED,
    gameId: game.id,
    gameTitle: game.title,
    newValue: token,
    reason: `allowCopy=${link.allowCopy} revealAnswers=${link.revealAnswers} allowLaunch=${link.allowLaunch}`,
  });

  return { link };
});


// ─── listGameShareLinks ───────────────────────────────────────────────────────

export const listGameShareLinks = loggedCallable('listGameShareLinks', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = (data ?? {}) as { gameId?: string };
  const game = await loadOwnGame(uid, gameId);

  const snap = await db.collection(FIRESTORE_PATHS.gameShareLinksCol())
    .where('ownerUid', '==', uid)
    .where('gameId', '==', game.id)
    .get();

  const now = new Date().toISOString();
  const links = snap.docs
    .map((d) => d.data() as GameShareLink)
    .map((l) => ({ ...l, refusal: shareLinkRefusal(l, now) }))
    // Newest first; a creator reads the one they just made.
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return { links };
});


// ─── revokeGameShareLink ──────────────────────────────────────────────────────

export const revokeGameShareLink = loggedCallable('revokeGameShareLink', async (data, context) => {
  const uid = requireAuth(context);
  const { token } = (data ?? {}) as { token?: string };
  if (!isValidShareToken(token)) {
    throw new functions.https.HttpsError('invalid-argument', 'token required');
  }

  const ref = db.doc(shareLinkPath(token));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Share link not found');
  const link = snap.data() as GameShareLink;
  if (link.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your share link');
  }

  // Stamped, not deleted: a revoked link can then say "this link was turned off"
  // instead of looking like a typo, and the audit trail keeps a target.
  const revokedAt = link.revokedAt ?? new Date().toISOString();
  await ref.update({ revokedAt });

  await auditBestEffort({
    operatorId: uid,
    actionType: AUDIT_SHARE_LINK_REVOKED,
    gameId: link.gameId,
    previousValue: token,
    reason: 'share link revoked by owner',
  });

  return { ok: true, revokedAt };
});


// ─── getSharedGame (PUBLIC — no auth) ─────────────────────────────────────────

export const getSharedGame = loggedCallable('getSharedGame', async (data, context) => {
  // Charged for EVERY call, valid token or not: the bound must apply to the
  // caller who is guessing, and a caller who is guessing never gets past the
  // lookup below.
  await enforceRateLimit(shareRateKeyFor(context), 'getSharedGame');

  const { token } = (data ?? {}) as { token?: string };
  const { link, ref } = await loadUsableLink(token, 'read');

  const snap = await db.doc(FIRESTORE_PATHS.game(link.ownerUid, link.gameId)).get();
  if (!snap.exists) refuseShareLink('not-found');
  const game = snap.data() as Game;
  // A game in the trash reads as gone through every door, this one included —
  // the tombstone is what the creator asked for and a stale link must not
  // outlive it. (Defence in depth: revoking on delete is best-effort.)
  if (game.deletedAt) refuseShareLink('not-found');

  // Best-effort telemetry for the owner's link list. NEVER blocks the read: a
  // counter write that fails must not turn a working link into a broken one.
  ref.update({
    viewCount: (typeof link.viewCount === 'number' ? link.viewCount : 0) + 1,
    lastViewedAt: new Date().toISOString(),
  }).catch((e) => logBestEffort('gameShareLink.viewCount', { gameId: link.gameId }, e));

  return {
    game: sanitizeGameForShare(game, link.revealAnswers === true),
    allowCopy: link.allowCopy === true,
    // What the holder may DO is told to the holder — the alternative is a page
    // that offers a button the server will refuse, or hides one it would honour.
    // `launchExhausted` separates "the owner said no" from "this link has already
    // started its allowance of runs": the second is fixable by asking for a new
    // link, and a page that cannot tell them apart says the wrong thing to both.
    allowLaunch: shareLinkLaunchRefusal(link, new Date().toISOString()) === null,
    launchExhausted: shareLinkLaunchRefusal(link, new Date().toISOString()) === 'launch-limit',
    // The viewer is told what they may do, never who owns it: `ownerUid` is not
    // in the projection and is not returned here either.
    sharedAt: link.createdAt,
  };
});


// ─── launchSharedRun ──────────────────────────────────────────────────────────
//
// The holder of a launch-enabled link STARTS A RUN of a game they do not own and
// have not copied, and gets staff access to operate it.
//
// Two things had to be true for this to be a real feature rather than a button:
//
//   1. It goes through `launchRunCore`, the same path the owner's own launch
//      takes — same validation, same billing decision, same atomic run + access
//      code write. A second launch path would be a second place for "free run"
//      to be forgotten.
//   2. The launcher gets a STAFF invite for that run. A run nobody can operate is
//      not a run: somebody has to press start, watch the board and finish it, and
//      the person who pressed the button is not the owner and cannot reach the
//      owner's console. The existing staff PIN + `?staff=` link is exactly the
//      scoped, run-limited access this needs — no new authorization concept.
//
// The run lands in the OWNER's account: it is their game, their standings, their
// participants and (whenever payments are switched back on) their credit. That is
// why `allowLaunch` is opt-in per link and never granted by omission, why the
// count per link is bounded, and why this writes an audit record.

export const launchSharedRun = loggedCallable('launchSharedRun', async (data, context) => {
  // An account is required, unlike the read: this WRITES, the audit trail needs a
  // subject, and the staff invite has to belong to somebody.
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'launchSharedRun');

  const { token, name } = (data ?? {}) as { token?: string; name?: string };
  const { link, ref } = await loadUsableLink(token, 'launch');

  const { runId, accessCode } = await launchRunCore({
    ownerUid: link.ownerUid,
    gameId: link.gameId,
  });

  // Staff access for whoever launched it, scoped to THIS run only.
  const staffName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Guest organizer';
  const invite = await createRunStaffInvite({
    ownerUid: link.ownerUid,
    gameId: link.gameId,
    runId,
    name: staffName,
  });

  // Best-effort counter; a failed increment must not undo a run that exists.
  ref.update({
    launchCount: (typeof link.launchCount === 'number' ? link.launchCount : 0) + 1,
  }).catch((e) => logBestEffort('gameShareLink.launchCount', { gameId: link.gameId }, e));

  await auditBestEffort({
    operatorId: uid,
    actionType: AUDIT_SHARE_LINK_LAUNCH,
    gameId: link.gameId,
    runId,
    newValue: accessCode,
    reason: `run launched by a share-link holder (token ${link.token.slice(0, 6)}…)`,
  });

  return {
    runId,
    accessCode,
    // The two ids the staff console needs beside the PIN. This is the ONE place a
    // share link discloses the owner uid, and it is unavoidable: a staff session
    // is addressed by owner + game + run. It is disclosed only to a caller the
    // owner explicitly authorized to run their game, never on the read path.
    staff: {
      ownerUid: link.ownerUid,
      gameId: link.gameId,
      runId,
      pin: invite.pin,
    },
  };
});


// ─── cleanup ──────────────────────────────────────────────────────────────────

/**
 * Delete every share link of a game. Called from the permanent-destruction path
 * and from account deletion.
 *
 * `gameShareLinks` lives OUTSIDE `users/{uid}`, so `recursiveDelete` on the game
 * (or on the user) does not reach it — the same trap `userNotes`/`userEngagement`
 * already sprang once. A surviving link would be a dangling read token for a
 * game that no longer exists.
 */
export async function deleteGameShareLinks(ownerUid: string, gameId: string): Promise<void> {
  const snap = await db.collection(FIRESTORE_PATHS.gameShareLinksCol())
    .where('ownerUid', '==', ownerUid)
    .where('gameId', '==', gameId)
    .get();
  await deleteDocsInChunks(snap.docs.map((d) => d.ref));
}

/** Every share link owned by a user, for account deletion. */
export async function deleteAllShareLinksForOwner(ownerUid: string): Promise<void> {
  const snap = await db.collection(FIRESTORE_PATHS.gameShareLinksCol())
    .where('ownerUid', '==', ownerUid)
    .get();
  await deleteDocsInChunks(snap.docs.map((d) => d.ref));
}

/**
 * Resolve a share token for the COPY path, used by duplicateGame. Returns the
 * link only when it is live AND copying is allowed; refuses exactly as the read
 * path does, so a stranger cannot tell a copy-disabled link from a dead one by
 * the error code.
 */
export async function resolveShareTokenForCopy(token: unknown): Promise<GameShareLink> {
  const { link } = await loadUsableLink(token, 'copy');
  return link;
}

/** Best-effort copy counter for the owner's link list. Never blocks a copy. */
export function bumpShareLinkCopyCount(link: GameShareLink): void {
  db.doc(shareLinkPath(link.token)).update({
    copyCount: (typeof link.copyCount === 'number' ? link.copyCount : 0) + 1,
  }).catch((e) => logBestEffort('gameShareLink.copyCount', { gameId: link.gameId }, e));
}
