-- ═══════════════════════════════════════════════════════════════════════════════
-- RushPoint — Indexes
--
-- Every index here mirrors a query the product actually runs. The starting point
-- was firestore.indexes.json (Firestore FORCES you to declare composite indexes, so
-- that file is an honest inventory of the real access patterns) plus the queries the
-- callables issue. Where a Firestore index is not reproduced, it is because the
-- equivalent Postgres query is answered by a primary key.
--
-- Primary keys already cover, and are deliberately NOT duplicated below:
--   run_teams (run_id, id)                     — a team fetching itself
--   run_team_stages (run_id, team_id, stage_id)
--   run_task_records (run_id, team_id, task_id) — a team's record for one task
--   run_task_overrides (run_id, task_id)
--   team_locations (run_id, team_id)
--   access_codes (code)                        — the join lookup
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── Games ────────────────────────────────────────────────────────────────────

-- listGames: the owner's non-deleted games, newest first. Partial on the tombstone
-- so the trash rows are not even in the index — this is the Postgres equivalent of
-- the `games.deletedAt` fieldOverride in firestore.indexes.json, and it is strictly
-- better: the index only holds the rows the common query wants.
create index games_owner_active_idx
  on games (owner_uid, updated_at desc)
  where deleted_at is null;

-- listDeletedGames / purgeDeletedGamesNow: the trash screen and the purge sweep,
-- ordered by how long a game has been in the bin.
create index games_trash_idx
  on games (owner_uid, deleted_at)
  where deleted_at is not null;

-- GIN on the whole `stages` document. The Builder, validation and routing all load
-- the game wholesale, so this is NOT for those paths — it is what makes ad-hoc
-- containment queries possible at all now that stages is one JSONB value
-- ("which games use a smart_station?", "which game holds task X?"), which under
-- Firestore required a full scan in application code.
-- jsonb_path_ops would be smaller and faster for pure @> containment, but the
-- default opclass also supports ? / ?| / ?& key-existence, which the maintenance
-- and backfill scripts use.
create index games_stages_gin_idx on games using gin (stages);

create index games_owner_visibility_idx on games (owner_uid, visibility);


-- ─── Runs ─────────────────────────────────────────────────────────────────────

-- listLiveRuns / the multi-run GM overview. (firestore: runs[ownerUid, status])
create index runs_owner_status_idx on runs (owner_uid, status);

-- pruneExpiredRunData: finished runs whose data has aged past the retention window.
-- (firestore: runs[status, finishedAt])
create index runs_status_finished_idx on runs (status, finished_at);

-- The access code is unique in practice and is looked up by get_join_info via
-- access_codes; this index serves the reverse direction (a run finding its code)
-- and enforces the invariant that two live runs never share one.
create unique index runs_access_code_idx on runs (access_code);

create index runs_game_idx on runs (game_id, created_at desc);


-- ─── Run teams ────────────────────────────────────────────────────────────────

-- listRunTeams / the console's team table, and the finalizeRun sweep.
create index run_teams_run_status_idx on run_teams (run_id, status);

-- The station/"who is where" view. (firestore: teams[activeTaskId, status])
create index run_teams_run_active_task_idx
  on run_teams (run_id, active_task_id)
  where active_task_id is not null;

-- Shared team devices: resolving "which team is this phone attached to" on every
-- request from a secondary device, and the `= any(device_uids)` RLS predicate.
create index run_teams_device_uids_gin_idx on run_teams using gin (device_uids);

-- A participant's own runs across time (the play-web "my games" surface) — this is
-- the query the flattening bought us; under Firestore it needed a collection-group
-- index and still could not scope by owner.
create index run_teams_id_idx on run_teams (id, updated_at desc);

create index run_teams_owner_idx on run_teams (owner_uid, run_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- ⭐ STATION OCCUPANCY — the index that replaces a denormalized counter
-- ═══════════════════════════════════════════════════════════════════════════════
-- Firestore had `Task.currentTeamCount` / a taskCounts map: a hand-maintained
-- integer that had to be incremented in the claim transaction and decremented in
-- every release path (complete, skip, expire, review-reject, station-slot release).
-- Miss one path — and the codebase has fixed at least two such leaks — and the
-- station is permanently "full" for the rest of the run, with a reconciler needed
-- to heal it.
--
-- Here occupancy is DERIVED and cannot drift:
--     select count(*) from run_task_records
--      where run_id = $1 and task_id = $2 and status = 'assigned';
--
-- The partial index makes that count touch only the currently-assigned rows, which
-- is a tiny fraction of the table (one row per team in flight, not per team-task
-- ever recorded). Concurrency is handled by the claim transaction taking the count
-- under the same snapshot it inserts in — see the station-contention e2e scenario.
create index run_task_records_station_occupancy_idx
  on run_task_records (run_id, task_id)
  where status = 'assigned'::task_status;

-- buildRankings / getRunRecap / analytics: every terminal record for a team.
create index run_task_records_team_status_idx
  on run_task_records (run_id, team_id, status);

-- Per-task analytics across the run (completion rate, median duration, benchmark
-- contribution) — the columnar direction of the same data.
create index run_task_records_task_idx on run_task_records (run_id, task_id, status);

-- The photo review queue: pending submissions across the whole run, oldest first.
create index run_task_records_photo_pending_idx
  on run_task_records (run_id, completed_at)
  where verification_outcome = 'photo_pending'::verification_outcome;

create index run_team_stages_run_status_idx on run_team_stages (run_id, status);


-- ─── Live-ops feeds ───────────────────────────────────────────────────────────
-- All three are the same query: "the active items of THIS run, newest first",
-- straight out of firestore.indexes.json (announcements[active, createdAt desc],
-- flashMissions[isActive, createdAt desc], feedItems[active, createdAt desc]) with
-- run_id prepended, because flattening means the run scope is now a column rather
-- than the path.

create index announcements_run_active_idx
  on announcements (run_id, active, created_at desc);

-- Fetching one team's targeted messages (the RLS predicate's other branch).
create index announcements_team_idx
  on announcements (run_id, team_id, created_at desc)
  where team_id is not null;

create index flash_missions_run_active_idx
  on flash_missions (run_id, active, created_at desc);

create index feed_items_run_active_idx
  on feed_items (run_id, active, created_at desc);

-- The moderation queue (feed-ugc-safety): reported-but-not-yet-hidden items.
create index feed_items_reported_idx
  on feed_items (run_id, report_count desc)
  where report_count > 0 and active;

-- Unacknowledged alerts drive the console's attention strip and listLiveRuns'
-- unackedAlerts count, so the partial index is the one that is read constantly.
create index alerts_run_unacked_idx
  on alerts (run_id, created_at desc)
  where not acknowledged;

create index alerts_run_created_idx on alerts (run_id, created_at desc);

-- Chat: one team's thread, newest last. This is the query that used to be "read the
-- whole capped array on one document".
create index chat_messages_run_team_idx on chat_messages (run_id, team_id, created_at);

create index run_feedback_run_idx on run_feedback (run_id, created_at desc);

create index staff_invites_run_idx on staff_invites (run_id, created_at desc);

-- is_staff_for_run() runs on EVERY policy evaluation for a staff console session,
-- so this partial index is on the hot path of the whole staff surface.
create index staff_sessions_lookup_idx
  on staff_sessions (staff_uid, run_id)
  where revoked_at is null;

create index trackables_run_holder_idx on trackables (run_id, current_holder_team_id);
create index trackable_log_trackable_idx on trackable_log (run_id, trackable_id, created_at);
create index zones_run_owner_team_idx on zones (run_id, owner_team_id);

create index team_locations_run_updated_idx on team_locations (run_id, updated_at desc);


-- ─── Location track ───────────────────────────────────────────────────────────
-- BRIN, not btree. The table is append-only in timestamp order, so the physical
-- layout already correlates near-perfectly with `recorded_at` — which is exactly the
-- condition BRIN is built for. It costs a few kilobytes against a btree's gigabytes
-- on the largest table in the system, and the only queries are range scans
-- (the heatmap over a run's window, the retention sweep).
-- Declared on the parent: Postgres propagates it to every existing partition AND
-- creates it on partitions added later by ensure_location_track_partition().
create index location_track_recorded_brin_idx
  on location_track using brin (recorded_at) with (pages_per_range = 32);

-- getRunHeatmap / getRunReplay: all points of one run. btree here, because a run's
-- rows are NOT physically clustered (many runs interleave) — BRIN would be useless.
create index location_track_run_idx on location_track (run_id, recorded_at);


-- ─── Public gallery ───────────────────────────────────────────────────────────
-- firestore.indexes.json declared four composite indexes here — tags CONTAINS
-- crossed with updatedAt desc and with popularity desc, for both collections.
-- Postgres splits that into a GIN on the array (for the containment predicate) and
-- a btree on the sort key; the planner combines them with a bitmap scan, so two
-- indexes cover all four Firestore combinations.

create index public_games_tags_gin_idx on public_games using gin (tags);
create index public_games_popularity_idx on public_games (popularity desc);
create index public_games_updated_idx on public_games (updated_at desc);
create index public_games_owner_idx on public_games (owner_uid);

create index public_tasks_tags_gin_idx on public_tasks using gin (tags);
create index public_tasks_popularity_idx on public_tasks (popularity desc);
create index public_tasks_created_idx on public_tasks (created_at desc);
create index public_tasks_owner_idx on public_tasks (owner_uid);
-- The task library's map view: bounding-box filter over the published points.
-- Partial, because locationless and unplaced missions have no point at all.
create index public_tasks_location_idx
  on public_tasks (approx_lat, approx_lng)
  where approx_lat is not null;
-- searchTaskLibrary also filters by type + difficulty within a tag set.
create index public_tasks_type_difficulty_idx on public_tasks (type, difficulty);


-- ─── Everything else ──────────────────────────────────────────────────────────

-- (firestore: accessCodes[ownerUid, gameId]) — used by deleteGame/restoreGame to
-- revoke and reinstate exactly the codes belonging to one game.
create index access_codes_owner_game_idx on access_codes (owner_uid, game_id);
create index access_codes_run_idx on access_codes (run_id);

create index wallet_transactions_uid_created_idx on wallet_transactions (uid, created_at desc);

-- listAuditLogs: an owner's trail, most recent first; optionally narrowed to a run.
create index audit_logs_owner_created_idx on audit_logs (owner_uid, created_at desc);
create index audit_logs_run_idx on audit_logs (run_id, created_at desc) where run_id is not null;

create index public_likes_item_idx on public_likes (kind, item_id);
create index public_likes_uid_idx on public_likes (uid);

create index discovery_pois_game_idx on discovery_pois (game_id);

-- The fixed-window limiter reads and writes one row per (bucket, uid) — already the
-- primary key. This one serves the janitor that drops elapsed windows.
create index rate_limits_window_idx on rate_limits (window_start_at);
