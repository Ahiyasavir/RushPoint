# `supabase/` — Postgres schema for the Firestore → Supabase migration

Three migrations, applied in order:

| File | What it does |
|---|---|
| `migrations/0001_core_schema.sql` | Enums, helper functions, all tables, the monthly-partitioned `location_track` + its partition helpers |
| `migrations/0002_rls_policies.sql` | `is_run_participant` / `is_staff_for_run` / `can_read_run` / `get_join_info`, RLS enabled on every table, one read policy per audience |
| `migrations/0003_indexes.sql` | Indexes mirroring the real query patterns (derived from `firestore.indexes.json` + the callables) |

They are plain SQL and depend only on the Supabase platform pieces: the `auth` schema
(`users.uid` references `auth.users(id)`), the `auth.uid()` function used by every
policy, and the `anon` / `authenticated` / `service_role` roles. They will **not**
apply to a bare Postgres without those.

## Run it locally

```bash
npm i -g supabase        # or: brew install supabase/tap/supabase
supabase init            # only if supabase/config.toml does not exist yet
supabase start           # boots Postgres + Auth + PostgREST in Docker
supabase db reset        # drops, recreates, and applies migrations/*.sql in order
```

`supabase db reset` is the loop to use while iterating — it re-runs all three files
from scratch, so a syntax error surfaces immediately.

Useful endpoints once `supabase start` is up (it prints them too):

- Studio: <http://127.0.0.1:54323>
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- API: <http://127.0.0.1:54321>

Apply to a hosted project with `supabase db push` (after `supabase link --project-ref <ref>`).

### Without the CLI

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f migrations/0001_core_schema.sql \
  -f migrations/0002_rls_policies.sql \
  -f migrations/0003_indexes.sql
```

## Things you need to know before touching this

**Participants never get `SELECT` on `games`.** The banner at the top of
`0002_rls_policies.sql` explains why at length: the participant payload is produced
by a field-level, runtime-state-dependent sanitizer (it strips answer keys, hint
text, secret codes, and a sealed hidden mission's coordinates). RLS gates rows and
column grants gate columns — neither can express "strip `steps[].answer` inside a
JSONB value, but only until this team arrives". Every participant read stays behind
an RPC, exactly as it sits behind a callable today.

**`access_codes` is not selectable by anyone.** `firestore.rules` allowed `get` and
denied `list`; RLS cannot tell a keyed fetch from an enumeration. The table has no
policy and no grant; joining goes through `get_join_info(code)`, which takes the code
as an argument. Rate-limit that RPC.

**There is no station-occupancy counter.** Occupancy is derived:

```sql
select count(*) from run_task_records
 where run_id = $1 and task_id = $2 and status = 'assigned';
```

backed by `run_task_records_station_occupancy_idx` (partial, `status = 'assigned'`).
The old denormalized counter drifted whenever a release path was missed and needed a
self-healing reconciler. Do not reintroduce it.

**`games.stages` stays JSONB.** The Builder rewrites it wholesale, validation treats
it as one unit, and routing loads it into memory. `stage_count` / `task_count` are
`GENERATED ... STORED`, so they cannot go stale the way the Firestore denormalization
did.

**Staff scope lives in `staff_sessions`, not in JWT claims.** The PIN → custom-token
flow was the most Firebase-specific part of the old model. A table makes revocation
take effect on the next statement rather than on the next token refresh.

## Operating `location_track`

Range-partitioned by month so the 90-day PII prune is a `DROP TABLE`, not a chunked
delete sweep.

```sql
-- keep the current month + 3 ahead; schedule daily (pg_cron)
select ensure_location_track_partitions(now(), 4);

-- the 90-day retention prune; returns how many partitions it dropped
select drop_location_track_partitions_older_than(90);
```

An `INSERT` with no matching partition **errors** — it does not route anywhere — so
the forward-fill job is not optional.

## Migration notes for the data loader

- Firebase uids are not UUIDs. `users.legacy_firebase_uid` and
  `run_teams.legacy_firebase_uid` carry the old identifier through the cutover; drop
  them afterwards. Identity columns (`users.uid`, `run_teams.id`, `device_uids`,
  staff uids) are `uuid` so `auth.uid()` compares without a cast.
- Content ids (`game_id`, `run_id`, `stage_id`, `task_id`) stay `text` — task and
  stage ids are authored strings living inside `games.stages` and referenced from
  `run_task_records`.
- Timestamps are `timestamptz` throughout. Everything in Firestore was an ISO string
  **except** `answerPenalties.cooldownUntil` and `.lastFailureAt`, which were epoch
  milliseconds — convert with `to_timestamp(ms / 1000.0)`.
- `RunTeam.stages[]` explodes into `run_team_stages` + `run_task_records`. The
  taskId-keyed maps (`taskAttempts`, `answerPenalties`, `taskStepProgress`,
  `taskHintsUsed`, `stationHintsUsed`, `smartVerifications`, `taskSubmissions`)
  become columns on `run_task_records` — they were maps only because Firestore had
  nowhere else to put a per-(team, task) fact.
- `Wallet.processedSessions[]` becomes rows in `stripe_processed_sessions`, so a
  duplicate webhook fails an `INSERT` instead of racing a read-modify-write.
- Genuinely opaque objects stay JSONB: `registration_data`, `power_ups`,
  `score_breakdown`, `guardian_consent`, `discovery_state`, `leaderboard`, `branding`,
  `safe_zone`, plus the feed's `reactions` / `reacted_by` / `reported_by`.
