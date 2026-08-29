// Share links for an UNPUBLISHED game (change: game-share-link).
//
// A creator wants to hand one person a URL that opens their game read-only — the
// whole builder view, every stage and mission — and lets that person take a copy,
// WITHOUT the game appearing in the public gallery. Publishing is the wrong lever:
// it writes publicGames/publicTasks and exposes the game to everyone.
//
// The address IS the credential, exactly like `accessCodes/{CODE}`: the link is a
// top-level document keyed by an unguessable token, so the holder never needs to
// know (and is never told) the owner uid or the game id. One game may hold several
// links, so revoking the one sent to a person does not kill the others.
//
// This module is the pure half — token shape and the "may this link still be
// used?" verdicts. Everything here is TOTAL and FAILS CLOSED: any input that is
// not a well-formed, live link refuses. A share link decides who may read a
// private game, so "I could not understand this document" must never read as yes.

/** Random bytes behind a token. 128 bits — brute force is not a threat model. */
export const SHARE_TOKEN_BYTES = 16;

/** Length of the canonical token: base64url of SHARE_TOKEN_BYTES, unpadded. */
export const SHARE_TOKEN_LENGTH = 22;

/**
 * Accepted token shape. Deliberately wider than SHARE_TOKEN_LENGTH (a longer
 * token minted by a future rotation must keep resolving) but strictly base64url:
 * the token is interpolated into a Firestore document path, so a `/` or a `.`
 * segment must be refused BEFORE any path is built, not after.
 */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function isValidShareToken(value: unknown): value is string {
  return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value);
}

/** Longest life a creator may give a link at creation time. */
export const SHARE_LINK_MAX_EXPIRY_DAYS = 365;

/**
 * Stored at `gameShareLinks/{token}`. Server-written only; clients can neither
 * read nor write the collection (firestore.rules), so every field here is
 * reached through a callable.
 */
export interface GameShareLink {
  token: string;
  ownerUid: string;
  gameId: string;
  createdAt: string;
  createdBy: string;
  /** May the holder take a copy into their own account? */
  allowCopy: boolean;
  /** May the holder SEE the answer keys? Copying always yields a working game. */
  revealAnswers: boolean;
  /** ISO instant. Absent = never expires (revocation is the normal off switch). */
  expiresAt?: string;
  /** ISO instant the owner turned the link off. Presence = dead. */
  revokedAt?: string;
  viewCount: number;
  copyCount: number;
  lastViewedAt?: string;
}

/** Why a link cannot be used. `null` from the verdict functions means "usable". */
export type ShareLinkRefusal = 'not-found' | 'revoked' | 'expired' | 'copy-not-allowed';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Is this link still readable? Total: `link` is deliberately `unknown` because
 * the caller hands it straight from Firestore, where the document may predate a
 * field or have been written by hand.
 *
 * A malformed document reads as 'not-found' rather than as usable — the same
 * fail-closed posture the safe-zone verdict takes, inverted because here the
 * safe answer is "no".
 */
export function shareLinkRefusal(link: unknown, nowIso: string): ShareLinkRefusal | null {
  if (!link || typeof link !== 'object') return 'not-found';
  const l = link as Partial<GameShareLink>;
  if (!isNonEmptyString(l.ownerUid) || !isNonEmptyString(l.gameId)) return 'not-found';
  if (isNonEmptyString(l.revokedAt)) return 'revoked';
  if (l.expiresAt !== undefined) {
    // An unreadable expiry is treated as expired, never as "no expiry".
    if (!isNonEmptyString(l.expiresAt)) return 'expired';
    const until = Date.parse(l.expiresAt);
    const now = Date.parse(nowIso);
    if (!Number.isFinite(until) || !Number.isFinite(now)) return 'expired';
    if (now >= until) return 'expired';
  }
  return null;
}

/**
 * Is this link still usable to TAKE A COPY? Read access is a precondition, so the
 * read verdict runs first and its refusal is returned unchanged — a revoked link
 * must not report itself as merely copy-disabled.
 */
export function shareLinkCopyRefusal(link: unknown, nowIso: string): ShareLinkRefusal | null {
  const read = shareLinkRefusal(link, nowIso);
  if (read) return read;
  return (link as Partial<GameShareLink>).allowCopy === true ? null : 'copy-not-allowed';
}

/**
 * The `expiresAt` a link created at `createdAtIso` should carry, or undefined for
 * "never". Out-of-range, non-finite and non-positive day counts yield undefined
 * (never an accidental instant expiry, and never an unbounded one).
 */
export function shareLinkExpiryIso(createdAtIso: string, expiresInDays?: unknown): string | undefined {
  if (typeof expiresInDays !== 'number' || !Number.isFinite(expiresInDays)) return undefined;
  const days = Math.floor(expiresInDays);
  if (days <= 0 || days > SHARE_LINK_MAX_EXPIRY_DAYS) return undefined;
  const from = Date.parse(createdAtIso);
  if (!Number.isFinite(from)) return undefined;
  return new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
}
