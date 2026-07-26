-- ═══════════════════════════════════════════════════════════════════════════════
-- RushPoint — Row Level Security
--
-- ───────────────────────────────────────────────────────────────────────────────
-- VERIFIED AGAINST CLIENT CODE — 2026-07-26
-- ───────────────────────────────────────────────────────────────────────────────
-- Everything below is either (V) checked against the code named beside it, or (A)
-- an assumption. Do not re-litigate a (V) line without re-reading its source; do
-- treat every (A) line as still open.
--
--   (V) feed_items — participants filtered to `active`, owner/staff UNFILTERED.
--       apps/play-web/src/components/FeedPanel.tsx:111-113 drops the
--       `where('active','==',true)` clause in `moderate` mode, and :296 renders the
--       hidden/reported badge off `item.active === false` (:241). The only caller
--       passing `moderate` is apps/play-web/src/screens/StaffConsole.tsx:669. A
--       blanket `and active` would blind the moderation UI. creator-web
--       (RunConsolePage.tsx:337-338) filters `active` in its OWN query, so an
--       unfiltered owner policy does not change what that console shows.
--   (V) alerts — participants DENIED. Grepped apps/play-web/src: the only reader is
--       StaffConsole; no participant screen touches alerts. Matches firestore.rules
--       (`allow read: if isOwner(uid) || isStaffForRun(...)`). Verified, not assumed.
--   (V) is_run_participant matches attached devices. See the function's own comment.
--       Evidence: functions/src/runs/index.ts joinTeamAsDevice (:486-535) attaches a
--       phone by pushing its uid into the FOUNDER's team.device_uids — it never
--       creates a team doc keyed by that uid — while firestore.rules'
--       isRunParticipant() (:326-330) tests exactly `exists(.../teams/{auth.uid})`.
--       apps/play-web/src/screens/PlayScreen.tsx mounts LiveOps (:474, :633) and
--       FeedPanel (:819) OUTSIDE any `isController` gate, and both read Firestore
--       directly (LiveOps.tsx:76-100, FeedPanel.tsx:92). So today a second phone is
--       served UI whose reads the rules deny. Keeping device_uids here fixes that.
--   (V) trackables / trackable_log / zones tightened to run scope. The only readers
--       are the getRunTrackables / getRunZones CALLABLES —
--       apps/play-web/src/screens/PlayScreen.tsx:160, :901 and
--       apps/creator-web/src/pages/RunConsolePage.tsx:1868 — and both callables
--       (functions/src/runs/index.ts:2647, :2744) resolve the caller's own team via
--       resolveTeamContext/resolveCallerTeam. Nothing reads these cross-run; no
--       public trackable-tracking page and no gallery surface exists. firestore.rules'
--       `isAuthenticated()` (:151-166) was dead-permissive, never exercised.
--   (V) staff_invites keeps NO policy. Grepped apps/ for a read of the collection:
--       there is none. apps/creator-web/src/pages/RunConsolePage.tsx:534 shows the
--       PIN straight from the inviteStaff CALLABLE's return value and holds it in
--       React state (`staffPin`, rendered by StaffInviteCard :1488-1511); the layout
--       flag is `hasStaffPin`, i.e. in-memory, not a query. So denying the table
--       breaks no screen. firestore.rules did allow the owner a read, so
--       list_staff_invites() below restores that capability MINUS the credential.
--   (A) Everything else in this file is a translation of firestore.rules that has
--       NOT been re-checked against a caller. Treat as unverified.
--
-- ⚠️ This file has never been executed: no Postgres/psql/Docker on the authoring
--    machine. Syntax is reviewed by eye only.
-- ───────────────────────────────────────────────────────────────────────────────
--
-- ⚠️  THE SINGLE MOST IMPORTANT RULE IN THIS FILE ⚠️
--
--   PARTICIPANTS NEVER GET `SELECT` ON `games`, NOR ON ANYTHING ELSE CARRYING
--   `stages`. All participant reads stay behind RPCs — exactly as they sit behind
--   Cloud Function callables today.
--
--   Why: the participant payload is produced by `sanitizeTaskForParticipant`, which
--   is FIELD-LEVEL and VALUE-DERIVED. It strips `answers`, `numericAnswer`,
--   `steps[].answer`, `hint`, `smart.secretCode`, and — for a still-sealed hidden
--   mission — `coordinates` / `geofenceRadiusMeters` / the whole `smart` block,
--   substituting a coarse `searchArea`. Some of that depends on RUNTIME STATE (has
--   this team arrived yet?) and on a per-team deterministic shuffle (quiz ordering).
--   RLS gates ROWS. Column GRANTs gate COLUMNS. Neither can express
--   "strip steps[].answer inside a JSONB value, but only until this team arrives".
--   A single `select stages from games` would hand every answer key to the phone.
--
--   So: no policy below ever grants a participant read of `games`, `discovery_pois`,
--   `run_task_overrides`, or `staff_invites`. If you find yourself adding one to
--   make a screen work, add a SECURITY DEFINER RPC that returns the SANITIZED
--   projection instead.
--
-- Shape of the model, mirroring firestore.rules:
--   • Owner  — `owner_uid = auth.uid()` (denormalized onto every owner-scoped table
--              in 0001, so this never needs a join or a recursive path walk).
--   • Participant — reads their OWN team row, and the run-scoped live-ops feeds.
--   • Staff  — run-scoped, via staff_sessions (see is_staff_for_run).
--   • Public — the gallery, and nothing else.
--   • Service role — everything; it bypasses RLS entirely and is what the server
--                    (the old Admin SDK) uses. Every write in this product is a
--                    server write, which is why almost no table below has an
--                    INSERT/UPDATE/DELETE policy at all.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── Helper functions ─────────────────────────────────────────────────────────
-- All are STABLE (one snapshot per statement, so the planner may cache them within
-- a query) and SECURITY DEFINER (they must read tables the CALLER cannot read —
-- that is the whole point). `set search_path` is mandatory on SECURITY DEFINER
-- functions: without it a caller-controlled search_path can shadow `run_teams` with
-- their own table and lie to the policy.

-- A participant of THIS run: the caller founded a team in it (uid == team id, the
-- same identity contract Firestore had), or their phone is attached to one
-- (shared-team-devices). Firestore's isRunParticipant() matched ONLY the founding
-- device because a rules `exists()` could not scan an array on another document;
-- including attached devices here is a deliberate UPGRADE that fixes a live gap.
--
-- KEPT DELIBERATELY, verified 2026-07-26 against the code:
--   • joinTeamAsDevice (functions/src/runs/index.ts:486-535) attaches a phone by
--     appending its uid to the FOUNDER's team.device_uids. It never writes a team
--     row keyed by that uid — so `exists(.../teams/{auth.uid})`, which is literally
--     what firestore.rules isRunParticipant() tests (:326-330), is FALSE for it.
--     The rules file even admits this: "Secondary attached devices — deviceUids —
--     are NOT matched here; they read via the team/chat docs, not the raw feed."
--   • But PlayScreen mounts LiveOps (:474, :633) and FeedPanel (:819) for EVERY
--     device on the team — `isController` gates actions, not these panels — and
--     both subscribe to Firestore directly (LiveOps.tsx:76-100, FeedPanel.tsx:92).
--     A second phone is therefore shown announcement/flash-mission/feed UI that the
--     rules deny it.
--   • transferController / claimController only move `controller_uid` between uids
--     already in device_uids; they do not change membership. So device_uids is the
--     complete and correct membership set.
-- Reverting to founding-uid-only would faithfully reproduce a bug. It stays.
create or replace function public.is_run_participant(p_run_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.run_teams t
    where t.run_id = p_run_id
      and (t.id = auth.uid() or auth.uid() = any (t.device_uids))
  );
$$;

-- Staff scoped to ONE run. Replaces `request.auth.token.staff == true && ...ownerUid
-- && ...gameId && ...runId` from firestore.rules. Scope lives in a table rather than
-- in JWT claims so that revoking a staff member takes effect on the next statement
-- instead of on the next token refresh, and so one person can hold several run
-- scopes without re-signing-in.
create or replace function public.is_staff_for_run(p_run_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_sessions s
    where s.run_id = p_run_id
      and s.staff_uid = auth.uid()
      and s.revoked_at is null
      and s.expires_at > now()
  );
$$;

-- Convenience for the three live-ops feeds: owner OR run-scoped staff OR participant.
create or replace function public.can_read_run(p_run_id text, p_owner_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_owner_uid = auth.uid()
      or public.is_staff_for_run(p_run_id)
      or public.is_run_participant(p_run_id);
$$;

revoke all on function public.is_run_participant(text) from public;
revoke all on function public.is_staff_for_run(text)   from public;
revoke all on function public.can_read_run(text, uuid) from public;
grant execute on function public.is_run_participant(text) to authenticated;
grant execute on function public.is_staff_for_run(text)   to authenticated;
grant execute on function public.can_read_run(text, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- ⚠️  ACCESS CODES — the security-critical decision in this file
-- ═══════════════════════════════════════════════════════════════════════════════
--   firestore.rules said:   allow get: if isAuthenticated();   allow list: if false;
--   i.e. "you may fetch a code you already know, but you may not enumerate them."
--   That distinction does not exist in Postgres. RLS evaluates a predicate per ROW;
--   it cannot see whether the client asked for one key or for the whole table. Any
--   policy permissive enough to satisfy `where code = 'ABC123'` is equally satisfied
--   by `select * from access_codes` — which would dump every live run's
--   {owner_uid, game_id, run_id} to any signed-in user. That is precisely the
--   enumeration attack the Firestore rule was written to stop (anti-cheat row 39).
--
--   Therefore: access_codes gets NO policy and NO grant. Nothing but the service
--   role can touch it. The join path is the RPC below, which takes the code as an
--   ARGUMENT — so a caller must already possess it, restoring the get/list
--   distinction as a property of the interface rather than of the predicate.
--   Rate-limit this RPC (rate_limits, bucket 'getJoinInfo') — a keyed lookup is
--   still brute-forceable if it is free.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_join_info(p_code text)
returns table (
  run_id             text,
  game_id            text,
  owner_uid          uuid,
  game_title         text,
  status             run_status,
  max_participants   integer,
  participant_count  integer,
  requires_guardian_consent boolean,
  min_age            integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.game_id, r.owner_uid, g.title, r.status,
         r.max_participants, r.participant_count,
         g.requires_guardian_consent, g.min_age
  from public.access_codes c
  join public.runs  r on r.id = c.run_id
  join public.games g on g.id = r.game_id
  where c.code = upper(trim(p_code))
    and c.status <> 'revoked'
    and g.deleted_at is null;
$$;
comment on function public.get_join_info(text) is
  'The ONLY read path to access_codes. Returns join-screen metadata for a code the caller already knows. Deliberately returns nothing secret: no staff_pin, no stages, no answer keys.';

revoke all on function public.get_join_info(text) from public;
grant execute on function public.get_join_info(text) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Enable RLS everywhere, then hand back only what is needed
-- ═══════════════════════════════════════════════════════════════════════════════
-- Supabase grants blanket table privileges to `anon` / `authenticated` on the public
-- schema. RLS on its own would still let a permissive default privilege surprise us
-- later, so the belt-and-braces order is: enable RLS on every table, REVOKE ALL from
-- the client roles, then GRANT SELECT back on exactly the tables that have a read
-- policy. No client role is granted INSERT/UPDATE/DELETE anywhere in this schema —
-- every mutation is a server write, as it was under the Admin SDK.

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;


-- ─── Creator-owned tables ─────────────────────────────────────────────────────
-- One predicate, repeated, because owner_uid is denormalized onto all of them.

create policy users_self_read on users
  for select to authenticated using (uid = auth.uid());
grant select on users to authenticated;

create policy wallets_owner_read on wallets
  for select to authenticated using (uid = auth.uid());
grant select on wallets to authenticated;

create policy wallet_tx_owner_read on wallet_transactions
  for select to authenticated using (uid = auth.uid());
grant select on wallet_transactions to authenticated;

-- ⚠️  `games` — OWNER ONLY. See the banner at the top of this file. A participant
-- must never select this table, because `stages` carries every answer key, hint,
-- secret code and hidden coordinate in the game. The public read path is
-- public_games (a projection that contains none of them); the participant read path
-- is an RPC returning a sanitized task payload.
-- Tombstoned games stay visible to their owner — that IS the trash screen — and
-- `deleted_at` / `deleted_by` are server-written, which needs no policy to enforce
-- because no client role has UPDATE at all.
create policy games_owner_read on games
  for select to authenticated using (owner_uid = auth.uid());
grant select on games to authenticated;

-- Coordinates AND answers are server-secret. Owner-only, participants denied —
-- the play path is the getRunDiscoveryPois / claimDiscoveryPoi RPCs.
create policy discovery_pois_owner_read on discovery_pois
  for select to authenticated using (owner_uid = auth.uid());
grant select on discovery_pois to authenticated;

create policy runs_owner_read on runs
  for select to authenticated using (owner_uid = auth.uid());
create policy runs_staff_read on runs
  for select to authenticated using (is_staff_for_run(id));
grant select on runs to authenticated;

-- NOT granted to participants: a per-run pause/close map is operational information
-- that reveals which stops exist. Routing resolves it server-side.
create policy run_task_overrides_owner_read on run_task_overrides
  for select to authenticated using (
    exists (select 1 from runs r where r.id = run_task_overrides.run_id and r.owner_uid = auth.uid())
  );
grant select on run_task_overrides to authenticated;


-- ─── Participant state ────────────────────────────────────────────────────────
-- The founding uid IS the team id (unchanged from Firestore), plus any attached
-- phone. `= any(device_uids)` is an array containment test on the row being
-- evaluated — no extra read, exactly like the old isAttachedDevice() helper.

create policy run_teams_participant_read on run_teams
  for select to authenticated
  using (id = auth.uid() or auth.uid() = any (device_uids));
create policy run_teams_owner_read on run_teams
  for select to authenticated using (owner_uid = auth.uid());
create policy run_teams_staff_read on run_teams
  for select to authenticated using (is_staff_for_run(run_id));
grant select on run_teams to authenticated;

-- The team's own progress. Same three readers as the team row itself: the team's
-- own devices, the owner, run-scoped staff.
-- NOTE what these rows do NOT contain: no answer keys, no hint text, no secret
-- codes — only this team's OUTCOMES (attempts, penalties charged, step progress).
-- That is why they are directly selectable while `games` is not.
create policy run_team_stages_read on run_team_stages
  for select to authenticated using (
    exists (
      select 1 from run_teams t
      where t.run_id = run_team_stages.run_id and t.id = run_team_stages.team_id
        and (t.id = auth.uid() or auth.uid() = any (t.device_uids)
             or t.owner_uid = auth.uid() or is_staff_for_run(t.run_id))
    )
  );
grant select on run_team_stages to authenticated;

create policy run_task_records_read on run_task_records
  for select to authenticated using (
    exists (
      select 1 from run_teams t
      where t.run_id = run_task_records.run_id and t.id = run_task_records.team_id
        and (t.id = auth.uid() or auth.uid() = any (t.device_uids)
             or t.owner_uid = auth.uid() or is_staff_for_run(t.run_id))
    )
  );
grant select on run_task_records to authenticated;


-- ─── Live-ops feeds ───────────────────────────────────────────────────────────

-- ⚠️  TARGETED ANNOUNCEMENTS — this is an UPGRADE over firestore.rules.
--   Firestore could not do this. Its rules gate a document at a time and cannot
--   FILTER documents inside a collection read: a client listening to
--   .../announcements received every doc, and `announcementVisibleTo()` dropped the
--   ones addressed elsewhere CLIENT-SIDE, as a courtesy. Any participant with a
--   debugger saw every other team's targeted message (which is why the codebase is
--   careful to note the field is not secret).
--   RLS filters per ROW inside a scan, so `team_id is null or team_id = auth.uid()`
--   is genuinely enforced here. The client-side helper becomes belt-and-braces.
create policy announcements_read on announcements
  for select to authenticated using (
    can_read_run(run_id, owner_uid)
    and (
      -- Owner and staff run the console; they must see the targeted messages too.
      owner_uid = auth.uid() or is_staff_for_run(run_id)
      -- A participant sees global broadcasts and only their own targeted ones.
      or team_id is null
      or team_id = auth.uid()
    )
  );
grant select on announcements to authenticated;

create policy flash_missions_read on flash_missions
  for select to authenticated using (can_read_run(run_id, owner_uid));
grant select on flash_missions to authenticated;

-- Carries participant photo URLs + team names (PII) — scoped to this run's owner /
-- run-scoped staff / a participant of THIS run, never "any authenticated user".
-- `photoFeedEnabled` is enforced WRITE-side (no items are written while the feed is
-- off); a policy cannot conditionally gate reads on a flag that lives on the game.
--
-- ⚠️  `active` IS NOT A BLANKET FILTER. hideFeedItem sets active = false; that is the
-- moderation state, and the people who moderate must be able to SEE it. FeedPanel in
-- `moderate` mode (StaffConsole) deliberately drops the active clause and renders a
-- "hidden" badge for those very rows — a blanket `and active` here would make the
-- moderation queue permanently empty and hiding an item irreversible from the UI.
-- So: participants see only live items; the owner and run-scoped staff read
-- unfiltered. Moderation is NOT pushed onto the service role, because the client
-- reads this collection directly today and the migration keeps that contract.
create policy feed_items_read on feed_items
  for select to authenticated using (
    can_read_run(run_id, owner_uid)
    and (
      owner_uid = auth.uid()
      or is_staff_for_run(run_id)
      or active
    )
  );
grant select on feed_items to authenticated;

-- SOS / technical alerts: owner + staff only. A participant learning that another
-- team pressed SOS is neither useful nor theirs to know.
-- VERIFIED (2026-07-26), not assumed: grepped apps/play-web/src — no participant
-- screen reads alerts; the sole reader is StaffConsole. Denying participants here
-- therefore breaks nothing. If a participant-facing safety surface is ever added, it
-- needs an RPC, not a widened policy (an alert names another team).
create policy alerts_read on alerts
  for select to authenticated
  using (owner_uid = auth.uid() or is_staff_for_run(run_id));
grant select on alerts to authenticated;

-- Team ↔ HQ chat: same read surface as the team row (own devices / owner / staff).
create policy chat_messages_read on chat_messages
  for select to authenticated using (
    owner_uid = auth.uid()
    or is_staff_for_run(run_id)
    or exists (
      select 1 from run_teams t
      where t.run_id = chat_messages.run_id and t.id = chat_messages.team_id
        and (t.id = auth.uid() or auth.uid() = any (t.device_uids))
    )
  );
grant select on chat_messages to authenticated;

-- Free-text survey responses about the organizer's own event: owner-read only,
-- exactly as in firestore.rules. Players do not read each other's feedback.
create policy run_feedback_owner_read on run_feedback
  for select to authenticated using (owner_uid = auth.uid());
grant select on run_feedback to authenticated;

-- ⚠️  staff_invites carries the one-time PIN in `pin`. NO client policy, NO grant —
-- not even for the owner. Column-level grants could hide `pin` from a SELECT, but a
-- column grant is easy to lose in a later migration and the PIN is a credential.
-- Redemption is a SECURITY DEFINER RPC that compares the PIN server-side.
--
-- NO SCREEN IS BROKEN BY THIS — verified 2026-07-26. firestore.rules did give the
-- owner `allow read` on staffInvites, but nothing in either app ever used it:
-- creator-web never queries the collection. RunConsolePage.tsx:534 takes the PIN
-- from the inviteStaff CALLABLE's return value into React state (`staffPin`) and
-- StaffInviteCard (:1488-1511) renders that in-memory value; the panel's visibility
-- flag `hasStaffPin` (runConsoleLayout.ts:177) is derived from the same state. So
-- the no-policy choice removes an unused capability, not a working screen.
--
-- The RPC below restores the Firestore owner-read capability MINUS the credential,
-- so a future "who did I invite / has it been used" panel does not tempt anyone into
-- adding a table policy. It is the projection, not the table, that is safe to expose:
-- `pin` is not in the RETURNS TABLE list, so no grant drift can leak it.
create or replace function public.list_staff_invites(p_run_id text)
returns table (
  id           uuid,
  run_id       text,
  game_id      text,
  display_name text,
  permissions  staff_permission[],
  used_at      timestamptz,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.run_id, i.game_id, i.display_name,
         i.permissions, i.used_at, i.created_at
  from public.staff_invites i
  where i.run_id = p_run_id
    and i.owner_uid = auth.uid()
  order by i.created_at desc;
$$;
comment on function public.list_staff_invites(text) is
  'Owner-only listing of a run''s staff invites. Deliberately omits the `pin` column: the PIN is a live credential and is only ever compared server-side by the redemption RPC. staff_invites itself has no RLS policy and no grant.';

revoke all on function public.list_staff_invites(text) from public;
grant execute on function public.list_staff_invites(text) to authenticated;

-- A staff member may see their OWN sessions (that is how the console knows its
-- scope and expiry). Nobody else needs this table.
create policy staff_sessions_self_read on staff_sessions
  for select to authenticated
  using (staff_uid = auth.uid() or owner_uid = auth.uid());
grant select on staff_sessions to authenticated;

-- Live map pings. Owner + staff with track_locations; a team may see its own pin.
create policy team_locations_read on team_locations
  for select to authenticated using (
    owner_uid = auth.uid()
    or is_staff_for_run(run_id)
    or team_id = auth.uid()
  );
grant select on team_locations to authenticated;

-- Trackables and zones render live on every participant's map — their position and
-- current holder are not secret. Scoped to participants of THIS run, though: under
-- firestore.rules this was `isAuthenticated()`, i.e. ANY signed-in user could read
-- ANY run's trackables. Tightening it costs nothing and closes a cross-run leak.
--
-- TIGHTENING KEPT, verified 2026-07-26 that nothing reads these cross-run:
--   • Every reader in both apps goes through the getRunTrackables / getRunZones
--     CALLABLES — PlayScreen.tsx:160 and :901, RunConsolePage.tsx:1868 — never a
--     direct collection read. Those callables (functions/src/runs/index.ts:2647,
--     :2744) already require the caller to hold a team in the run
--     (resolveTeamContext / resolveCallerTeam), so the callable surface was ALWAYS
--     narrower than the rule; `isAuthenticated()` was dead-permissive, not relied on.
--   • No public trackable-tracking page and no gallery surface reads them; the
--     gallery projections are public_games / public_tasks only.
--   • The owner is covered by can_read_run()'s p_owner_uid arm, which is what the
--     Run Console needs.
-- So this narrows nobody's actual access — it is a real security improvement, not a
-- silent behaviour change.
create policy trackables_read on trackables
  for select to authenticated using (can_read_run(run_id, owner_uid));
grant select on trackables to authenticated;

create policy trackable_log_read on trackable_log
  for select to authenticated using (
    exists (select 1 from trackables tr
            where tr.run_id = trackable_log.run_id and tr.id = trackable_log.trackable_id
              and can_read_run(tr.run_id, tr.owner_uid))
  );
grant select on trackable_log to authenticated;

create policy zones_read on zones
  for select to authenticated using (can_read_run(run_id, owner_uid));
grant select on zones to authenticated;

-- Retained GPS history: owner only. This is the most sensitive PII in the system.
-- The policy is declared on the PARENT — Postgres applies a partitioned table's RLS
-- to every partition, including ones created later by ensure_location_track_partition().
create policy location_track_owner_read on location_track
  for select to authenticated using (owner_uid = auth.uid());
grant select on location_track to authenticated;


-- ─── Public gallery ───────────────────────────────────────────────────────────
-- `using (true)` for anon AND authenticated, read only. These two tables are
-- projections written exclusively by publishGame; there is no write policy, so the
-- projection contract (no answer keys, no hint text, no secret codes) stays a
-- property of the write path, as it was in Firestore.
-- Note deliberately: public_tasks.approx_lat/lng is the EXACT authored point of every
-- located mission, HIDDEN MISSIONS INCLUDED (gallery-exact-hidden-location). The
-- creator-facing map must be accurate; the in-game hidden puzzle is sealed by the
-- participant sanitizer, not here. This is not a leak — do not "fix" it.

create policy public_games_read on public_games for select to anon, authenticated using (true);
grant select on public_games to anon, authenticated;

create policy public_tasks_read on public_tasks for select to anon, authenticated using (true);
grant select on public_tasks to anon, authenticated;

-- Anonymized cross-platform aggregate — no per-run ids by construction. Any
-- authenticated creator may read the medians; only the server contributes.
create policy benchmarks_read on benchmarks for select to authenticated using (true);
grant select on benchmarks to authenticated;

-- Tag counts drive the gallery's filter chips; harmless and public.
create policy tag_stats_read on tag_stats for select to anon, authenticated using (true);
grant select on tag_stats to anon, authenticated;

-- A player reads only their own lifetime profile.
create policy players_self_read on players
  for select to authenticated using (uid = auth.uid());
grant select on players to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Tables with NO POLICIES AT ALL — service role only
-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS is enabled on each (the loop above did it) and no policy exists, so every
-- client role gets zero rows regardless of grants. This is intentional and each has
-- a distinct reason:
--
--   access_codes              enumeration (see the banner above); read via get_join_info().
--   staff_invites             carries a live credential (`pin`); redeem via RPC, list
--                             via list_staff_invites() (which omits `pin`). Verified
--                             2026-07-26 that no app screen queries this table.
--   audit_logs                immutable admin trail; read via the listAuditLogs RPC.
--                             A client-readable audit log is a map of every
--                             adjustment, evacuation and manual unlock in an event.
--   public_likes              writable ⇒ forgeable gallery rankings; readable ⇒ a
--                             scrapable "who liked what" social graph. Like state
--                             comes back inside the gallery search RPCs.
--   rate_limits               a client that can read its own counter knows exactly
--                             when to resume; one that can write it has no limit.
--   stripe_processed_sessions payment idempotency ledger.
--
-- Documented rather than left implicit so a future migration does not "helpfully"
-- add a policy to one of them.
-- ═══════════════════════════════════════════════════════════════════════════════
