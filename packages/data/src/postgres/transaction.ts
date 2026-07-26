// ─── The Postgres transaction runner ─────────────────────────────────────────
//
// Implements `RunInTransaction` (../transaction.ts) over `BEGIN … COMMIT`.
//
//
// ── The published contract is WEAKER than what this backend does ─────────────
//
// `../transaction.ts` promises callers only that "the body MAY execute more than
// once", and requires every body to be written so that running it twice and
// committing once is indistinguishable from running it once. It says so because
// FIRESTORE re-invokes the body on an optimistic-commit conflict, silently, and
// the contract was made the STRICTER of the two backends on purpose.
//
// SQL runs the body EXACTLY ONCE per attempt and surfaces a conflict as an
// error. That is a legal special case of "one or more times", so this
// implementation satisfies the contract for free — and, importantly, a body
// written for Firestore is already correct here without modification. The
// implication runs one way only: a body that assumed single execution would be
// wrong on Firestore, which is why the contract does not permit that assumption
// even though this backend would honour it.
//
// `contract.ts` does not assert which model an implementation uses (see its
// NOT-IN-CONTRACT 2). It PROBES it and reports a note, and its
// `probeTransactionReExecution` scenario has an explicit SINGLE-EXECUTION branch
// that this runner is expected to land in.
//
//
// ── When the body DOES run more than once here ───────────────────────────────
//
// On a serialization failure (40001) or a deadlock (40P01) the whole
// transaction is retried from the top, body included. So "more than once" is not
// merely theoretical on Postgres either — it is the documented behaviour of
// `SERIALIZABLE`/`REPEATABLE READ` and of any deadlock, and it is safe here for
// exactly the reason the contract gives: bodies are required to be idempotent.
//
// Nothing else is retried. A unique violation, a check violation or an
// application error is the body's answer, not contention, and retrying it would
// only turn one failure into `maxAttempts` failures.
//
//
// ── Rule 4 (read before you write) is not enforced here, and why ─────────────
//
// `../transaction.ts` rule 4 says every document a body writes must first be
// read through the same `tx`, and permits an implementation to reject a
// violation with `failed-precondition`. Firestore ENFORCES it structurally (a
// write to an unread document is not conflict-checked, so a concurrent
// modification is silently lost). Postgres does not need it for correctness:
// a bare `UPDATE` takes its own row lock, so a write without a prior read is
// safe here rather than silently lossy.
//
// This runner therefore does not police it. Adding a read-set tracker would make
// the two implementations behave differently on a body that is legal on one and
// rejected on the other — which is the one outcome Phase 1 must not produce.

import { DataError } from '../types';
import type { Tx, TxBody, TransactionOptions } from '../transaction';
import { isSerializationFailure, toDataError, type SqlClient, type SqlQueryable } from './client';


/**
 * Default attempt budget.
 *
 * 8, matching the Firestore implementation's `DEFAULT_MAX_ATTEMPTS` and the
 * `withLockRetry` tuning it inherited from
 * `functions/src/routing/assignNextTask.ts`. The number was arrived at
 * empirically under load simulation on the hottest path in the system, and the
 * migration must not re-tune it — a Postgres runner that gave up sooner would
 * change behaviour under exactly the load the tuning exists for.
 */
export const DEFAULT_MAX_ATTEMPTS = 8;

/**
 * Backoff for attempt `i` (0-based), in ms. The SAME formula as
 * `firestore/transaction.ts`, deliberately.
 *
 * The jitter lives in the RUNNER, between attempts. It never reaches the body —
 * rule 2 forbids randomness THERE, which is also why the body is never told
 * which attempt it is on.
 */
export function backoffMs(i: number, random: () => number = Math.random): number {
  return 75 * (i + 1) + Math.floor(random() * 300);
}


// ─── The Tx handle ───────────────────────────────────────────────────────────
//
// `Tx` is nominally branded by a symbol this package does not export, so no
// implementation can construct one honestly. The cast below is the seam — the
// same one `inMemory.ts` documents as "the ONLY one" — and it is confined to
// these two functions.

interface PgTx {
  readonly q: SqlQueryable;
}

function wrapTx(q: SqlQueryable): Tx {
  const handle: PgTx = { q };
  return handle as unknown as Tx;
}

/** Recover the queryable a `Tx` carries. Refuses anything else, loudly. */
export function unwrapTx(tx: Tx): SqlQueryable {
  const handle = tx as unknown as PgTx | null;
  if (!handle || typeof handle !== 'object' || typeof handle.q !== 'object') {
    throw new DataError(
      'failed-precondition',
      'withTx() was given something that is not a transaction handle from this repository. ' +
        'A Tx is only valid inside the runInTransaction body that produced it.',
    );
  }
  return handle.q;
}


/**
 * Build the `runInTransaction` implementation for a client.
 *
 * `sleep` is injectable so a test can run the retry path without waiting; it
 * defaults to a real timer. It is NOT part of the published contract.
 */
export function makeRunInTransaction(
  client: SqlClient,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
): <T>(body: TxBody<T>, options?: TransactionOptions) => Promise<T> {
  return async function runInTransaction<T>(
    body: TxBody<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const label = options?.label ?? 'runInTransaction';
    const max = Math.max(1, options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

    let last: unknown = null;
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        return await client.transaction((q) => body(wrapTx(q)));
      } catch (e) {
        // NOT contention ⇒ this is the body's answer (or a real fault). It
        // leaves UNCHANGED if it is not a driver error, because `contract.ts`
        // asserts identity on the exact object a body threw.
        if (!isSerializationFailure(e)) throw toDataError(e, label);
        last = e;
        if (attempt + 1 < max) await sleep(backoffMs(attempt));
      }
    }

    throw new DataError(
      'contended',
      `${label}: transaction attempts exhausted (${max})`,
      { label, attempts: max, cause: String((last as { message?: unknown })?.message ?? last) },
    );
  };
}
