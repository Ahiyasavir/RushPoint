// ─── Identity strings ↔ `uuid` columns ───────────────────────────────────────
//
// `0001_core_schema.sql` states the ID convention explicitly:
//
//   • IDENTITIES are `uuid` and line up with `auth.uid()` — users.uid,
//     run_teams.id, staff/device uids. That is what lets an RLS predicate say
//     `id = auth.uid()` with no cast.
//   • CONTENT IDS are `text` — game_id, run_id, stage_id, task_id.
//
// The domain types do not know that. `RunTeam.id`, `Run.ownerUid` and
// `StaffInvite.ownerUid` are all plain `string`, because under Firestore they
// were Firebase uids — which are NOT uuids (`kJ8s...`, 28 chars, base62). The
// schema anticipates exactly this and carries `legacy_firebase_uid` columns on
// `users` and `run_teams` "through the data migration".
//
//
// ── The rule this file implements ────────────────────────────────────────────
//
//   toUuid(s) = s            when s already IS a uuid  (the production case)
//             = derive(s)    otherwise                 (the migration/test case)
//
// `derive` is a pure, deterministic, dependency-free hash. It has to be pure and
// deterministic because the same identity string must resolve to the same row on
// every process and every call — there is no lookup table.
//
// It is deliberately NOT a cryptographic UUIDv5: this package compiles under a
// tsconfig with NO `@types/node` and no DOM (see tsconfig.check.json), so
// `crypto`, `Buffer` and `TextEncoder` are all unavailable. A 128-bit
// FNV-1a-with-avalanche is more than enough for a collision-free namespace of
// creator and participant ids, and its only job is to be STABLE.
//
//
// ── The honest limitation ────────────────────────────────────────────────────
//
// `derive` is one-way. A non-uuid identity therefore round-trips ONLY where the
// schema gave us somewhere to keep the original: `users.legacy_firebase_uid` and
// `run_teams.legacy_firebase_uid`. Everywhere else (`runs.owner_uid`,
// `alerts.team_id`, `run_teams.device_uids[]`, `run_task_records.reviewed_by`)
// the column holds the derived uuid and a read returns the uuid TEXT, not the
// original string — so those reads are exact only once the data migration has
// converted identities to real uuids, which is the stated end state of the
// schema's ID convention.
//
// Where a read MUST return the domain identity — `Run.ownerUid`,
// `RunTeam.ownerUid`, `StaffInvite.ownerUid` — this implementation joins
// `users` and reads `legacy_firebase_uid` back. It never guesses.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `s` is already a canonical uuid and needs no derivation. */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** 32-bit FNV-1a over `s`, seeded, then avalanched. Pure; no dependencies. */
function fnv1a32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 16777619, expressed as shifts so it stays in 32-bit integer math.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // Avalanche (murmur3 finaliser) — FNV alone leaves the low bits weak, and the
  // low bits are where our four words differ from one another.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function hex8(n: number): string {
  let s = (n >>> 0).toString(16);
  while (s.length < 8) s = '0' + s;
  return s;
}

/**
 * Deterministically derive a uuid from an arbitrary identity string.
 *
 * Four independently seeded 32-bit hashes give 128 bits. Version and variant
 * nibbles are stamped so the result is a syntactically valid uuid (Postgres's
 * `uuid` type accepts any 128 bits, but a value that does not look like a uuid
 * in a log is a support ticket waiting to happen). Version 8 = "custom", which
 * is what this is.
 */
export function deriveUuid(s: string): string {
  const a = hex8(fnv1a32(s, 0x811c9dc5));
  const b = hex8(fnv1a32(s, 0x01000193));
  const c = hex8(fnv1a32(s, 0x9e3779b9));
  const d = hex8(fnv1a32(s, 0x7f4a7c15));
  const all = a + b + c + d;                       // 32 hex chars
  const v = '8' + all.slice(13, 16);               // version 8
  // Variant bits 10xx ⇒ first nibble of group 4 forced into 8..b.
  const variantNibble = '89ab'[parseInt(all.slice(16, 17), 16) & 0x3];
  const w = variantNibble + all.slice(17, 20);
  return `${all.slice(0, 8)}-${all.slice(8, 12)}-${v}-${w}-${all.slice(20, 32)}`;
}

/** The one function the repository calls. See the header for the round-trip rule. */
export function toUuid(id: string): string {
  return isUuid(id) ? id.toLowerCase() : deriveUuid(id);
}

/** Optional-friendly variant: `null`/`undefined` stay as `null`. */
export function toUuidOrNull(id: string | null | undefined): string | null {
  return id === null || id === undefined || id === '' ? null : toUuid(id);
}
