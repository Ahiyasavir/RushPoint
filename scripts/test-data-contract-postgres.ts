// ─── The repository CONTRACT, against a REAL Postgres — no Docker, no server ──
//
// scripts/test-data-contract.ts runs the contract against the in-memory
// reference (the FAST lane). THIS file runs the SAME contract against the
// PostgresRepository that actually ships, on a REAL PostgreSQL instance: PGlite
// (Postgres compiled to WASM, in-process, from npm). Two things get proven at
// once, and both were previously only asserted by eye:
//
//   1. The DDL in `supabase/migrations/*.sql` EXECUTES. 1,710 lines of schema
//      that had never touched a running Postgres now create real tables, types,
//      constraints, generated columns, partitions and functions — or this test
//      fails loudly on the exact line that doesn't.
//   2. The Postgres implementation is BEHAVIOUR-NEUTRAL. If it passes the same
//      contract the in-memory reference and Firestore pass, swapping the storage
//      engine is safe BY CONSTRUCTION, which is the whole argument of the
//      migration.
//
// ── What PGlite is and is not ────────────────────────────────────────────────
//
// PGlite IS real PostgreSQL: the same parser, planner, executor, MVCC and error
// codes. A `23505` here is a `23505` in production. It is NOT Supabase — GoTrue,
// PostgREST, Realtime and the `service_role`/`authenticated`/`anon` login roles
// live above the database, not in it. So this harness supplies a MINIMAL,
// CLEARLY-LABELLED shim for the few objects the schema references that a bare
// Postgres does not have (the `auth` schema, `auth.uid()`, the three Supabase
// roles). The shim adds nothing the repository can lean on: PostgresRepository
// talks to the database as the owner (as the backend's service role would),
// which BYPASSES RLS exactly as it does in production — so enabling RLS in 0002
// neither helps nor blocks it, and applying 0002 here only proves that the RLS
// SQL itself parses and executes.
//
// ── Honesty about concurrency ────────────────────────────────────────────────
//
// PGlite is a SINGLE connection. Real parallel transactions cannot interleave on
// it, so this harness serialises `transaction()` calls itself (see
// `PGliteClient`). That means the claim-contention scenario proves the
// implementation's LOGIC is correct when its transactions are run one-at-a-time
// with real BEGIN/COMMIT and real constraint enforcement — NOT that Postgres's
// MVCC resolves two genuinely simultaneous claimers. The emulator/real-cluster
// station-contention lane is what covers true parallelism; this lane covers
// "does the SQL the implementation emits do the right thing at all". Both are
// necessary; neither substitutes for the other.
//
// SAFETY: no network, no filesystem writes, no clock, no randomness. Reads the
// three migration files and nothing else.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
// 0001 requires `btree_gin` for its mixed btree+gin composite indexes. It ships
// with Supabase; here it is loaded as a PGlite contrib bundle so `create
// extension btree_gin` in the real migration succeeds unchanged.
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { runRepositoryContract } from '../packages/data/test/contract';
import { createPostgresRepository } from '../packages/data/src/postgres/repository';
import { toUuid } from '../packages/data/src/postgres/ids';
import type { SqlClient, SqlQueryable, SqlResult, SqlRow } from '../packages/data/src/postgres/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'supabase', 'migrations');

// ── The Supabase shim ────────────────────────────────────────────────────────
//
// Everything a bare Postgres lacks that `supabase/migrations/*.sql` names. Each
// line is here because the schema references it, and NOTHING here is something
// the repository reads — it only unblocks the DDL.
//
//  • roles `anon` / `authenticated` / `service_role`: 0002 grants to them, and
//    0001's partition helper revokes from the first two. `nologin` because we
//    never authenticate AS them here — the owner connection bypasses RLS.
//  • schema `auth` + `auth.uid()` / `auth.role()` / `auth.jwt()`: RLS policies
//    call them. `auth.uid()` returns NULL under the owner connection, which is
//    fine: RLS is bypassed for the owner, so the value is never consulted.
//  • `auth.users(id)`: `public.users.uid` has a FK to it (GoTrue owns identity).
//    The repository's `putProfile` inserts into `public.users` only, so without
//    help the FK would reject every creator. Rather than DROP the constraint
//    (which would stop proving it is valid DDL), a BEFORE-INSERT trigger mirrors
//    the new uid into `auth.users` first — the FK stays live and enforced, and
//    the one thing GoTrue would have done (create the identity row) is done for
//    it. Clearly a test-only bridge, and the only behavioural liberty taken.
const SHIM = `
  create schema if not exists auth;
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`;

// Installed AFTER 0001 (public.users must exist first). Keeps the auth.users FK
// enforced while letting the repository insert creators GoTrue would have owned.
const AUTH_USERS_BRIDGE = `
  create or replace function auth._mirror_user() returns trigger language plpgsql as $$
  begin
    insert into auth.users (id) values (new.uid) on conflict (id) do nothing;
    return new;
  end $$;
  drop trigger if exists _mirror_user on public.users;
  create trigger _mirror_user before insert on public.users
    for each row execute function auth._mirror_user();
`;

function loadMigration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8');
}

/**
 * PGlite as the injected `SqlClient` the repository expects.
 *
 * `transaction` runs a real `BEGIN … COMMIT/ROLLBACK` via EXPLICIT statements on
 * PGlite's one connection — NOT `db.transaction()`. That choice is load-bearing.
 * `db.transaction()` takes an EXCLUSIVE lock on the single connection for the
 * duration of the body; the contract's re-execution scenario deliberately issues
 * an OUT-OF-BAND write (through the base repository, to simulate a competing
 * writer "without a second thread") from INSIDE a transaction body — on Firestore
 * that write lands on another connection, but under an exclusive lock it would
 * queue behind the very COMMIT the body is waiting to reach, and deadlock. With
 * explicit BEGIN, every `query` — the body's and the out-of-band one — runs on
 * the same open connection, so the out-of-band write JOINS the transaction
 * instead of blocking it. The honest consequence: on this single-connection test
 * engine the re-execution scenario degenerates to Postgres's SINGLE-EXECUTION
 * path (which is exactly what real Postgres does — see NOT-IN-CONTRACT 2), and
 * true cross-connection conflict is the emulator/cluster lane's job, not this
 * one's.
 *
 * `transaction` calls are still SERIALISED through `tail` so two never open BEGIN
 * on the shared connection at once. A rejected body rolls back and the ORIGINAL
 * error object is re-thrown unchanged — the contract asserts identity on it.
 */
class PGliteClient implements SqlClient {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;
  constructor(private readonly db: PGlite) {}

  async query<R extends SqlRow = SqlRow>(sql: string, params?: unknown[]): Promise<SqlResult<R>> {
    const r = await this.db.query<R>(sql, params as unknown[] | undefined);
    return { rows: r.rows, rowCount: r.affectedRows };
  }

  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
    // The queryable handed to the body is just `this` — on the single connection
    // it is already inside the BEGIN this method opened.
    const q: SqlQueryable = { query: (sql, params) => this.query(sql, params) };
    const run = this.tail.then(async () => {
      await this.db.query('begin');
      this.depth++;
      try {
        const out = await fn(q);
        await this.db.query('commit');
        return out;
      } catch (e) {
        try {
          await this.db.query('rollback');
        } catch {
          /* a failed rollback must not mask the body's error */
        }
        throw e; // unchanged — `caught === marker` identity is preserved
      } finally {
        this.depth--;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }
}

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string): void => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  ✗ ${msg}`);
    }
  };

  const db = new PGlite({ extensions: { btree_gin } });

  // ── Apply the shim and the REAL migrations, in order ──────────────────────
  // A throw here is the headline result: the schema did not execute. The error
  // carries the SQLSTATE and, for a syntax/undefined-object error, the offending
  // text — which is exactly the line to look at.
  // Auto-discover every migration in order, so a new `000N_*.sql` is covered the
  // day it lands. The auth.users bridge is injected right after 0001 (it needs
  // public.users to exist and must precede any insert of a creator).
  const migrationFiles = readdirSync(MIGRATIONS)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  const steps: Array<[string, string]> = [['supabase shim', SHIM]];
  for (const f of migrationFiles) {
    steps.push([f, loadMigration(f)]);
    if (/^0001/.test(f)) steps.push(['auth.users bridge (test-only)', AUTH_USERS_BRIDGE]);
  }
  for (const [label, sql] of steps) {
    try {
      await db.exec(sql);
      console.log(`  · applied ${label}`);
    } catch (e) {
      console.error(`\n  ✗ FAILED APPLYING ${label}`);
      console.error(`    ${(e as Error).message}`);
      console.error('\ndata-contract-postgres: schema did not execute — see above.');
      process.exit(1);
    }
  }
  ok(true, 'the real migrations execute on a real Postgres');

  // The set of tables to blank between scenarios (contract requires each
  // scenario to start empty). Discover them rather than hard-coding, so a new
  // table is covered automatically.
  const tablesRes = await db.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  console.log(`  · discovered ${tablesRes.rows.length} public tables to reset`);
  const tables = tablesRes.rows.map((r) => `public."${r.tablename}"`);
  const truncateAll = tables.length
    ? `truncate ${tables.join(', ')} restart identity cascade`
    : 'select 1';

  const client = new PGliteClient(db);

  // ── Referential parents the contract cannot seed itself ───────────────────
  //
  // A real Postgres enforces `runs.game_id → games` and `runs.owner_uid →
  // users` (and `games.owner_uid → users`) — referential integrity the document
  // stores never had, so the in-memory and Firestore runs never needed a parent
  // game to exist before a run. `ContractRepository` is a deliberately NARROWED
  // surface (no `putGame`/`putProfile`), so the fixtures cannot create those
  // parents through it. The harness supplies them directly instead — the exact
  // context the app always has (a run belongs to a game owned by a creator),
  // and nothing the contract then asserts on. `toUuid` is the repository's OWN
  // id derivation, so the derived owner uuid matches what `putRun` will store,
  // and `legacy_firebase_uid` is what makes a read of `Run.ownerUid` return the
  // original 'owner-1' rather than its uuid. These mirror contract.ts's fixed
  // OWNER/GAME constants; if either drifts, the FK error returns immediately.
  const OWNER = 'owner-1';
  const GAME = 'game-1';
  const seedParents = async (): Promise<void> => {
    await db.query(
      `insert into users (uid, legacy_firebase_uid) values ($1, $2) on conflict do nothing`,
      [toUuid(OWNER), OWNER],
    );
    await db.query(
      `insert into games (id, owner_uid, title) values ($1, $2, $3) on conflict do nothing`,
      [GAME, toUuid(OWNER), 'Contract Fixture Game'],
    );
  };

  // ── Run the contract, once per scenario, each against a blank database ─────
  // `absentDistinctFromNull: false` — Postgres has ONE null, so the
  // Firestore-only half of the Patch suite (a stored value that is "absent" yet
  // not null) is not asserted here, per contract.ts's documented option.
  const result = await runRepositoryContract(
    async () => {
      await db.exec(truncateAll);
      await seedParents();
      return createPostgresRepository(client);
    },
    'postgres via pglite',
    { absentDistinctFromNull: false },
  );

  for (const failure of result.failures) console.error(`  ✗ ${failure}`);
  for (const n of result.notes) console.log(`  · ${n}`);

  ok(
    result.failed === 0,
    `PostgresRepository passes the contract (${result.failed} assertion(s) failed)`,
  );
  ok(
    result.passed > 40,
    `the contract asserted something substantial against Postgres (${result.passed} assertions)`,
  );

  console.log(
    `\n  postgres: ${result.passed} contract assertions passed, ${result.failed} failed`,
  );
  console.log(`\ndata-contract-postgres: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  await db.close();
}

main().catch((e) => {
  console.error('data-contract-postgres: suite threw', e);
  process.exit(1);
});
