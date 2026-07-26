// ─── `Patch<T>` against SQL — the highest-risk translation in the migration ──
//
// Firestore has THREE states for a field. Postgres has TWO for a column.
//
//   Firestore                          Postgres
//   ─────────────────────────────      ──────────────────────────────────────
//   the field is not in the document   (no such thing — a column always exists)
//   the field holds null               the column holds NULL
//   the field holds a value            the column holds a value
//
// The codebase RELIES on the first two being different (`types.ts`, "ABSENT vs
// NULL"; README §3). `Game.safeZone?: SafeZone | null` means:
//
//   undefined ⇒ "the Builder did not send this field; leave whatever is stored"
//   null      ⇒ "the creator REMOVED the boundary; clear it"
//
// Collapsing those silently un-clears safe zones — the boundary comes back after
// the creator deleted it.
//
//
// ── Where the distinction actually has to live ───────────────────────────────
//
// README §3 resolves this precisely, and this file implements exactly that
// resolution and nothing more:
//
//   "a SQL implementation genuinely cannot distinguish 'field absent' from
//    'column NULL' at rest, and it does not have to. The distinction only has
//    to survive the PATCH, not the ROW."
//
// So the whole translation is one rule about the SET LIST:
//
//   field ABSENT from the patch object   → the column is NOT IN THE SET CLAUSE
//   field present, value `undefined`     → same as absent (see below)
//   field present, value `null`          → `SET col = NULL`   (a real stored null)
//   field present, value `DELETE`        → `SET col = NULL`   (cleared)
//                                          …or `SET col = DEFAULT` when the
//                                          column is NOT NULL (see mapping.ts)
//   field present, any other value       → `SET col = $n::type`
//
// An omitted field is not "written as NULL", not "written as its current
// value", and not "written as DEFAULT". It is NOT MENTIONED. `UPDATE` leaves a
// column it does not name entirely alone, which is precisely Firestore's
// "leave the stored value alone" — so the ABSENT case is free, and the entire
// risk is in making sure nothing ever accidentally puts an omitted field into
// the list. That is why this function is the ONLY place a SET clause is built
// in this implementation, and why every caller passes a whole `Patch<T>` rather
// than pre-flattened columns.
//
//
// ── Why `undefined` folds into ABSENT and can never mean "clear" ─────────────
//
// Identical to the Firestore rule (`firestore/patch.ts`), for a different
// reason. There it was `ignoreUndefinedProperties: true` making the two
// indistinguishable on the wire. Here it is that `{ activeTaskId: undefined }`
// and `{}` are indistinguishable after JSON, after a spread and after
// `Object.assign` — so treating `undefined` as a clear would make a patch's
// meaning depend on whether it had been serialised. `contract.ts` asserts this
// directly: after `patchTeam({ activeTaskId: undefined })` the stored value must
// be unchanged.
//
// The `DELETE` token is a `Symbol` compared by IDENTITY precisely because it is
// the only value that survives all three of those transformations while still
// being unmistakably "remove this".
//
//
// ── What this file deliberately does NOT do ──────────────────────────────────
//
// * No dotted paths, no nested merge. README §4. A nested object value REPLACES
//   the stored `jsonb` wholesale. `assertNoNestedPaths` refuses a dotted key
//   loudly rather than writing a column named `"a.b"` (which does not exist) or
//   silently doing something clever.
// * No "skip the write if nothing changed". A patch of `{ x: DELETE }` is a
//   write. Only an EMPTY set list is a no-op, and that is reported to the caller
//   so it can skip the round trip instead of issuing `UPDATE t SET WHERE …`,
//   which is a syntax error.

import { DataError, isDelete } from '../types';
import { castOf, encodeValue, type Column, type FieldMap } from './mapping';


/** Characters that would make a patch key a path expression rather than a field. */
const PATH_SPECIALS = /[.`[\]/*~]/;

/**
 * Refuse any patch key that looks like a nested path.
 *
 * Under Firestore a dotted `.update()` key against an array element coerced the
 * array into a map and destroyed a run in progress. SQL cannot express a dotted
 * key at all, so the failure mode here would be different (an undefined column),
 * but the RULE is the same one and it is cheaper to enforce it identically in
 * both implementations than to explain why they differ. Task ids and tag names
 * are opaque user-influenced strings, so a dotted key can arrive from DATA, not
 * only from a typo.
 */
export function assertNoNestedPaths(keys: string[], what: string): void {
  for (const k of keys) {
    if (PATH_SPECIALS.test(k)) {
      throw new DataError(
        'failed-precondition',
        `${what}: patch key ${JSON.stringify(k)} looks like a nested path. ` +
          'Patches on this interface are SHALLOW — a nested object value replaces ' +
          'the stored value wholesale. Use the named method for nested records ' +
          '(patchTaskRecord / patchStageRecord / …).',
        { key: k },
      );
    }
  }
}

export interface SetClause {
  /** `col = $1::text` fragments, in order. EMPTY when the patch writes nothing. */
  assignments: string[];
  params: unknown[];
  /** Next free placeholder index, so a caller can append WHERE parameters. */
  nextIndex: number;
}

/**
 * Translate a `Patch<T>` into an `UPDATE … SET` clause.
 *
 * `startIndex` lets a caller reserve `$1…$k` for its WHERE parameters — or, more
 * usually, take the SET clause first and append the WHERE params afterwards
 * using `nextIndex`.
 *
 * A field present in the patch but ABSENT from `map` is an error, not a
 * silently-ignored key: an unmapped field means the patch is trying to write
 * something this aggregate has no column for, and swallowing it is how a caller
 * comes to believe it stored a value it did not. (The one deliberate exception
 * is handled by the caller, which strips fields it is contractually forbidden to
 * patch — `RunTeam.stages` — BEFORE calling here.)
 */
export function buildSetClause(
  patch: Record<string, unknown> | null | undefined,
  map: FieldMap,
  what: string,
  startIndex = 1,
): SetClause {
  const out: SetClause = { assignments: [], params: [], nextIndex: startIndex };
  if (!patch) return out;

  const keys = Object.keys(patch);
  assertNoNestedPaths(keys, what);

  for (const field of keys) {
    const v = patch[field];

    // ── ABSENT. The whole point of the file: not in the SET clause at all. ──
    if (v === undefined) continue;

    const col: Column | undefined = map[field];
    if (!col) {
      throw new DataError(
        'failed-precondition',
        `${what}: no column is mapped for field ${JSON.stringify(field)}`,
        { field },
      );
    }
    if (col.readOnly) {
      throw new DataError(
        'failed-precondition',
        `${what}: field ${JSON.stringify(field)} maps to a read-only column (${col.name})`,
        { field, column: col.name },
      );
    }

    // ── DELETE. "Remove the field." ────────────────────────────────────────
    // On a nullable column that is NULL. On a NOT NULL column it CANNOT be
    // NULL (23502), so it is the column DEFAULT — the value a row that never
    // carried the field would have had, which is the closest thing SQL has to
    // "the key is not there". The read side completes the round trip via
    // `Column.omitWhenDefault` (see mapping.ts).
    if (isDelete(v)) {
      out.assignments.push(`${col.name} = ${col.nullable ? 'null' : 'default'}`);
      continue;
    }

    // ── A REAL STORED NULL. Not a delete — see the header. At rest it is the
    // same NULL the DELETE branch writes, and README §3 says that is fine: the
    // distinction has to survive the patch, not the row.
    if (v === null) {
      if (col.nullable) {
        out.assignments.push(`${col.name} = null`);
      } else {
        // A null for a NOT NULL column is a caller error, but refusing the whole
        // patch over it would be worse than the Firestore behaviour it replaces.
        // DEFAULT is the same answer DELETE gets, and it is reported in `detail`
        // if anyone goes looking.
        out.assignments.push(`${col.name} = default`);
      }
      continue;
    }

    // ── A VALUE. Written as-is, replacing wholesale (no merge). ─────────────
    out.assignments.push(`${col.name} = $${out.nextIndex}::${castOf(col)}`);
    out.params.push(encodeValue(col, v, `${what}.${field}`));
    out.nextIndex++;
  }

  return out;
}

/**
 * True when a patch would write nothing.
 *
 * NOTE `{ x: DELETE }` is NOT empty — removing a field is a write. This is
 * exactly the predicate `firestore/patch.ts` exposes, kept identical so a caller
 * reading both implementations does not have to check whether they agree.
 */
export function isEmptyPatch(patch: Record<string, unknown> | null | undefined): boolean {
  if (!patch) return true;
  for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined) return false;
  }
  return true;
}

/**
 * Apply a `Patch<T>` to an IN-MEMORY object with the same three-valued rule.
 *
 * Needed where a patch targets something that is NOT a column: `Run.leaderboard`
 * and `RunTeam.powerUps` are `jsonb` value objects, and a nested record patch
 * (`patchStageRecord`) is expressed over a domain shape before it is written
 * back. Here `DELETE` really does mean `delete obj[k]`.
 *
 * Returns a NEW object; the input is never mutated.
 */
export function applyPatchInMemory<T extends object>(
  base: T,
  patch: Record<string, unknown> | null | undefined,
  what: string,
): T {
  if (!patch) return { ...base };
  const keys = Object.keys(patch);
  assertNoNestedPaths(keys, what);

  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of keys) {
    const v = patch[k];
    if (v === undefined) continue;    // absent ⇒ leave alone
    if (isDelete(v)) delete out[k];   // DELETE ⇒ remove the key entirely
    else out[k] = v;                  // value (incl. null) ⇒ replace wholesale
  }
  return out as T;
}
