// ─── Unit of work ────────────────────────────────────────────────────────────
//
// This file defines what "these N operations happen atomically" MEANS in
// RushPoint, in a way that is simultaneously honest about Firestore and about
// Postgres. It is the load-bearing file of the whole abstraction: if the
// transaction contract is wrong, every atomic operation built on it is wrong.
//
//
// ── The problem ──────────────────────────────────────────────────────────────
//
// Firestore's `runTransaction(fn)` is OPTIMISTIC. The SDK executes `fn`,
// collects its reads, and attempts the commit; if any read document changed in
// the meantime the commit is rejected and the SDK CALLS `fn` AGAIN — up to five
// times by default, silently. Today's code lives with this (see
// `withLockRetry` in functions/src/routing/assignNextTask.ts, which adds a
// SECOND layer of retry on top for lock-timeout contention).
//
// Postgres's transaction is PESSIMISTIC in the sense that matters here: the body
// runs exactly once. A serialization failure surfaces as an error to the caller,
// not as a silent re-invocation.
//
// So the two backends disagree about the single most important property of a
// transaction body: HOW MANY TIMES IT RUNS.
//
//
// ── The resolution: make the contract the STRICTER of the two ────────────────
//
// A body that is safe under re-execution is trivially safe under single
// execution. The reverse is false. Therefore this interface promises callers the
// WEAKER guarantee — "your body may run more than once" — and requires them to
// write bodies that survive it. That single decision makes:
//
//   * the Firestore implementation correct, because re-execution is legal; and
//   * the Postgres implementation correct for free, because running once is a
//     special case of running one-or-more times.
//
// It also means the two implementations can never diverge behaviourally on this
// axis, which is the whole point of Phase 1 being behaviour-neutral.
//
//
// ── THE FIVE RULES A TRANSACTION BODY MUST OBEY ──────────────────────────────
//
// 1. THE BODY MAY BE EXECUTED MORE THAN ONCE.
//    Write it so that running it twice and committing once is indistinguishable
//    from running it once. In practice: derive everything you write from what
//    you read INSIDE the body, never from a value computed before it.
//
// 2. NO SIDE EFFECTS OUTSIDE `tx`.
//    No HTTP calls, no Storage writes, no logging that a human counts, no push
//    notifications, no Stripe calls, no mutation of variables in the enclosing
//    scope, no `Math.random()`, no `Date.now()`. Anything you need from the
//    outside world must be computed BEFORE the transaction and passed in;
//    anything you want to do to the outside world must happen AFTER it commits,
//    driven by the transaction's RETURN VALUE.
//
// 3. TIMESTAMPS AND IDS COME FROM OUTSIDE.
//    Generate the ISO instant and any new document id before calling
//    `runInTransaction` and close over them. A body that calls `new Date()` will
//    produce a different timestamp on its second execution, and one that mints
//    an id will orphan the first one. This is also why no method in this package
//    has a `serverTimestamp()` — see types.ts, RULE 3.
//
// 4. READ BEFORE YOU WRITE.
//    Every document you intend to write must first be read through the SAME
//    `tx`. Firestore enforces this (a write to an unread document is not
//    conflict-checked, so a concurrent modification is silently lost) and it is
//    what gives the Postgres implementation the row locks it needs. An
//    implementation MAY reject a write to a document not read in this
//    transaction with `failed-precondition`.
//
// 5. THE BODY MUST BE FINITE AND SMALL.
//    No unbounded loops, no paging, no sweeps. A transaction touches a bounded
//    set of documents in one aggregate neighbourhood. Sweeps use
//    `SweepRepository` (see repository.ts) and are explicitly NOT atomic.
//
//
// ── What this DELIBERATELY does not expose ───────────────────────────────────
//
// * No `tx.commit()` / `tx.rollback()`. Committing is the runner's job; the
//   only way to abort is to throw. A thrown error rolls the whole body back and
//   propagates — including a `DataError`, which is how an atomic operation
//   signals "the invariant said no" (e.g. 'failed-precondition').
// * No isolation level. Firestore has one; exposing SQL's would create a
//   contract the Firestore implementation cannot honour.
// * No retry count, no backoff, no "attempt number" handed to the body. If a
//   body could see which attempt it is on, someone would branch on it, and the
//   two implementations would diverge immediately.
// * No nesting. `runInTransaction` inside a transaction body is an error.
// * No queries inside `tx` beyond the ones the interface names. Firestore
//   transactions cannot run arbitrary indexed queries the way a SQL transaction
//   can, so the transactional read surface is a deliberate SUBSET of the
//   repository's read surface (see `TransactionalRepository` in repository.ts).

import type { DataError } from './types';


/**
 * Read-your-writes semantics INSIDE a transaction.
 *
 * Firestore's transaction does NOT give you read-your-writes: a `tx.get` after a
 * `tx.set` on the same document returns the PRE-transaction value. Postgres
 * does. Rather than force one backend to emulate the other, the contract forbids
 * relying on either: **within a single transaction body, do not read a document
 * you have already written in that body.** Keep the value you wrote in a local
 * variable instead.
 *
 * An implementation MAY throw `failed-precondition` when this is violated. This
 * type exists to name the rule so it can be cited in review.
 */
export type NoReadYourWrites = never;


/**
 * The handle passed to a transaction body.
 *
 * `Tx` is intentionally opaque and carries no methods of its own — every
 * operation is reached through the repository surface bound to it (see
 * `TransactionalRepository`). That way there is exactly one place a method can
 * be declared, and a method available transactionally is available
 * non-transactionally with the identical signature.
 */
declare const TX_BRAND: unique symbol;

export interface Tx {
  /**
   * Nominal brand. Prevents a plain object being passed where a real
   * transaction handle is required, and prevents a `Tx` escaping into code that
   * expects a repository.
   */
  readonly [TX_BRAND]: true;
}


/**
 * A transaction body.
 *
 * MUST be idempotent, side-effect-free outside `tx`, and free of ambient clock
 * or randomness. See THE FIVE RULES above. Its return value is the ONLY channel
 * out of the transaction; it is delivered exactly once, after commit, and is
 * where any post-commit side effect (push, webhook, Storage write, audit email)
 * takes its instructions from.
 */
export type TxBody<T> = (tx: Tx) => Promise<T>;


export interface TransactionOptions {
  /**
   * Maximum attempts the runner may make before giving up with a `contended`
   * `DataError`. Advisory: an implementation may cap it. It exists because
   * RushPoint's assign/release path already tunes this (`withLockRetry`,
   * 8 attempts with jittered backoff) and that tuning must survive the
   * migration.
   *
   * Note this is a property of the RUNNER, never of the body — the body is
   * never told which attempt it is on (see above).
   */
  maxAttempts?: number;

  /**
   * Human-readable label for logs/metrics, e.g. 'claimTaskSlot'. Never
   * semantic; an implementation must behave identically without it.
   */
  label?: string;
}


/**
 * Runs `body` atomically.
 *
 * GUARANTEES
 *  - All writes performed through `tx` commit together or not at all.
 *  - Every document read through `tx` is conflict-checked: if it changed between
 *    the read and the commit, the transaction does not commit as-is.
 *  - The returned value is the value returned by the ATTEMPT THAT COMMITTED.
 *
 * NON-GUARANTEES (read these; they are the contract)
 *  - `body` may be invoked MORE THAN ONCE. Results of non-committing attempts
 *    are discarded.
 *  - `body` may be invoked ZERO times if the runner fails before starting.
 *  - No read-your-writes inside the body.
 *
 * THROWS
 *  - Whatever `body` throws, unchanged, after rolling back. This is how an
 *    invariant refusal (`new DataError('failed-precondition', …)`) leaves the
 *    transaction.
 *  - `DataError('contended')` when the attempt budget is exhausted. RETRIABLE by
 *    the caller with the same arguments — which is only safe BECAUSE the body is
 *    required to be idempotent.
 */
export type RunInTransaction = <T>(
  body: TxBody<T>,
  options?: TransactionOptions,
) => Promise<T>;


/**
 * Marker for a method that is atomic ON ITS OWN and therefore does NOT need to
 * be wrapped in `runInTransaction` — the implementation performs whatever
 * locking it needs internally. Every method in `atomic.ts` is such a method.
 *
 * Composition rule: an `Atomic` method may be CALLED inside a `runInTransaction`
 * body (it then joins the enclosing transaction, and the five rules apply to it
 * as to everything else). Called outside one, it is its own transaction. The
 * signature is identical either way — that is why the transactional and
 * non-transactional repository surfaces are the same interface.
 */
export type Atomic<F> = F;


/**
 * The result shape used by every atomic operation whose invariant may legally
 * REFUSE — as opposed to fail.
 *
 * "Refused" is not an error: a station being full, a hint already paid for, a
 * duplicate completion, a run at capacity are all NORMAL outcomes the caller
 * must handle, and modelling them as thrown errors makes every call site a
 * try/catch and makes the Firestore/Postgres error mapping load-bearing.
 * A thrown `DataError` means something is WRONG; an `Outcome` with
 * `ok: false` means the invariant said no, on purpose.
 */
export type Outcome<T extends object, R extends string> =
  | ({ ok: true } & T)
  | { ok: false; reason: R };

/** Convenience constructors so implementations produce identical shapes. */
export const ok = <T extends object>(value: T): { ok: true } & T =>
  ({ ok: true, ...value });
export const refused = <R extends string>(reason: R): { ok: false; reason: R } =>
  ({ ok: false, reason });


/** Re-exported so a body can throw the canonical refusal error. */
export type { DataError };
