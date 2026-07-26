// ─── Patch semantics — the single most load-bearing file in this package ─────
//
// `Patch<T>` is THREE-valued (types.ts, "ABSENT vs NULL"):
//
//   field absent from the patch object  → leave the stored value alone
//   field present with a value (incl. null) → write that value
//   field present with the DELETE token → remove the field entirely
//
// Getting this wrong is not a cosmetic bug. `Game.safeZone?: SafeZone | null`
// means "undefined = the Builder did not send this field" and "null = the
// creator REMOVED the boundary". Collapsing the two silently un-clears safe
// zones — the boundary comes back after the creator deleted it.
//
//
// ── Why `undefined` can never mean "delete" ──────────────────────────────────
//
// `functions/src/firebase.ts` configures the Admin SDK with
// `ignoreUndefinedProperties: true` (it has to: optional domain fields would
// otherwise crash writes). With that setting ON, `update({ safeZone: undefined })`
// is a SILENT NO-OP — the field is dropped before it reaches the wire, so the
// stored value survives.
//
// So on this backend "absent" and "present-but-undefined" are ALREADY the same
// thing, and no amount of care at a call site can distinguish them. That is
// precisely why the delete token is an explicit `Symbol` compared by identity:
// it is the only value that survives a spread, a JSON round trip and
// `Object.assign` while still being unmistakably "remove this".
//
//
// ── Why `.update()` and not `.set({merge:true})` ─────────────────────────────
//
// Both accept `FieldValue.delete()`, but they differ on dotted keys:
//
//   .set({ 'a.b': v }, { merge: true })  → writes a LITERAL top-level field
//                                          named "a.b". This has shipped as a
//                                          bug in this repo.
//   .update({ 'a.b': v })                → writes the NESTED path a → b, and on
//                                          an ARRAY (`stages.0.tasks.0`) coerces
//                                          the array into a map. Also shipped.
//
// This package forbids dotted keys outright (README rule 4), so the remaining
// difference is what happens to a MISSING document: `set({merge:true})` creates
// a partial one, `update()` fails with NOT_FOUND. A `patch*` on this interface
// means "modify a document that exists"; creating a half-populated document
// that satisfies no domain type is strictly worse than a loud `not-found`, so
// `update()` wins and every `patch*` maps to it.
//
// `assertNoFieldPaths` enforces the dotted-key ban at runtime, because a key
// only has to be dotted ONCE to corrupt an array beyond repair.

import { DataError, DELETE, isDelete } from '../types';
import type { FsDocumentData, FsValue } from './context';


/** Characters Firestore interprets specially inside a field path. */
const FIELD_PATH_SPECIALS = /[.`[\]/*~]/;

/**
 * Reject any patch key Firestore would parse as a FIELD PATH rather than as a
 * plain field name.
 *
 * `.update()` treats `'a.b'` as a nested path, and against an array element
 * (`'stages.0.tasks.0'`) it silently converts the array into a map — an
 * unrecoverable corruption of a run in progress. Task ids, tag names and
 * feature flags are user-influenced opaque strings, so a dotted key can arrive
 * from data, not only from a typo. Refuse loudly.
 */
export function assertNoFieldPaths(keys: string[], what: string): void {
  for (const k of keys) {
    if (FIELD_PATH_SPECIALS.test(k)) {
      throw new DataError(
        'failed-precondition',
        `${what}: patch key ${JSON.stringify(k)} looks like a Firestore field path. ` +
          'Patches on this interface are SHALLOW — a nested object value replaces ' +
          'the stored object wholesale. Use the named method for nested records ' +
          '(patchTaskRecord / patchStageRecord / …).',
        { key: k },
      );
    }
  }
}

/**
 * Translate a `Patch<T>` into the field map handed to `.update()`.
 *
 * - key absent, or value `undefined`  → OMITTED from the result (leave alone).
 *   `undefined` is folded into "absent" deliberately: `ignoreUndefinedProperties`
 *   makes them indistinguishable on the wire anyway, and the type of `Patch<T>`
 *   already refuses `undefined` for a required field, so the only way to get
 *   here with one is a JSON round trip — where it really did mean "absent".
 * - value `DELETE`                    → the driver's `FieldValue.delete()`.
 * - value `null`                      → a REAL STORED NULL. Not a delete.
 * - anything else                     → written as-is, replacing wholesale.
 *
 * Returns `null` when the patch is empty after translation, so the caller can
 * skip the write entirely. That matters: an empty `.update({})` against a
 * missing document would still throw NOT_FOUND, turning a semantic no-op into a
 * spurious error.
 */
export function toUpdateData(
  patch: Record<string, unknown> | null | undefined,
  deleteSentinel: () => FsValue,
  what: string,
): FsDocumentData | null {
  if (!patch) return null;
  const keys = Object.keys(patch);
  assertNoFieldPaths(keys, what);

  const out: FsDocumentData = {};
  let count = 0;
  for (const k of keys) {
    const v = patch[k];
    if (v === undefined) continue;          // absent ⇒ leave the stored value alone
    out[k] = isDelete(v) ? deleteSentinel() // DELETE ⇒ remove the field
      : (v as FsValue);                     // includes `null` ⇒ store a real null
    count++;
  }
  return count === 0 ? null : out;
}

/**
 * Apply a `Patch<T>` to an IN-MEMORY object, with the same three-valued
 * semantics.
 *
 * Needed wherever a nested record is rewritten rather than field-path-updated:
 * `RunTeam.stages[]` is one document, so patching one `RunTaskRecord` is a
 * read-modify-rewrite of the array INSIDE this repository (README rule 5). Here
 * `DELETE` maps to `delete obj[k]`, which is what `FieldValue.delete()` means
 * once the value is a plain object.
 *
 * Returns a NEW object; the input is never mutated, so a Firestore transaction
 * body that re-executes cannot observe a partially-applied patch from a
 * previous attempt.
 */
export function applyPatchInMemory<T extends object>(
  base: T,
  patch: Record<string, unknown> | null | undefined,
  what: string,
): T {
  if (!patch) return { ...base };
  const keys = Object.keys(patch);
  assertNoFieldPaths(keys, what);

  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of keys) {
    const v = patch[k];
    if (v === undefined) continue;   // absent ⇒ leave alone
    if (isDelete(v)) delete out[k];  // DELETE ⇒ remove the key entirely
    else out[k] = v;                 // value (incl. null) ⇒ replace wholesale
  }
  return out as T;
}

/**
 * True when a patch would write nothing. Callers use it to skip a round trip.
 * Note a patch of `{ x: DELETE }` is NOT empty — removing a field is a write.
 */
export function isEmptyPatch(patch: Record<string, unknown> | null | undefined): boolean {
  if (!patch) return true;
  for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined) return false;
  }
  return true;
}

/**
 * Strip `undefined` values out of a whole-document write.
 *
 * `put*` methods take a COMPLETE domain object, and optional domain fields are
 * routinely `undefined`. Production tolerates them via
 * `ignoreUndefinedProperties: true`, but a test double or a future driver
 * without that setting would reject the write — so they are removed here rather
 * than relied on being ignored downstream. A `DELETE` token in a whole-document
 * write is meaningless (there is no prior document to remove a field from) and
 * is refused.
 */
export function toDocumentData(
  value: Record<string, unknown>,
  what: string,
): FsDocumentData {
  const out: FsDocumentData = {};
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (v === undefined) continue;
    if (v === DELETE) {
      throw new DataError(
        'failed-precondition',
        `${what}: the DELETE token is only meaningful in a patch, not in a whole-document write`,
        { key: k },
      );
    }
    out[k] = v as FsValue;
  }
  return out;
}
