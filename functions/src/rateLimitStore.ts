// Server-side per-uid rate-limit enforcement (change: callable-rate-limiting, #19;
// moved in-process by change: vps-firestore-read-offload).
//
// The DECISION lives in the pure `rateLimit` fixed-window function in
// @rushpoint/shared. This file only owns WHERE the per-key `WindowState` is kept.
//
// It used to be kept in Firestore, decided inside a transaction. That cost one read
// and one WRITE on every rate-limited callable invocation — ~1,516 of each in nine
// minutes of a single 29-participant run, against a 50,000-read / 20,000-write daily
// quota. On 2026-08-26 that run exhausted the quota mid-play and every callable
// started failing with `8 RESOURCE_EXHAUSTED`.
//
// The durability bought nothing. The API is a SINGLE Node process (functions/server.js
// has no `cluster`), so no second reader ever consulted those documents; the only
// behavior the persistence preserved was budget survival across a restart. That is
// deliberately traded away — the limiter exists to bound abuse, and admitting a few
// extra calls right after a restart is a far smaller cost than a read and a write on
// every call.
//
// The transaction is gone for the same reason it was needed: it guarded an `await`
// between reading and writing the counter. There is no await here, and Node runs this
// to completion on one thread, so the read-modify-write is already atomic.
//
// ⚠️ PRECONDITION: single API process. If the API is ever scaled horizontally, each
// process enforces its own budget and the effective cap becomes max × processes.
// Revisit this file before scaling out.

import * as functions from 'firebase-functions';
import { rateLimit, RATE_LIMITS, type RateBudget, type WindowState } from '@rushpoint/shared';

/** How many keys may be held before reclamation is forced regardless of cadence. */
const MAX_KEYS = 50_000;
/** Reclaim every N enforcement calls, so memory is bounded without a timer. */
const RECLAIM_EVERY = 1_000;

export interface RateLimiter {
  /**
   * Enforce `bucket`'s budget for `uid` at `nowMs`. Throws `resource-exhausted`
   * past the cap. `nowMs` is injected so window boundaries are unit-testable.
   */
  enforce(uid: string, bucket: string, budget: RateBudget | undefined, nowMs: number): void;
  /** Drop every key whose window has already elapsed at `nowMs`. */
  reclaim(nowMs: number): void;
  /** Number of keys currently held. Test/diagnostic surface. */
  size(): number;
}

/**
 * Build an isolated limiter over an in-process key→WindowState map. Exported so the
 * pure suite can drive it with an injected clock; production uses the module
 * singleton below.
 */
export function createRateLimiter(
  opts: { onMissingBudget?: (bucket: string, uid: string) => void } = {},
): RateLimiter {
  // The key's OWN windowMs is stored beside its state, never looked back up from
  // RATE_LIMITS at reclaim time. A caller may pass an explicit budget override, and a
  // bucket name is not guaranteed to be in the table — so a lookup returns undefined
  // for exactly the keys a sweep must be most careful with, and "no window found"
  // reads as "elapsed". That deletes a LIVE exhausted key and re-admits the caller,
  // turning the cap off for whoever is hammering hardest.
  const states = new Map<string, WindowState & { windowMs: number }>();
  let sinceReclaim = 0;

  // Reclaiming an ELAPSED window is not the same as clearing a live one: a key whose
  // window has passed is already indistinguishable from a key never seen, because
  // `rateLimit` restarts the window itself in that case. A live key must survive, or
  // the sweep silently turns the cap off — which is why the suite pairs every
  // "reclaimed" assertion with a "still refused" one.
  function reclaim(nowMs: number): void {
    for (const [key, state] of states) {
      if (nowMs - state.windowStartMs >= state.windowMs) states.delete(key);
    }
    sinceReclaim = 0;
    trim();
  }

  // Reclaiming only removes ELAPSED windows, so it frees nothing at all when every key is
  // live — which would leave the map growing without limit. play-web signs in anonymously,
  // so a script can mint uids as fast as it likes and each one is a fresh live key. So the
  // real bound is here, applied after EVERY insert rather than only on the sweep, which is
  // what makes it exact instead of "the cap plus whatever arrived since the last sweep".
  //
  // This does re-admit a live exhausted key, and that is the lesser evil on purpose: the
  // same attacker gets a fresh budget just by rotating to a new uid, so eviction concedes
  // nothing uid-rotation did not already concede — while an unbounded map is an OOM that
  // takes the whole API down.
  function trim(): void {
    while (states.size > MAX_KEYS) {
      const oldest = states.keys().next();
      if (oldest.done) return;
      states.delete(oldest.value);
    }
  }

  return {
    enforce(uid, bucket, budget, nowMs) {
      const b = budget ?? RATE_LIMITS[bucket];
      if (!b) {
        // Fail-open preserves behavior, but a missing budget is almost always a typo'd
        // bucket name silently disabling the limit — make it visible.
        (opts.onMissingBudget ?? ((bk: string, u: string) =>
          functions.logger.warn('rateLimit.noBudget', { bucket: bk, uid: u })))(bucket, uid);
        return;
      }

      if (++sinceReclaim >= RECLAIM_EVERY || states.size > MAX_KEYS) reclaim(nowMs);

      const key = `${bucket}:${uid}`;
      const decision = rateLimit(states.get(key), b.max, b.windowMs, nowMs);
      states.set(key, { ...decision.nextState, windowMs: b.windowMs });
      trim();

      if (!decision.allowed) {
        functions.logger.warn('rateLimit.tripped', {
          bucket, uid, retryAfterMs: decision.retryAfterMs,
        });
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'Too many requests — slow down a moment. / יותר מדי בקשות — האט/י לרגע.',
        );
      }
    },
    reclaim,
    size: () => states.size,
  };
}

/** The process-wide limiter. One per API process, by design (see the note above). */
const limiter = createRateLimiter();

/**
 * Enforce a per-uid fixed-window call budget for `bucket`. Throws
 * `resource-exhausted` past the cap. Pass an explicit `budget` to override the
 * default in RATE_LIMITS[bucket].
 *
 * Still `async` and still awaited by ~99 call sites: the signature is deliberately
 * unchanged so moving the store touched no callable.
 */
export async function enforceRateLimit(
  uid: string,
  bucket: string,
  budget?: RateBudget,
): Promise<void> {
  limiter.enforce(uid, bucket, budget, Date.now());
}
