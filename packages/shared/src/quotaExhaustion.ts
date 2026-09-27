// Telling "you are clicking too fast" apart from "the project's daily Firestore
// budget is gone" (change: daily-quota-user-message).
//
// On 2026-08-28 the creator console showed "טעינת המשחקים נכשלה" (failed to load
// games) for hours. Nothing was broken: the deployed bundle carried the right
// API key and the right backend origin, the VPS was healthy, and unauthenticated
// callables answered a clean 401. Firestore had simply hit the Spark plan's hard
// 50,000-reads-per-day project ceiling and was answering every read with
// `8 RESOURCE_EXHAUSTED: Quota exceeded` until midnight Pacific.
//
// The user-visible failure was indistinguishable from a bug, and the advice the
// UI gave was actively wrong. Both apps map `resource-exhausted` to "too many
// actions in a short time, wait a few seconds and try again" — which is the right
// copy for OUR OWN in-process rate limiter (rateLimitStore.ts) and the exact wrong
// copy here: no amount of waiting a few seconds helps, and retrying is precisely
// what burns the remaining budget. The honest answer is "come back tomorrow".
//
// THE DISCRIMINATOR IS THE TYPE OF `code`, AND IT IS NOT A COINCIDENCE:
//   - Our rate limiter throws `functions.https.HttpsError`, whose `code` is the
//     STRING 'resource-exhausted'.
//   - Firestore's gRPC client throws a ServiceError, whose `code` is the NUMBER 8
//     (grpc.status.RESOURCE_EXHAUSTED).
// So a string code is always ours and a numeric 8 is always the infrastructure.
// We deliberately do NOT classify on the message text ("Quota exceeded"): that
// string is Google-authored, unstable, and untranslated — the same reason every
// other classifier in this codebase reads `code` only.
//
// Note that gRPC 8 also covers non-quota resource exhaustion (a hit write rate
// limit, an oversized payload). Those are rare, equally unfixable by the user in
// the moment, and equally well served by "we are working on it, come back later" —
// so folding them in here is the right trade, not an accepted inaccuracy.

/**
 * Marker put on the `details` of the HttpsError the server substitutes, and read
 * back by both clients. `details` is the only part of an HttpsError that survives
 * the callable transport as structured data, so it is the only place a machine
 * -readable reason can travel.
 */
export const DAILY_QUOTA_REASON = 'daily-quota';

/** Shape the server attaches and the clients destructure. */
export interface DailyQuotaDetails {
  reason: typeof DAILY_QUOTA_REASON;
}

/** gRPC status code for RESOURCE_EXHAUSTED. */
const GRPC_RESOURCE_EXHAUSTED = 8;

/**
 * SERVER SIDE. Did this thrown value come from Firestore refusing us on quota,
 * rather than from our own rate limiter?
 *
 * Total: any input at all yields a boolean, and this never throws. A non-object,
 * a null, a thrown string and an HttpsError all answer false.
 */
export function isFirestoreQuotaExhausted(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  return (e as { code?: unknown }).code === GRPC_RESOURCE_EXHAUSTED;
}

/**
 * CLIENT SIDE. Is this rejection the server telling us the daily budget is gone?
 *
 * Reads the structured marker only. A plain `resource-exhausted` with no marker
 * is our own rate limiter and must keep its existing "slow down" copy, so the
 * absence of the marker is meaningful and is not treated as a maybe.
 */
export function isDailyQuotaRejection(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const details = (e as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  return (details as { reason?: unknown }).reason === DAILY_QUOTA_REASON;
}
