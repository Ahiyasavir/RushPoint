// Server-side per-uid rate-limit enforcement (change: callable-rate-limiting, #19).
//
// Persists the pure limiter's WindowState per (bucket, uid) and decides inside a
// transaction so concurrent calls can't both slip under the cap. Throws a typed,
// bilingual `resource-exhausted` once the per-window budget is exceeded.

import * as functions from 'firebase-functions';
import { FIRESTORE_PATHS, rateLimit, RATE_LIMITS, type RateBudget, type WindowState } from '@rushpoint/shared';
import { db } from './firebase';

/**
 * Enforce a per-uid fixed-window call budget for `bucket`. Reads/writes the
 * counter doc in a transaction and throws `resource-exhausted` past the cap.
 * Pass an explicit `budget` to override the default in RATE_LIMITS[bucket].
 */
export async function enforceRateLimit(uid: string, bucket: string, budget?: RateBudget): Promise<void> {
  const b = budget ?? RATE_LIMITS[bucket];
  if (!b) {
    // Fail-open preserves behavior, but a missing budget is almost always a typo'd
    // bucket name silently disabling the limit — make it visible.
    functions.logger.warn('rateLimit.noBudget', { bucket, uid });
    return;
  }

  const ref = db.doc(FIRESTORE_PATHS.rateLimit(bucket, uid));
  const nowMs = Date.now();

  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = (snap.exists ? snap.data() : null) as WindowState | null;
    const d = rateLimit(state, b.max, b.windowMs, nowMs);
    tx.set(ref, { ...d.nextState, updatedAtMs: nowMs });
    return d;
  });

  if (!decision.allowed) {
    functions.logger.warn('rateLimit.tripped', { bucket, uid, retryAfterMs: decision.retryAfterMs });
    throw new functions.https.HttpsError(
      'resource-exhausted',
      'Too many requests — slow down a moment. / יותר מדי בקשות — האט/י לרגע.',
    );
  }
}
