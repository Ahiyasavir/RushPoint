# RushPoint — Firebase → Supabase Migration Plan

> **Status:** DECIDED, not started. This document governs the work.
> **Branch:** `migration/supabase` · **Worktree:** `Rushpoint-supabase`
> **Companion docs:** [CLAUDE.md](CLAUDE.md) · [TECH_SPEC.md](TECH_SPEC.md) · [INSTRUCTIONS.md](INSTRUCTIONS.md)
> **Last updated:** 2026-07-26

---

## 0. The decision, honestly stated

We are moving RushPoint's **datastore and its authorization surface** from Firestore to
**Supabase** (Postgres + RLS + Realtime + Storage), targeting a **self-hosted instance on an
~$8/mo IONOS box** with Supabase Cloud Pro ($25/mo) as the managed fallback.

**Driver:** Firebase Blaze is pay-as-you-go with **no hard spending cap**. Firestore
reads/writes cannot be capped — the documented mitigation is budget *alerts*, which fire after
the money is spent. The owner is billing to a family member's card and needs a **bounded**
worst case, not a low expected case.

**The honest downside — record it and stop re-arguing it:**

| | Firebase (today) | Supabase (target) |
|---|---|---|
| Expected monthly cost at our traffic | **$0–2** | **$8 (self-host) or $25 (Pro)** |
| Worst-case monthly cost | **Unbounded** (~$2–2.5k/day is a physically reachable runaway) | **Fixed.** A box that is out of capacity gets slow, not expensive. |
| Ops burden | ~zero | Backups, upgrades, uptime, Postgres tuning — **ours** |

So this migration **spends money to buy predictability**, and spends a large amount of
engineering time to do it. At today's traffic it is a strict financial loss. It is justified
only by the tail risk and by the owner's inability to absorb that tail. That is a legitimate
reason. It is not a performance, feature, or scalability reason, and we should not pretend
otherwise in any commit message or spec.

**Second-order benefit that is real and worth counting:** the migration forces the deletion of
`run.taskCounts` (§4.4) — a denormalized counter that already required a self-healing
reconciler. That is a genuine correctness win we would otherwise never get funded.

---

## 1. Goal & non-goals

### Goal

Every durable game/run/team/score/wallet record lives in Postgres, behind a Supabase project we
control, with a **fixed monthly ceiling**, and the product behaves identically from the
participant's and creator's point of view.

### Non-goals (explicitly out of scope)

1. **No product changes.** No new features, no UX changes, no v2.1 roadmap items (Appendix B of
   TECH_SPEC.md) ride along. A migration that also ships features cannot be bisected when it
   breaks.
2. **No callable-API redesign.** `functions/src/**` keeps its callable names, arguments and
   response shapes. `services/calls.ts` in both apps should ideally not change at all. This is
   the single most important constraint in the document — see §7.
3. **No performance target.** "As fast as today" is the bar. Postgres on an $8 box will beat
   Firestore on some paths (aggregations, `buildRankings`) and lose on others (globally
   distributed reads). We do not chase either.
4. **No schema "improvement" beyond what the migration forces.** Two exceptions are chartered
   below (`taskCounts` deletion, `RunTeam.stages` → rows) because *not* doing them means
   porting a Firestore-shaped workaround into a database that does not have the problem.

---

## 2. Target architecture

```
apps/creator-web ─┐                                    (unchanged React/Vite)
apps/play-web   ─┤ services/calls.ts  (UNCHANGED signatures)
                 │        │
                 │        └── HTTP → functions/  (Node 20, callable-shaped)
                 │                       │
                 │                       └── repositories/  ◀── NEW SEAM (Phase 1)
                 │                                 │
                 │                                 └── pg (node-postgres) → Postgres
                 │
                 └── Realtime subscriptions ────────────────► Supabase Realtime
                 └── Auth ──────────────────────────────────► Firebase Auth (KEPT — see §8)
                 └── Storage ───────────────────────────────► Supabase Storage
```

**Key structural choice: keep the callable layer.** RushPoint's clients already never write game
state — every mutation is a callable and every privileged read is a callable
(`getMyTeamState`, `getJoinInfo`, `getPublicLeaderboard`). That is exactly the boundary a
Postgres migration wants, and it is already built. We do **not** move logic into Postgres
functions or expose PostgREST to clients broadly. RLS becomes **defence in depth**, not the
primary authorization mechanism — because two of our rules genuinely cannot be expressed as RLS
(§6).

**The seam.** All 417 raw Firestore call sites collapse to **~140 distinct repository
operations** across **26 aggregates**. Phase 1 introduces `functions/src/repositories/*` with one
module per aggregate, and every call site goes through it. Of the 140:

| Class | Count | Character |
|---|---|---|
| Generic CRUD | ~90 | Mechanical. Get / put / list / delete by key. |
| Atomic / invariant-bearing | ~30 | Real design work. Most get **simpler** in SQL. |
| Query-shaped | ~15 | Real design work: index design, pagination. |
| Sweeps / batch deletes | ~5 | Real design work: replaces `deleteDocsInChunks`. |

**~50 operations are the irreducible engineering.** The other ~90 are typing practice.

**`functions/src/runs/index.ts` IS the migration.** 194 of the 417 call sites (47%), 4,812 LOC,
and 24 of the 43 transactions live in that one file. The top 5 files are ~87% of the surface.
Schedule accordingly: do not spread the team thin across the tail.

---

## 3. Transaction inventory (43 total)

Verified: `grep -c runTransaction functions/src` = 44 occurrences (43 transaction bodies + the
`withLockRetry` wrapper declaration).

### 3.1 — ~36 are mechanical, and get *safer*

Firestore's `runTransaction` is optimistic: read, mutate, commit, and on contention the **entire
body re-executes**. The overwhelming majority of our transactions are single-document
read-modify-write. In SQL that is:

```sql
SELECT … FROM t WHERE id = $1 FOR UPDATE;   -- pessimistic, no retry loop, no lost-update window
UPDATE t SET … WHERE id = $1;
```

This is a strict improvement: no retry loop, no re-execution semantics to reason about, no
partial-read anomaly. **These 36 are the low-risk bulk and should be batched, not
individually specced.**

### 3.2 — ~6 disappear entirely

- **Claim-once flags** (staff PIN consumption, referral claim guard, idempotency markers) become
  a single statement:
  ```sql
  UPDATE staff_invites SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING *;
  ```
  Zero rows returned = already claimed. The transaction was only ever emulating this.
- **`popularityStore`** and **`rateLimitStore`** become single `INSERT … ON CONFLICT DO UPDATE`
  upserts.

Deleting these is a net LOC reduction and removes six places a future bug can live.

### 3.3 — 2 need REDESIGN, not translation ⚠️ (highest engineering risk in the codebase)

**`assignTask` / `releaseTask`** — `functions/src/routing/assignNextTask.ts`.

Today they read the **whole run document**, filter candidate tasks against the
`run.taskCounts` map in memory, pick a winner, and atomically increment
`taskCounts[taskId]` — relying on Firestore's optimistic re-read to resolve contention
(hence `withLockRetry(op, attempts = 8)` at line 265).

A naive port — `SELECT … FROM runs WHERE id = $1 FOR UPDATE` — **serialises every task
assignment in the entire run behind one row lock**. At 30 teams finishing tasks concurrently
that is a queue, not a race. This is the one place where a mechanical translation is actively
worse than what we have.

**The redesign (chartered, see §4.2 and Phase 3):** station occupancy stops being a counter and
becomes a *query over rows*. Claiming a task becomes:

```sql
UPDATE run_task_records
   SET status = 'assigned', team_id = $team, started_at = now()
 WHERE run_id = $run AND task_id = $task AND status = 'unassigned'
 RETURNING *;
```

Row-level lock on the row actually being contended. `withLockRetry` is deleted. Capacity is
checked with a `count(*)` over `status='assigned'` inside the same statement's predicate or a
`FOR UPDATE SKIP LOCKED` selection over candidates.

### 3.4 — 3 need care

1. **`claimReferral`** — locks **two** wallet rows. Postgres will deadlock on mutual referrals
   (A refers B while B refers A) unless locks are taken in a **canonical order**. Mandate:
   always `ORDER BY uid` before `SELECT … FOR UPDATE`. Add a regression test that fires the two
   directions concurrently.
2. **`requestNextTask`'s two-phase reserve-then-claim** — today it reserves a slot, then claims,
   with a compensating `try/catch` that *reverses the reservation* on failure. That pattern
   exists only because Firestore cannot span the two documents atomically. In Postgres both
   phases **MERGE into one transaction** and the entire compensation branch is **deleted**. Do
   not port the try/catch; porting it would preserve a failure mode that no longer exists.
3. **`completeTaskForTeam`'s `skippedHeldTaskIds` reset** (`runs/index.ts:769-780`) — the array
   is reset as the *first statement inside* the transaction body, with a comment explaining that
   Firestore re-executes the body. In Postgres the body runs once, so the reset is harmless but
   meaningless. **Before deleting it, confirm nothing downstream depends on the re-execution
   semantics** — specifically that the release-slot path (line ~1049-1056) reads the array
   exactly once per commit.

---

## 4. Schema decisions — DECIDED

These are settled. Each records *why*, so a future reader does not re-open them.

### 4.1 — `Game.stages[]` → **JSONB** ✅

Keep the whole stage/task tree as one `jsonb` column on `games`.

**Why (all four independently sufficient):**
- The Builder **rewrites the tree wholesale** on save. There is no partial-update path.
- `buildSavePayload()` (`apps/creator-web/src/lib/savePayload.ts`) computes the dirty check by
  `JSON.stringify`-diffing that exact payload. Shredding breaks the dirty check, not just the write.
- Validation (`requiredTaskCountProblem`, `maxCompletableTasks`) treats the stage as **one unit**.
- **Routing loads the game and filters `stage.tasks` IN MEMORY.** It never queries individual
  tasks from the database. Shredding would buy query-ability nobody uses, and would cost us the
  atomic-save semantics we rely on.

Trade-off accepted: no FK from `run_task_records.task_id` to a `tasks` table. Task IDs are
validated in application code, exactly as today.

### 4.2 — `RunTeam.stages[]` / `RunTaskRecord` → **ROWS** ✅

Opposite call, opposite reasons. `run_task_records` becomes a first-class table:

```sql
create table run_task_records (
  run_id        uuid    not null,
  team_id       text    not null,          -- == participant uid
  stage_id      text    not null,
  task_id       text    not null,
  status        text    not null,          -- unassigned|assigned|completed|skipped
  started_at    timestamptz,
  completed_at  timestamptz,
  earned_score  numeric,
  excluded_ms   bigint,                    -- see §5.1 on absent-vs-0
  score_breakdown jsonb,
  -- folded in from the taskId-keyed maps on the team doc:
  attempts        int   not null default 0,
  cooldown_until  timestamptz,             -- was answerPenalties[taskId].cooldownUntil
  last_failure_at timestamptz,             -- was answerPenalties[taskId].lastFailureAt
  step_progress   int,                     -- was taskStepProgress[taskId]
  hint_used       boolean not null default false,   -- was taskHintsUsed[]
  station_hint_used boolean not null default false, -- was stationHintsUsed[]
  primary key (run_id, team_id, task_id)
);
```

**Why:**
- It is the **hot read/write path** — every completion touches it.
- It is **queryable state**: capacity, contention, and progress are all questions about these rows.
- **`buildRankings` aggregates across them**, and does so today by parsing a nested array in JS.
- Today the **whole nested array is rewritten inside a transaction** on every completion. That
  single fact is what forces `withLockRetry` AND the reservation-reversal `try/catch`. As rows,
  claiming is one `UPDATE … WHERE status='unassigned'` and the contention **disappears**.

This also removes the Firestore 1 MB document-size ceiling that TECH_SPEC §4.C flags as a
planned-v2.1 concern. The v2.1 `taskStates` subcollection proposal is **superseded** by this
table — do not implement both.

**Parity constraint carries over verbatim:** `buildRankings` must remain a pure function of the
stored rows. Never `now()`, never the live template, never client input. Live/final drift is a
scoring bug, not a display bug.

### 4.3 — `Run.taskStatusOverrides` → **table** ✅

`run_task_status_overrides (run_id, task_id, status)`. A per-key `INSERT … ON CONFLICT DO UPDATE`
beats `jsonb_set` on a hot map, and `setRunTaskStatus` writes exactly one key at a time. The
run-scoped-override principle from CLAUDE.md is unchanged: overrides live on the run, never the
template.

### 4.4 — **`run.taskCounts` → DELETE** ✅ — *the single largest correctness win of this migration*

`taskCounts` is a denormalized per-task occupancy counter on the run document. It already
requires a self-healing reconciler because it drifts (the station-slot leak in
`submitStationPhoto`/`reviewStationSubmission` was exactly this class of bug). It also
concentrates *all* routing contention onto one document.

Truth becomes a query:

```sql
select count(*) from run_task_records
 where run_id = $1 and task_id = $2 and status = 'assigned';
```

There is no counter to leak, no reconciler to maintain, and no invariant to test — the number is
derived. Delete `taskCounts` from the type, the routing code, the reconciler, and the simulate
audit that checks "every station counter returns to 0."

### 4.5 — Flatten the 5-level nesting ✅

`users/{ownerUid}/games/{gameId}/runs/{runId}/teams/{teamId}/…` becomes flat tables with
`owner_uid`, `game_id`, `run_id`, `team_id` columns. This is nearly free: **`owner_uid` is
already denormalized onto `Run`, `RunTeam` and `StaffInvite`** precisely because Firestore
subcollection paths were awkward to query. The denormalization we were forced into is the
schema we want.

### 4.6 — `location_track` → **range partition by month** ✅

The 90-day PII prune (TECH_SPEC §15, `pruneExpiredRunData`) becomes `DROP PARTITION` — O(1),
no batch chunking, no `MAX_BATCH_OPS = 450` arithmetic. Same for `team_locations` if volume
warrants. This retires most of `functions/src/batchUtil.ts`.

---

## 5. Semantic hazards (things that silently change meaning)

### 5.1 — `FieldValue.delete()` → NULL ⚠️

**13 `FieldValue.delete()` call sites verified in `functions/src`.** Firestore distinguishes
**ABSENT** from **NULL**, and this codebase leans on that *deliberately*:

- `safeZone?: SafeZone | null` — `null` means "the creator cleared it", absent means "the client
  did not send it". Collapsing them means a partial update wipes the safe zone.
- `RunTaskRecord.excludedMs` — absent vs `0` changes routing behaviour, not just display.

Postgres has one NULL. **Mandatory audit:** every `'x' in data` / `Object.prototype.hasOwnProperty`
/ `?? fallback` / `=== undefined` read against a migrated field must be individually reviewed.
Where the distinction is load-bearing, encode it explicitly (a separate `safe_zone_cleared
boolean`, or `excluded_ms` NOT NULL DEFAULT 0 after proving 0 and absent are equivalent at every
read). Do not "just make it nullable" and move on — that is how this migration ships a silent
scoring bug.

### 5.2 — `serverTimestamp` is NOT used anywhere ✅

**Verified: 0 occurrences across `functions/`, `apps/`, `packages/`.** This is a genuine, unusual
advantage. There are **no sentinel-value semantics to emulate** — no "the value is a placeholder
until the server commits" state to reproduce. Every timestamp is already a real value the server
computed. `now()` maps cleanly.

### 5.3 — Mixed time representations

`answerPenalties.cooldownUntil` and `.lastFailureAt` are **epoch-ms numbers**
(`packages/shared/src/types/index.ts:931-932`) while everything else in the codebase is **ISO
strings**. Normalize both to `timestamptz` in the schema, and **keep ISO serialization at the API
boundary** so no client changes. Note that `evaluateRetryLockout` deliberately bounds the value
on READ so an out-of-range stored value self-heals — preserve that; it is what makes a slow phone
clock safe (CLAUDE.md, "never ship an absolute deadline to a device clock").

---

## 6. Security — the two things that CANNOT be RLS 🔴

**This is the highest-severity risk in the document.** Everything else in
`firestore.rules` maps cleanly onto RLS. These two do not, and a reviewer who assumes "RLS covers
it" will ship a data leak.

### 6.1 — `accessCodes`: keyed-get allowed, enumeration denied

`firestore.rules:253-258`:
```
match /accessCodes/{code} {
  allow get:   if isAuthenticated();
  allow list:  if false;
  allow write: if false;
}
```

Joining a run **is** a keyed fetch by code. Listing the collection would enumerate every run's
`{ownerUid, gameId, runId}` — an anti-cheat hole. **RLS is row-level and cannot distinguish a
keyed fetch from a scan.** `USING (auth.uid() IS NOT NULL)` on `access_codes` permits
`SELECT * FROM access_codes` and dumps the table.

**Mitigation (mandatory):** no client SELECT grant on `access_codes` at all. The only path is a
`SECURITY DEFINER` RPC:

```sql
create function get_join_info(p_code text) returns json
  language plpgsql security definer set search_path = public as $$ … $$;
revoke all on access_codes from anon, authenticated;
```

This mirrors the existing `getJoinInfo` callable exactly — the shape is already right. Rate-limit
the RPC (the existing `rateLimitStore` becomes an upsert, §3.2) so it cannot be used to brute-force
the 6-character code space.

### 6.2 — The participant sanitizer is FIELD-level and value-derived 🔴

`sanitizeTaskForParticipant` (`functions/src/runs/index.ts`) strips `smart.secretCode`, `hint`
text, `answers`, `numericAnswer`, every `steps[].answer`, and — for a still-sealed hidden mission
— the exact `coordinates`, substituting a coarse `searchArea` circle.

**Column GRANTs cannot express "strip `steps[].answer` from inside a JSONB tree."** RLS decides
*which rows* you see, not *which bytes inside a column*. And the hidden-location rule is
**value-derived** (it depends on whether *this team* has already been unsealed by
`reportArrival`'s server GPS verdict), which is not a static grant at all.

**Mitigation (mandatory, non-negotiable):**

> **Participants must NEVER hold direct SELECT on `games`, or on any table carrying a `stages`
> column, in any form.** Every participant read stays behind an RPC / callable, exactly as it sits
> behind a callable today.

`REVOKE ALL ON games FROM anon, authenticated;` and let `get_my_team_state` be the only door.
The e2e sanitizer allowlist (`ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` in `scripts/e2e-verify.mjs`)
must survive the test rewrite intact — it is the thing that fails loud when a new `Task` field
leaks. This is also why §2 keeps the callable layer rather than exposing PostgREST.

### 6.3 — One genuine UPGRADE

**Targeted announcements** are today enforced *client-side as courtesy* — `firestore.rules` grants
read on `…/runs/{runId}/announcements` to any authenticated user, and the client filters by
target. RLS **can** express "this row is visible only to the teams it targets" as a real
`USING` predicate. Take the upgrade; note it in the delta spec as a behaviour *tightening* so
nobody debugs a "missing announcement" for an hour.

### 6.4 — Auth claims → JWT

Staff tokens carry `{ staff, ownerUid, gameId, runId, permissions }` and the whole staff
authorization model reads them. If Firebase Auth is kept (§8), these claims must be verified in
the callable layer as today and, where RLS is used as defence in depth, mapped into the Postgres
session via `SET LOCAL request.jwt.claims`. Do **not** let RLS be the only staff scoping —
`assertStaffOrOwner` stays.

---

## 7. Testing — the safety net you lose during the riskiest change ⚠️

Roughly **10,000 lines of Firebase-specific test code**. Measured:

| Suite | LOC | Fate |
|---|---|---|
| `scripts/e2e-verify.mjs` | **8,937** | Mostly SURVIVES — see below |
| `scripts/test-rules.mjs` (Firestore rules) | 325 | **Dies.** Rewrite as RLS/RPC tests. |
| `scripts/test-storage-rules.mjs` | 167 | **Dies.** Rewrite as Storage-policy tests. |
| `scripts/simulate-run.mjs` (+ browser/adversarial sims) | 263 | Harness rewrite only; assertions survive. |
| `functions/src/__property__/invariants.property.test.ts` | 676 | **Survives untouched** (no emulator). |
| `scripts/test-*.ts` pure lane (~25 suites) | — | **Survives untouched.** All pure. |

**The good news, verified:** `e2e-verify.mjs` contains only **51** direct
`admin.` / `.collection(` / `.doc(` references across 8,937 lines. It is a **callable-contract**
suite, not a Firestore suite. If §1 non-goal 2 holds — callable names, args and response shapes
unchanged — the *assertions* port almost wholesale. What must be rebuilt is:

- the **harness**: emulator boot / import / export, port-offset isolation, the reap logic
  (`emulatorReap`, `emulatorPorts`, `emulatorIsolation` — all Firebase-CLI-specific), replaced by
  `supabase start` / a disposable Postgres schema per run;
- the ~51 direct admin reads used for setup and oracle checks;
- the **callable coverage guard**, which introspects the emulator's served callables. It must be
  re-pointed at whatever serves callables post-migration, and it must stay — it is the reason a
  new callable ships RED until it has a test.

**Sequencing consequence — this is why Phase 2 is where it is:** rewrite the harness **before**
the routing redesign (Phase 3), not after. Doing the highest-risk redesign with no e2e is the
single most likely way this project produces a silent scoring bug in production.

---

## 8. What we are NOT migrating

### 8.1 — Firebase **Auth**: KEEP ✅ (at least through Phase 8)

- **50k MAU free**, generous beyond anything we will hit; **it is not the cost risk.** The
  unbounded exposure is Firestore ops, not Auth.
- We use anonymous auth (uid == teamId), email/password, Google, **and custom tokens** for staff
  PIN sign-in. Supabase Auth can do all of it, but re-implementing custom-token minting and
  migrating every existing anonymous participant identity is real work with a real breakage
  mode — a participant mid-run who loses their uid loses their team.
- Keeping it means `uid` stays a `text` primary key across the schema. That is fine.
- **Revisit only if** Supabase self-hosting makes the split awkward, or if Firebase Auth pricing
  changes. Record it as a deliberate hybrid, not an oversight.

### 8.2 — Firebase **Hosting**: KEEP ✅

Cheap, predictable, already the TWA origin (`twa-manifest.json` pins it — changing origin breaks
the Play Store listing's Digital Asset Links). Static hosting is not the cost risk.

### 8.3 — **Stripe** and the payment webhook: unchanged

`stripeWebhook` is an `onRequest` HTTP function reading Stripe events. Only its *storage* moves
(wallets/transactions → Postgres). The idempotency mechanism (`processedSessions[]`) becomes a
`unique` constraint on a `processed_sessions` table, which is strictly better.

### 8.4 — `apps/mobile`

Archived v1, not in workspaces. Not touched. Not migrated. Not deleted by this work.

### 8.5 — The v2.1 roadmap (TECH_SPEC Appendix B)

Including the planned **RTDB telemetry offload** — which this migration **obsoletes**, since
`team_locations` in Postgres + Realtime is the same architecture without a second Firebase
product. Mark Appendix B §4.B and §4.C as superseded when Phase 3 lands.

---

## 9. The nine phases

Estimates are **person-days of focused work**, and assume the person already knows this codebase.
"Solo elapsed" assumes the realistic part-time rate this project has actually run at.

```
P0 ──► P1 ──► P2 ──► P3 ──► P4 ──┬──► P6 ──► P7 ──► P8
                                 └──► P5 ──┘
```

---

### Phase 0 — Foundations, schema DDL, and the dev loop · **10 pd**
**Depends on:** nothing.

Stand up local Supabase alongside the Firebase emulator (both run; nothing is switched). Write the
complete DDL for all 26 aggregates per §4. Migration tooling (`supabase/migrations/*.sql`, applied
in CI). Provision the IONOS box and prove a restore-from-backup **before** any data matters.
Define the `repositories/` interface — the type signatures only, no implementations.

**Definition of done:** `npm run dev:all` boots Postgres + the emulator side by side; the full
schema applies from zero on a clean box; a backup taken on the IONOS box restores to a working
database on a second box; every one of the ~140 repository operations has a **typed signature**
committed, with the 50 hard ones tagged in the source.

---

### Phase 1 — Data-access seam + the port · **~45 pd (8–10 weeks solo)** 🔴 the monster
**Depends on:** P0.

Implement `repositories/*` against Postgres and route all 417 call sites through them. Order the
work by concentration, not by module alphabetics:

1. `functions/src/runs/index.ts` — 194 sites, 24 transactions. **This is the migration.** Budget
   over half the phase here.
2. The rest of the top 5 files (together ~87% of the surface).
3. The long tail.

Within that: the ~90 generic CRUD ops are batchable and low-ceremony. The ~30 atomic ops get
individual `SELECT … FOR UPDATE` review (§3.1). The 6 that vanish get **deleted, not ported**
(§3.2). The 3 care-cases get named tests: canonical lock ordering for `claimReferral`, the merged
single-transaction `requestNextTask` with the compensation branch removed, and the
`skippedHeldTaskIds` confirmation.

`assignTask`/`releaseTask` are **deliberately left on a temporary naive port** here — they are
Phase 3.

**Definition of done:** zero `firebase-admin/firestore` imports outside `repositories/`;
`npm run typecheck` + the entire pure lane (`npm test`) green; every one of the ~140 ops has at
least one exercising test; §5.1's absent-vs-NULL audit is **completed and signed off in writing**
with each of the 13 `FieldValue.delete()` sites individually resolved.

---

### Phase 2 — Test harness rewrite · **20 pd**
**Depends on:** P1. **Must complete before P3.**

Per §7: rebuild the e2e harness on Postgres (disposable schema per scenario replaces the
emulator port-offset/isolation/reap machinery — a large simplification), port the ~51 direct
admin reads, keep every assertion, keep the sanitizer allowlist, keep the callable coverage
guard, keep the leaderboard invariant oracle and the authz denial matrix. Rewrite
`test-rules.mjs` / `test-storage-rules.mjs` as RLS + RPC + Storage-policy suites, including an
explicit **negative test that `SELECT * FROM access_codes` and `SELECT * FROM games` are denied to
`authenticated`** (§6.1, §6.2).

**Definition of done:** `npm run verify` and `npm run verify:emulator` (renamed) are green against
Postgres with the same scenario count; the callable coverage guard passes with no new `EXEMPT`
entries; an intentionally-introduced sanitizer leak and an intentionally-introduced
`access_codes` grant both fail the suite loud.

---

### Phase 3 — Routing redesign + `taskCounts` deletion · **10 pd** 🔴 highest-risk change
**Depends on:** P2 (do not attempt without the net).

Implement §3.3 and §4.4. Delete `taskCounts`, `withLockRetry`, and the slot reconciler. Rewrite
`assignTask`/`releaseTask` against `run_task_records` rows. Re-point `loadFactor` at a `count(*)`
predicate. `getRecommendedTasks` (read-only, no assignment) follows the same path.

**Definition of done:** `npm run simulate --teams=8` and the adversarial simulate both green;
the station-contention e2e scenario proves concurrent `requestNextTask` cannot exceed a station
cap; the "every counter returns to 0" audit is **deleted** and replaced by "no
`run_task_records` row is left `assigned` after finalize"; a 30-team concurrent assignment
completes without lock-queue blowup (measure it — this is the one place we accept a performance
gate).

---

### Phase 4 — Auth boundary, RLS and RPCs · **12 pd**
**Depends on:** P3.

Write RLS policies for every table as defence in depth. Write `get_join_info` and the participant
read RPCs (§6.1, §6.2). Revoke direct grants on `access_codes` and `games`. Map staff claims into
`request.jwt.claims`. Take the targeted-announcement upgrade (§6.3). Keep `assertStaffOrOwner`
and `requireAuth` in the callable layer — RLS does not replace them.

**Definition of done:** the authz denial matrix (participant / stranger / other-run-staff / owner
× privileged callables) is green; a manually-crafted PostgREST request as `authenticated` cannot
read any answer key, any hidden coordinate, or any access code; RLS is enabled on **every** table
(`SELECT relname FROM pg_class WHERE relrowsecurity = false` returns nothing in `public`).

---

### Phase 5 — Realtime + offline · **15 pd** 🔴 largest *unquantified* risk
**Depends on:** P3. Can run parallel to P4.

**39 `onSnapshot` call sites** across the apps (the analysis counted ~34 distinct listeners; grep
counts imports too). Map each to Supabase Realtime. Expect friction: **Realtime's filters are far
weaker than Firestore's queries** — several listeners will need either a broader subscription with
client-side filtering (costing bandwidth) or a change-feed table shaped for what Realtime can
filter.

**And the part with no clean answer:** `persistentLocalCache` — enabled in **both** apps
(`apps/play-web/src/services/firebase.ts:102`, creator at `:115`) with
`persistentMultipleTabManager` — provides **offline write-through with automatic replay on
reconnect**. Supabase has **no equivalent**. This app is explicitly offline-hardened for field use
(service worker, offline banner, fail-open submit gates, GPS retry backoff), because participants
are outdoors on bad cellular.

Realistic options, to be decided *during* this phase with a spike, not now:
1. **Accept degradation** — reads come from a local cache we write ourselves; **writes fail fast
   and the existing fail-open UI handles it.** Note that CLAUDE.md's `offlineSubmitGate` already
   warns-then-sends; a write that genuinely cannot leave the device is a *new* failure mode.
2. **Client-side outbox** — an IndexedDB queue in front of `services/calls.ts` with idempotency
   keys. Every callable is already idempotent or guarded, which makes this tractable, but it is
   ~2 weeks on its own and is not currently in the 15 pd.
3. **Reduce the offline surface** — cache reads aggressively, require connectivity for
   submissions, and make that explicit in the UI.

**Flag honestly:** this is the largest item in the plan whose cost we cannot yet estimate. If
option 2 is chosen, add **10 pd**.

**Definition of done:** every one of the 39 listener sites is either ported or explicitly
retired with a reason; the browser-fidelity sim (`npm run simulate:browser`) passes including its
offline segment; the chosen offline strategy is documented in TECH_SPEC §21 with its accepted
degradation stated in plain language.

---

### Phase 6 — Storage, scheduled jobs, partitioning · **8 pd**
**Depends on:** P4 + P5.

Port Firebase Storage → Supabase Storage (participant photo/audio prefixes
`runs/{runId}/teams/{teamId}/**`, authored media `gameMedia/{ownerUid}/**`, with the size and
content-type limits from `storage.rules`). Port `pruneExpiredRunData` (pubsub schedule) to
`pg_cron`. Implement the `location_track` monthly partitions and convert the 90-day prune to
`DROP PARTITION` (§4.6). Retire most of `batchUtil.ts`.

**Definition of done:** Storage-policy suite green (including the dead-legacy-prefix denials);
`pg_cron` prune runs and drops a partition on a seeded old month; `deleteMyAccount`'s cascade
still purges every photo (this is a privacy-policy commitment, not a nice-to-have); the 450-op
batch chunking is gone with no sweep left unbounded.

---

### Phase 7 — Data migration & dual-run cutover · **12 pd**
**Depends on:** P6. See §10.

**Definition of done:** see §10's gate list.

---

### Phase 8 — Decommission & cost verification · **5 pd**
**Depends on:** P7 + a clean soak.

Delete `firestore.rules`, `firestore.indexes.json`, the Firestore indexes, the emulator
port/isolation/reap machinery, and every Firestore dependency. **Do not delete the Firebase
project** — Auth and Hosting stay (§8). Downgrade the project off Blaze **only after** confirming
Auth and Hosting stay within Spark limits; if they do not, the billing risk we migrated to escape
is still present and must be re-assessed in writing.

**Definition of done:** `grep -r "firebase/firestore\|firebase-admin/firestore"` returns nothing;
one full billing cycle observed with the actual bill recorded in this document; a written
statement of the *new* worst case (what happens when the IONOS box fills its disk — because that
is now the failure mode, and it is a **downtime** failure, not a financial one).

---

### Totals

| Phase | pd | Cumulative |
|---|---|---|
| P0 Foundations | 10 | 10 |
| P1 Data-access port | **45** | 55 |
| P2 Test harness | 20 | 75 |
| P3 Routing redesign | 10 | 85 |
| P4 Auth/RLS/RPC | 12 | 97 |
| P5 Realtime + offline | 15 *(+10 if outbox)* | 112 |
| P6 Storage/jobs | 8 | 120 |
| P7 Cutover | 12 | 132 |
| P8 Decommission | 5 | **137** |

**~137 person-days.** Solo at this project's observed part-time rate: **6–9 months**. Phase 1
alone is 8–10 weeks. Anyone quoting a number materially below this has not read §3.3, §5.1, §6.2
or §7.

**Cost framing, restated:** ~137 person-days to convert an expected $0–2/mo bill into a fixed
$8–25/mo bill. The purchase is the elimination of an unbounded tail, not a saving.

---

## 10. Cutover strategy

### 10.1 — The shape

**Do not dual-write.** Dual-writing Firestore and Postgres through the whole port would double
the transaction surface, and the two stores' atomicity models do not compose — a Postgres
transaction that commits while the Firestore transaction retries is exactly the split-brain we
cannot debug in the field. Instead:

**Backend-selectable, per-deployment.** One environment variable
(`RUSHPOINT_DATASTORE = firestore | postgres`) selects the repository implementation at the seam
built in Phase 1. Both implementations satisfy the same interface and are exercised by the same
test suite. A deployment runs **one** store.

### 10.2 — The ladder

1. **Playtest lane first.** The `playtest` stack (`npm run playtest:ngrok`) flips to Postgres
   while production stays on Firestore. Note the operational reality from MEMORY: a **second
   computer** hosts the tunnel and auto-updates from git every ~3 minutes, so this is a `git push`
   away — and so is an accidental production flip. Gate the env var explicitly per host.
2. **Soak.** Run the full gauntlet plus a real multi-team playtest on Postgres. Minimum: two
   complete real runs, start to `finalizeRun`, with at least one deliberate mid-run network
   failure.
3. **Freeze + export + import.** Choose a window with **no live run**
   (`listLiveRuns` must return empty — make this a scripted precondition, not a human check).
   Export Firestore, transform, `COPY` into Postgres, verify (below).
4. **Flip production.** Change one env var, deploy.
5. **Keep Firestore warm and read-only for 30 days.** Do not delete. Do not let anything write
   to it.

### 10.3 — Verification gates before the flip

- Row counts match document counts for all 26 aggregates.
- `buildRankings` output is **byte-identical** between stores for every historical finished run.
  This is the strongest oracle we have and it is cheap — run it over every run ever finalized.
- Every `accessCodes` entry resolves through `get_join_info`.
- Every wallet balance and every transaction ledger entry reconciles. **A wallet discrepancy is a
  hard stop** — it is real money.
- The absent-vs-NULL audit (§5.1) is re-run against migrated data, not just against code.

### 10.4 — Rollback

**Trigger:** any wallet discrepancy, any scoring discrepancy, any participant unable to join, or
any data-loss signal. Not "it feels slow."

**Procedure:** flip `RUSHPOINT_DATASTORE` back to `firestore` and redeploy. Recovery target:
minutes.

**The rollback window closes when the first write lands in Postgres that has no Firestore
counterpart** — i.e. as soon as a real run starts on the new stack. From that moment, rollback
means *losing that run*. Therefore:

> **Rollback is safe only during the first window with no live run.** Schedule the flip
> immediately after a finalize and before any launch, and hold the next launch until a smoke
> check passes. After that point the recovery path is roll-forward + restore-from-backup, which
> is why P0's restore drill is a gate and not paperwork.

---

## 11. Risk register

Likelihood × Impact, both Low/Med/High. Ordered by product of the two.

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | **Participant sanitizer bypassed** via a direct table grant — answer keys, hints, or hidden coordinates leak to players. Silent; discovered when a run is won by cheating. | Med | **High** | §6.2: `REVOKE ALL ON games`. Participant reads only via RPC. Keep the e2e sanitizer allowlist. Phase 4 DoD includes a hand-crafted PostgREST probe. |
| R2 | **Offline field play degrades** — no `persistentLocalCache` equivalent; participants outdoors on bad cellular lose submissions. | **High** | **High** | §Phase 5. Decide the strategy from a spike, not a guess. Budget +10 pd for the outbox. State the accepted degradation publicly in the app. |
| R3 | **Routing redesign introduces a scoring/contention bug** — the one place a mechanical port is worse than the original. | Med | **High** | Phase 2 **before** Phase 3. Station-contention e2e + 8-team and adversarial sims + a 30-team lock-queue measurement. |
| R4 | **Absent-vs-NULL collapse** silently changes safe-zone clearing or `excludedMs` routing. | **High** | Med | §5.1. Named, signed-off audit of all 13 sites as a Phase 1 DoD item — not a code-review pass. |
| R5 | **`access_codes` enumeration** — an RLS policy that "looks right" dumps every run's identifiers. | Med | **High** | §6.1. No grant at all; `SECURITY DEFINER` RPC; rate-limited; explicit negative test in Phase 2. |
| R6 | **Estimate blowout.** 137 pd is the *informed* estimate for a solo dev on a codebase where one file is 47% of the surface. | **High** | Med | Phase-gated with per-phase DoD. Re-estimate after Phase 1 with real velocity; publish the revision here. Phases 5–8 are cuttable/deferrable; 0–4 are not. |
| R7 | **We lose the safety net mid-migration** — ~10k lines of test code in flux during the riskiest work. | Med | **High** | §7's measured finding: e2e is callable-shaped (51 direct Firestore refs in 8,937 lines), so honouring non-goal 2 preserves the assertions. Phase 2 is a hard gate. |
| R8 | **Self-hosting operational burden** — the $8 box is now our uptime, our backups, our Postgres upgrades. A dead box during a live field game is unrecoverable in the moment. | Med | **High** | P0 restore drill as a gate. Automated daily backups off-box. Document a "restore to Supabase Cloud Pro in an hour" break-glass — the $25/mo option is the disaster plan, not a rejected alternative. |
| R9 | **`claimReferral` deadlock** on mutual referrals. | Low | Med | §3.4: canonical lock ordering by uid + a concurrent bidirectional regression test. |
| R10 | **Realtime filter weakness** forces broad subscriptions → bandwidth cost or client-side filtering bugs (e.g. a participant receiving another team's data client-side even if the UI hides it). | Med | Med | Audit each of the 39 sites in Phase 5. Where filtering must be broad, ensure **RLS**, not the client, is what withholds the data. |
| R11 | **Hybrid Auth confusion** — Firebase Auth + Postgres data means `auth.uid()` is not natively populated and every RLS policy depends on correctly injected claims. | Med | Med | §6.4. One helper for claim injection, tested. Never let RLS be the only staff scoping. |
| R12 | **Cutover during a live run** corrupts an in-flight game. | Low | **High** | §10.2 step 3: scripted `listLiveRuns`-empty precondition, not a human check. |
| R13 | **Scope creep** — "while we're in here" feature work rides along and the migration becomes unbisectable. | **High** | Med | §1 non-goals. Every PR on this branch must be justifiable as "this is required to run on Postgres." |
| R14 | **Postgres is slower on a $8 box than Firestore's CDN** for globally distributed participants. | Low | Med | Accepted (§1 non-goal 3). Our players are geographically concentrated by construction — a field game is local. Measure in the Phase 5 soak; if it fails, the mitigation is Supabase Cloud Pro, not a redesign. |
| R15 | **`stripeWebhook` payment loss during cutover** — a webhook arrives while the datastore is flipping. | Low | **High** | Stripe retries failed webhooks for 3 days. Return 5xx (not 2xx) during the flip window so Stripe redelivers. Verify wallet reconciliation post-flip (§10.3). |

---

## 12. House rules for this migration

These are the existing project conventions, restated where they bind this work.

1. **SDD + TDD applies.** Every phase is one or more OpenSpec changes
   (`/opsx:propose` → `/opsx:apply` → `/opsx:archive`). The first task of any logic change is a
   failing test. The migration is not an exemption from the process — it is the case the process
   was built for.
2. **Gates stay green per phase**, adapted as they are ported: `typecheck` · `lint` · `test` ·
   `creator:build` · `play:build` · `bundle:budget` · `base:check` · `i18n:check:strict` ·
   the e2e successor.
3. **`FIRESTORE_PATHS` becomes table/column constants** in `@rushpoint/shared`. The rule is
   unchanged in spirit: **never hardcode a table name in a call site.**
4. **`packages/shared` stays framework-free.** No `pg`, no Supabase client. It is imported by
   both browsers.
5. **No client writes to run/team/score state.** The rule that made this migration tractable
   stays. A new mutation is a callable, not an RLS-permitted insert.
6. **Do not build the migration and the v2.1 roadmap at once.** Appendix B waits.
7. **UI changes require `npm run i18n:check:strict`.** This migration should produce ~zero UI
   changes; if a phase touches `.tsx`, that is a signal the seam leaked, and it should be
   questioned in review before it is gated.

---

## 13. Open questions (must be answered before the phase that needs them)

| # | Question | Needed by |
|---|---|---|
| Q1 | Offline strategy: accept degradation, build the outbox, or reduce the offline surface? | Phase 5 kickoff |
| Q2 | Self-host on IONOS from day one, or start on Supabase Cloud Pro and move down once stable? (Starting managed de-risks R8 at $25/mo for a few months.) | Phase 0 |
| Q3 | Do we keep Firebase Auth permanently, or is it a Phase 9 that this document does not cover? | Phase 8 |
| Q4 | Is `excludedMs` absent genuinely equivalent to `0` at every read site, or does routing branch on it? | Phase 1 (blocks §5.1 sign-off) |
| Q5 | Who is the second pair of eyes on the RLS policies? Self-reviewed RLS is how tables leak. | Phase 4 |
