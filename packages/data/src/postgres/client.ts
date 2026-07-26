// ─── The injected SQL seam ───────────────────────────────────────────────────
//
// `@rushpoint/data` depends on NO database driver, in either direction. The
// Firestore implementation states this in `firestore/context.ts` and takes an
// already-initialised `Firestore`; this file is the same idea for Postgres.
//
// WHY IT MATTERS HERE MORE THAN IT DID THERE
//
// There are at least three drivers this repository has to survive: `pg` (the
// Supabase/IONOS production choice), `postgres.js` (if the team ever wants
// pipelining), and `@electric-sql/pglite` (Postgres 18 compiled to WASM, which
// is how `scripts/test-data-contract-postgres.ts` runs the whole contract
// against a REAL Postgres with the REAL schema, with no Docker and no server).
// If any of them were imported at module scope, the package would grow a
// runtime dependency that the other two builds have to carry — and the test lane
// would need the production driver installed to typecheck.
//
// So the seam is two methods. Everything below this line speaks only `SqlQueryable`.
//
//
// ── The one thing an adapter MUST get right ──────────────────────────────────
//
// `transaction(fn)` must give `fn` a queryable on which BEGIN … COMMIT has real
// isolation. For a POOL-backed driver that means a dedicated connection checked
// out for the duration. For a SINGLE-CONNECTION driver (PGlite) it means the
// adapter has to serialise transactions itself — see `serialisedPgliteClient` in
// scripts/test-data-contract-postgres.ts, and the honesty note there about what
// that does and does not prove.

import { DataError } from '../types';


/** One result row. Values are whatever the driver's type parsers produced. */
export type SqlRow = Record<string, unknown>;

export interface SqlResult<R extends SqlRow = SqlRow> {
  rows: R[];
  /** Rows affected by a DML statement, when the driver reports it. */
  rowCount?: number;
}

/**
 * Anything you can run a statement on: the pool, a pooled client, or a
 * transaction handle. Placeholders are Postgres-native (`$1`, `$2`, …).
 *
 * DELIBERATELY NOT a template-tag API. Every statement in this implementation is
 * a string literal with numbered placeholders, so a reader can copy it into
 * `psql` unchanged and so no interpolation path exists that could ever build SQL
 * out of a task id or a tag name.
 */
export interface SqlQueryable {
  query<R extends SqlRow = SqlRow>(sql: string, params?: unknown[]): Promise<SqlResult<R>>;
}

export interface SqlClient extends SqlQueryable {
  /**
   * Run `fn` inside ONE SQL transaction on ONE connection.
   *
   * Contract: commit if `fn` resolves, roll back and RE-THROW UNCHANGED if it
   * rejects. "Unchanged" is load-bearing — `contract.ts` asserts
   * `caught === marker` on the exact Error object the body threw, and an adapter
   * that wraps it breaks the rule that a `DataError` is the only thing this
   * package invents.
   */
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
}


// ─── Error translation ───────────────────────────────────────────────────────
//
// README rule 8: an implementation may throw only `DataError`, and only for the
// five codes in types.ts. A raw `PostgresError` escaping this package would make
// the caller's error mapping driver-specific, which is exactly what the
// repository exists to prevent.

/** Postgres SQLSTATEs that mean "retry the whole transaction". */
const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

/** Unique / exclusion constraint violation ⇒ `already-exists`. */
const UNIQUE_VIOLATION = '23505';
/** FK, check, not-null violations ⇒ the caller asserted something false. */
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

/** Connection-level failures ⇒ `unavailable` (retriable). */
const CONNECTION_STATES = ['08000', '08003', '08006', '08001', '08004', '57P01', '57P02', '57P03'];

/**
 * Read a driver's SQLSTATE without knowing the driver.
 *
 * `pg` puts it on `.code`; `postgres.js` on `.code`; PGlite surfaces the server
 * error with `.code` too but sometimes only inside a wrapped `.cause`. Look in
 * both and give up quietly rather than guessing.
 */
export function sqlState(e: unknown): string | null {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** True for the two SQLSTATEs a transaction runner may legally retry. */
export function isSerializationFailure(e: unknown): boolean {
  const s = sqlState(e);
  return s === SERIALIZATION_FAILURE || s === DEADLOCK_DETECTED;
}

/**
 * Map a driver error onto a `DataError` — and PASS ANYTHING ELSE THROUGH
 * UNCHANGED.
 *
 * The pass-through is not laziness. A transaction body throws application
 * errors (including `DataError`s that ARE the refusal), and `contract.ts`
 * asserts identity on the thrown object. Only something that carries a
 * recognisable SQLSTATE is a database error worth translating.
 */
export function toDataError(e: unknown, what: string): unknown {
  if (e instanceof DataError) return e;
  const state = sqlState(e);
  if (state === null) return e;

  const message = String((e as { message?: unknown }).message ?? e);
  const detail = { what, sqlState: state };

  if (state === SERIALIZATION_FAILURE || state === DEADLOCK_DETECTED) {
    return new DataError('contended', `${what}: ${message}`, detail);
  }
  if (CONNECTION_STATES.indexOf(state) >= 0) {
    return new DataError('unavailable', `${what}: ${message}`, detail);
  }
  if (state === UNIQUE_VIOLATION) {
    return new DataError('already-exists', `${what}: ${message}`, detail);
  }
  if (
    state === FOREIGN_KEY_VIOLATION ||
    state === NOT_NULL_VIOLATION ||
    state === CHECK_VIOLATION
  ) {
    return new DataError('failed-precondition', `${what}: ${message}`, detail);
  }
  // Everything else (syntax errors, undefined columns, permission denied) is a
  // BUG in this package, not a condition a caller can act on. It still has to
  // leave as a DataError, and 'failed-precondition' is the only honest code —
  // it is neither retriable nor a missing document.
  return new DataError('failed-precondition', `${what}: ${message}`, detail);
}

/** Run `body`, translating any driver error on the way out. */
export async function guard<T>(what: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    throw toDataError(e, what);
  }
}
