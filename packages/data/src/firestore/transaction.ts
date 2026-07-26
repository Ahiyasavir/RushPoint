// ─── The Firestore transaction runner ────────────────────────────────────────
//
// Implements `RunInTransaction` (../transaction.ts) over `db.runTransaction`,
// plus the `withLockRetry` layer that already wraps every contended transaction
// in production.
//
//
// ── Why the published contract is the WEAK one, and why that is free here ────
//
// The interface promises callers only that "the body MAY execute more than
// once". Firestore satisfies that NATIVELY: `runTransaction` is optimistic — it
// runs the body, collects the reads, attempts the commit, and on a conflict
// RE-INVOKES the body (up to five times by default, silently). So this
// implementation needs no emulation whatsoever; the contract was written to be
// the honest description of what this backend already does. The Postgres
// implementation later gets the contract for free in the other direction: a body
// that runs exactly once is a special case of one-or-more.
//
//
// ── Two layers of retry, and why both stay ───────────────────────────────────
//
// Layer 1 is the SDK's own optimistic retry, described above.
// Layer 2 is `withLockRetry` — 8 attempts with jittered backoff — which exists
// because Firestore's own retry budget is NOT enough for RushPoint's hottest
// path: every assign and every release contends on the ONE run document, and at
// ~20 synchronised teams the lock queue is deep enough that the SDK gives up
// with `10 ABORTED: lock timeout`.
//
// The tuning below (8 attempts, `75 * (i + 1) + random * 300` ms, and the exact
// set of gRPC codes treated as contention) is copied VERBATIM from
// `withLockRetry` in `functions/src/routing/assignNextTask.ts`. It was arrived
// at empirically under load simulation and this migration must not re-tune it.
//
// The ONE deliberate difference: on budget exhaustion today's code throws
// `functions.https.HttpsError('unavailable', …)`. An implementation of this
// interface may only throw `DataError` (README rule 8) — mapping onto a callable
// error code is the caller's job. The exhaustion error is therefore
// `DataError('contended')`, whose `.retriable` is true, and which the callable
// layer maps back to `unavailable`. Same wire behaviour, one less layer knowing
// about HTTP.
//
//
// ── `Math.random()` inside a transaction? ────────────────────────────────────
//
// Rule 2 of the contract forbids randomness in the BODY. The jitter here is in
// the RUNNER, between attempts, and never reaches the body — which is also why
// the body is never told which attempt it is on.

import { DataError } from '../types';
import type { Tx, TxBody, TransactionOptions } from '../transaction';
import type { FsDatabase, FsTransaction } from './context';
import { isContendedError, toDataError } from './context';


/** Default attempt budget. 8, matching `withLockRetry`'s default. */
export const DEFAULT_MAX_ATTEMPTS = 8;

/** Backoff for attempt `i` (0-based), in ms. Mirrors today's formula exactly. */
export function backoffMs(i: number, random: () => number = Math.random): number {
  // Jittered backoff with a wider ceiling: at ~20+ synchronized teams the single
  // run-doc lock queues deep, so more attempts + more jitter spread the retries
  // out instead of colliding on the same slot and failing.
  return 75 * (i + 1) + random() * 300;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retry `op` while the failure looks like lock contention.
 *
 * Behaviourally identical to `withLockRetry` in
 * `functions/src/routing/assignNextTask.ts`, including the identity guard: a
 * NON-contended error (NOT_FOUND, a thrown `DataError` from the body, an
 * assertion) is rethrown UNCHANGED and immediately, never spun on. That
 * property is covered by `functions/src/routing/withLockRetry.test.ts` and is
 * what lets an invariant refusal escape a transaction body intact.
 */
export async function withLockRetry<T>(
  op: () => Promise<T>,
  attempts: number = DEFAULT_MAX_ATTEMPTS,
  deps: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const nap = deps.sleep ?? sleep;
  const rnd = deps.random ?? Math.random;
  const budget = Math.max(1, Math.floor(attempts));
  let lastErr: unknown;
  for (let i = 0; i < budget; i++) {
    try {
      return await op();
    } catch (e) {
      // A DataError raised by the BODY is the app saying "no" (a failed
      // precondition, a missing document). It is never contention and must not
      // be retried — retrying would re-run a body whose invariant already
      // refused. Contention arriving as a DataError('contended') can only come
      // from a nested runner, which the contract forbids, so this is safe.
      if (e instanceof DataError) throw e;
      if (!isContendedError(e)) throw e;
      lastErr = e;
      await nap(backoffMs(i, rnd));
    }
  }
  // Retry budget exhausted while the lock stayed contended. RETRIABLE by the
  // caller with the same arguments — which is only safe because bodies are
  // required to be idempotent.
  throw new DataError(
    'contended',
    `transaction gave up after ${budget} attempts under contention`,
    { cause: String((lastErr as Error | null)?.message ?? lastErr) },
  );
}


// ─── Binding a driver transaction to the opaque `Tx` handle ──────────────────
//
// `Tx` is nominally branded by a NON-EXPORTED unique symbol, so a conforming
// handle cannot be constructed — by design: only a runner may mint one. The
// driver transaction is therefore kept in a module-private WeakMap and the
// handle itself is an empty object.
//
// This is stronger than casting the driver transaction to `Tx` directly: a
// foreign object passed to `withTx` is REJECTED with `failed-precondition`
// instead of being duck-typed into a broken write, and the driver handle can
// never leak back out through the branded type.

const REGISTRY = new WeakMap<object, FsTransaction>();

/** Mint a `Tx` handle for a driver transaction. Runner-internal. */
export function bindTx(raw: FsTransaction): Tx {
  const handle = Object.freeze({}) as unknown as Tx;
  REGISTRY.set(handle as unknown as object, raw);
  return handle;
}

/** Recover the driver transaction from a handle, or refuse. */
export function unwrapTx(tx: Tx): FsTransaction {
  const raw = tx && typeof tx === 'object'
    ? REGISTRY.get(tx as unknown as object)
    : undefined;
  if (!raw) {
    throw new DataError(
      'failed-precondition',
      'withTx received a value that is not a transaction handle minted by this repository. ' +
        'Pass the `tx` argument of the runInTransaction body, unmodified.',
    );
  }
  return raw;
}

/** Invalidate a handle once its transaction is over, so it cannot be reused. */
export function releaseTx(tx: Tx): void {
  REGISTRY.delete(tx as unknown as object);
}


/**
 * Build the `runInTransaction` implementation for a database handle.
 *
 * `maxAttempts` is the OUTER (withLockRetry) budget. The SDK's own optimistic
 * retry sits inside it and is left at its default — exactly the arrangement
 * `withLockRetry(() => db.runTransaction(...))` produces in production today.
 */
export function makeRunInTransaction(db: FsDatabase) {
  return async function runInTransaction<T>(
    body: TxBody<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const attempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const label = options?.label ?? 'transaction';
    return withLockRetry(async () => {
      try {
        return await db.runTransaction(async (raw) => {
          const handle = bindTx(raw);
          try {
            return await body(handle);
          } finally {
            // Released per ATTEMPT: a handle from a discarded attempt must not
            // stay usable, or a body that squirrelled one away could write into
            // a transaction that never committed.
            releaseTx(handle);
          }
        });
      } catch (e) {
        // Contention is re-thrown raw so withLockRetry can classify it; anything
        // else becomes a DataError here, at the boundary.
        if (e instanceof DataError || isContendedError(e)) throw e;
        throw toDataError(e, label);
      }
    }, attempts);
  };
}
