-- RushPoint — the once-flag latch (Firestore → Supabase migration)
--
-- Home for the table `packages/data/src/postgres/atomic.ts` requires and
-- deliberately refuses to create itself (a repository that DDLs its own storage
-- stops being reviewable). The DDL is published there as `ONCE_FLAGS_DDL`; this
-- migration is the "0004_once_flags.sql that whoever owns supabase/migrations/"
-- was asked to write. Keep the two in lockstep.
--
-- WHAT IT IS. A false→true latch, one row per (run, team, flag). It backs
-- `claimOnceFlag`, the single method behind `Run.benchmarkContributed`,
-- `Run.summaryEmailSent` and `RunTeam.profileRecorded` — one method, not three,
-- because the invariant is identical and THE FLAG NAME IS DATA (so it is a
-- value in the `flag` column, never a column name).
--
-- WHY A ROW, NOT A BOOLEAN COLUMN. The latch's atomicity IS the primary key:
--
--     insert into data_once_flags (…) values (…) on conflict do nothing returning 1;
--
-- Exactly one caller inserts; everyone else conflicts and gets zero rows back.
-- That is strictly stronger than a conditional UPDATE — there is no read at all,
-- so no read-modify-write window even in READ COMMITTED — and it generalises to
-- a flag name that is data.

create table if not exists data_once_flags (
  run_id     text not null references runs (id) on delete cascade,
  -- All-zero uuid = "this latch is on the RUN, not on a team". NOT NULL with a
  -- sentinel rather than nullable: a NULL in a primary key would make two
  -- run-scoped claims of the same flag DISTINCT rows — the opposite of a latch.
  team_id    uuid not null default '00000000-0000-0000-0000-000000000000',
  flag       text not null,
  claimed_at timestamptz not null,
  primary key (run_id, team_id, flag)
);

comment on table data_once_flags is
  'Idempotency latches (benchmarkContributed / summaryEmailSent / profileRecorded). Server-write-only via claimOnceFlag; no client ever reads or writes it.';

-- Server-write-only, exactly like runs/teams/scores. RLS is enabled with NO
-- policy, so every non-owner role is denied by default; the backend reaches it
-- through the service role, which bypasses RLS. This runs AFTER 0002's blanket
-- revoke sweep, so the client roles are stripped explicitly here.
alter table data_once_flags enable row level security;
revoke all on data_once_flags from anon, authenticated;
