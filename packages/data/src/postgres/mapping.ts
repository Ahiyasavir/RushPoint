// ─── Domain field ⇄ SQL column mapping ───────────────────────────────────────
//
// Firestore stored the domain object VERBATIM: a document was the TypeScript
// shape, so there was nothing to map and nothing to get wrong. Postgres does not
// work that way — `RunTeam.activeTaskId` is `run_teams.active_task_id`,
// `Run.isTestDrive` is `runs.is_test_drive`, an ISO instant is a `timestamptz`,
// and a `Record<string, unknown>` is `jsonb`.
//
// That mapping is DECLARED here as data, once per aggregate, rather than being
// spelled out inside each of ~40 methods. Three reasons, all of them things this
// repo has been bitten by before:
//
//   1. A field that is missing from the map is missing from BOTH directions, so
//      a write that silently drops a column cannot coexist with a read that
//      still returns it. (Compare `BUILDER_EDITABLE_FIELDS` in creator-web: the
//      save payload IS the dirty check, and a field missing from the list looked
//      alive because local state round-tripped.)
//   2. `Patch<T>` has to build a SET list from the same map, or "omitted" and
//      "cleared" would be decided in a different place from where the column
//      name is decided. See patch.ts — that is THE load-bearing translation.
//   3. NOT NULL columns need an explicit answer to "what does DELETE mean here",
//      and the answer belongs next to the column, not in a call site.
//
//
// ── ABSENT vs NULL, at rest ──────────────────────────────────────────────────
//
// README §3 is explicit that Postgres cannot distinguish "field absent" from
// "column NULL" and does not have to: the distinction only has to survive the
// PATCH, not the ROW. `contract.ts` gates the at-rest half behind
// `options.absentDistinctFromNull`, which this implementation leaves FALSE.
//
// What that leaves this file responsible for is the READ side: which NULL
// columns come back as `null`, and which come back as ABSENT.
//
//   emitNull: true   ⇒ the DOMAIN TYPE itself admits null
//                      (`RunTeam.activeTaskId?: string | null`,
//                       `RunTeam.evacuatedFrom?: string | null`,
//                       `Wallet.proExpiresAt?: string | null`).
//   emitNull absent  ⇒ the domain type is merely optional, so a NULL column is
//                      reported as an ABSENT KEY, which is what a Firestore
//                      document with no such field looked like.
//
// That is not a convenience: `contract.ts` asserts `t?.activeTaskId === null`
// after a null patch AND after an undefined patch, and separately asserts that a
// DELETEd optional field reads back `undefined` or `null`.

import { DELETE, DataError } from '../types';
import { toUuid } from './ids';


// ─── Column descriptors ──────────────────────────────────────────────────────

/**
 * SQL types this mapping knows how to encode a JS value into and decode a driver
 * value out of. Kept as a closed union so a typo becomes a compile error rather
 * than a silently unconverted value.
 */
export type SqlType =
  | 'text'
  | 'uuid'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'double precision'
  | 'boolean'
  | 'timestamptz'
  | 'jsonb'
  | 'text[]'
  | 'uuid[]'
  | 'integer[]'
  /** A named enum type. Encoded as text and cast; decoded as text. */
  | 'enum'
  /** An ARRAY of a named enum type (`staff_permission[]`). */
  | 'enum[]';

export interface Column {
  /** The physical column name. */
  readonly name: string;
  readonly type: SqlType;
  /** For `type: 'enum'`, the Postgres type name used in the `::cast`. */
  readonly enumType?: string;
  /**
   * FALSE (the default) means the column is NOT NULL.
   *
   * This is the answer to "what does `DELETE` mean for a column that cannot
   * hold NULL". It cannot be `SET col = NULL` — that is a 23502 violation. It is
   * `SET col = DEFAULT`, which restores the column to the value a document that
   * never carried the field would have had. See `omitWhenDefault`.
   */
  readonly nullable?: boolean;
  /**
   * Read-side companion to the above. When a NOT NULL column holds its default,
   * the domain field is reported as ABSENT.
   *
   * `RunTeam.smartStreak?: number` over `smart_streak integer not null default 0`
   * is the canonical case: 0 and "no streak" are the same fact, and the contract
   * requires `DELETE` on that field to read back as undefined/null rather than
   * as a number. Set it ONLY where the default really is indistinguishable from
   * absence in the domain.
   */
  readonly omitWhenDefault?: string | number | boolean;
  /** Report a NULL column as a real `null` rather than as an absent key. */
  readonly emitNull?: boolean;
  /** Override the encode step (e.g. an identity string that must become a uuid). */
  readonly encode?: (v: unknown) => unknown;
  /** Override the decode step. */
  readonly decode?: (v: unknown) => unknown;
  /**
   * A read-only column: it is decoded into the domain object but never written.
   * Used for GENERATED columns (`games.stage_count`) and for values assembled by
   * a join or a sub-select (`owner_uid` resolved back through `users`).
   */
  readonly readOnly?: boolean;
}

/** domain field name → column. The single source of truth for one aggregate. */
export type FieldMap = Record<string, Column>;


// ─── Array literals ──────────────────────────────────────────────────────────
//
// Passed as a TEXT parameter with an explicit `::text[]` cast rather than handed
// to the driver as a JS array, because array serialisation is the one place the
// three target drivers genuinely disagree. A literal both accepts is portable by
// construction, and quoting every element makes the encoder total — an element
// containing a comma, a brace, a quote or a backslash cannot change the parse.

export function encodeArrayLiteral(v: unknown, what: string): string {
  if (!Array.isArray(v)) {
    throw new DataError('failed-precondition', `${what}: expected an array`, { got: typeof v });
  }
  const parts = v.map((el) => {
    const s = String(el);
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(',')}}`;
}

/**
 * Decode whatever the driver produced for an array column.
 *
 * `pg` and PGlite both parse array columns into JS arrays; `postgres.js` does
 * too. The literal branch exists so a driver configured WITHOUT array parsing
 * degrades to correct-but-slow instead of returning a string where the domain
 * expects a list.
 */
function decodeArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  const body = v.replace(/^\{/, '').replace(/\}$/, '');
  if (body === '') return [];
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}


// ─── Encode: JS value → query parameter ──────────────────────────────────────

/**
 * Turn a domain value into a parameter for `$n::<type>`.
 *
 * Every parameter is sent as text and cast in SQL. That is on purpose: it makes
 * the statement's intent readable in a log, it removes any dependence on the
 * driver's inferred parameter types, and it is the only way `timestamptz`,
 * `jsonb` and array columns behave identically across the three drivers.
 */
export function encodeValue(col: Column, v: unknown, what: string): unknown {
  if (v === null || v === undefined) return null;
  if (col.encode) return col.encode(v);

  switch (col.type) {
    case 'uuid':
      return toUuid(String(v));
    case 'uuid[]':
      return encodeArrayLiteral((v as unknown[]).map((x) => toUuid(String(x))), what);
    case 'text[]':
    case 'integer[]':
    case 'enum[]':
      return encodeArrayLiteral(v, what);
    case 'jsonb':
      return JSON.stringify(v);
    case 'integer':
    case 'bigint':
    case 'numeric':
    case 'double precision':
      return Number(v);
    case 'boolean':
      return Boolean(v);
    case 'timestamptz':
      // Stored EXACTLY as handed in (types.ts RULE 3 — no clock of our own).
      return String(v);
    case 'enum':
    case 'text':
    default:
      return String(v);
  }
}

/** The `::type` suffix a parameter needs. */
export function castOf(col: Column): string {
  if (col.type === 'enum') return col.enumType ?? 'text';
  if (col.type === 'enum[]') return `${col.enumType ?? 'text'}[]`;
  return col.type;
}


// ─── Decode: driver value → domain value ─────────────────────────────────────

function decodeInstant(v: unknown): string {
  // `pg` and PGlite both hand back a JS Date for timestamptz. A string arrives
  // only from a driver with date parsing disabled — pass it through rather than
  // re-parsing, since the caller stored an ISO string in the first place.
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function decodeValue(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.decode) return col.decode(v);

  switch (col.type) {
    case 'timestamptz':
      return decodeInstant(v);
    case 'integer':
    case 'bigint':
    case 'numeric':
    case 'double precision':
      // `numeric` comes back as a STRING from every driver that cares about
      // precision. The domain types are `number`, so the conversion is here and
      // not at 30 call sites.
      return typeof v === 'number' ? v : Number(v);
    case 'boolean':
      return Boolean(v);
    case 'text[]':
    case 'uuid[]':
    case 'enum[]':
      return decodeArray(v).map(String);
    case 'integer[]':
      return decodeArray(v).map(Number);
    case 'jsonb':
      // Parsed by the driver. A string only appears if jsonb parsing is off.
      return typeof v === 'string' ? JSON.parse(v) : v;
    case 'uuid':
    case 'enum':
    case 'text':
    default:
      return typeof v === 'string' ? v : String(v);
  }
}


// ─── Row → domain object ─────────────────────────────────────────────────────

/**
 * Rebuild a domain object from one row, using `map`.
 *
 * Absence rules (see the header):
 *   NULL column, `emitNull`            → the key is present holding `null`
 *   NULL column, no `emitNull`         → the key is ABSENT
 *   value equals `omitWhenDefault`     → the key is ABSENT
 *   anything else                      → decoded value
 *
 * A column named in the map but MISSING from the row is skipped rather than
 * decoded as NULL: a partial projection must not be able to manufacture a
 * "cleared" field. (This implementation always selects `*`, so it should not
 * happen — but a fabricated absence is exactly the class of bug the Firestore
 * implementation's `notImplemented` policy exists to prevent.)
 */
export function rowToDomain<T>(row: Record<string, unknown>, map: FieldMap): T {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(map)) {
    const col = map[field];
    if (!(col.name in row)) continue;
    const raw = row[col.name];
    if (raw === null || raw === undefined) {
      if (col.emitNull) out[field] = null;
      continue;
    }
    const decoded = decodeValue(col, raw);
    // A `decode` may return `undefined` to mean "this reads as ABSENT" — how an
    // empty `text[]`/`jsonb` array column reproduces a Firestore document that
    // simply had no such field (see `emptyArrayIsAbsent` in schema.ts).
    if (decoded === undefined) continue;
    if (col.omitWhenDefault !== undefined && decoded === col.omitWhenDefault) continue;
    out[field] = decoded;
  }
  return out as unknown as T;
}


// ─── Whole-object write (`put*` semantics: create or replace) ────────────────

export interface InsertPlan {
  columns: string[];
  /** `$1::text, $2::timestamptz, …` — same order as `columns`. */
  placeholders: string[];
  params: unknown[];
}

/**
 * Build the column/placeholder/param triple for a COMPLETE domain object.
 *
 * Unlike a patch, a `put*` is create-or-REPLACE: a field the object does not
 * carry must be RESET, not preserved. So EVERY writable column in the map is
 * always listed — a field the object omits contributes `NULL` for a nullable
 * column and the SQL keyword `DEFAULT` for a NOT NULL one.
 *
 * Listing every column unconditionally is what makes the paired
 * `on conflict … do update set col = excluded.col` a true replace. If an
 * omitted column were dropped from the list instead, `excluded.col` would not
 * exist for it and the PRIOR value would survive a `put*` — a create-or-replace
 * that silently merges, which is the bug this comment exists to prevent.
 *
 * A `DELETE` token in a whole-object write is meaningless — there is no prior
 * row to remove a field from — and is refused, exactly as the Firestore
 * implementation's `toDocumentData` refuses it.
 */
export function buildInsert(
  value: Record<string, unknown>,
  map: FieldMap,
  what: string,
  startIndex = 1,
): InsertPlan {
  const plan: InsertPlan = { columns: [], placeholders: [], params: [] };
  let i = startIndex;
  for (const field of Object.keys(map)) {
    const col = map[field];
    if (col.readOnly) continue;
    const v = value[field];
    if (v === DELETE) {
      throw new DataError(
        'failed-precondition',
        `${what}: the DELETE token is only meaningful in a patch, not in a whole-object write`,
        { field },
      );
    }
    plan.columns.push(col.name);
    if (v === undefined || v === null) {
      // NULL would be a 23502 on a NOT NULL column, so the absence of a value
      // means "whatever a row that never carried this field would have had".
      plan.placeholders.push(col.nullable ? `$${i}::${castOf(col)}` : 'default');
      if (col.nullable) { plan.params.push(null); i++; }
      continue;
    }
    plan.placeholders.push(`$${i}::${castOf(col)}`);
    plan.params.push(encodeValue(col, v, `${what}.${field}`));
    i++;
  }
  return plan;
}

/** `col = excluded.col, …` for every column in an insert plan. */
export function excludedAssignments(plan: InsertPlan): string {
  return plan.columns.map((c) => `${c} = excluded.${c}`).join(', ');
}
