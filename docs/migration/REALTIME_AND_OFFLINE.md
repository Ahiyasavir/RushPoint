# Realtime & Offline — resolving the migration's largest unquantified risk

> **Scope:** Phase 5 of [MIGRATION_PLAN.md](../../MIGRATION_PLAN.md) (§Phase 5, line 578), listed
> there as 🔴 *the largest item in the plan whose cost we cannot yet estimate*, and as risks **R2**
> (offline field play degrades) and **R10** (Realtime filter weakness).
> **Status:** investigated 2026-07-26. This document answers open question **Q1** and re-estimates
> Phase 5.
> **Verdict up front:** the risk is **acceptable**, and it is **substantially smaller than the plan
> assumes** — because the plan mis-describes what this app actually uses Firestore for. Two of the
> plan's stated premises are false against the code. See §0.
>
> Every claim below is anchored to a `file:line` in this worktree or a cited URL. Where I could not
> verify something, it says so in bold.

---

## 0. The two corrections that change the estimate

The migration plan's Phase 5 rests on two factual premises. Both are wrong as stated.

### Correction 1 — the app does **not** queue offline writes. Not one.

MIGRATION_PLAN.md:587-591 says `persistentLocalCache` "provides **offline write-through with
automatic replay on reconnect**. Supabase has **no equivalent**." That is a true statement about
the Firestore *API* and a false statement about *this app*.

Evidence, in order of decisiveness:

1. **There are no gameplay client writes to replay.** A repo-wide grep for
   `setDoc|addDoc|updateDoc|deleteDoc|writeBatch` across `apps/play-web/src` and
   `apps/creator-web/src` returns exactly **two** hits, both creator-side profile writes to
   `users/{uid}` on an interactive, online-only path:
   - `apps/creator-web/src/components/AuthGate.tsx:144` (write the profile row at sign-up)
   - `apps/creator-web/src/pages/SettingsPage.tsx:196` (write the new email after a change)

   **`apps/play-web/src` contains zero Firestore writes.** This is not an accident; it is the
   architecture CLAUDE.md mandates ("Run / team / score / leaderboard docs are SERVER-WRITE-ONLY")
   and `firestore.rules` enforces.

2. **Every mutation is an HTTPS callable, and Firestore's offline queue does not cover those.**
   `apps/play-web/src/services/firebase.ts:301` and `apps/creator-web/src/services/api.ts:16` both
   wrap `httpsCallable`. A callable is an HTTPS POST to Cloud Functions; it is not part of the
   Firestore write path and gets **no** offline queueing or replay. Offline, `completeTask`,
   `submitTaskAnswer`, `verifyStationCode` and `triggerSOS` fail *today*, on Firebase, exactly as
   they would on Supabase.

3. **The code says so in its own comments.** `apps/play-web/src/components/ConnectionBanner.tsx:6-7`:
   "Reads/live-state keep working from the Firestore cache, but **actions (verify, submit, SOS) need
   a connection**."

4. **The test suite asserts the degraded behaviour, not offline success.** The browser-fidelity
   sim's offline segment (`scripts/simulate-browser-run.mjs:376-393`) takes a team offline mid-run
   and asserts only three things: the offline banner appears, **no page error is raised**, and the
   team can still finish **after reconnecting**. It never asserts that a submission made while
   offline succeeds. There is no such test because there is no such behaviour.

**Consequence:** MIGRATION_PLAN.md Phase 5 option 2 ("Client-side outbox … **+10 pd**") is solving
a problem the app does not have. It should be struck, not deferred. That is a **10 pd reduction**
and — more importantly — the removal of the single genuinely unbounded item in the plan.

### Correction 2 — Supabase Realtime's filters are much stronger than the plan assumes.

MIGRATION_PLAN.md:582-585 and risk **R10** assume "Realtime's filters are far weaker than
Firestore's queries", forcing broad subscriptions or a bespoke change-feed table.

Per the current official docs
([Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)), the filter format
is `column=operator.value` evaluated **server-side**, and the supported operators are `eq`, `neq`,
`lt`, `lte`, `gt`, `gte`, `in` (max 100 values), `like`/`ilike`, `match`/`imatch`, `is`,
`isdistinct`, each negatable with a `not.` prefix. **Multiple columns can be combined** with commas
as a logical `AND` (documented example: `quantity=gte.10,status=eq.open`); `OR` is not supported.

⚠️ **Caveat, flagged honestly:** this is a *recent* doc state. Most circulating third-party material
(and older Supabase docs) still say "eq only, one column". The docs **do not state a minimum
Realtime version** for the extended operators — **unverified**, and we are targeting a *self-hosted*
instance, so **the spike in §6 must confirm this against our pinned Realtime image before any
design depends on multi-column filters.** The design in §4 is deliberately built so that it works
even if only `eq` on one column is available (see §4.0).

What Realtime genuinely cannot do, and the plan is right about: **there is no `orderBy` and no
`limit` in a subscription** — no ordering or limiting primitive exists for `postgres_changes`. §4.0
explains why that costs us nothing.

---

## 1. Listener inventory — the real count

MIGRATION_PLAN.md:581 says "**39 `onSnapshot` call sites**… the analysis counted ~34 distinct
listeners". Both numbers are inflated:

| Count | What it is |
|---:|---|
| 39 | `grep -c onSnapshot apps/**` — includes **imports, comments, and `apps/mobile`** (archived v1, not in the npm workspaces) |
| 25 | occurrences in `apps/play-web/src` + `apps/creator-web/src` — still includes imports and comment prose |
| **14** | lexical `onSnapshot(` **call sites** in the two live apps |
| **16** | **logical listeners** — 14 lexical, but `RunConsolePage.tsx:299` sits inside the `watchOrRead` helper, invoked 3× (teams / feedItems / chat) |

**16 listeners.** That is the number Phase 5 has to port. Nine in play-web, seven in creator-web.

### 1.1 Ranked by what actually breaks for a human

Ranking is by *consequence of staleness or failure*, not by frequency. A stale leaderboard is
cosmetic. An undelivered SOS is a safety incident.

| # | Site (`file:line`) | Collection & query shape | If it goes stale or fails, the user… | Sev |
|---|---|---|---|---|
| 1 | `apps/play-web/src/screens/StaffConsole.tsx:256` | `alerts`, `where('acknowledged','==',false)` | **Staff never see a raised SOS.** A participant in trouble is not attended to. The console plays an audible cue on new alerts (`seenAlertIds` baseline, :246-250) — this is the safety path. | **P0** |
| 2 | `apps/creator-web/src/pages/RunConsolePage.tsx:191` | `alerts`, `where('acknowledged','==',false)` | Same, organizer side. Also drives the `document.title` flash (:214-222) so an SOS is noticed on another tab. The code already treats a swallowed error here as the worst case: "the one place the console read 'no SOS' when the truth was 'cannot tell'" (:183-185). | **P0** |
| 3 | `apps/play-web/src/components/LiveOps.tsx:86` | `announcements`, `where('active','==',true)`, `orderBy('createdAt','desc')`, `limit(30)` | **Miss an organizer broadcast** — which includes safety instructions ("come back to the square", "avoid the north gate"). Targeted score notices ride the same collection. | **P1** |
| 4 | `apps/play-web/src/components/LiveOps.tsx:100` | `flashMissions`, `where('isActive','==',true)`, `orderBy('createdAt','desc')`, `limit(20)` | **Miss a time-limited bonus mission.** Short TTL by design, so latency is the whole feature — a team that sees it 60 s late is competitively disadvantaged through no fault of its own. Fairness, not cosmetics. | **P1** |
| 5 | `apps/play-web/src/screens/PlayScreen.tsx:184` | `teams/{teamId}` doc — **trigger only** | Race start / task assignment / score / finish feel laggy. **Already poll-backed**: see §1.2. | **P1 surface, P3 listener** |
| 6 | `apps/play-web/src/components/ChatPanel.tsx:41` | `runChat/{teamId}` doc | Team↔HQ chat stalls. Safety-adjacent (it is how a confused or lost team talks to HQ). Already has a bounded re-subscribe, 2 s→30 s (:33-56). | **P1** |
| 7 | `apps/play-web/src/screens/StaffConsole.tsx:525` | `runChat` collection (all threads) | HQ does not see an incoming team message. Other half of #6. | **P1** |
| 8 | `apps/play-web/src/screens/StaffConsole.tsx:212` | `teams` collection | Photo-review queue + manual-bonus panel go stale; a team waits on an unreviewed photo. Blocks progress but is visible and correctable. Failure is surfaced (`setReadErr`, :245). | **P2** |
| 9 | `apps/creator-web/src/pages/RunConsolePage.tsx:316` (via `watchOrRead`) | `teams` collection | Same photo-review queue, organizer side. Failure surfaced via `photoLoadError` (:323-325). | **P2** |
| 10 | `apps/creator-web/src/components/LiveTeamMap.tsx:61` | `teamLocations` collection | Organizer's live map of where teams are goes stale. Situational awareness; matters when someone is missing. | **P2** |
| 11 | `apps/creator-web/src/pages/RunConsolePage.tsx:164` | `runs/{runId}` doc | Run status / leaderboard snapshot / freeze state stale on the console. | **P2** |
| 12 | `apps/creator-web/src/pages/RunConsolePage.tsx:375` (via `watchOrRead`) | `runChat` collection | Organizer's chat threads + unread badges. Duplicate of #7 on the creator console. | **P2** |
| 13 | `apps/play-web/src/screens/PlayScreen.tsx:839` | `runChat/{teamId}` doc | Unread-chat **badge** only (the thread itself is #6). | **P3** |
| 14 | `apps/play-web/src/components/FeedPanel.tsx:128` | `feedItems`, `where('active','==',true)` (dropped in `moderate` mode), `orderBy('createdAt','desc')`, `limit(100)` | Live photo feed updates late. Purely social. Already has a bounded re-subscribe, 2 s→30 s (:117-140). | **P3** |
| 15 | `apps/creator-web/src/pages/RunConsolePage.tsx:336` (via `watchOrRead`) | `feedItems`, same shape | Moderation queue updates late. A reported photo sits a few seconds longer. | **P3** |
| 16 | `apps/creator-web/src/pages/WalletPage.tsx:52` | `wallets/{uid}/transactions`, `orderBy('createdAt','desc')`, `limit(20)` | A credit purchase appears in the ledger a few seconds late, on a page the user opened to look at it. | **P4** |

**Two P0s, and they are the same query on the same table** (`alerts`, unacknowledged), rendered in
two consoles. The entire safety-critical realtime surface of this product is **one subscription
shape**. That is the single most important finding in this section: it means the hard part is small
and can be engineered to a much higher standard than the other fourteen.

### 1.2 The decisive structural fact: this app is already a polling app

The migration plan treats realtime as load-bearing everywhere. The code does not. Existing
production polling loops, none of which involve `onSnapshot`:

| Poll | Interval | Source |
|---|---|---|
| Participant game state (`getMyTeamState`) | **12 s** | `apps/play-web/src/screens/PlayScreen.tsx:193` |
| …and **3 s** while reconnecting | 3 s | `apps/play-web/src/screens/PlayScreen.tsx:220` |
| Run console teams table — "the console's **SINGLE live picture** (the table, every score, the attention verdict, the signal chips)" | **5 s** | `apps/creator-web/src/pages/RunConsolePage.tsx:264`, comment at :244 |
| `refreshLeaderboard` mid-run | 15 s | `apps/creator-web/src/pages/RunConsolePage.tsx:277` |
| Public shareable leaderboard | 8 s | `apps/play-web/src/screens/PublicLeaderboardScreen.tsx:45` |
| TV leaderboard | `REFRESH_MS` | `apps/play-web/src/screens/TvLeaderboard.tsx:52` |
| Creator live-runs list | interval | `apps/creator-web/src/hooks/useLiveRuns.ts:61` |

Read listener #5 against this table. `PlayScreen.tsx:176-177` states it explicitly: *"The snapshot
is only a trigger — we still fetch the server-sanitized state via `getMyTeamState` so answer keys
never reach the client."* The participant's entire game state already arrives by **callable poll**;
the snapshot exists only to make the poll fire sooner. Likewise the run console's teams table is a
5 s `listRunTeams` poll, and the `teams` snapshot there feeds only the photo-review queue.

**So the most important realtime surface in the product already degrades gracefully to a 12 s poll
by design, and is already tested that way.** Polling is not a compromise we are introducing; it is
the architecture that exists.

---

## 2. Offline — what the app actually relies on

### 2.1 Reads, not writes

| Firestore capability | Enabled? | Actually relied upon? |
|---|---|---|
| Offline **write** queue + replay | Yes, by default with `persistentLocalCache` | **No.** Zero play-web writes; two online-only creator profile writes. All mutations are callables, which the queue does not cover. §0 Correction 1. |
| Offline **read** cache (IndexedDB) | `apps/play-web/src/services/firebase.ts:100-102`, `apps/creator-web/src/services/firebase.ts:115` | **Partially** — it backs the 16 listeners, and only those. It does **not** back `getMyTeamState`, which is the participant's game state. |
| Automatic listener reconnect | Yes | Yes — but the app does not trust it. `FeedPanel.tsx:117-140` and `ChatPanel.tsx:33-56` both hand-roll a 2 s→30 s re-subscribe because "Firestore tears the listener down on error, and this effect only re-subscribes when its deps change — which they don't for a stable run — so one `unavailable`/token-refresh blip would freeze the feed for the rest of the run." |

### 2.2 What "offline" looks like today, on Firebase

Worth stating plainly, because it sets the bar we must match — not the bar the plan imagines:

- **Offline, app already open:** the shell stays up, the banner shows
  (`ConnectionBanner.tsx:24`), React state holds the last game view, listener-fed surfaces may serve
  from the Firestore cache, and every *action* fails. `offlineSubmitGate`
  (`apps/play-web/src/lib/stuckGuards.ts:64-80`) warns once per task then **sends anyway**, because
  `navigator.onLine` is a heuristic and every client gate must fail open.
- **Offline, app reloaded:** the service worker serves the app shell
  (`apps/play-web/public/sw.js`, network-first navigation with a cached `/index.html` fallback), and
  then **`getMyTeamState` fails and the participant sees the reconnecting / sync-failed card**
  (`PlayScreen.tsx:130-145`). `localStorage` holds only the *session coordinates*
  (`apps/play-web/src/store.ts:18-36`: `ownerUid/gameId/runId/code`), never game state. The
  Firestore cache does **not** rescue this path, because the state does not come from Firestore.

**That second bullet is the honest headline: a reload while offline is already broken today.** The
migration cannot regress it, because there is nothing left to lose.

### 2.3 The offline-sync landscape — and why we should use none of it

I researched this properly rather than assuming, because "Supabase has no offline story" is the
scariest line in the migration plan. Findings:

**Supabase officially has no offline support and no roadmap for it.**
[Discussion #357](https://github.com/orgs/supabase/discussions/357) ("Using Supabase offline") has
been open since **Dec 2020** and is the org's most-upvoted discussion; in June 2023 the team
explained why it is hard (they would need a full timestamped event history, plus RLS problems) and
**recommended third parties instead**. A newer request,
[#40664](https://github.com/orgs/supabase/discussions/40664) (Nov 2025), is **still unanswered**.
There is no offline/PWA docs page. So this is genuinely on us or on a vendor.

But every vendor in this space solves the problem **we do not have** — the write path — and charges
for it in bundle size, schema demands, and maturity risk:

| Option | Fit for "reads-only, RPC writes" | Why not |
|---|---|---|
| **PowerSync** | Poor | Local **WASM SQLite + Web Workers + OPFS/IndexedDB**; every read is rewritten as local SQL against Sync Rules. `uploadData()` is **mandatory** in the connector API; a no-op read-only config is *probably* workable but **no vendor doc endorses it** — unsupported territory. No official bundle figure, realistically **several hundred KB gzip of WASM+workers**, which would blow `npm run bundle:budget` unless lazy-loaded. Free tier caps at **50 concurrent connections** and **deprovisions after 7 idle days** — thin for a live field game. Heavy re-architecture. |
| **ElectricSQL** | **Good, architecturally** | Genuinely read-path-only by design ("Electric does not do write-path sync"), plain HTTP/SSE, **~18 KB gzip, no WASM/OPFS/COOP-COEP**. But: it gives you **no offline store** (the client is in-memory; you supply IndexedDB yourself), the old engine was **frozen Jul 2024** and deprecated with a full rewrite (1.0 GA Mar 2025), Cloud went public beta Apr 2025 with **GA unconfirmed**, the company has repositioned around "agents on sync", and Supabase integration needs the direct connection URL, which is **IPv6-only** → requires the **IPv4 add-on (Supabase Pro)**. Keep on the shelf as the upgrade path; do not adopt now. |
| **RxDB** | Fair | Pull-only replication is explicitly supported. But **IndexedDB, OPFS, SQLite and workers are all Premium — $99/mo minimum**. Its Supabase plugin syncs clients **directly against tables**, contradicting our RPC-only posture. |
| **TanStack DB** | Fair | Still **0.x**; persistence landed Mar 2026 and the authors call it "**the first alpha release of persistence**". The Supabase adapter `@supabase-labs/tanstack-db` is **0.0.1, one published version, Supabase's own label: alpha**. |
| **Legend-State** | Fair | Smallest (~11 KB gzip) and pull-only is trivial (omit `set`). But the sync features live only in **v3, in beta since Sep 2024 — ~22 months**. |
| **WatermelonDB** | Poor | **Rule out.** Stable 0.28.0 (Apr 2025), **no commits to master since Aug 2025**, empty Releases page. Local-DB-of-record model is wrong for us anyway. |
| **Rocicorp Zero** | Poor | 1.0 shipped Jun 2026, Apache-2.0, but **their own docs say it "doesn't support offline writes"** and cannot survive extended offline periods — disqualifying for a field game whose whole point is dead cell zones. |

**Conclusion: adopt no sync engine.** Every one of them is priced, sized and shaped for
bidirectional sync. We need a read cache.

### 2.4 Decision on offline

**Adopt MIGRATION_PLAN.md Phase 5 option 1 + a bounded slice of option 3. Strike option 2.**

Concretely:

1. **Writes: accept the status quo.** Callables become Supabase RPC/Edge Function calls. They fail
   offline. They fail offline today. The existing fail-open UI (`stuckGuards.ts`,
   `ConnectionBanner`, the localized `syncFailed` copy) already handles it, unchanged. **0 pd.**
2. **Reads: replace the Firestore cache with an explicit one we own.** A small IndexedDB
   last-known-good store keyed by `(runId, surface)`, written on every successful fetch, read on
   boot when the network is unavailable. This is the *only* new offline code, and it is bounded:
   one module, one hook, no schema demands, no sync engine, no conflict resolution (the server is
   the sole writer, so there is never a conflict to resolve).
   - Surfaces worth caching: participant game state (`getMyTeamState`), announcements, flash
     missions, the active task card. Roughly 4 payloads, all small JSON.
   - **Concretely:** `persistQueryClient` (an official, long-standing TanStack Query plugin) with an
     `idb-keyval` async persister and `networkMode: 'offlineFirst'`, so cached-but-stale data
     renders offline instead of the query erroring
     ([docs](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)).
     Single-digit KB gzip. Set `gcTime ≥ maxAge`. Known pitfall to avoid: persisting the whole
     client on every mutation is a documented perf problem on large caches
     ([TanStack/query#5854](https://github.com/TanStack/query/issues/5854)) — persist selectively.
   - ⚠️ **Service-worker gotcha worth designing around now:** the Cache Storage API **cannot store
     POST responses** ([workbox#2258](https://github.com/GoogleChrome/workbox/issues/2258)), and
     `supabase.rpc()` **defaults to POST**. Mark read-only RPCs `STABLE` and call them with
     `{ get: true }` ([rpc docs](https://supabase.com/docs/reference/javascript/rpc)) so they become
     GETs the service worker can cache; keep authoritative write RPCs as POST/NetworkOnly. This is
     free if decided up front and annoying to retrofit.
   - **Estimate: 3 pd**, including tests.
   - **This is a net improvement over today**, because it fixes the reload-while-offline hole
     described in §2.2 — a hole Firestore's cache never plugged.
3. **Reduce the offline surface honestly in the UI.** The banner already exists; add explicit
   "saved locally, will retry" wording nowhere, because nothing is saved locally. Keep the copy
   truthful. **0 pd.**

**Phase 5 offline cost: 3 pd, not the plan's "15 pd + 10 pd if outbox".**

---

## 3. Supabase Realtime — the honest constraints

Grounded in the official docs. Numbers are as published on
[Realtime Quotas](https://supabase.com/docs/guides/realtime/quotas).

| Constraint | Detail | Does it bite us? |
|---|---|---|
| **Filters** | `column=op.value`, server-side; `eq/neq/lt/lte/gt/gte/in/like/ilike/match/imatch/is/isdistinct`, `not.` prefix, comma = `AND`, **no `OR`**. ([docs](https://supabase.com/docs/guides/realtime/postgres-changes)) | **No** — see §4.0. Every one of our 16 listeners is scoped by a single `run_id` (or `uid`). |
| **No `orderBy` / `limit` in a subscription** | No ordering or limiting primitive exists for `postgres_changes`. | **No** — see §4.0. Our `orderBy`+`limit` exist on the *initial* query, not the delta stream. |
| **Cannot filter DELETE events** | And with RLS on, the `old` record carries only the primary key. ([docs](https://supabase.com/docs/guides/realtime/postgres-changes)) | **Barely.** Our live-ops rows are soft-deactivated (`active=false`, `acknowledged=true`), i.e. UPDATEs. Hard deletes are retention sweeps, which no live UI watches. |
| **RLS is evaluated per subscriber, per change** | "a table with 100 subscribed users … performs 100 authorization checks"; single-threaded, so bigger compute does not help; **use Broadcast beyond ~3,000 concurrent subscribers**. ([docs](https://supabase.com/docs/guides/realtime/postgres-changes)) | **Watch it.** Our RLS helpers do subqueries — `can_read_run` calls `is_staff_for_run` **and** `is_run_participant` (`supabase/migrations/0002_rls_policies.sql:116-165`), each an `exists(select …)`. Per-subscriber-per-change, on an $8 box. See §5. |
| **No replay on reconnect** | Nothing in the docs describes catch-up, resume-from-LSN or replay for `postgres_changes`. Events during a disconnect are **gone**. The only documented catch-up is **Broadcast Replay**, which is private-channels-only, DB-broadcast-only, `limit` ≤ 25, 72 h retention. ([Broadcast](https://supabase.com/docs/guides/realtime/broadcast)) | **Yes — this is the real one.** See §4.1. |
| **Silent disconnects** | When heartbeats stop (backgrounded tab, throttled mobile browser) "the WebSocket connection can silently drop" with no error. Mitigations: `worker: true` (heartbeat on a Web Worker) and a `heartbeatCallback` where **you must call `client.connect()` yourself**. ([troubleshooting](https://supabase.com/docs/guides/troubleshooting/realtime-handling-silent-disconnections-in-backgrounded-applications-592794)) | **Yes — and this is the field-use one.** A phone in a pocket mid-race is exactly a backgrounded tab. See §4.1. |
| **Auto-reconnect** | `realtime-js` reconnects with stepped backoff `[1000, 2000, 5000, 10000]` ms, scheduled in `_onConnClose()` unless the disconnect was manual. ([RealtimeClient.ts](https://github.com/supabase/realtime-js/blob/master/src/RealtimeClient.ts)) | No — comparable to Firestore. |
| **Quotas** | Free: 200 concurrent connections / 100 msg·s⁻¹ / 100 channel-joins·s⁻¹. Pro: 500 / 500 / 500. Channels per connection: **100** on every tier. ([quotas](https://supabase.com/docs/guides/realtime/quotas)) | **No, at our scale** — but see §5 for the self-hosted caveat. |
| **Official recommendation** | Supabase itself says Broadcast "is the recommended method for scalability and security" and Postgres Changes "does not scale as well". ([subscribing-to-database-changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)) | Informs §5. |
| **supabase-js offline** | **None.** No local cache, no write queue, no persistence. `realtime-js` buffers outgoing socket frames in memory only — not durable, does not survive a reload. Open request: [discussions#40664](https://github.com/orgs/supabase/discussions/40664). | Already handled by §2.4. |

---

## 4. The design

### 4.0 The core pattern: **SQL for the snapshot, Realtime for the nudge**

This is the whole design, and it dissolves the filter problem entirely.

Firestore conflates two things in one `onSnapshot`: the **initial query** (rich: `where` +
`orderBy` + `limit`) and the **delta stream**. Supabase separates them, and that separation is an
advantage here:

- **Initial + refresh fetch → a normal PostgREST query or RPC.** It has the *full* power of SQL:
  every `where`, every `order by`, every `limit`, plus joins Firestore could never do. Every one of
  the 16 listeners' query shapes is trivially expressible.
- **Delta stream → `postgres_changes` filtered by `run_id=eq.<runId>`.** The payload is only a
  *nudge*: "something in this run changed." The client re-applies its own predicate (`active`,
  `acknowledged`) to the row in the payload, or simply re-runs the SQL query.

Why this works for us specifically: **every live-ops table in the target schema carries `run_id` as
a first-class column** — `announcements`, `flash_missions`, `feed_items`, `alerts`,
`chat_messages`, `team_locations`, `run_teams` (`supabase/migrations/0001_core_schema.sql:441-601`).
A Firestore *collection path* (`…/runs/{runId}/alerts`) becomes a *column predicate*
(`run_id = <runId>`). That is a **single `eq` filter on a single column** — the one thing Realtime
has always supported, on every version, self-hosted or not.

**So the design does not depend on the multi-column/extended-operator capability flagged as
unverified in §0 Correction 2.** If the spike finds our pinned self-hosted Realtime only supports
single-column `eq`, nothing here changes. That is deliberate.

The `orderBy`/`limit` windows (`FEED_WINDOW = 100`, `ANNOUNCEMENT_WINDOW = 30`, `FLASH_WINDOW = 20`)
were introduced for a **Firestore cost reason that ceases to exist**: `LiveOps.tsx:18-27` and
`FeedPanel.tsx:94-104` both explain the window as a bound on *uncapped Blaze read billing*. On a
fixed-price box there is no billing tail. Keep the windows anyway (they bound bandwidth and render
cost), but they now live in the SQL `LIMIT`, where they belong.

**Bonus, already banked:** `announcements` targeting becomes a *real* security boundary rather than
a client-side courtesy. `supabase/migrations/0002_rls_policies.sql:342-362` notes that Firestore
rules cannot filter rows within a collection read, so `announcementVisibleTo()` dropped other teams'
targeted messages *client-side* — visible to anyone with a debugger. RLS filters per row. This is a
genuine upgrade delivered by the migration.

### 4.1 Two things we must build, because Supabase genuinely lacks them

**(a) Refetch-on-resubscribe.** There is no replay (§3). Therefore: on every `SUBSCRIBED` status
callback — initial *and* post-reconnect — **re-run the initial SQL query**. This closes the
missed-events window by construction, without a cursor, a change-feed table, or Broadcast Replay's
25-message/72-hour constraints.

> **Honesty note:** I could **not** find this as *official* Supabase guidance anywhere on
> supabase.com/docs; it appears only in third-party material. It follows directly from the
> documented absence of replay, and it is what we would have to do regardless — but it is a
> community pattern, not a vendor-blessed one, and this document should not imply otherwise.

**(b) Heartbeat on a Web Worker + an explicit reconnect callback.** Set `worker: true` and supply a
`heartbeatCallback` that calls `client.connect()` on `'disconnected'`, per the
[silent-disconnection troubleshooting doc](https://supabase.com/docs/guides/troubleshooting/realtime-handling-silent-disconnections-in-backgrounded-applications-592794).
**This is not optional for us.** Our users are outdoors with the phone backgrounded or the screen
off between tasks; a silently dead socket that never errors is precisely the failure that would
swallow an SOS.

Both live in **one shared subscription hook** (`useRunChannel`), written once and used by all 16
sites. It replaces the two hand-rolled 2 s→30 s re-subscribe loops in `FeedPanel.tsx:117-140` and
`ChatPanel.tsx:33-56` — the app already discovered it needs this; it just built it twice, locally,
and not everywhere it was needed.

### 4.2 Per-listener migration table

`R` = Realtime (`postgres_changes`, `run_id=eq.<runId>`) + refetch-on-`SUBSCRIBED`.
`P` = poll an RPC on an interval.
`R+P` = Realtime with a slow poll underneath as a safety net.

| # | Site | Sev | Mechanism | Reasoning |
|---|---|---|---|---|
| 1 | StaffConsole alerts | **P0** | **R + P (20 s)** | Safety. Realtime for latency; an unconditional 20 s poll underneath so that a silent socket death, a dropped event, or a Realtime outage **cannot** hide an SOS. Belt *and* braces is correct here and nowhere else. Also raise a visible "cannot tell" state on poll failure — `RunConsolePage.tsx:183-185` already established that "no SOS" and "cannot tell" must never look alike. |
| 2 | RunConsole alerts | **P0** | **R + P (20 s)** | Same query, same table, same hook. Two renderers, one implementation. |
| 3 | LiveOps announcements | P1 | **R** | Filter `run_id=eq.…`; client keeps its `active` predicate. Initial + refetch query carries `where active`, `order by created_at desc`, `limit 30`. RLS now enforces targeting server-side (§4.0). |
| 4 | LiveOps flash missions | P1 | **R** | Latency *is* the feature. Same channel as #3 — one channel per run, multiple table bindings, so this costs no extra connection. |
| 5 | PlayScreen team doc (trigger) | P1 surface | **R** on `run_teams`, filter `id=eq.<teamId>` | Keeps the "nudge then `getMyTeamState`" pattern **exactly as-is** (`PlayScreen.tsx:176-177`). The 12 s fallback poll at :193 and the 3 s reconnect poll at :220 stay untouched. **This listener is already allowed to fail; that is a shipped, tested property.** |
| 6 | ChatPanel thread | P1 | **R** on `chat_messages`, filter `run_id=eq.…` | **Gets strictly better.** Firestore stored one doc per team with a capped `messages[]` array — a rewrite-the-whole-array-on-every-send problem (`0001_core_schema.sql:519-530`). As rows, an INSERT event carries just the new message: no cap, no rewrite, less bandwidth. |
| 7 | StaffConsole all threads | P1 | **R** | Same subscription, no `team_id` filter. RLS scopes it (`chat_messages_read`, `0002_rls_policies.sql:405`). |
| 8 | StaffConsole teams | P2 | **R** on `run_teams` | Photo-review queue. Keep the existing visible-error behaviour (`setReadErr`). |
| 9 | RunConsole teams | P2 | **R** on `run_teams` | Ditto, with `photoLoadError`. Note the console's *main* teams table is already a 5 s poll (`RunConsolePage.tsx:264`) and is unaffected. |
| 10 | LiveTeamMap `teamLocations` | P2 | **R** on `team_locations` | Naturally row-per-team with a `(run_id, team_id)` PK (`0001_core_schema.sql:588-601`) — UPDATE events map perfectly. **Alternative to spike:** if update volume is high (N teams × one ping every few seconds), this is the one table where **Broadcast** may beat Postgres Changes, since per-subscriber RLS re-evaluation scales with subscribers × changes. Organizer-only, so subscriber count is ~1-3; probably fine as R. Measure, don't guess. |
| 11 | RunConsole run doc | P2 | **P (10 s)** | **Polling is the right answer and I want to say so plainly.** The run row changes on status transitions and leaderboard refreshes — the console *already* calls `refreshLeaderboard` on a 15 s interval (`RunConsolePage.tsx:277`), so a 10 s poll is strictly fresher than the data's own update cadence. A subscription here buys nothing and costs a binding. |
| 12 | RunConsole chat threads | P2 | **R** | Shares the run channel with #9 and #15. |
| 13 | PlayScreen chat unread badge | P3 | **Drop the separate listener** | Derive the badge from the #6 subscription. Two listeners on the same data in the same app is duplication Firestore's API encouraged; one channel makes it obvious. **Net −1 listener.** |
| 14 | FeedPanel | P3 | **R** | Purely social. Its bespoke 2 s→30 s retry loop is deleted in favour of the shared hook. |
| 15 | RunConsole feed | P3 | **R** | Shares the run channel. Preserve the `watchOrRead` optimisation (`RunConsolePage.tsx:290-300`): a **finished** run's rows never change, so read once and do not subscribe at all. This carries over unchanged and is worth keeping. |
| 16 | WalletPage transactions | P4 | **P (5 s while the page is open), or drop** | A ledger the user is staring at after a purchase. Poll it. Better still, refetch once when `purchaseCredits` resolves and on window focus, and subscribe to nothing. **This is over-engineered today.** |

**Resulting shape: 12 Realtime bindings across ~2 channels per client** (one run channel, one
team/user channel), 3 polls, 1 listener deleted. Against the documented **100 channels per
connection** limit ([quotas](https://supabase.com/docs/guides/realtime/quotas)), we are using ~2%.

---

## 5. The "do not migrate this" list

This is the section the plan asked for, and I am not going to soften it. It is short — which is
itself the finding.

### 🔴 DO NOT migrate the SOS/alerts path to Realtime *alone*.

Listeners #1 and #2. Ported as a bare `postgres_changes` subscription, this path is **strictly
worse than Firestore**, for two documented reasons that compound:

1. **No replay.** An event that fires during a disconnect is gone forever. Firestore re-delivers
   query results on reconnect from its resume token.
2. **Silent disconnects.** A backgrounded phone's socket can die with no error and no event — the
   exact device state of a staff member walking a course with the console in a pocket.

Together: a raised SOS can be **silently never delivered**, and the console will look healthy.
There is no vendor mechanism that fixes this (Broadcast Replay does not apply — it is
DB-broadcast-only, ≤25 messages, private channels).

**Therefore: the alerts path must carry an unconditional independent poll (§4.2, R+P), and that
poll — not the subscription — is the correctness guarantee.** Realtime is a latency optimisation
layered on top. If a future refactor deletes the poll "because Realtime covers it", that is a
safety regression. This must be enforced by a test, not by a comment.

**Everything else on the list is conditional, not absolute:**

### 🟡 Do not migrate `team_locations` to Postgres Changes without measuring first.
It is the highest-write-rate table (every team, every few seconds, all run long) and Postgres
Changes re-runs RLS per subscriber per change on a single thread. Our `can_read_run` helper is two
nested `exists(select …)` subqueries (`0002_rls_policies.sql:116-165`) on an $8 box. Subscriber
count is small (organizers only), so it will probably be fine — but **measure it in the spike**.
If it is not fine, `realtime.broadcast_changes()` from a trigger is the documented escape hatch and
fans out once per change instead of once per subscriber.

### 🟡 Do not adopt an offline sync engine (PowerSync / RxDB / TanStack DB / WatermelonDB / Zero).
Full reasoning in §2.3. Each is priced, sized and shaped for **bidirectional** sync — the half of
the problem we do not have — and each charges for it in WASM bundle weight, schema demands, paid
tiers, or alpha/beta maturity. Two carry hard disqualifiers: WatermelonDB is dormant (no commits
since Aug 2025), and Rocicorp Zero's **own docs say it does not support offline writes** and cannot
survive extended offline periods — precisely our use case. If we ever need push-based read sync,
**ElectricSQL is the one to revisit** (read-path-only by design, ~18 KB gzip, no WASM), but not now
and not as part of this migration.

### 🟡 Do not port `WalletPage` (#16) at all.
Migrate it to a refetch-on-action. Subscribing to a ledger is not a requirement anyone stated.

### ⚪ Nothing else. Explicitly:
There is **no surface that Supabase fundamentally cannot serve.** I looked for one. The candidates
I expected to find — rich query filters on the delta stream, offline write replay — both evaporated
on inspection: the first because our collection-path scoping is already a single `eq` on `run_id`
(§4.0), the second because **the app never queued a write in the first place** (§0).

---

## 6. Recommendation, confidence, and what would change my mind

### Recommendation: **the realtime/offline risk is ACCEPTABLE. Proceed.**

Revised Phase 5 estimate:

| Item | Plan | Revised | Why |
|---|---|---|---|
| Port 16 listeners (was "39 sites / ~34 listeners") | 15 pd | **7 pd** | One shared `useRunChannel` hook + 16 thin call sites. The count was inflated ~2.4×; the pattern is uniform because every table has `run_id`. |
| Offline outbox | +10 pd | **0 pd — struck** | The app has no client writes to queue. §0 Correction 1. |
| Offline read cache (IndexedDB last-known-good) | (inside the 15) | **3 pd** | New, small, and a net *improvement* over today (§2.2). |
| Alerts belt-and-braces poll + test | — | **1 pd** | The one non-negotiable (§5). |
| Realtime spike (filters on our pinned self-hosted image; `team_locations` load) | — | **2 pd** | Retires the two flagged uncertainties before design commits. |
| **Total** | **15–25 pd** | **13 pd** | |

More important than the number: **the residual risk is bounded and concentrated in one query
shape** (unacknowledged alerts), for which a mechanical, testable mitigation exists.

### Confidence

| Claim | Confidence | Basis |
|---|---|---|
| The app does not rely on offline writes | **Very high (95%)** | Four independent lines of repo evidence, including a test that asserts the degraded behaviour (§0). This is the load-bearing claim and it is the best-evidenced one. |
| 16 listeners, correctly ranked | **High (90%)** | Direct enumeration. Severity ranking involves judgement about field consequences; the P0/P1 boundary is the one I would most want a second opinion on. |
| The SQL-snapshot + Realtime-nudge pattern covers all 16 | **High (85%)** | Follows from every table having `run_id`. Deliberately does not depend on the unverified extended-filter capability. |
| Supabase Realtime has no replay; silent disconnects are real | **High (90%)** | Documented; the replay claim rests on *absence* of documentation, which is weaker evidence than presence. |
| An $8 self-hosted box handles our Realtime load | **Low-Medium (50%)** | **The weakest claim here.** Published quotas are for *Supabase Cloud* and say nothing about a self-hosted instance on our hardware, which is our actual target (MIGRATION_PLAN.md:13-14). Per-subscriber-per-change RLS on single-threaded Realtime, with subquery-based policies, is unmeasured. This is what the §6 spike is for. |
| Phase 5 = 13 pd | **Medium (65%)** | Estimates are estimates. The scope is now well-defined, which is most of the battle. |

### What would change my mind (→ do not proceed on realtime grounds)

1. **The spike shows our pinned self-hosted Realtime cannot filter `run_id=eq.<id>` reliably, or
   drops events under a 30-team load.** That is the load-bearing capability. If it is not solid, the
   entire §4 design collapses and the answer becomes "poll everything" — survivable for 14 of 16
   listeners, genuinely bad for the two P0s.
2. **A grep I ran is wrong and a real offline write path exists** that I missed — e.g. a direct
   table write added after this document, or a callable relied upon to succeed offline. This single
   fact carries the largest share of the estimate reduction; it deserves a second reviewer, and it
   should be **enforced going forward by a test that fails if `apps/play-web/src` ever gains a
   direct datastore write.**
3. **The alerts poll proves unaffordable** — if a 20 s poll per staff console is somehow too
   expensive on the target box, then the safety path has no correctness guarantee and I would not
   ship it. (I consider this very unlikely: it is a handful of consoles, not a handful of thousands.)
4. **`team_locations` under Postgres Changes saturates the box** and `broadcast_changes` does not
   rescue it — this would not block the migration, but it would mean dropping the organizer live map
   to a poll, which is a real product downgrade worth naming in advance.

### Definition of done for Phase 5 (replacing MIGRATION_PLAN.md:607-609)

- All 16 listeners ported or explicitly retired, each with its reason recorded in §4.2.
- `useRunChannel` implements refetch-on-`SUBSCRIBED` and `worker: true` + reconnect callback.
- **A test asserts the alerts path still works with Realtime disabled entirely.** This is the one
  that protects the safety guarantee from a future well-meaning refactor.
- A test asserts `apps/play-web/src` contains no direct datastore writes (locks in §0 Correction 1).
- `npm run simulate:browser` passes, including the offline segment at
  `scripts/simulate-browser-run.mjs:376-393`, **with an added assertion that a reload while offline
  restores the last-known game view** — a behaviour we do not have today.
- The accepted degradation is stated in plain language in TECH_SPEC §21 and, where users meet it,
  in the app's own copy.

---

## 7. Open items this document does not close

1. **Extended Realtime filter operators on our pinned self-hosted image** — version requirement is
   **not documented** (§0 Correction 2). The §4 design is built not to need it; confirm anyway.
2. **`DEFAULT_RECONNECT_FALLBACK`** in `realtime-js` — **not verified**; only the
   `[1000, 2000, 5000, 10000]` ladder was read from source.
3. **Self-hosted Realtime capacity on the target box** — no published figures exist; the quota table
   is Cloud-only. Must be measured.
4. **No `alter publication supabase_realtime add table …` exists yet** in
   `supabase/migrations/`. A grep for `publication` across the migration files returns nothing.
   Realtime will emit no events until those statements ship. Small, but it is a hard prerequisite
   and it is currently missing.
5. **Vendor facts in §2.3 that I could not confirm** and which would only matter if we reversed the
   "no sync engine" decision: PowerSync's real web bundle/WASM payload (no official figure) and
   whether a no-op `uploadData()` is a *supported* read-only mode (no vendor doc says so);
   ElectricSQL Cloud's GA status; whether TanStack DB's alpha persistence composes with
   `QueryCollection` (docs page 404'd).
6. **Whether a `postgres_changes` payload leaks columns RLS would have withheld** on a *broad*
   `run_id` subscription (risk **R10**'s underlying concern). RLS is applied to change events, but I
   did not verify column-level behaviour against our specific policies. Include in the spike.
