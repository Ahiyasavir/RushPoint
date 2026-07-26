// ─── The RLS policies in 0002, ENFORCED against a REAL Postgres ───────────────
//
// scripts/test-data-contract-postgres.ts proves the schema (0001–0004) EXECUTES
// and that the repository — which talks to the DB as the service/owner role and
// therefore BYPASSES RLS — is behaviour-neutral. It deliberately does NOT test
// that the RLS policies in 0002 actually DENY anyone: the owner connection never
// has a policy applied to it.
//
// THIS file closes that gap. The whole "keep Firebase Auth + let clients read
// Firestore-style directly through Supabase" plan rests on 0002 being correct —
// a stranger MUST be denied and an owner MUST be allowed, per ROW, by the
// database itself. So here we:
//
//   1. Apply the same shim + real migrations as the contract harness, as the
//      PGlite superuser (RLS bypassed) — and SEED a small world with raw SQL:
//      a creator, a game, a run, two teams, an alert, announcements (one global,
//      one targeted), a flash mission, a staff session, an access code.
//   2. Simulate a CLIENT by opening a transaction and doing
//        set local role authenticated;   (or `anon`)
//        select set_config('request.jwt.claim.sub', '<uuid>', true);
//      so `auth.uid()` returns that uid and RLS applies exactly as it would to a
//      PostgREST request. We then issue the SAME `select` a client would and
//      assert the row count.
//
// ── Why this is genuinely non-vacuous ────────────────────────────────────────
//
// Every ALLOW assertion is paired with a DENY assertion against the identical
// query run as a DIFFERENT identity. A policy that accidentally granted everyone
// (e.g. `using (true)`) would make the DENY half return rows and FAIL. A policy
// that accidentally denied everyone would make the ALLOW half return zero and
// FAIL. Only a correctly-scoped predicate passes both halves.
//
// ── What PGlite gives us here, and its one honest limit ──────────────────────
//
// PGlite is real PostgreSQL: `set local role` really switches the effective role,
// RLS is really evaluated per row, and a REVOKE really yields `42501 permission
// denied`. The superuser connection owns the tables and bypasses RLS, so SET ROLE
// to the non-owner `authenticated`/`anon` roles is what turns policies ON — which
// is precisely how a Supabase client (a non-owner login role) is treated. The
// SECURITY DEFINER helpers (is_run_participant / is_staff_for_run / can_read_run /
// get_join_info) run as their owner exactly as in production. No limitation was
// hit that forced dropping a DENY; where a DENY manifests as a thrown permission
// error rather than an empty result (a table with NO grant at all), the test
// asserts the throw explicitly.
//
// SAFETY: no network, no filesystem writes beyond reading the migration files, no
// clock beyond `now()` inside Postgres, no randomness.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { toUuid } from '../packages/data/src/postgres/ids';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'supabase', 'migrations');

// Identical shim to the contract harness: the few objects a bare Postgres lacks
// that the migrations name. `auth.uid()` reads the JWT-sub GUC we set per client.
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

// Keeps the auth.users FK live while letting us seed creators GoTrue would own.
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

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string): void => {
    if (cond) {
      passed++;
    } else {
      failed++;
      console.error(`  ✗ ${msg}`);
    }
  };

  const db = new PGlite({ extensions: { btree_gin } });

  // ── Apply shim + real migrations, in order (superuser: RLS bypassed here) ──
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
      process.exit(1);
    }
  }

  // ── Identities ─────────────────────────────────────────────────────────────
  const OWNER = toUuid('owner-1'); // the creator who owns game-1 / run-1
  const STRANGER = toUuid('stranger-1'); // a DIFFERENT signed-in creator
  const TEAM_A = toUuid('team-a'); // a participant: run_teams.id == this uid
  const TEAM_B = toUuid('team-b'); // a second participant in the same run
  const OUTSIDER = toUuid('outsider-1'); // authenticated, but in NO run
  const STAFF = toUuid('staff-1'); // run-scoped staff via staff_sessions
  const CODE = 'ABC123';

  // ── Seed the world as the owner/superuser (RLS bypassed) ───────────────────
  const seed = `
    insert into users (uid, legacy_firebase_uid) values ('${OWNER}', 'owner-1');
    -- a second real creator, so users_self_read has a non-owner self to test
    insert into users (uid, legacy_firebase_uid) values ('${STRANGER}', 'stranger-1');

    insert into games (id, owner_uid, title) values ('game-1', '${OWNER}', 'Test Game');
    insert into runs (id, game_id, owner_uid, status, access_code)
      values ('run-1', 'game-1', '${OWNER}', 'live', '${CODE}');

    insert into run_teams (id, run_id, game_id, owner_uid, display_name)
      values ('${TEAM_A}', 'run-1', 'game-1', '${OWNER}', 'Team A');
    insert into run_teams (id, run_id, game_id, owner_uid, display_name)
      values ('${TEAM_B}', 'run-1', 'game-1', '${OWNER}', 'Team B');

    -- an SOS alert naming Team A (participants must NOT read this)
    insert into alerts (run_id, owner_uid, type, team_id, team_name, message)
      values ('run-1', '${OWNER}', 'sos', '${TEAM_A}', 'Team A', 'need help');

    -- one GLOBAL announcement + one TARGETED at Team A (Team B must NOT see it)
    insert into announcements (run_id, owner_uid, message, team_id)
      values ('run-1', '${OWNER}', 'Global notice', null);
    insert into announcements (run_id, owner_uid, message, team_id)
      values ('run-1', '${OWNER}', 'For Team A only', '${TEAM_A}');

    insert into flash_missions (run_id, owner_uid, title)
      values ('run-1', '${OWNER}', 'Bonus dash');

    -- a live, unrevoked staff session scoping STAFF to run-1
    insert into staff_sessions (staff_uid, run_id, game_id, owner_uid, permissions, expires_at)
      values ('${STAFF}', 'run-1', 'game-1', '${OWNER}', '{track_locations,review_photos}', now() + interval '1 hour');

    insert into access_codes (code, owner_uid, game_id, run_id, status)
      values ('${CODE}', '${OWNER}', 'game-1', 'run-1', 'unused');
  `;
  try {
    await db.exec(seed);
    console.log('  · seeded fixture world (owner/game/run/teams/alert/announcements/staff/code)');
  } catch (e) {
    console.error(`\n  ✗ FAILED SEEDING: ${(e as Error).message}`);
    process.exit(1);
  }

  // Sanity: prove SET ROLE actually drops us out of RLS-bypass. If the base role
  // were not a superuser, `set local role authenticated` might error — catch that
  // now with a clear message rather than mis-attributing later failures.
  try {
    await db.query('begin');
    await db.query('set local role authenticated');
    await db.query('rollback');
  } catch (e) {
    console.error(`\n  ✗ cannot SET ROLE authenticated on this engine: ${(e as Error).message}`);
    console.error('    RLS cannot be exercised — aborting.');
    process.exit(1);
  }

  // ── The client simulator ───────────────────────────────────────────────────
  // Runs `body` inside a transaction as `role`, with auth.uid() == `uid`, then
  // ALWAYS rolls back (so `set local role` / GUC never leak between checks).
  async function asClient<T>(
    role: 'authenticated' | 'anon',
    uid: string | null,
    body: () => Promise<T>,
  ): Promise<T> {
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      return await body();
    } finally {
      await db.query('rollback');
    }
  }

  // Row count of `sql` as the given client. Any thrown error propagates.
  async function countAs(
    role: 'authenticated' | 'anon',
    uid: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> {
    return asClient(role, uid, async () => {
      const r = await db.query(sql, params as unknown[]);
      return r.rows.length;
    });
  }

  // True iff `sql` throws a Postgres "permission denied" (42501) as this client —
  // the DENY shape for a table with NO grant at all (access_codes, alerts-to-anon,
  // etc.), which is a THROW, not an empty result set.
  async function permissionDeniedAs(
    role: 'authenticated' | 'anon',
    uid: string | null,
    sql: string,
  ): Promise<boolean> {
    try {
      await countAs(role, uid, sql);
      return false;
    } catch (e) {
      return /permission denied/i.test((e as Error).message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POLICY-BY-POLICY: each proves ALLOW and DENY on the SAME query.
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. games_owner_read — owner-only (the answer-key-bearing table).
  ok(
    (await countAs('authenticated', OWNER, `select 1 from games where id = 'game-1'`)) === 1,
    'games_owner_read ALLOW: owner reads their own game',
  );
  ok(
    (await countAs('authenticated', STRANGER, `select 1 from games where id = 'game-1'`)) === 0,
    'games_owner_read DENY: a different creator reads ZERO games',
  );
  // A participant of the run is STILL denied games (the banner rule in 0002).
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from games where id = 'game-1'`)) === 0,
    'games_owner_read DENY: a participant of the run cannot read games',
  );

  // 2. runs_owner_read / runs_staff_read.
  ok(
    (await countAs('authenticated', OWNER, `select 1 from runs where id = 'run-1'`)) === 1,
    'runs_owner_read ALLOW: owner reads their run',
  );
  ok(
    (await countAs('authenticated', STRANGER, `select 1 from runs where id = 'run-1'`)) === 0,
    'runs_owner_read DENY: a different creator reads ZERO runs',
  );
  ok(
    (await countAs('authenticated', STAFF, `select 1 from runs where id = 'run-1'`)) === 1,
    'runs_staff_read ALLOW: run-scoped staff reads the run',
  );
  ok(
    (await countAs('authenticated', OUTSIDER, `select 1 from runs where id = 'run-1'`)) === 0,
    'runs_staff_read DENY: a non-staff outsider reads ZERO runs',
  );

  // 3. run_teams participant/owner/staff read + per-row participant scoping.
  //    Team A may read ONLY its own team row — never Team B's.
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from run_teams where id = '${TEAM_A}'`)) === 1,
    'run_teams_participant_read ALLOW: a participant reads their own team row',
  );
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from run_teams where id = '${TEAM_B}'`)) === 0,
    'run_teams_participant_read DENY: a participant cannot read another team in the same run',
  );
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from run_teams`)) === 1,
    'run_teams_participant_read DENY (unqualified): an unfiltered scan still yields ONLY the caller row',
  );
  ok(
    (await countAs('authenticated', OUTSIDER, `select 1 from run_teams`)) === 0,
    'run_teams DENY: an outsider reads ZERO team rows',
  );
  ok(
    (await countAs('authenticated', OWNER, `select 1 from run_teams`)) === 2,
    'run_teams_owner_read ALLOW: the owner reads all teams in their run',
  );
  ok(
    (await countAs('authenticated', STAFF, `select 1 from run_teams`)) === 2,
    'run_teams_staff_read ALLOW: run-scoped staff reads all teams in the run',
  );

  // 4. announcements_read — TARGETED filtering enforced PER ROW.
  //    Global(1) + targeted-to-A(1). Owner/staff see both; A sees both; B sees
  //    only the global; an outsider sees none.
  ok(
    (await countAs('authenticated', OWNER, `select 1 from announcements`)) === 2,
    'announcements_read ALLOW: owner sees global + targeted (2)',
  );
  ok(
    (await countAs('authenticated', STAFF, `select 1 from announcements`)) === 2,
    'announcements_read ALLOW: staff sees global + targeted (2)',
  );
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from announcements`)) === 2,
    'announcements_read ALLOW: the targeted team sees global + its own targeted (2)',
  );
  ok(
    (await countAs('authenticated', TEAM_B, `select 1 from announcements`)) === 1,
    "announcements_read DENY: another team sees ONLY the global, never Team A's targeted (1)",
  );
  ok(
    (await countAs('authenticated', OUTSIDER, `select 1 from announcements`)) === 0,
    'announcements_read DENY: an outsider sees ZERO announcements',
  );

  // 5. flash_missions_read — any run participant may read; outsiders may not.
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from flash_missions`)) === 1,
    'flash_missions_read ALLOW: a run participant reads the flash mission',
  );
  ok(
    (await countAs('authenticated', OUTSIDER, `select 1 from flash_missions`)) === 0,
    'flash_missions_read DENY: an outsider reads ZERO flash missions',
  );

  // 6. alerts_read — owner + staff ONLY; participants are DENIED (SOS names a team).
  ok(
    (await countAs('authenticated', OWNER, `select 1 from alerts`)) === 1,
    'alerts_read ALLOW: owner reads the SOS alert',
  );
  ok(
    (await countAs('authenticated', STAFF, `select 1 from alerts`)) === 1,
    'alerts_read ALLOW: run-scoped staff reads the SOS alert',
  );
  ok(
    (await countAs('authenticated', TEAM_A, `select 1 from alerts`)) === 0,
    'alerts_read DENY: a participant (even the one the alert names) reads ZERO alerts',
  );

  // 7. staff_sessions_self_read — the staff member (and owner) read the session;
  //    an outsider reads none.
  ok(
    (await countAs('authenticated', STAFF, `select 1 from staff_sessions`)) === 1,
    'staff_sessions_self_read ALLOW: staff reads their own session',
  );
  ok(
    (await countAs('authenticated', OWNER, `select 1 from staff_sessions`)) === 1,
    'staff_sessions_self_read ALLOW: owner reads sessions for their run',
  );
  ok(
    (await countAs('authenticated', OUTSIDER, `select 1 from staff_sessions`)) === 0,
    'staff_sessions_self_read DENY: an outsider reads ZERO staff sessions',
  );

  // 8. users_self_read — you read only your own profile row.
  ok(
    (await countAs('authenticated', OWNER, `select 1 from users where uid = '${OWNER}'`)) === 1,
    'users_self_read ALLOW: a user reads their own profile',
  );
  ok(
    (await countAs('authenticated', STRANGER, `select 1 from users where uid = '${OWNER}'`)) === 0,
    "users_self_read DENY: a user cannot read another user's profile",
  );
  ok(
    (await countAs('authenticated', OWNER, `select 1 from users`)) === 1,
    'users_self_read DENY (unqualified): an unfiltered scan yields ONLY the caller (1 of 2 rows)',
  );

  // 9. access_codes — NO policy, NO grant. Enumeration must be impossible even for
  //    an authenticated user; the ONLY read path is the get_join_info RPC.
  ok(
    await permissionDeniedAs('authenticated', OUTSIDER, `select 1 from access_codes`),
    'access_codes DENY: a direct SELECT is permission-denied for authenticated (no enumeration)',
  );
  ok(
    await permissionDeniedAs('anon', null, `select 1 from access_codes`),
    'access_codes DENY: a direct SELECT is permission-denied for anon',
  );

  // 10. get_join_info(text) — the anon join path. anon may EXECUTE the RPC (which
  //     reaches access_codes as SECURITY DEFINER) but may NOT read run_teams
  //     directly. This is the get/list distinction 0002 restores as an interface
  //     property.
  ok(
    (await countAs('anon', null, `select 1 from get_join_info($1)`, [CODE])) === 1,
    'get_join_info ALLOW: anon resolves a code it already knows via the RPC',
  );
  ok(
    (await countAs('anon', null, `select 1 from get_join_info($1)`, ['NOSUCH'])) === 0,
    'get_join_info: an unknown code returns nothing (no leak of validity beyond match)',
  );
  ok(
    await permissionDeniedAs('anon', null, `select 1 from run_teams`),
    'anon DENY: anon cannot SELECT run_teams directly (no grant)',
  );
  ok(
    await permissionDeniedAs('anon', null, `select 1 from runs`),
    'anon DENY: anon cannot SELECT runs directly (no grant)',
  );

  // 11. public gallery — the ONLY tables genuinely readable by everyone. This is
  //     the ALLOW that must NOT have a DENY: if public_tasks were accidentally
  //     scoped, the gallery would break. Its "DENY counterpart" is that the
  //     answer-key tables above (games) are NOT public — already asserted.
  //     Seed a public row so the assertion is real.
  await db.exec(`
    insert into public_games (id, owner_uid, title, mode, scoring_preset)
      values ('game-1', '${OWNER}', 'Test Game', 'team', 'smart_weighted')
      on conflict do nothing;
  `);
  ok(
    (await countAs('anon', null, `select 1 from public_games where id = 'game-1'`)) === 1,
    'public_games_read ALLOW: anon reads the public gallery projection',
  );

  // 12. audit_logs — service-role-only immutable trail: denied to everyone.
  ok(
    await permissionDeniedAs('authenticated', OWNER, `select 1 from audit_logs`),
    'audit_logs DENY: even the owner cannot SELECT the audit trail directly',
  );

  console.log(`\ntest-rls-postgres: ${passed} passed, ${failed} failed`);
  await db.close();
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('test-rls-postgres: suite threw', e);
  process.exit(1);
});
