// ─── Firestore driver context — construction and the driver's shape ──────────
//
// This file exists so `@rushpoint/data` can hold a Firestore implementation
// WITHOUT owning Firebase's lifecycle and WITHOUT taking a dependency on
// `firebase-admin`.
//
// WHY NO `import ... from 'firebase-admin'`
//
//   1. `functions/src/firebase.ts` performs `admin.initializeApp()` at MODULE
//      SCOPE. Importing the admin SDK from a library is therefore not a neutral
//      act — it decides when (and with which credentials) an app is initialised.
//      The repository must never make that decision; it receives an already
//      configured `db`.
//   2. `@rushpoint/data` is dependency-free by design (see package.json: its only
//      dependency is `@rushpoint/shared`). Its typecheck config resolves shared
//      from SOURCE precisely so it runs in a fresh checkout with no install.
//      Adding a real admin import would break that.
//
// So the driver is described STRUCTURALLY below. The real
// `admin.firestore.Firestore` satisfies `FsDatabase` by shape, so
// `new FirestoreRepository({ db, deleteSentinel: () => FieldValue.delete() })`
// type-checks at the call site in `functions/` with no cast.
//
// These interfaces are deliberately the SMALLEST subset this implementation
// uses. If a method is missing here, the implementation is not allowed to call
// it — which is a feature: it keeps the Firestore surface enumerable.

import { DataError } from '../types';


// ── Values ───────────────────────────────────────────────────────────────────

/** Anything Firestore will store. Deliberately loose; the domain types are the real contract. */
export type FsValue = unknown;
export interface FsDocumentData { [field: string]: FsValue }

/** Firestore's comparison operators, restricted to the ones this package uses. */
export type FsWhereOp = '==' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains-any';


// ── Snapshots ────────────────────────────────────────────────────────────────

export interface FsDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: FsDocumentReference;
  data(): FsDocumentData | undefined;
}

export interface FsQueryDocumentSnapshot extends FsDocumentSnapshot {
  data(): FsDocumentData;
}

export interface FsQuerySnapshot {
  readonly docs: FsQueryDocumentSnapshot[];
  readonly empty: boolean;
  readonly size: number;
}

export interface FsAggregateSnapshot {
  data(): { count: number };
}

export interface FsAggregateQuery {
  get(): Promise<FsAggregateSnapshot>;
}


// ── Queries ──────────────────────────────────────────────────────────────────

export interface FsQuery {
  where(field: string, op: FsWhereOp, value: FsValue): FsQuery;
  orderBy(field: string, dir?: 'asc' | 'desc'): FsQuery;
  limit(n: number): FsQuery;
  startAfter(...values: FsValue[]): FsQuery;
  get(): Promise<FsQuerySnapshot>;
  count(): FsAggregateQuery;
}

export interface FsCollectionReference extends FsQuery {
  readonly id: string;
  /**
   * NOTE the argument is REQUIRED here even though Firestore allows omitting it
   * to mint an id. Rule 2 of this package is "never mint an id" — a Firestore
   * transaction may re-execute, and a minted id would orphan the first
   * attempt's document. Removing the no-arg overload makes that unrepresentable.
   */
  doc(id: string): FsDocumentReference;
}

export interface FsDocumentReference {
  readonly id: string;
  readonly path: string;
  collection(id: string): FsCollectionReference;
  get(): Promise<FsDocumentSnapshot>;
  set(data: FsDocumentData, options?: { merge?: boolean }): Promise<unknown>;
  update(data: FsDocumentData): Promise<unknown>;
  delete(): Promise<unknown>;
}


// ── Transaction + batch ──────────────────────────────────────────────────────

export interface FsTransaction {
  get(ref: FsDocumentReference): Promise<FsDocumentSnapshot>;
  get(query: FsQuery): Promise<FsQuerySnapshot>;
  set(ref: FsDocumentReference, data: FsDocumentData, options?: { merge?: boolean }): FsTransaction;
  update(ref: FsDocumentReference, data: FsDocumentData): FsTransaction;
  delete(ref: FsDocumentReference): FsTransaction;
}

export interface FsWriteBatch {
  set(ref: FsDocumentReference, data: FsDocumentData, options?: { merge?: boolean }): FsWriteBatch;
  update(ref: FsDocumentReference, data: FsDocumentData): FsWriteBatch;
  delete(ref: FsDocumentReference): FsWriteBatch;
  commit(): Promise<unknown>;
}


// ── The database handle ──────────────────────────────────────────────────────

export interface FsDatabase {
  doc(path: string): FsDocumentReference;
  collection(path: string): FsCollectionReference;
  collectionGroup(collectionId: string): FsQuery;
  batch(): FsWriteBatch;
  runTransaction<T>(
    updateFunction: (tx: FsTransaction) => Promise<T>,
    options?: { maxAttempts?: number },
  ): Promise<T>;
}


// ── Construction ─────────────────────────────────────────────────────────────

export interface FirestoreDeps {
  /**
   * An ALREADY-INITIALISED Firestore instance. In production this is the `db`
   * exported by `functions/src/firebase.ts`, which is configured with
   * `ignoreUndefinedProperties: true`.
   *
   * ⚠ That setting is load-bearing for this package's correctness: with it on,
   * writing `{ safeZone: undefined }` is a SILENT NO-OP rather than a clear.
   * It is exactly why `DELETE` is an explicit token here and never a convention
   * around `undefined` (see patch.ts).
   */
  db: FsDatabase;

  /**
   * Produces Firestore's "remove this field" sentinel — i.e.
   * `() => admin.firestore.FieldValue.delete()`.
   *
   * It is a FACTORY, not a value, because the Admin SDK returns a fresh sentinel
   * object per call and this implementation must not assume they are shared or
   * reusable across writes.
   *
   * Injected rather than imported for the same reason `db` is: importing
   * `firebase-admin` here would drag app initialisation into a types package.
   */
  deleteSentinel: () => FsValue;
}

/**
 * Holds the injected driver. Nothing else. Kept as its own tiny class so every
 * piece of the implementation takes ONE object and so a test double is a single
 * literal.
 */
export class FirestoreContext {
  readonly db: FsDatabase;
  readonly deleteSentinel: () => FsValue;

  constructor(deps: FirestoreDeps) {
    if (!deps || !deps.db) {
      throw new DataError('failed-precondition', 'FirestoreContext requires an initialised `db`');
    }
    if (typeof deps.deleteSentinel !== 'function') {
      throw new DataError(
        'failed-precondition',
        'FirestoreContext requires `deleteSentinel: () => FieldValue.delete()`',
      );
    }
    this.db = deps.db;
    this.deleteSentinel = deps.deleteSentinel;
  }
}


// ── Error mapping ────────────────────────────────────────────────────────────
//
// The repository throws ONLY `DataError` (README rule 8). Everything a driver
// can raise is funnelled through here so that mapping lives in exactly one
// place.
//
// The gRPC codes are the same ones `withLockRetry` already discriminates on in
// `functions/src/routing/assignNextTask.ts` — kept identical on purpose.

export const GRPC_ABORTED = 10;
export const GRPC_NOT_FOUND = 5;
export const GRPC_ALREADY_EXISTS = 6;
export const GRPC_DEADLINE_EXCEEDED = 4;
export const GRPC_INTERNAL = 13;
export const GRPC_UNAVAILABLE = 14;

/** The retriable-contention predicate, mirrored VERBATIM from `withLockRetry`. */
export function isContendedError(e: unknown): boolean {
  const code = (e as { code?: number | string } | null)?.code;
  const msg = String((e as Error | null)?.message ?? '');
  // Contention surfaces as code-10 ABORTED (lock timeout) AND as the transient
  // gRPC codes 4 (DEADLINE_EXCEEDED), 13 (INTERNAL), 14 (UNAVAILABLE) under deep
  // run-doc lock queues — all the same "retry in ms" class. The message arm
  // catches SDK errors that carry no numeric `.code`. Kept narrow: NOT_FOUND (5)
  // and other terminal errors still rethrow raw.
  return (
    code === GRPC_ABORTED ||
    code === GRPC_DEADLINE_EXCEEDED ||
    code === GRPC_INTERNAL ||
    code === GRPC_UNAVAILABLE ||
    /ABORTED|lock timeout|too much contention|deadline|unavailable|internal/i.test(msg)
  );
}

/**
 * Map a driver error onto a `DataError`.
 *
 * A `DataError` passes through untouched — that is how an invariant refusal
 * thrown inside a transaction body reaches the caller unchanged.
 */
export function toDataError(e: unknown, what: string): DataError {
  if (e instanceof DataError) return e;
  const code = (e as { code?: number | string } | null)?.code;
  const message = String((e as Error | null)?.message ?? e);
  if (code === GRPC_NOT_FOUND || /NOT_FOUND|No document to update/i.test(message)) {
    return new DataError('not-found', `${what}: ${message}`, { cause: message });
  }
  if (code === GRPC_ALREADY_EXISTS || /ALREADY_EXISTS/i.test(message)) {
    return new DataError('already-exists', `${what}: ${message}`, { cause: message });
  }
  if (isContendedError(e)) {
    return new DataError('contended', `${what}: ${message}`, { cause: message });
  }
  // Anything unclassified is reported as `unavailable` — RETRIABLE. That is the
  // conservative choice: a caller retrying a safe operation is cheaper than a
  // caller treating a transient gRPC hiccup as a permanent failure.
  return new DataError('unavailable', `${what}: ${message}`, { cause: message });
}

/** Run `fn`, funnelling any driver error through `toDataError`. */
export async function guard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDataError(e, what);
  }
}
