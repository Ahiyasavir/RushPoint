// Applies the THREE Supabase migration files to a REAL PostgreSQL and asserts what
// actually landed in the catalogue. PGlite is Postgres compiled to WASM — same
// parser, same planner, same pg_catalog — so a syntax error, a bad FK, a mistyped
// column, a duplicate index name or a policy that references a missing table fails
// here exactly as it would in production. No Docker, no `supabase start`, no network.
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// ⚠ WHAT THIS DOES **NOT** PROVE — read this before trusting a green run.
//   This gate proves the schema INSTALLS. It does not prove the security model is
//   correct. See the "NOT VALIDATED" block this script prints at the end; it is
//   printed on success too, on purpose, so nobody reads a ✓ as "RLS is verified".
//
// SAFETY: this file opens no socket, starts no emulator and touches no project
// state. PGlite runs entirely in memory inside this process and is discarded.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', 'supabase', 'migrations');
const FILES = ['0001_core_schema.sql', '0002_rls_policies.sql', '0003_indexes.sql'];

// ── Floors, not exact counts ─────────────────────────────────────────────────
// Deliberately BELOW the real numbers (37 tables / 97 indexes / 30 policies at the
// time of writing). A floor lets the schema grow without a red gate, while a
// collapsed run — one file silently not applying — falls far below it and fails.
const MIN_TABLES = 30;
const MIN_INDEXES = 60;
const MIN_POLICIES = 20;
const MIN_FUNCTIONS = 8;
const EXPECTED_PARTITIONS = 4; // 0001 ends with ensure_location_track_partitions(now(), 4)

// The repo's scripts/ lane is transpiled to CJS by tsx, so there is no top-level
// await here — everything lives inside main().
async function main(): Promise<void> {

// ── Graceful skip ────────────────────────────────────────────────────────────
// A fresh worktree has no node_modules. This gate must not turn `npm test` red just
// because the optional WASM Postgres has not been installed yet — same posture as
// the emulator-bound scripts, which skip rather than fail when their dep is absent.
let PGlite: any;
try {
  // Indirected through a variable so the CJS transform emits a real dynamic import
  // (PGlite is ESM-only) instead of a bare require().
  const specifier = '@electric-sql/pglite';
  ({ PGlite } = await import(specifier));
} catch {
  console.log('supabase-schema: SKIPPED — @electric-sql/pglite is not installed.');
  console.log('  Run `npm i` (it is a devDependency of packages/data) to enable this gate.');
  console.log('  The migration SQL was NOT executed by this run.');
  process.exit(0);
}

const db = new PGlite();
await db.waitReady;

const version = String((await db.query('select version()')).rows[0].version).split(',')[0];
console.log(`engine: ${version}`);

// ── Environment stubs ────────────────────────────────────────────────────────
// These are Supabase PLATFORM pieces, not part of our schema. Stubbing them is how
// we test OUR SQL instead of testing the absence of GoTrue. Every stub is a hole in
// what this gate proves, and each one is re-reported at the bottom.
const STUBS = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
-- GoTrue owns this table in real Supabase. Minimal shape: enough for users.uid's FK.
create table if not exists auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text,
  raw_app_meta_data jsonb,
  created_at        timestamptz default now()
);
-- Stubbed to CONSTANTS. auth.uid() returning null is precisely why no policy's
-- predicate is exercised by this run.
create or replace function auth.uid()  returns uuid  language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text  language sql stable as $$ select 'authenticated'::text $$;
create or replace function auth.jwt()  returns jsonb language sql stable as $$ select '{}'::jsonb $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role;  end if;
end $$;
`;
await db.exec(STUBS);

// ── Apply the three files ────────────────────────────────────────────────────
const strippedExtensions: string[] = [];
const skippedGinIndexes: string[] = [];

for (const file of FILES) {
  let sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

  // PGlite does not bundle contrib. Their absence here is an ENVIRONMENT difference,
  // not a schema bug — Supabase ships them. Strip and report; never silently assume.
  sql = sql.replace(/^[ \t]*create extension[^;]*;.*$/gim, (m) => {
    const name = (m.match(/exists\s+"?([a-z_]+)"?/i) ?? m.match(/extension\s+"?([a-z_]+)"?/i) ?? [])[1];
    if (name && !strippedExtensions.includes(name)) strippedExtensions.push(name);
    return `-- [test] extension stripped: ${name ?? '?'}`;
  });

  // GIN over a plain btree-typed column needs btree_gin, which we just stripped.
  sql = sql.replace(/^[ \t]*create index[^;]*using gin[^;]*;[ \t]*$/gim, (m) => {
    skippedGinIndexes.push((m.match(/create index\s+(?:if not exists\s+)?(\S+)/i) ?? [])[1] ?? '?');
    return '-- [test] gin index skipped (needs btree_gin)';
  });

  let applyError = '';
  try {
    await db.exec(sql);
  } catch (e) {
    applyError = String((e as Error)?.message ?? e).split('\n')[0];
  }
  ok(applyError === '', `${file} applies cleanly — ${applyError || 'ok'}`);
  if (applyError) {
    // Nothing downstream is meaningful once a file failed to apply.
    console.error(`\nsupabase-schema: ${passed} passed, ${failed} failed (aborted after ${file})`);
    process.exit(1);
  }
}

// ── Read the catalogue back ──────────────────────────────────────────────────
async function count(sql: string): Promise<number> {
  const r = await db.query(sql);
  return Number(r.rows[0].n);
}

const tables = await count(
  `select count(*) n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p')`,
);
const indexes = await count(`select count(*) n from pg_indexes where schemaname = 'public'`);
const policies = await count(`select count(*) n from pg_policies where schemaname = 'public'`);
const functions = await count(
  `select count(*) n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'`,
);
const rlsTables = await count(
  `select count(*) n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity`,
);

console.log(
  `catalogue: ${tables} tables · ${indexes} indexes · ${rlsTables} rls-enabled · ` +
  `${policies} policies · ${functions} functions`,
);

ok(tables >= MIN_TABLES, `at least ${MIN_TABLES} tables exist (found ${tables})`);
ok(indexes >= MIN_INDEXES, `at least ${MIN_INDEXES} indexes exist (found ${indexes})`);
ok(policies >= MIN_POLICIES, `at least ${MIN_POLICIES} policies exist (found ${policies})`);
ok(functions >= MIN_FUNCTIONS, `at least ${MIN_FUNCTIONS} functions exist (found ${functions})`);

// 0002 enables RLS in a loop over every table in `public`, so "should have RLS" is
// literally "all of them". Name the offenders — a count alone would not say which.
const unprotected = (await db.query(
  `select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`,
)).rows.map((r: any) => String(r.relname));
ok(
  unprotected.length === 0,
  `every public table has relrowsecurity — unprotected: ${unprotected.join(', ') || 'none'}`,
);
ok(rlsTables === tables, `rls-enabled count (${rlsTables}) equals table count (${tables})`);

// ── location_track partitions ────────────────────────────────────────────────
// Computed from the clock, not hardcoded: 0001 ends with (now(), 4) ⇒ this month
// plus the next three. An INSERT with no matching partition ERRORS, so a missing
// partition is a real outage, not cosmetics.
const now = new Date();
const expectedPartitions = Array.from({ length: EXPECTED_PARTITIONS }, (_, i) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
  return `location_track_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
});
const actualPartitions = (await db.query(
  `select c.relname from pg_class c
     join pg_inherits inh on inh.inhrelid = c.oid
     join pg_class parent on parent.oid = inh.inhparent
    where parent.relname = 'location_track' order by 1`,
)).rows.map((r: any) => String(r.relname));

for (const name of expectedPartitions) {
  ok(actualPartitions.includes(name), `partition ${name} was materialised`);
}
ok(
  actualPartitions.length >= EXPECTED_PARTITIONS,
  `location_track has >= ${EXPECTED_PARTITIONS} partitions (found ${actualPartitions.length}: ${actualPartitions.join(', ')})`,
);

// The partition helpers must be callable, not merely parseable.
let helperError = '';
try {
  await db.exec(`select ensure_location_track_partitions(now() + interval '6 months', 2);`);
} catch (e) {
  helperError = String((e as Error)?.message ?? e).split('\n')[0];
}
ok(helperError === '', `ensure_location_track_partitions() runs — ${helperError || 'ok'}`);

// ── The honesty block ────────────────────────────────────────────────────────
// Printed on PASS as well as FAIL. A reader who sees only ✓ must not walk away
// believing the security model was tested.
console.log('\n────────────────────────────────────────────────────────────────');
console.log('⚠  NOT VALIDATED BY THIS GATE (green above does NOT cover these):');
console.log('');
console.log('  1. RLS POLICY CORRECTNESS. Policies were INSTALLED, never EXERCISED.');
console.log('     auth.uid() is stubbed to a constant NULL and no session ever assumes');
console.log('     the anon/authenticated roles, so not one policy predicate was');
console.log('     evaluated against real rows. A policy that leaks every row to every');
console.log('     user, or one that locks out its own owner, passes this gate.');
console.log('     ⇒ Authorization must be proven against a real Supabase (`supabase');
console.log('       start` + `db reset`) with real JWTs, the way firestore.rules was.');
console.log('');
console.log(`  2. EXTENSIONS. Stripped before applying: ${strippedExtensions.join(', ') || '(none)'}`);
console.log('     PGlite bundles no contrib. Whether they exist in the TARGET database');
console.log('     is unproven here — btree_gin is a genuine hard dependency.');
console.log('');
console.log(`  3. GIN INDEXES. ${skippedGinIndexes.length} skipped (they need btree_gin):`);
console.log(`     ${skippedGinIndexes.join(', ') || '(none)'}`);
console.log('     Their definitions were never parsed or built by Postgres here.');
console.log('');
console.log('  4. SUPABASE PLATFORM. auth.users, auth.uid/role/jwt and the roles');
console.log('     anon / authenticated / service_role are local STUBS. Their real');
console.log('     shapes, grants and default privileges are not under test.');
console.log('');
console.log('  5. DATA. No row was inserted. Constraints, checks, triggers and the');
console.log('     partition ROUTING are unexercised; only their DEFINITIONS applied.');
console.log('  6. PERFORMANCE. Index usefulness is not measured — only existence.');
console.log('────────────────────────────────────────────────────────────────');

console.log(`\nsupabase-schema: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

} // end main

main().catch((e) => {
  console.error(`  ✗ supabase-schema crashed: ${String((e as Error)?.message ?? e)}`);
  process.exit(1);
});
