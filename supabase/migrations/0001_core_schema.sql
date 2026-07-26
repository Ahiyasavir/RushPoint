-- ═══════════════════════════════════════════════════════════════════════════════
-- RushPoint — Postgres core schema (Firestore → Supabase migration)
--
-- WHY THIS SHAPE
--   Firestore forced a 5-level path:
--     users/{uid}/games/{gameId}/runs/{runId}/teams/{teamId}
--   Nothing in the product actually needs that recursion: `ownerUid` is already
--   denormalized onto Run / RunTeam / StaffInvite precisely because the server had
--   to reconstruct paths from a flat query result. So every table here is FLAT and
--   carries `owner_uid` directly — which is also what makes RLS expressible as one
--   predicate per table instead of a recursive path walk.
--
-- ID CONVENTION (two kinds of id, deliberately different types)
--   • IDENTITIES are `uuid` and line up with `auth.uid()`: users.uid, run_teams.id
--     (a participant's anonymous uid IS the team id — unchanged from Firestore),
--     staff/device uids. This is what lets RLS say `id = auth.uid()` with no cast.
--   • CONTENT IDS are `text`: game_id, run_id, stage_id, task_id. Task and stage ids
--     are AUTHORED strings that live inside `games.stages` JSONB and are referenced
--     from run rows; forcing them to uuid would break the game file format,
--     import/export, and every existing template.
--   Firebase uids are not uuids, so `legacy_firebase_uid` columns carry the old
--   identifier through the data migration and can be dropped afterwards.
--
-- TIMESTAMPS
--   `timestamptz` everywhere. Firestore stored ISO strings — EXCEPT
--   answerPenalties.cooldownUntil / lastFailureAt, which were epoch milliseconds.
--   Those are normalized to timestamptz here (see run_task_records); the loader
--   must convert with to_timestamp(ms / 1000.0).
-- ═══════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gin;  -- mixed btree+gin composite indexes


-- ─── Enums ────────────────────────────────────────────────────────────────────
-- Enumerated because these are closed, product-defining vocabularies mirrored in
-- packages/shared/src/types/index.ts. Adding a member is `ALTER TYPE ... ADD VALUE`,
-- which is cheap; the payoff is that a typo'd status fails at write time instead of
-- silently creating a state nothing routes on.

create type game_mode              as enum ('individual', 'team');
create type scoring_preset         as enum ('time_only', 'fixed_points_speed', 'smart_weighted');
create type task_type              as enum ('field', 'smart_station', 'photo', 'self_report',
                                            'quiz', 'numeric', 'geofence', 'sequence', 'survey');
create type stage_status           as enum ('locked', 'active', 'completed');
create type task_status            as enum ('unassigned', 'assigned', 'completed', 'skipped');
create type run_status             as enum ('draft', 'live', 'finished');
create type team_status            as enum ('registered', 'active', 'finished');
create type visibility             as enum ('private', 'public');
create type access_code_status     as enum ('unused', 'used', 'revoked');
create type staff_permission       as enum ('announce', 'review_photos', 'track_locations');
create type alert_type             as enum ('sos', 'technical', 'stationary');
create type announcement_level     as enum ('info', 'warning', 'critical');
create type announcement_kind      as enum ('announcement', 'score');
create type station_status         as enum ('active', 'paused', 'closed');
create type verification_outcome   as enum ('correct', 'photo_pending', 'approved', 'rejected');
create type billing_type           as enum ('free', 'credit', 'pro', 'test');
create type wallet_plan            as enum ('free', 'pro');
create type public_item_kind       as enum ('game', 'task');
create type audit_action_type      as enum ('fine', 'score_override', 'skip', 'evacuation', 'manual_unlock');
-- Legacy 'topup'/'charge' retained: wallet rows written before the Event-Credits
-- migration must still load without rewriting history.
create type transaction_type       as enum ('topup_credits', 'charge_event', 'pro_subscription',
                                            'referral', 'free_run_consumed', 'topup', 'charge');


-- ─── Immutable JSONB helpers (needed by GENERATED columns) ────────────────────
-- A generated column may only call IMMUTABLE functions and may not contain a
-- subquery, so the per-stage task count has to be wrapped in a function of its own.
-- Both are total: a NULL / non-array `stages` yields 0 rather than raising, so a
-- half-migrated row can still be inserted.

create or replace function jsonb_stage_count(p_stages jsonb)
returns integer
language sql immutable parallel safe
as $$
  select case when jsonb_typeof(p_stages) = 'array' then jsonb_array_length(p_stages) else 0 end;
$$;

create or replace function jsonb_task_count(p_stages jsonb)
returns integer
language sql immutable parallel safe
as $$
  select coalesce((
    select sum(case when jsonb_typeof(s -> 'tasks') = 'array'
                    then jsonb_array_length(s -> 'tasks') else 0 end)
    from jsonb_array_elements(case when jsonb_typeof(p_stages) = 'array'
                                   then p_stages else '[]'::jsonb end) s
  ), 0)::int;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Creator identity + billing
-- ═══════════════════════════════════════════════════════════════════════════════

create table users (
  uid                 uuid primary key references auth.users (id) on delete cascade,
  display_name        text,
  -- Migration bridge only: the old Firebase uid. Drop once the cutover is done.
  legacy_firebase_uid text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table users is
  'Creator profile. One row per authenticated creator; participants do NOT get a row here (a participant is a run_teams row keyed by their anonymous uid).';

create table wallets (
  uid                           uuid primary key references users (uid) on delete cascade,
  event_credits                 integer     not null default 0 check (event_credits >= 0),
  lifetime_free_runs_used       integer     not null default 0 check (lifetime_free_runs_used >= 0),
  bonus_free_runs               integer     not null default 0 check (bonus_free_runs >= 0),
  plan                          wallet_plan not null default 'free',
  pro_expires_at                timestamptz,
  stripe_customer_id            text,
  stripe_subscription_id        text,
  last_package_max_participants integer,
  -- Referral program: who invited this creator (set once) + how many they invited.
  referred_by                   uuid references users (uid) on delete set null,
  referral_claimed_at           timestamptz,
  referral_count                integer     not null default 0 check (referral_count >= 0),
  -- Legacy pre-Event-Credits balance; kept so old ledgers still reconcile.
  balance_ils                   numeric(12, 2),
  updated_at                    timestamptz not null default now(),
  -- A creator cannot refer themselves (anti-farming, mirrors claimReferral).
  constraint wallets_no_self_referral check (referred_by is null or referred_by <> uid)
);

create table wallet_transactions (
  id                       uuid primary key default gen_random_uuid(),
  uid                      uuid not null references users (uid) on delete cascade,
  type                     transaction_type not null,
  description              text not null default '',
  amount_ils               numeric(12, 2),
  price_ils                numeric(12, 2),
  credits                  integer,
  credit_cost              integer,
  package_id               text,
  max_participants_per_run integer,
  game_title               text,
  run_id                   text,
  team_id                  uuid,
  stripe_payment_intent_id text,
  created_at               timestamptz not null default now()
);
comment on table wallet_transactions is
  'Append-only credit ledger. run_id/team_id are intentionally NOT foreign keys: the ledger must survive a purged run (financial record retention outlives the 90-day run-data prune).';

-- Stripe idempotency. In Firestore this was `Wallet.processedSessions: string[]`,
-- an unbounded array on a hot document that had to be read, scanned and rewritten
-- on every webhook. As a table the uniqueness IS the primary key, so a duplicate
-- webhook delivery fails the INSERT instead of racing a read-modify-write.
create table stripe_processed_sessions (
  uid        uuid not null references users (uid) on delete cascade,
  session_id text not null,
  created_at timestamptz not null default now(),
  primary key (uid, session_id)
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- Game templates
-- ═══════════════════════════════════════════════════════════════════════════════

-- `stages` is JSONB, not tables, and that is a considered decision:
--   • The Builder REWRITES the whole array on every save (buildSavePayload copies
--     BUILDER_EDITABLE_FIELDS wholesale) — a normalized stage/task tree would mean
--     a diff+upsert+delete dance on every keystroke-driven save for zero benefit.
--   • Validation is whole-unit (requiredTaskCount vs maxCompletableTasks, the unlock
--     graph, exclusive groups) — it needs the entire array in memory anyway.
--   • Routing loads the game once and filters tasks in memory.
--   • Import/export/duplicate/publish all copy the array verbatim.
-- The only thing normalization would have bought is per-task querying, and the one
-- place that matters (station occupancy) is answered from run_task_records instead.
create table games (
  id                        text primary key,
  owner_uid                 uuid not null references users (uid) on delete cascade,
  title                     text not null,
  description               text,
  mode                      game_mode not null default 'team',
  stages                    jsonb not null default '[]'::jsonb,
  scoring_preset            scoring_preset not null default 'smart_weighted',
  scoring_options           jsonb,
  registration_fields       jsonb not null default '[]'::jsonb,
  branding                  jsonb,
  visibility                visibility not null default 'private',
  tags                      text[] not null default '{}',
  cover_image               text,
  -- approxLocation is a GeoPoint + label; split into columns because the gallery
  -- filters and sorts on it (a JSONB point cannot use a plain btree range scan).
  approx_lat                double precision,
  approx_lng                double precision,
  approx_label              text,
  play_count                integer not null default 0,
  requires_guardian_consent boolean not null default false,
  min_age                   integer,
  -- Opaque value objects: read and written whole, never filtered on. JSONB keeps
  -- them honest without inventing 4 columns that only one code path ever touches.
  safe_zone                 jsonb,
  benchmark_opt_out         boolean not null default false,
  -- SECRET: never copied into public_games or any participant payload.
  integration_webhook_url   text,
  integration_platform      text check (integration_platform in ('slack', 'teams')),
  allow_instant_play        boolean not null default false,
  photo_feed_enabled        boolean not null default true,
  power_ups_enabled         boolean not null default false,
  manual_leaderboard_reveal boolean not null default false,
  instructions              jsonb,
  -- Tombstone (recoverable-game-deletion): presence of deleted_at = soft-deleted.
  -- Server-written only; see 0002 for why no client policy can touch these.
  deleted_at                timestamptz,
  deleted_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Denormalized counts the gallery and the Builder's readiness check both read.
  -- GENERATED STORED so they can never drift from `stages` — in Firestore these
  -- were hand-maintained fields on publicGames and could (and did) go stale.
  stage_count               integer generated always as (jsonb_stage_count(stages)) stored,
  task_count                integer generated always as (jsonb_task_count(stages)) stored,
  constraint games_stages_is_array check (jsonb_typeof(stages) = 'array'),
  constraint games_tombstone_pair  check ((deleted_at is null) = (deleted_by is null))
);
comment on column games.stages is
  'The full ordered Stage[] (each with its Task[]). Written wholesale by the Builder; see the table comment for why this is not normalized.';

-- Hidden geofenced trivia waypoints (surprise-trivia-waypoints). Coordinates AND
-- answers are server-secret, which is exactly why this is its own table rather than
-- another key inside games.stages: a table can be denied to every non-owner role
-- outright, whereas a JSONB key would ride along with any read of the game row.
create table discovery_pois (
  id             text not null,
  game_id        text not null references games (id) on delete cascade,
  owner_uid      uuid not null references users (uid) on delete cascade,
  lat            double precision not null,
  lng            double precision not null,
  radius_meters  double precision not null check (radius_meters > 0),
  title          text not null,
  flavor_text    text,
  question       text not null,
  answers        text[] not null default '{}',   -- SERVER-SECRET
  bonus_points   integer not null default 0,
  hint           text,
  created_at     timestamptz not null default now(),
  primary key (game_id, id)
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- Runs
-- ═══════════════════════════════════════════════════════════════════════════════

create table runs (
  id                    text primary key,
  game_id               text not null references games (id) on delete cascade,
  -- Denormalized from games. It was already denormalized in Firestore for path
  -- construction; here it is what makes the RLS predicate a single column compare
  -- instead of a join on every row read.
  owner_uid             uuid not null references users (uid) on delete cascade,
  status                run_status not null default 'draft',
  access_code           text not null,
  staff_pin             text,
  launched_at           timestamptz,
  finished_at           timestamptz,
  billing_type          billing_type not null default 'free',
  max_participants      integer not null default 5 check (max_participants > 0),
  is_test_drive         boolean not null default false,
  participant_count     integer not null default 0 check (participant_count >= 0),
  -- Monotonic phone count; has no detach path, so it never decrements.
  device_count          integer not null default 0 check (device_count >= 0),
  free_participants_used integer,
  -- The computed standings snapshot (rankings[] + frozen/published flags). Opaque:
  -- it is produced whole by buildRankings and read whole by every consumer, and it
  -- must stay a POINT-IN-TIME snapshot — normalizing it would invite re-deriving it
  -- on read, which is exactly the live/final parity bug the codebase warns about.
  leaderboard           jsonb,
  hot_zone              jsonb,
  white_label           boolean not null default false,
  brand                 jsonb,
  self_guided           boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table runs is
  'A live instance of a game. Server-write-only (no client INSERT/UPDATE policy in 0002) — score and leaderboard integrity depend on it.';

-- Per-RUN operator overrides of a task's availability (live-task-pause).
-- Deliberately NOT on the template: a stop closed today must not stay closed for
-- tomorrow's run, for a duplicate, for an export, or in the gallery. In Firestore
-- this was `Run.taskStatusOverrides: Record<taskId, StationStatus>`; a child table
-- gives it a real primary key and lets one row be upserted without rewriting a map.
create table run_task_overrides (
  run_id     text not null references runs (id) on delete cascade,
  task_id    text not null,
  status     station_status not null,
  set_by     uuid,
  updated_at timestamptz not null default now(),
  primary key (run_id, task_id)
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- Participant state
-- ═══════════════════════════════════════════════════════════════════════════════

-- One row per team/individual. `id` IS the founding participant's auth uid — the
-- same identity contract Firestore had (uid == teamId), which is what makes the
-- participant RLS policy a bare column compare.
create table run_teams (
  id                          uuid not null,
  run_id                      text not null references runs (id) on delete cascade,
  game_id                     text not null,
  owner_uid                   uuid not null references users (uid) on delete cascade,
  display_name                text not null,
  -- Free-form answers to the creator's registration form: the SHAPE is authored
  -- per game (registration_fields), so there is no fixed column set to migrate to.
  registration_data           jsonb not null default '{}'::jsonb,
  member_names                text[] not null default '{}',
  member_count                integer,
  status                      team_status not null default 'registered',
  score                       numeric not null default 0,
  -- Sign convention preserved from the TS types: bonus_penalty is SUBTRACTED from
  -- the final score, so a BONUS is a NEGATIVE value here.
  bonus_penalty               numeric not null default 0,
  power_ups                   jsonb,
  guardian_consent            jsonb,
  out_of_bounds               boolean not null default false,
  out_of_bounds_at            timestamptz,
  out_of_bounds_override_until timestamptz,
  last_breach_alert_at        timestamptz,
  discovery_state             jsonb,
  -- Mirror of "which task is this team on right now"; the station-occupancy query
  -- reads run_task_records, this stays only for the team's own UI.
  active_task_id              text,
  launched                    boolean not null default false,
  started_at                  timestamptz,
  finished_at                 timestamptz,
  smart_streak                integer not null default 0,
  streak_multiplier           numeric,
  evacuated_from              text,
  -- Shared team devices: every attached phone's uid. Exactly one may submit.
  device_uids                 uuid[] not null default '{}',
  controller_uid              uuid,
  device_join_code            text,
  devices                     jsonb not null default '[]'::jsonb,
  legacy_firebase_uid         text,
  updated_at                  timestamptz not null default now(),
  primary key (run_id, id)
);
comment on table run_teams is
  'Participant state. The taskId-keyed maps that used to hang off this document (taskAttempts, answerPenalties, taskStepProgress, taskHintsUsed, stationHintsUsed, smartVerifications) are now COLUMNS on run_task_records — they were maps only because Firestore had nowhere else to put per-(team,task) facts.';

create table run_team_stages (
  run_id              text not null,
  team_id             uuid not null,
  stage_id            text not null,
  stage_order         integer not null,
  status              stage_status not null default 'locked',
  started_at          timestamptz,
  completed_at        timestamptz,
  -- Copied from Stage.requiredTaskCount at run-build time so the run is
  -- self-contained: a mid-run template edit must never re-time or re-gate a team.
  -- skipTaskForTeam may LOWER this value for one team; the template is untouched.
  required_task_count integer,
  earned_score        numeric not null default 0,
  primary key (run_id, team_id, stage_id),
  foreign key (run_id, team_id) references run_teams (run_id, id) on delete cascade,
  unique (run_id, team_id, stage_order)
);

create table run_task_records (
  run_id                                 text not null,
  team_id                                uuid not null,
  task_id                                text not null,
  stage_id                               text not null,
  task_index                             integer not null default 0,
  status                                 task_status not null default 'unassigned',
  -- Stamped when the task is CLAIMED (assignNextInActiveStage's claim transaction),
  -- so any span measured from it includes travel. Not the same clock as
  -- Task.expectedDurationMinutes, which is interaction time AT the stop.
  started_at                             timestamptz,
  completed_at                           timestamptz,
  -- Hidden-location arrival latch: set once by reportArrival after a server-side
  -- GPS check. Sticky — never cleared, so a reload or GPS loss cannot re-seal a
  -- task the player already physically reached.
  arrived_at                             timestamptz,
  actual_minutes                         numeric,
  -- pause-clock tasks: ms of this team's clock excluded, stamped ONCE at completion
  -- from the server's own started_at → completed_at span. buildRankings SUMS this
  -- instead of re-reading task.pausesTimer, so a mid-run template edit cannot
  -- retroactively re-time finished work (live/final leaderboard parity).
  excluded_ms                            bigint,
  -- Snapshotted expected route-time contribution at terminal state, same reason.
  expected_duration_minutes_at_completion numeric,
  earned_score                           numeric,
  score_breakdown                        jsonb,
  -- ── Smart-station / photo review (was the team doc's taskSubmissions map) ──
  verification_outcome                   verification_outcome,
  photo_url                              text,
  reviewed_at                            timestamptz,
  reviewed_by                            uuid,
  rejection_reason                       text,
  survey_response                        text,
  -- ── Folded-in per-(team,task) maps ────────────────────────────────────────
  -- Wrong answers recorded for this task (was team.taskAttempts[taskId]).
  attempts                               integer not null default 0 check (attempts >= 0),
  -- Was team.taskHintsUsed[] — a membership array standing in for a boolean.
  hint_purchased                         boolean not null default false,
  -- Was answerPenalties[taskId].charged: points already taken off, enforces the cap.
  penalty_charged                        numeric not null default 0,
  -- Was answerPenalties[taskId].cooldownUntil, stored as EPOCH MS while every other
  -- timestamp in the codebase was an ISO string. Normalized to timestamptz here.
  -- NOTE for the client contract: the server still ships a REMAINING DURATION, never
  -- this absolute instant — an absolute deadline counted down against a phone clock
  -- freezes a slow-clocked phone.
  cooldown_until                         timestamptz,
  last_failure_at                        timestamptz,   -- was epoch ms
  lockout_ms                             integer,
  failure_count                          integer not null default 0,
  -- Was answerPenalties[taskId].lastHash — the duplicate-submission replay guard.
  last_answer_hash                       text,
  -- Was team.taskStepProgress[taskId]: steps completed on a `sequence` task.
  step_progress                          integer not null default 0 check (step_progress >= 0),
  -- Was team.stationHintsUsed[taskId]: which hint indices this team revealed.
  station_hints_used                     integer[] not null default '{}',
  -- Was team.smartVerifications[taskId]: recorded verification events.
  smart_verifications                    text[] not null default '{}',
  updated_at                             timestamptz not null default now(),
  primary key (run_id, team_id, task_id),
  foreign key (run_id, team_id) references run_teams (run_id, id) on delete cascade,
  foreign key (run_id, team_id, stage_id)
    references run_team_stages (run_id, team_id, stage_id) on delete cascade
);
comment on table run_task_records is
  'One row per (run, team, task). THIS TABLE IS THE STATION-OCCUPANCY INDEX. There is deliberately no taskCounts / currentTeamCount column anywhere in this schema: occupancy is DERIVED — select count(*) from run_task_records where run_id=$1 and task_id=$2 and status=''assigned''. The Firestore design kept a denormalized counter that drifted on every crashed transaction and needed a self-healing reconciler; a counted index cannot drift.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- Live ops (per run)
-- ═══════════════════════════════════════════════════════════════════════════════

create table announcements (
  id         uuid primary key default gen_random_uuid(),
  run_id     text not null references runs (id) on delete cascade,
  owner_uid  uuid not null references users (uid) on delete cascade,
  message    text not null,
  message_he text,
  level      announcement_level not null default 'info',
  kind       announcement_kind  not null default 'announcement',
  active     boolean not null default true,
  -- NULL = global broadcast; set = addressed to exactly one team.
  -- Under Firestore this could only be a client-side courtesy (rules cannot filter
  -- documents within a collection read). Here it is enforced in the RLS policy — see 0002.
  team_id    uuid,
  delta      numeric,          -- kind='score' only: the applied signed adjustment
  operator_id uuid,
  created_at timestamptz not null default now()
);

create table flash_missions (
  id              uuid primary key default gen_random_uuid(),
  run_id          text not null references runs (id) on delete cascade,
  owner_uid       uuid not null references users (uid) on delete cascade,
  title           text not null,
  title_he        text,
  description     text not null default '',
  description_he  text,
  bonus_points    integer not null default 0,
  expires_at      timestamptz,
  active          boolean not null default true,   -- was `isActive`
  winner_team_id  uuid,
  created_at      timestamptz not null default now()
);

create table feed_items (
  id           uuid primary key default gen_random_uuid(),
  run_id       text not null references runs (id) on delete cascade,
  owner_uid    uuid not null references users (uid) on delete cascade,
  task_id      text not null,
  task_title   text not null default '',
  team_id      uuid not null,
  team_name    text not null default '',
  photo_url    text not null,
  -- emoji → count, and uid → emoji (one reaction per uid). Kept JSONB: they are
  -- read and rendered whole, and the reducer (applyReport / reactions) is pure and
  -- already operates on the map shape.
  reactions    jsonb not null default '{}'::jsonb,
  reacted_by   jsonb not null default '{}'::jsonb,
  reported_by  jsonb not null default '{}'::jsonb,
  report_count integer not null default 0,
  reports_cleared boolean not null default false,
  active       boolean not null default true,
  hidden_at    timestamptz,
  hidden_by    uuid,
  created_at   timestamptz not null default now()
);

create table alerts (
  id              uuid primary key default gen_random_uuid(),
  run_id          text not null references runs (id) on delete cascade,
  owner_uid       uuid not null references users (uid) on delete cascade,
  type            alert_type not null,
  team_id         uuid not null,
  team_name       text,
  task_id         text,
  station_title   text,
  lat             double precision,
  lng             double precision,
  message         text not null default '',
  acknowledged    boolean not null default false,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at      timestamptz not null default now()
);

-- Team ↔ HQ chat. In Firestore this was ONE document per team holding a capped
-- `messages: ChatMessage[]` array — capped precisely because a growing array in a
-- document is a rewrite-the-whole-thing-on-every-send problem. As rows there is no
-- cap and no rewrite; retention is a delete by run.
create table chat_messages (
  id          uuid primary key default gen_random_uuid(),
  run_id      text not null references runs (id) on delete cascade,
  owner_uid   uuid not null references users (uid) on delete cascade,
  team_id     uuid not null,
  from_side   text not null check (from_side in ('team', 'hq')),
  sender_id   uuid,
  sender_name text not null default '',
  text        text not null,
  created_at  timestamptz not null default now()
);

create table run_feedback (
  run_id      text not null references runs (id) on delete cascade,
  uid         uuid not null,          -- the responding PLAYER (device), not the team
  owner_uid   uuid not null references users (uid) on delete cascade,
  team_id     uuid not null,
  team_name   text not null default '',
  member_name text,
  -- Fixed rating key set (overall/content/bonding/difficulty/smoothness/recommend)
  -- with per-key ranges; kept JSONB because unanswered dimensions are simply absent
  -- and the summary rollup consumes the whole partial map.
  ratings     jsonb not null default '{}'::jsonb,
  issues      text[] not null default '{}',
  comment     text,
  lang        text not null default 'he',
  created_at  timestamptz not null default now(),
  primary key (run_id, uid)
);
comment on table run_feedback is
  'Holds free text (PII) — dies with the run in the 90-day retention prune.';

create table staff_invites (
  id           uuid primary key default gen_random_uuid(),
  run_id       text not null references runs (id) on delete cascade,
  game_id      text not null,
  owner_uid    uuid not null references users (uid) on delete cascade,
  -- The one-time PIN. Never selectable by any client role (see 0002): redemption
  -- goes through a SECURITY DEFINER RPC, so the PIN is compared server-side only.
  pin          text not null,
  display_name text,
  permissions  staff_permission[] not null default '{}',
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ── Staff sessions ────────────────────────────────────────────────────────────
-- The most Firebase-specific piece of the old design: staffSignIn minted a CUSTOM
-- TOKEN whose claims (staff / ownerUid / gameId / runId) the rules then read via
-- request.auth.token. Supabase JWTs are not mintable the same way from an RPC, and
-- putting run scope into app_metadata means a staff member's scope only changes on
-- token refresh — which is wrong for a PIN that can be revoked mid-run.
-- So the scope lives in a TABLE and is_staff_for_run() reads it: revocation is
-- immediate, one staff identity can hold several run scopes, and expiry is a plain
-- timestamp instead of a token lifetime.
create table staff_sessions (
  token_id    uuid primary key default gen_random_uuid(),
  staff_uid   uuid not null,          -- the auth identity the PIN redemption signed in
  run_id      text not null references runs (id) on delete cascade,
  game_id     text not null,
  owner_uid   uuid not null references users (uid) on delete cascade,
  invite_id   uuid references staff_invites (id) on delete set null,
  permissions staff_permission[] not null default '{}',
  display_name text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table team_locations (
  run_id      text not null references runs (id) on delete cascade,
  team_id     uuid not null,
  owner_uid   uuid not null references users (uid) on delete cascade,
  team_name   text,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_meters double precision,
  stage_order integer,
  updated_at  timestamptz not null default now(),
  primary key (run_id, team_id)
);
comment on table team_locations is
  'LAST-KNOWN position only (one row per team, upserted). The history lives in location_track.';

create table trackables (
  id                      text not null,
  run_id                  text not null references runs (id) on delete cascade,
  owner_uid               uuid not null references users (uid) on delete cascade,
  name                    text not null,
  description             text,
  image_url               text,
  home_task_id            text,
  current_holder_team_id  uuid,        -- NULL = not held (sitting at a task or home)
  current_task_id         text,
  updated_at              timestamptz not null default now(),
  primary key (run_id, id)
);

create table trackable_log (
  id           uuid primary key default gen_random_uuid(),
  run_id       text not null,
  trackable_id text not null,
  team_id      uuid not null,
  team_name    text,
  task_id      text,
  action       text not null check (action in ('pickup', 'drop')),
  created_at   timestamptz not null default now(),
  foreign key (run_id, trackable_id) references trackables (run_id, id) on delete cascade
);

create table zones (
  id              text not null,
  run_id          text not null references runs (id) on delete cascade,
  owner_uid       uuid not null references users (uid) on delete cascade,
  title           text not null,
  lat             double precision not null,
  lng             double precision not null,
  radius_meters   double precision not null check (radius_meters > 0),
  owner_team_id   uuid,
  owner_team_name text,
  captured_at     timestamptz,
  capture_bonus   integer not null default 0,
  created_at      timestamptz not null default now(),
  primary key (run_id, id)
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- Retained GPS track — RANGE PARTITIONED BY MONTH
-- ═══════════════════════════════════════════════════════════════════════════════
-- This is the highest-volume table in the system (a ping per team every few seconds
-- for the length of a run) and it carries PII with a hard 90-day retention promise.
-- Under Firestore the prune was a chunked delete sweep bounded by the 500-op batch
-- cap — slow, expensive, and it had to be re-run until it converged. Partitioned by
-- month, the prune is DROP TABLE on a whole partition: constant time, no bloat, no
-- vacuum debt, and nothing to reconcile if it is interrupted.
create table location_track (
  id          uuid not null default gen_random_uuid(),
  run_id      text not null,
  team_id     uuid not null,
  owner_uid   uuid not null,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_meters double precision,
  recorded_at timestamptz not null default now(),
  primary key (recorded_at, id)
) partition by range (recorded_at);
comment on table location_track is
  'Partition key MUST be part of the primary key (Postgres requirement), hence (recorded_at, id). No FK to runs: a partitioned table cannot be the child of a FK that would force per-partition validation on drop, and the prune is by TIME, not by run.';

-- Create (idempotently) the monthly partition containing `p_when`.
create or replace function ensure_location_track_partition(p_when timestamptz default now())
returns text
language plpgsql
as $$
declare
  v_start date := date_trunc('month', p_when at time zone 'UTC')::date;
  v_end   date := (date_trunc('month', p_when at time zone 'UTC') + interval '1 month')::date;
  v_name  text := format('location_track_%s', to_char(v_start, 'YYYY_MM'));
begin
  execute format(
    'create table if not exists %I partition of location_track for values from (%L) to (%L)',
    v_name, v_start, v_end
  );
  -- A partition created AFTER 0002 ran would otherwise miss the blanket
  -- enable-RLS/revoke sweep. The parent's policies already cover reads that go
  -- through `location_track`, but a partition reachable by name must be closed too.
  execute format('alter table %I enable row level security', v_name);
  execute format('revoke all on %I from anon, authenticated', v_name);
  return v_name;
end;
$$;

-- Roll partitions forward: call from a daily cron with (now(), 3) to keep the
-- current month plus a few ahead. Creating ahead of time matters — an INSERT with
-- no matching partition ERRORS, it does not silently route anywhere.
create or replace function ensure_location_track_partitions(
  p_from   timestamptz default now(),
  p_months integer     default 3
) returns void
language plpgsql
as $$
declare i integer;
begin
  for i in 0 .. greatest(p_months, 1) - 1 loop
    perform ensure_location_track_partition(p_from + (i || ' months')::interval);
  end loop;
end;
$$;

-- The 90-day PII prune. Drops any partition whose whole range is older than the
-- cutoff — never a partial delete, so a partition is either entirely retained or
-- entirely gone (which is what the retention promise actually says).
create or replace function drop_location_track_partitions_older_than(p_days integer default 90)
returns integer
language plpgsql
as $$
declare
  v_cutoff date := (now() - (p_days || ' days')::interval)::date;
  v_rec    record;
  v_count  integer := 0;
begin
  for v_rec in
    select c.relname,
           (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \(''([0-9-]+)''\)'))[1]::date as upper_bound
    from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'location_track'
  loop
    if v_rec.upper_bound is not null and v_rec.upper_bound <= v_cutoff then
      execute format('drop table if exists %I', v_rec.relname);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Bootstrap: current month + 3 ahead, so a fresh database can accept writes.
select ensure_location_track_partitions(now(), 4);


-- ═══════════════════════════════════════════════════════════════════════════════
-- Top-level collections
-- ═══════════════════════════════════════════════════════════════════════════════

create table access_codes (
  code        text primary key,
  owner_uid   uuid not null references users (uid) on delete cascade,
  game_id     text not null,
  run_id      text not null,
  status      access_code_status not null default 'unused',
  team_id     uuid,
  used_at     timestamptz,
  -- Game trash: soft-deleting a game REVOKES its codes rather than deleting them,
  -- so uniqueCode() cannot hand a released code to a different creator's run during
  -- the grace period. These two fields let a restore reinstate EXACTLY the codes
  -- that deletion revoked; a code revoked for any other reason carries neither.
  revoked_by_game_deletion_at timestamptz,
  revoked_from_status         access_code_status,
  created_at  timestamptz not null default now()
);
comment on table access_codes is
  'SECURITY: this table is NOT directly selectable by any client role — see 0002. Firestore allowed `get` but denied `list`; RLS cannot make that distinction, so the read path is the get_join_info(code) RPC.';

create table public_games (
  id                      text primary key references games (id) on delete cascade,
  owner_uid               uuid not null references users (uid) on delete cascade,
  owner_display_name      text,
  title                   text not null,
  description             text,
  mode                    game_mode not null,
  scoring_preset          scoring_preset not null,
  tags                    text[] not null default '{}',
  cover_image             text,
  approx_lat              double precision,
  approx_lng              double precision,
  approx_label            text,
  play_count              integer not null default 0,
  stage_count             integer not null default 0,
  task_count              integer not null default 0,
  estimated_total_minutes integer not null default 0,
  requirement             text check (requirement in ('gps', 'anywhere')),
  allow_instant_play      boolean not null default false,
  instructions            jsonb,
  like_count              integer not null default 0,
  -- popularityScore(playCount, likeCount, createdAt) — the field the gallery orders
  -- by. Server-written; a client that could write it could pin its own game to the
  -- top of the gallery, which is why 0002 grants no write policy here.
  popularity              double precision not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public_tasks (
  id                text primary key,
  source_game_id    text not null references games (id) on delete cascade,
  source_game_title text,
  owner_uid         uuid not null references users (uid) on delete cascade,
  owner_display_name text,
  title             text not null,
  description       text,
  type              task_type not null,
  -- gallery-exact-hidden-location: this is the EXACT authored point of EVERY located
  -- mission, HIDDEN MISSIONS INCLUDED. The creator-facing gallery map must be
  -- accurate; the in-game hidden puzzle is sealed separately, by the participant
  -- sanitizer, not by this projection. Locationless/unplaced ⇒ both columns NULL.
  -- The deprecated exact `coordinates` key is not carried over at all.
  approx_lat        double precision,
  approx_lng        double precision,
  difficulty        integer not null default 1,
  estimated_minutes integer not null default 0,
  point_value       integer not null default 0,
  tags              text[] not null default '{}',
  copy_count        integer not null default 0,
  like_count        integer not null default 0,
  popularity        double precision not null default 0,
  created_at        timestamptz not null default now()
);
comment on table public_tasks is
  'World-readable projection. NOTE it deliberately carries NO answer keys, hint text, secret codes or smart-station config — the projection contract is enforced at the WRITE path (publishGame), exactly as it was in Firestore. Never add a column that mirrors a Task field wholesale.';

-- One like per (kind, item, user): the primary key IS the uniqueness constraint,
-- as the derived Firestore document id was. Denied to clients in BOTH directions —
-- writable likes are forgeable rankings, readable likes are a scrapable social graph.
create table public_likes (
  kind       public_item_kind not null,
  item_id    text not null,
  uid        uuid not null references users (uid) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, item_id, uid)
);

create table audit_logs (
  id             uuid primary key default gen_random_uuid(),
  owner_uid      uuid not null,
  game_id        text,
  run_id         text,
  team_id        uuid,
  team_name      text,
  operator_id    uuid not null,
  action_type    audit_action_type not null,
  previous_value text,
  new_value      text,
  reason         text,
  created_at     timestamptz not null default now()
);
comment on table audit_logs is
  'Immutable admin trail. No FKs on purpose: an audit record must outlive the run, game and even the account it describes. Service-role only (no policies in 0002); the read path is the listAuditLogs RPC.';

-- Anonymized cross-platform aggregate, one row per task type. No per-run ids by
-- construction — that is the whole privacy argument for publishing it to creators.
create table benchmarks (
  task_type                task_type primary key,
  count                    integer not null default 0,
  median_ms_rolling        double precision not null default 0,
  completion_rate_rolling  double precision not null default 0,
  updated_at               timestamptz not null default now()
);

create table players (
  uid              uuid primary key,
  display_name     text,
  games_played     integer not null default 0,
  tasks_completed  integer not null default 0,
  total_points     numeric not null default 0,
  badges           text[] not null default '{}',
  updated_at       timestamptz not null default now()
);
comment on table players is
  'Cross-run lifetime stats for PARTICIPANTS (anonymous uids), distinct from `users` (creators). A player reads only their own row.';

-- Was the single hot `publicTagStats/global` document, maintained transactionally
-- because it was one document. As rows, two publishes touching different tags no
-- longer contend at all.
create table tag_stats (
  tag        text primary key,
  count      integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now()
);

-- Per-uid fixed-window callable rate-limit counters. Service-role only.
create table rate_limits (
  bucket           text not null,
  uid              uuid not null,
  count            integer not null default 0,
  window_start_at  timestamptz not null default now(),
  primary key (bucket, uid)
);
