// Sending a rejected photo again (change: rejected-photo-resend; Ahiya, 2026-10-06).
//
// The phone hashes the photo it sends (SHA-256 of the file, hex). The server keeps, per mission, how
// many times each hash was rejected (`taskSubmissions[taskId].rejectedHashes`). One rejection: the
// phone asks before sending that same picture again. Two: the server refuses it. A new photo of the
// same thing is different bytes and is never blocked. Pure and total, and FAILS OPEN: a missing or
// malformed hash, map or count is "new", never a refusal.

export type ResendVerdict = 'new' | 'rejectedOnce' | 'rejectedTwice';

/** Rejections of one picture after which the server refuses it. */
export const RESEND_REFUSE_AFTER = 2;

const HASH_RE = /^[0-9a-f]{64}$/;

export function isMediaHash(v: unknown): v is string {
  return typeof v === 'string' && HASH_RE.test(v);
}

export function resendVerdict(rejectedHashes: unknown, hash: unknown): ResendVerdict {
  if (!isMediaHash(hash)) return 'new';
  if (!rejectedHashes || typeof rejectedHashes !== 'object' || Array.isArray(rejectedHashes)) return 'new';
  const n = (rejectedHashes as Record<string, unknown>)[hash];
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return 'new';
  return n >= RESEND_REFUSE_AFTER ? 'rejectedTwice' : 'rejectedOnce';
}
