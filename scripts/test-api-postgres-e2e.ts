// ─── The Node API server, end to end, over the REAL Postgres repository ──────
//
// scripts/test-api-contract.ts proves the callable PROTOCOL — error codes, the
// wire envelope, auth, CORS, malformed input — with a STUB repository and no
// database. It answers "does the server speak Firebase-callable correctly?".
//
// THIS file answers the other half, the one that actually gates a cutover to
// IONOS: "does the server, wired to the REAL PostgresRepository against a REAL
// Postgres, serve REAL data?". It boots the same `createServer` factory the
// production `index.ts` boots, injects a PostgresRepository backed by PGlite
// (Postgres-in-WASM, the same engine scripts/test-data-contract-postgres.ts
// uses), seeds a creator + game + run + access code, and drives `getJoinInfo`
// through Fastify's full request pipeline via `app.inject()` — routing, CORS,
// content-type handling, auth resolution, the handler, and JSON serialisation,
// exactly as a browser POST would traverse them.
//
// What a green run proves that nothing else did: HTTP → Fastify → callable
// dispatch → the ported handler → the repository interface → real SQL on real
// Postgres → the byte-identical response `apps/play-web` already expects. That
// is the replacement backend actually working, not merely typechecking.
//
// SAFETY: binds no socket (app.inject), no network, no clock beyond an injected
// one, no randomness. Reads the migration files and nothing else.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { createPostgresRepository } from '../packages/data/src/postgres/repository';
import { toUuid } from '../packages/data/src/postgres/ids';
import type { SqlClient, SqlQueryable, SqlResult, SqlRow } from '../packages/data/src/postgres/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'supabase', 'migrations');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// The minimal Supabase shim + FK bridge — identical intent to
// scripts/test-data-contract-postgres.ts (auth schema, the login roles, and a
// trigger that keeps the auth.users FK honest without dropping it).
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
const AUTH_USERS_BRIDGE = `
  create or replace function auth._mirror_user() returns trigger language plpgsql as $$
  begin insert into auth.users (id) values (new.uid) on conflict (id) do nothing; return new; end $$;
  drop trigger if exists _mirror_user on public.users;
  create trigger _mirror_user before insert on public.users
    for each row execute function auth._mirror_user();
`;

/** PGlite as the repository's SqlClient — explicit BEGIN/COMMIT on the one
 *  connection (see the rationale in test-data-contract-postgres.ts). */
class PGliteClient implements SqlClient {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: PGlite) {}
  async query<R extends SqlRow = SqlRow>(sql: string, params?: unknown[]): Promise<SqlResult<R>> {
    const r = await this.db.query<R>(sql, params as unknown[] | undefined);
    return { rows: r.rows, rowCount: r.affectedRows };
  }
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
    const q: SqlQueryable = { query: (sql, params) => this.query(sql, params) };
    const run = this.tail.then(async () => {
      await this.db.query('begin');
      try {
        const out = await fn(q);
        await this.db.query('commit');
        return out;
      } catch (e) {
        try {
          await this.db.query('rollback');
        } catch {
          /* don't mask the body error */
        }
        throw e;
      }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run as Promise<T>;
  }
}

async function main(): Promise<void> {
  const db = new PGlite({ extensions: { btree_gin } });
  await db.exec(SHIM);
  await db.exec(readFileSync(join(MIGRATIONS, '0001_core_schema.sql'), 'utf8'));
  await db.exec(AUTH_USERS_BRIDGE);
  await db.exec(readFileSync(join(MIGRATIONS, '0002_rls_policies.sql'), 'utf8'));
  await db.exec(readFileSync(join(MIGRATIONS, '0003_indexes.sql'), 'utf8'));
  await db.exec(readFileSync(join(MIGRATIONS, '0004_once_flags.sql'), 'utf8'));

  // ── Seed a real world through raw SQL (the repository has no access-code
  //    write method — access codes are minted by launchRun). uuids come from the
  //    repository's OWN derivation so getAccessCode → getGame → getRun line up. ─
  const OWNER = 'owner-1';
  const GAME = 'game-1';
  const RUN = 'run-1';
  const CODE = 'JOIN01';
  const ownerUuid = toUuid(OWNER);
  await db.query(`insert into users (uid, legacy_firebase_uid, display_name) values ($1, $2, $3)`,
    [ownerUuid, OWNER, 'Test Creator']);
  await db.query(
    `insert into games (id, owner_uid, title, description, mode, visibility)
     values ($1, $2, $3, $4, 'team', 'public')`,
    [GAME, ownerUuid, 'Old City Treasure Hunt', 'Find the hidden gems.'],
  );
  await db.query(
    `insert into runs (id, game_id, owner_uid, access_code, status) values ($1, $2, $3, $4, 'live')`,
    [RUN, GAME, ownerUuid, CODE],
  );
  await db.query(
    `insert into access_codes (code, owner_uid, game_id, run_id, status) values ($1, $2, $3, $4, 'unused')`,
    [CODE, ownerUuid, GAME, RUN],
  );

  const repo = createPostgresRepository(new PGliteClient(db));

  // ── Boot the SAME server factory production boots, with a fake token verifier
  //    (offline) and the real Postgres repo. ─────────────────────────────────
  const { createServer } = await import('../apps/api/src/server.js');
  const GOOD_TOKEN = 'good-token';
  const app = await createServer({
    deps: { repo },
    verifyIdToken: async (token: string) => {
      if (token === GOOD_TOKEN) return { uid: 'player-1' } as never;
      throw new Error('bad token');
    },
    allowedOrigins: ['https://rushpoint-play.web.app'],
    logger: false,
  });

  const post = (name: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/${name}`,
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(body),
    });

  // ── 1. The happy path: a real code resolves to real game data ──────────────
  const res = await post('getJoinInfo', { data: { code: CODE } }, { authorization: `Bearer ${GOOD_TOKEN}` });
  ok(res.statusCode === 200, `getJoinInfo over real Postgres is 200 (got ${res.statusCode})`);
  const result = (res.json() as { result?: Record<string, unknown> }).result;
  ok(!!result, 'the response is the callable {result: ...} envelope');
  ok(result?.title === 'Old City Treasure Hunt',
    `the title is read from real Postgres, got ${String(result?.title)}`);
  ok(result?.description === 'Find the hidden gems.',
    `the description round-trips through the repository, got ${String(result?.description)}`);
  ok(result?.mode === 'team', `the game mode is served, got ${String(result?.mode)}`);
  ok((result?.runStatus) === 'live',
    `the run status comes from the seeded run, got ${String(result?.runStatus)}`);
  const ctx = result?.context as { ownerUid?: string; gameId?: string; runId?: string } | undefined;
  ok(ctx?.gameId === GAME && ctx?.runId === RUN,
    `the resolved context points at the real game/run, got ${JSON.stringify(ctx)}`);
  ok(Array.isArray(result?.registrationFields),
    'registrationFields is served as an array');

  // ── 2. An unknown code: the REAL repo returns null → not-found ─────────────
  const missing = await post('getJoinInfo', { data: { code: 'NOPE99' } }, { authorization: `Bearer ${GOOD_TOKEN}` });
  ok(missing.statusCode === 404, `an unknown code is 404 (got ${missing.statusCode})`);
  ok((missing.json() as { error?: { status?: string } }).error?.status === 'NOT_FOUND',
    'an unknown code carries the canonical NOT_FOUND name to the client');

  // ── 3. A revoked code: real status column → permission-denied ──────────────
  await db.query(`update access_codes set status = 'revoked' where code = $1`, [CODE]);
  const revoked = await post('getJoinInfo', { data: { code: CODE } }, { authorization: `Bearer ${GOOD_TOKEN}` });
  ok(revoked.statusCode === 403, `a revoked code is 403 (got ${revoked.statusCode})`);
  ok((revoked.json() as { error?: { status?: string } }).error?.status === 'PERMISSION_DENIED',
    'a revoked code is PERMISSION_DENIED, decided from the real status column');
  await db.query(`update access_codes set status = 'unused' where code = $1`, [CODE]);

  // ── 4. Auth is still enforced end to end ───────────────────────────────────
  const noAuth = await post('getJoinInfo', { data: { code: CODE } });
  ok(noAuth.statusCode === 401, `a missing token is 401 (got ${noAuth.statusCode})`);

  await app.close();
  await db.close();

  console.log(`\napi-postgres-e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('api-postgres-e2e: suite threw', e);
  process.exit(1);
});
