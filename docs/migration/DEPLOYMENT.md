# RushPoint — Target Deployment Architecture

> **Scope:** where each piece of RushPoint *runs* after the Firebase → Supabase migration, whether
> the hardware it runs on can actually hold it, and what it costs.
> **Companion docs:** [MIGRATION_PLAN.md](../../MIGRATION_PLAN.md) · [DEPLOY.md](../../DEPLOY.md)
> (today's Firebase runbook) · [CLAUDE.md](../../CLAUDE.md) ·
> `docs/migration/AUTH.md` · `docs/migration/REALTIME_AND_OFFLINE.md`
> **Status:** design, not executed. **Last updated:** 2026-07-26.

---

## 0. The bar this document is judged against

The owner's decision, treated here as a fixed constraint and not re-litigated:

> **Target: self-hosted Supabase on a single IONOS Ubuntu VPS, ~$8/month fixed.**
> **"Keep in Firebase whatever is not limiting me from moving to IONOS."**

So the test applied to every component below is **not** "would Supabase be nicer." It is:

> **Does keeping this on Firebase block escaping uncapped pay-as-you-go billing?**

If the answer is no, it **stays on Firebase**, because migrating it spends engineering time to buy
nothing. MIGRATION_PLAN.md §0 already states the honest framing: this migration is a strict
financial loss at today's traffic, justified only by eliminating an unbounded tail. Every
unnecessary component we move makes that trade worse.

One fact does most of the work in §1, so state it up front:

**Firebase's Blaze requirement is per-*project*, not per-product.** The billing account stays
attached to `rushpoint-pwa-7daaa` as long as *any* Blaze-only product is in use. Two of ours are:

- **Cloud Functions cannot deploy on Spark** at all — DEPLOY.md §1 says so in the prerequisites.
- **Cloud Storage for Firebase requires Blaze**: from 2026-02-02, "to maintain access to your
  default bucket and all other Cloud Storage resources, your project must be on the pay-as-you-go
  Blaze pricing plan," and a Spark project's bucket calls return 402/403
  ([Firebase FAQ, Sept 2024 storage changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)).

Therefore **Functions and Storage both fail the bar and must move**, and — critically —
**"escaping uncapped billing" is not achieved until BOTH have moved and the project is actually
downgraded to Spark.** Until that downgrade lands, the migration has bought predictability on
paper only. That makes the downgrade a named milestone in §5, not a footnote in Phase 8.

---

## 1. Component-by-component verdict

| Component | Verdict | Why (against the bar) | Cost consequence |
|---|---|---|---|
| **Firestore** | 🔴 **MIGRATE** | The whole reason for the project. Reads/writes are billed per operation with **no hard cap** — the documented mitigation is budget *alerts*, which fire after the money is spent (MIGRATION_PLAN §0). A read-amplification bug or an abusive client is a physically reachable four-figure day. | Removes the single largest unbounded term. Replaced by Postgres on the box: a runaway query makes the box **slow**, not expensive. |
| **Cloud Functions (~96 callables)** | 🔴 **MIGRATE** | Two independent reasons. (a) **Functions cannot run on Spark** (DEPLOY.md §1), so keeping them keeps the Blaze billing account attached and the migration achieves nothing. (b) Invocations + GB-seconds + **outbound egress** are themselves pay-as-you-go and uncapped; a retry storm from `services/firebase.ts`'s 3-attempt client retry multiplies it. | Replaced by one Node process on the box (§4). Marginal cost **$0** — it shares the VPS already being paid for. Removes the second unbounded term. |
| **Firebase Auth** | ✅ **KEEP** | **Not the cost risk.** 50k MAU free, on **Spark**, and RushPoint will not approach it. Migrating it is pure downside: anonymous `uid == teamId` is the participant's identity and a re-issued uid **loses their team mid-run**; staff sign-in mints **custom tokens** carrying `{staff, ownerUid, gameId, runId, permissions}` that the entire staff authz model reads (MIGRATION_PLAN §6.4, §8.1). | **$0.** Keeps `uid` as a `text` primary key across the Postgres schema — already the plan of record (§8.1). |
| **Cloud Storage** (photo/audio uploads) | 🔴 **MIGRATE** | Fails the bar on the *plan* rule, not the volume rule. Volume alone would be tolerable — uploads are bounded by humans physically taking photos. But **Cloud Storage now requires Blaze**, so keeping it means never downgrading, and the uncapped Firestore-adjacent billing account stays live forever. There is no "keep Storage on Spark" option. | Moves to the `storage-api` container (already in `docker-compose.supabase.yml`) on the box's disk. **This is what turns the Spark downgrade from impossible into possible** — see §5, D6. Cost: disk, not dollars (§3.5 has the capacity math). |
| **Firebase Hosting** (2 sites) | ✅ **KEEP** | Static hosting is not the cost risk — Spark gives 10 GB stored / **360 MB/day** transfer, and the quota is a **hard stop, not a bill**, which is exactly the bounded behaviour being purchased. And it is load-bearing: `twa-manifest.json:3` pins the Android TWA origin to `rushpoint-play.web.app`. That is a Firebase-owned domain; it **cannot** be pointed anywhere else, so moving Hosting breaks the Play Store listing's Digital Asset Links. | **$0**, with one honest caveat in §1.1. |
| **Stripe webhook** (`stripeWebhook`, `onRequest`) | 🔴 **MIGRATE** — but **zero urgency** | It is a Cloud Function, and Functions cannot exist on Spark. So it cannot stay, regardless of its own merits. It is however **dormant**: `PAYMENTS_ENABLED = false` (`packages/shared/src/freeMode.ts:17`), the launch default. | **$0 today** (no traffic). Becomes one plain HTTP route on the Node server (§4.6). MIGRATION_PLAN §8.3 is right that only its *storage* changes; this doc adds that its *host* changes too. |

### 1.1 — The one honest caveat on keeping Hosting

Spark's **360 MB/day** transfer is shared by both sites and is a **hard stop**: over quota, the
site stops serving. Against measured bundle sizes (`scripts/check-bundle-budget.mjs:32-39`,
baseline 2026-07-23):

| Session shape | Bytes over the wire (gzip) | Sessions/day within 360 MB |
|---|---|---|
| play-web cold first load | ~243 KB (`initial 243,356 gzip`) | ~**1,480** |
| …plus the lazy map chunk | ~463 KB (MapLibre is `219,614 gzip`) | ~**780** |

Comfortable for a field game (tens of players), and repeat visits are served from the service
worker. But a genuinely large event, or both sites busy on the same day, can hit it — and it will
present as *"the app won't load"* on the day, which is the worst possible time.

**Mitigation, cheap:** put **Cloudflare's free CDN** in front of a custom domain for the web
origin; origin transfer drops to near zero. **Caveat on the caveat:** the Android TWA is pinned to
`rushpoint-play.web.app` (`twa-manifest.json:3`), which cannot be CDN-fronted, so app traffic
always hits Firebase Hosting directly. Monitor the Hosting usage graph before any scheduled large
event. Do **not** solve this by staying on Blaze — that reattaches the exact risk being migrated
away from.

---

## 2. What actually runs on the IONOS box

### 2.1 — Inventory

Everything below is one Ubuntu LTS host. The Supabase services are exactly the eight already
defined in `docker-compose.supabase.yml`; nothing new is invented here.

| # | Process | Image / runtime | Exposed? | Purpose |
|---|---|---|---|---|
| 1 | **Caddy** (reverse proxy + TLS) | `caddy:2` or host package | **:80, :443 — the only open ports** | TLS termination, automatic Let's Encrypt, routes to 2 & 3 |
| 2 | **Node API server** | Node 20, Fastify | 127.0.0.1:8080 | The ~96 callables (§4) |
| 3 | **Kong** | `kong:2.8.1` | 127.0.0.1:54321 | Supabase gateway → realtime + storage only (see §2.3) |
| 4 | **Postgres** | `supabase/postgres:15.8.1.060` | 127.0.0.1:54322 | **The database.** `wal_level=logical` for Realtime |
| 5 | **Realtime** | `supabase/realtime:v2.34.31` | internal | Replaces the 39 `onSnapshot` listeners |
| 6 | **Storage API** | `supabase/storage-api:v1.19.3` | internal | Replaces Firebase Storage; `STORAGE_BACKEND=file` on a volume |
| 7 | **PostgREST** | `postgrest/postgrest:v12.2.8` | internal | **Not exposed publicly** — kept only because storage-api requires it (`POSTGREST_URL`, `depends_on: rest`) |
| 8 | **GoTrue** | `supabase/gotrue:v2.170.0` | internal | ⚠️ **Probably deletable** — see §2.3 |
| 9 | **postgres-meta** | `supabase/postgres-meta:v0.87.1` | ⛔ **DROP** | Studio's backend only |
| 10 | **Studio** | `supabase/studio:*` | ⛔ **DROP** | Web console. Luxury on a 4 GB box |
| — | **Backup timer** | `pg_dump` + `rclone`, systemd timer | — | §3.3 |
| — | **ufw / fail2ban / unattended-upgrades** | host | — | §2.4 |

Not on the box, deliberately: Firebase **Auth** and **Hosting** (§1), MapTiler (external, free
tier), Stripe (external, dormant), and the archived `apps/mobile`.

### 2.2 — Resource reality check 🔴 the section that decides whether this plan is real

**What "$8/month IONOS" actually buys.** Two sources disagree because one quotes promotional and
one quotes renewal pricing:

- [HostAdvice](https://hostadvice.com/hosting-company/ionos-reviews/pricing/) — VPS Linux M at
  **$8/mo: 2 cores, 4 GB RAM, 160 GB**.
- [ionos.com/servers/vps](https://www.ionos.com/servers/vps) — VPS **L+** at 6 vCores / 8 GB /
  240 GB NVMe for **$6/mo promotional** (3 months, 1-year term).

**Planning baseline used here: 2 vCPU / 4 GB / 160 GB.** That is the conservative reading and the
one that survives renewal. Treat any 8 GB figure as an upgrade to price, not an assumption.

**Per-container memory.** These are **estimates, labelled as such.** Basis: the runtime each image
is built on (Go / Haskell / Elixir-BEAM / Node / OpenResty / Next.js), the container set actually
declared in `docker-compose.supabase.yml`, and published self-hosting figures — Supabase's own
guidance is **4 GB / 2 cores absolute minimum, 8 GB / 4 cores recommended for production**, with
Kong ~100–200 MB and Studio ~200–400 MB, and an explicit warning that an **untuned Kong can
consume 2 GB while Auth barely uses 10 MB**
([MassiveGRID](https://massivegrid.com/blog/self-host-supabase-ubuntu-vps/),
[supascale](https://www.supascale.app/blog/docker-container-resource-tuning-for-selfhosted-supabase)).
Verify with `docker stats` on the real box in Phase 0; do not treat this table as measured.

| Process | Runtime | Est. RSS | Note |
|---|---|---|---|
| Postgres | C | **700–1000 MB** | Whatever `shared_buffers` is set to, plus ~5–10 MB/connection. The single largest and the one that must not be starved. |
| Realtime | Elixir/BEAM | **250–400 MB** | BEAM reserves generously. Second largest. |
| Storage API | Node | 120–200 MB | |
| Kong | OpenResty | 150–250 MB | **Only with `KONG_NGINX_WORKER_PROCESSES=1`.** Left at default it spawns a worker per core and is the 2 GB horror story above. |
| Node API server | Node 20 | 150–250 MB | 1 process, `pg` pool max 10 (§4.5) |
| PostgREST | Haskell | 40–80 MB | |
| GoTrue | Go | 15–30 MB | Negligible |
| Caddy | Go | 20–40 MB | |
| Docker daemon + Ubuntu base | — | 300–400 MB | Not optional |
| **Studio** | Next.js | **300–500 MB** | Drop candidate |
| **postgres-meta** | Node | 80–120 MB | Drop candidate (Studio-only) |

**Verdict — the full stack does NOT fit comfortably on a 4 GB box.**

| Configuration | Est. total RSS | Free on 4 GB | Assessment |
|---|---|---|---|
| **Full stack** (all 10 + Node + Caddy + OS) | **2.8 – 3.7 GB** | 0.3 – 1.2 GB | ❌ **Do not deploy.** At the bad end of the range this OOMs. Even at the good end there is **almost nothing left for the OS page cache**, which is the resource Postgres read performance actually depends on. A `pg_dump \| gzip` during a live run pushes it over. |
| **Trimmed** (drop Studio + postgres-meta) | 2.4 – 3.1 GB | 0.9 – 1.6 GB | ⚠️ Workable but tight. |
| **Trimmed + Kong pinned to 1 worker + GoTrue dropped** | **~2.0 – 2.6 GB** | **1.4 – 2.0 GB** | ✅ **Recommended.** Leaves real page cache and real headroom. |

**Recommendation — do both of these:**

1. **Trim the stack** (below). It is free and it is also a security win.
2. **If the budget can stretch, take the 8 GB tier** (~$6/mo promo, ~$11–15/mo renewal). The delta
   over the 4 GB box is a few dollars a month and it removes an entire class of 2 a.m. failure.
   Against ~137 person-days of migration effort (MIGRATION_PLAN §Totals), refusing to spend $5/mo
   on headroom is a false economy. **The 4 GB box is viable only with the trimmed stack. It is not
   viable with the stock `docker-compose.supabase.yml`.**

### 2.3 — What to trim, and why each cut is safe

- **Studio (⛔ drop).** A web console. `psql` over SSH does everything it does, on a box where
  every port but 80/443 is firewalled anyway. Saves 300–500 MB — **the single biggest win per
  keystroke.** Bring it up temporarily with a compose profile when actually needed.
- **postgres-meta (⛔ drop).** Exists only to serve Studio (`docker-compose.supabase.yml:233-236`).
  It also connects as `supabase_admin`, i.e. an unauthenticated superuser API if ever exposed.
  Dropping it removes 80–120 MB and a foot-gun.
- **PostgREST (keep, but never expose).** MIGRATION_PLAN §2 and §6.2 already mandate that clients
  never get broad table access, and §6.2 is emphatic: `REVOKE ALL ON games FROM anon,
  authenticated`. Deployment-side, do the stronger thing — **do not route `/rest/v1/` through Kong
  to the internet at all.** Then risks **R1** (sanitizer bypass via direct grant) and **R5**
  (`access_codes` enumeration) become *structurally* unreachable from outside the box, rather than
  merely policy-denied. RLS stays as declared defence in depth. PostgREST stays running only
  because `storage-api` requires it.
- **GoTrue (⚠️ probably drop — confirm with `docs/migration/AUTH.md`).** §1 keeps **Firebase**
  Auth, so nothing in the product signs in through GoTrue. It is 15–30 MB, so this is a
  simplification rather than a memory win, and the real question is whether Realtime/Storage need
  it present. Do not cut it until AUTH.md confirms. If it stays, it must have signup **disabled**
  (`GOTRUE_DISABLE_SIGNUP: "true"`) in production — the local compose sets `"false"`
  (`docker-compose.supabase.yml:130`) and shipping that would expose an open registration endpoint.
- **Kong (keep, pin the workers).** `KONG_NGINX_WORKER_PROCESSES=1`. Production Kong must also
  **re-add the `key-auth` / apikey gate** that the local compose deliberately omits — the comment
  at `docker-compose.supabase.yml:257-262` says so explicitly: *"Hosted Supabase does gate at the
  edge — this is a LOCAL-ONLY simplification, and it is why the port is bound to 127.0.0.1."*
  On a public box that binding is gone. **Do not ship the local Kong config to production.**

### 2.4 — Non-negotiable host configuration

- **ufw: 22, 80, 443. Nothing else.** Every container publishes to `127.0.0.1` — the compose file
  already does this (`"127.0.0.1:${SUPABASE_DB_PORT:-54322}:5432"` etc.). Keep that invariant on
  the server; a `0.0.0.0` bind puts an unauthenticated-by-default Postgres on the public internet.
- **SSH: keys only**, `PasswordAuthentication no`, plus `fail2ban`.
- **`unattended-upgrades`: security patches only, automatic reboot DISABLED.** An unattended kernel
  reboot during a live field game is a self-inflicted outage (§3.2).
- **Swap: 2 GB file**, and `oom_score_adj = -500` on the Postgres container. Without it the Linux
  OOM killer picks the largest RSS — which, after the trim, is Postgres. Losing Postgres loses the
  run; losing Realtime degrades it. Make the kernel pick the right victim.
- **Docker: pinned image tags, never `latest`** — the compose header already mandates this
  (`docker-compose.supabase.yml:58-63`) and the reason applies doubly in production.
- **Disk alert at 70%.** See §3.5.

---

## 3. Single-box risk — stated without softening

### 3.1 — The trade, plainly

| | **Firebase (today)** | **One IONOS VPS (target)** |
|---|---|---|
| Redundancy | Multi-zone, managed, automatic failover | **None.** One VM, one disk, one datacentre. |
| Backups | Google's problem | **The owner's problem.** Nobody else is doing it. |
| Upgrades | Invisible | A reboot. During an event, an outage. |
| Ops burden | ~zero | Postgres tuning, disk, certs, patches, monitoring |
| Expected cost | **$0–2/mo** | ~$9–17/mo |
| **Worst case** | **Unbounded** — a physically reachable four-figure day | **Fixed.** A saturated box gets slow, not expensive. |
| **New worst case** | — | **Total outage of a live event, with no failover.** |

**This is a swap, not an improvement.** The owner is exchanging a *financial* tail risk they cannot
absorb for an *availability* tail risk they can, in principle, absorb — but only if the mitigations
in §3.3 are actually built, not just written down. Firebase has never taken RushPoint down. The
IONOS box will, eventually, at least once.

### 3.2 — What "down" means for this product specifically

RushPoint is not a dashboard where an outage means a stale chart. A run is a **1–3 hour live
event** with real people — often teenagers — **outdoors, walking between physical locations,
holding a phone that is their only instruction sheet.** When the backend dies:

- Participants cannot check in, submit, or get their next task. They are standing in a street with
  a spinner.
- The creator has **no fallback** — the whole design premise is that there are no human judges
  (CLAUDE.md, "automatic scoring, no judges").
- The run cannot be finalized, so scores may be unrecoverable if the last backup predates it.
- It is **unrecoverable in the moment.** Restoring a VPS takes longer than the event lasts.

Concrete failure modes, ranked by how likely they are to bite first:
**(1)** OOM kill on a tight box (§2.2) · **(2)** disk full — photos and `location_track` (§3.5) ·
**(3)** an unattended kernel upgrade rebooting mid-event · **(4)** a TLS cert renewal failure ·
**(5)** IONOS host maintenance or a hardware fault · **(6)** a `docker compose pull` that moves a
pinned tag · **(7)** disk/filesystem corruption with no replica.

MIGRATION_PLAN R8 already rates this **Med × High**. This document does not lower that rating.

### 3.3 — Mitigations (build all five; none is optional)

1. **Automated `pg_dump` to off-box object storage.**
   `pg_dump -Fc` on a systemd timer → **hourly at rest, every 15 minutes while a run is live**
   (drive the cadence off `listLiveRuns`, the same predicate §5/D4 uses). Ship with `rclone` to
   **Backblaze B2** (first 10 GB free) or **Cloudflare R2** (10 GB free, no egress fee). Retain
   7 daily + 4 weekly. **A backup on the same disk as the database is not a backup.**
   *Upgrade path, when the ops appetite exists:* `pgBackRest` or WAL archiving for
   point-in-time recovery. Do not start there — an unmaintained PITR setup is worse than a
   maintained `pg_dump`.
   *Do not forget Storage:* the photo/audio volume is separate from Postgres and needs its own
   `rclone sync`. A restored database pointing at missing objects is a half restore.
2. **A restore drill that is timed, written down, and repeated.**
   MIGRATION_PLAN Phase 0's DoD already gates on "a backup taken on the IONOS box restores to a
   working database on a second box." Keep that gate and add: **rehearse quarterly and record the
   wall-clock number in this file.** "We have backups" without a timed restore is a belief, not a
   capability.
3. **External uptime monitoring with a phone alert.**
   Free tier (UptimeRobot / Better Stack), 60-second interval, against **two** endpoints:
   - `GET /healthz` on the Node server — process alive;
   - `GET /healthz/deep` — executes `SELECT 1` **and** a Realtime handshake.
     The deep check is the one that matters: a live Caddy in front of a dead Postgres returns a
     cheerful 200 and is the classic false-green. Add a **disk-usage** alert at 70% and a
     **memory** alert at 85%.
4. **A pre-event freeze.**
   No `apt upgrade`, no `docker compose pull`, no deploy in the **24 hours before a scheduled
   run**. Take a manual backup immediately before launch. This is a written checklist, and it is
   the cheapest mitigation on this list.
5. **A rehearsed break-glass — and it is *not* "roll back to Firestore."**
   MIGRATION_PLAN §10.4 is right that the Firestore rollback window closes the moment the first
   run writes to Postgres. After that, the disaster plan is R8's:
   **restore the newest `pg_dump` into a Supabase Cloud Pro project ($25/mo, created on demand)
   and repoint the Node server's `DATABASE_URL`.** Recovery is one restore plus one env var.
   The $25/mo managed option is **the insurance policy, not a rejected alternative** — and because
   the API server is the only thing that talks to Postgres (§4), it genuinely is a one-variable
   change. **Rehearse it once, end to end, before the first real run.** An unrehearsed break-glass
   is decoration.

> **Recommendation to the owner, stated once:** if a paid event is ever scheduled — anything with a
> deadline and other people's expectations attached — run *that* event on **Supabase Cloud Pro**
> and keep the IONOS box for everything else. $25 for one month is cheaper than one failed event,
> and it costs nothing to keep the option open because both run the same stack.

### 3.5 — Disk is the resource that will actually run out

Photos and audio move from Firebase Storage onto the box's 160 GB. `storage.rules` caps a
participant upload at **10 MB** (`storage.rules:33`) and authored game media at **50 MB**
(`storage.rules:63`). A 30-player run with 10 photo missions is **up to ~3 GB**; ten such runs is
~30 GB; plus `location_track` GPS rows, WAL, Docker images and on-box backup staging.

Consequences:
- **Phase 6's `pg_cron` prune must delete Storage objects too**, not just rows. A 90-day PII prune
  that leaves the photos on disk fills the disk *and* breaks the privacy commitment (CLAUDE.md
  flags `deleteMyAccount`'s photo cascade as a policy commitment, not a nice-to-have).
- **Alert at 70%**, and treat a full disk as the *expected* long-run failure — MIGRATION_PLAN
  Phase 8's DoD already asks for a written statement of the new worst case, and this is it.
  **It is a downtime failure, not a financial one. That is the whole point of the migration.**

---

## 4. The Node API server

### 4.1 — Framework: **Fastify**

Express would work and nobody should re-litigate it if it is already written. Fastify is the
recommendation because the shape of this surface suits it exactly:

- **~96 uniform JSON POST endpoints** with argument types that already exist in
  `@rushpoint/shared` → per-route JSON Schema gives free validation *and* fast serialization,
  replacing hand-rolled argument checks in the callables.
- **2 vCPU.** Fastify's throughput advantage is not decisive at this scale, but on a
  deliberately small box, headroom that costs nothing is worth taking.
- First-class hooks (`onRequest`) give a single place for auth, rate limiting, and the
  `auditLogs` write that `scripts/lib/callableHardening.mjs` statically enforces on every
  privileged callable. That guard must be re-pointed at the new surface, **not deleted** — it and
  the e2e callable-coverage guard are the reason a new endpoint ships RED until it has a test.

### 4.2 — Wire protocol: **implement the Firebase callable contract verbatim** 🔴 the key move

MIGRATION_PLAN §1 non-goal 2 is "the single most important constraint in the document":
`services/calls.ts` in both apps should ideally not change **at all**. Deployment can deliver that
literally, because the Firebase callable protocol is a documented HTTP shape and the client sits
behind one factory function.

**Server implements:**

```
POST https://api.<domain>/<callableName>
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{ "data": { ...args } }
→ 200 { "result": { ...response } }
→ 4xx/5xx { "error": { "status": "PERMISSION_DENIED", "message": "..." } }
```

> 🔴 **`status` MUST be the UPPER_SNAKE canonical name, not the hyphenated code.**
> This example previously read `"permission-denied"` and that was wrong. The client SDK
> (`@firebase/functions` `errorCodeMap`, `_errorForResponse`) keys its lookup on
> `PERMISSION_DENIED` and *maps it to* the hyphenated `permission-denied` the app sees. Send the
> hyphenated form on the wire and the lookup misses, so the SDK **discards the real code and
> reports `internal`** — every error in the app would surface as a generic internal failure with
> the true cause erased. `scripts/test-api-contract.ts` pins this with an explicit counter-example.
> The SDK source is the contract here, not this document.

**Client changes: one line, in one file, per app.** `apps/play-web/src/services/firebase.ts:112`
is `export const functions = getFunctions(app);`. It becomes
`getFunctions(app, import.meta.env.VITE_API_ORIGIN)` — the Firebase SDK's `httpsCallable` then
posts to `<origin>/<name>` with exactly the body and headers above. Creator-web mirrors it.
**`services/calls.ts` in both apps changes zero characters.** All ~96 typed wrappers, every
`Req`/`Res` type, and every call site are untouched.

Three client behaviours in `firebase.ts:285-322` are now **server obligations**, not
implementation details:

- **Retries.** The client retries up to **3 times** on `functions/internal`,
  `functions/unavailable`, `functions/deadline-exceeded`, `functions/aborted`. So the server must
  map a transient Postgres error (serialization failure, pool exhaustion, `57P01` admin shutdown)
  to **`unavailable`** — then the existing retry silently absorbs a container restart. Map a
  *permanent* error to anything else, or the client burns three attempts on a guaranteed failure.
- **The 20-second timeout is a hard contract.** `CALLABLE_TIMEOUT_MS = 20_000`. Any endpoint whose
  p99 approaches it is broken from the client's perspective. Alert on p99 > 5 s.
- **Retry-safety is per-callable.** `opts.retry === false` exists precisely because some callables
  are not idempotent (`triggerSOS` creates a new auto-id alert on each call). That opt-out list
  must survive the port unchanged, and any endpoint whose idempotency changes is a **client**
  change in disguise — i.e. a non-goal-2 violation that must be caught in review.

**CORS:** Caddy/Fastify must allow both Hosting origins (`https://rushpoint-creator.web.app`,
`https://rushpoint-play.web.app`, plus any custom domains) with `Authorization` on preflight.
This is a **cross-origin** deployment now — Firebase's same-project convenience is gone, and a
missed preflight presents as a total client outage.

### 4.3 — Auth middleware: keep `firebase-admin` on the box

One `onRequest` hook:

1. Extract the bearer token.
2. `getAuth().verifyIdToken(token)` — offline RS256 verification against Google's cached public
   keys, so no per-request network round trip.
3. Attach `{uid, claims}` to the request. `requireAuth` and `assertStaffOrOwner` port **unchanged**
   — MIGRATION_PLAN §6.4 mandates they stay, and RLS never replaces them.

This is what makes "KEEP Firebase Auth" (§1) essentially free at the deployment layer: anonymous
`uid == teamId` and the staff custom-token claims `{staff, ownerUid, gameId, runId, permissions}`
arrive exactly as they do today. The box needs a **service-account JSON**, mounted read-only, not
baked into the image, not in git.

⚠️ **Cross-doc dependency — do not resolve it here.** Realtime and Storage validate **HS256 JWTs
signed with `JWT_SECRET`** (`docker-compose.supabase.yml:161, 190, 219`). A Firebase ID token is
**RS256, signed by Google** — those containers *cannot* verify it. Something must mint a
short-lived Supabase-shaped token (`sub = uid`, `role = authenticated`, plus staff claims) after
verifying the Firebase token. The natural place is a `POST /realtimeToken` endpoint on this
server, since it already holds both trust anchors. **The design belongs to
`docs/migration/AUTH.md`; it is flagged here only because it determines what the box runs.**

### 4.4 — Database role: **a dedicated `BYPASSRLS` service role, not a per-request user JWT** ✅

**Decision: the API server connects as one dedicated role (`rushpoint_api`) that bypasses RLS.**

Why, in order of weight:

1. **The callable layer already *is* the authorization boundary,** and it is the boundary the
   codebase was built around: clients never write game state, every mutation and every privileged
   read is a callable, and `callableHardening.mjs` statically proves each one carries an auth
   assertion. MIGRATION_PLAN §2 chose to keep that layer precisely so Postgres would not have to
   re-implement it.
2. **RLS provably cannot express our rules.** MIGRATION_PLAN §6.2 (rated 🔴): the participant
   sanitizer is **field-level** (`strip steps[].answer` from inside a JSONB tree) and
   **value-derived** (whether *this* team has been unsealed by `reportArrival`'s GPS verdict). RLS
   decides which **rows** you see, not which bytes inside a column. A per-request user JWT would
   therefore still not be sufficient — it would only be *additional*.
3. **Doubling the authz surface manufactures bugs.** With a user JWT, all ~149 repository
   operations must satisfy both the callable's check *and* a policy. Every mismatch presents as
   "row not found," which reads as data loss, at 11 p.m., during a run.
4. **Pooling.** Per-request `SET LOCAL role` + `request.jwt.claims` forces every call into a
   transaction and complicates pool reuse for no security gain given (1)–(3).

**Bounded so it is not a superuser.** `rushpoint_api` is **not** `supabase_admin` or `postgres`:

```sql
create role rushpoint_api login bypassrls;
grant usage on schema public to rushpoint_api;
grant select, insert, update, delete on all tables in schema public to rushpoint_api;
-- and nothing else: no DDL, no auth schema, no storage schema, no superuser.
```

A compromised API server can read and write game data — which it must, to function — but cannot
drop tables, cannot read `auth.*`, and cannot escalate.

**Where RLS *is* load-bearing, and it genuinely is:** the browser's **Realtime** subscriptions
(and any Storage access) do not pass through this server. They carry the user's own JWT to
Realtime/Kong, and **RLS is the only thing withholding another team's rows** on that path. That is
exactly MIGRATION_PLAN R10's mitigation: *"where filtering must be broad, ensure RLS, not the
client, is what withholds the data."* So:

> **RLS is mandatory and enabled on every table (Phase 4 DoD). It is defence in depth for the API
> server's path and the primary control for the Realtime path.** Those are different jobs. Neither
> statement weakens the other.

### 4.5 — Process and pool sizing (2 vCPU baseline)

- **One Node process.** Do not `cluster` on 2 vCPU — Postgres and Realtime need those cores more
  than a second event loop does.
- **`pg` pool max 10**, `idleTimeoutMillis` 30 s, statement timeout 15 s (under the client's 20 s).
  Ten connections × ~5–10 MB is bounded; an unbounded pool on a 4 GB box is an OOM waiting to
  happen, and every other container holds its own pool too.
- **Run it under systemd** (or as a service in the same compose file) with `Restart=always`. A
  crash must self-heal — the client's transient retry (§4.2) then hides a restart from players.
- **Structured JSON logs to `journald`**, log rotation capped. The existing Sentry seam from the
  observability work should be re-pointed, not dropped.

### 4.6 — The Stripe webhook

One `POST /stripeWebhook` route, **raw body preserved** (signature verification needs the exact
bytes — this is the classic Fastify/Express porting bug), Stripe signature checked against
`STRIPE_WEBHOOK_SECRET`. It is **dormant** (`PAYMENTS_ENABLED = false`), so it ships as a stub with
a passing test and no urgency. When payments switch on, the Stripe dashboard endpoint URL changes
from `https://us-central1-<project>.cloudfunctions.net/stripeWebhook` (DEPLOY.md §4.5) to
`https://api.<domain>/stripeWebhook` — **a manual dashboard change that no deploy performs for
you.** Put it on the go-live checklist. MIGRATION_PLAN R15's mitigation (return 5xx during a flip
window so Stripe redelivers; it retries for 3 days) carries over verbatim.

---

## 5. Deployment cutover sequence

This complements MIGRATION_PLAN §10 (which covers the *data* cutover) with the *infrastructure*
steps. The `RUSHPOINT_DATASTORE = firestore | postgres` switch from §10.1 is assumed.

| Step | What | Rollback at this point |
|---|---|---|
| **D0** | **Provision and harden** the box (§2.4). Docker, Caddy, DNS for `api.<domain>`. **Restore a `pg_dump` onto a second throwaway box before any data exists** — Phase 0 DoD, and it is a gate, not paperwork. | Delete the box. Nothing depends on it. |
| **D1** | **Stand up the trimmed stack + the Node API on a staging hostname** (`staging-api.<domain>`). Production is 100% untouched Firebase. Both stacks run; the new one carries zero traffic. | Free. |
| **D2** | **Point the playtest lane at it.** `RUSHPOINT_DATASTORE=postgres` + `VITE_API_ORIGIN=https://staging-api…` for the playtest build only. ⚠️ **Per MEMORY, a second computer hosts the tunnel and auto-pulls from git every ~3 minutes** — so an accidental production flip is one `git push` away. **The origin and the datastore flag live in a host-local `.env`, never committed, and the committed default stays Firebase.** MIGRATION_PLAN §10.2 step 1 raises this; here it is a hard deployment control. | Revert the host-local `.env`. |
| **D3** | **Soak.** Two complete real runs to `finalizeRun`, including one deliberate mid-run network failure. Run `npm run simulate --teams=8` **against the box over the network**, not localhost — the 2-vCPU and latency reality only shows up there. Watch `docker stats` and confirm §2.2's estimates. | Free — production never moved. |
| **D4** | **Flip production.** Scripted precondition: `listLiveRuns` returns **empty** (§10.2 step 3 — a script, not a human check). Freeze + export + import per §10.3. Then rebuild both apps with the production `VITE_API_ORIGIN` and `npm run deploy:hosting`. ⚠️ **This is a Hosting deploy, not a git push** — DEPLOY.md's warning that a stale bundle keeps serving old behaviour applies exactly. | **Firebase Hosting keeps every release and offers one-click rollback in the console.** Re-serving the previous bundle points every client back at Cloud Functions + Firestore in seconds. **This is the best rollback in the whole plan — do not give it up by decommissioning Functions early.** |
| **D5** | **Watch.** First real run on the new stack. Verify wallet reconciliation and `buildRankings` parity (§10.3). | ⚠️ **The window closes the moment a real run writes to Postgres** (§10.4). From here, recovery is roll-forward + restore, which is why §3.3's break-glass must already be rehearsed. |
| **D6** | 🎯 **Migrate Storage, verify, then DOWNGRADE THE PROJECT TO SPARK.** Only Auth and Hosting remain, both within free limits (§1). **This is the milestone that actually ends the unbounded billing exposure** — everything before it is preparation. Confirm the bill is $0 before declaring victory; MIGRATION_PLAN Phase 8 requires exactly this. | Re-upgrade to Blaze; it is one click. |
| **D7** | **30-day soak**, Firestore read-only, then decommission per Phase 8. **Do not delete the Firebase project** — Auth and Hosting live there. | — |

> **Ordering constraint, easy to get wrong:** downgrading to Spark **before** Storage has moved
> makes every existing photo return **402/403** (the Sept-2024 FAQ). D6's internal order —
> Storage first, downgrade second, verify third — is not negotiable.

---

## 6. Ballpark monthly cost

> ### ✅ DECIDED (owner, this session): the **8 GB tier (~$15/mo)**.
> D1 in §7 is closed. §2.2's trimming work (drop Studio + postgres-meta, pin
> `KONG_NGINX_WORKER_PROCESSES=1`, never expose PostgREST) still applies — the bigger box buys
> headroom for the OS page cache and a Realtime load we have **not** yet measured, not a licence
> to run the stock stack untrimmed.
>
> **The arithmetic the owner should see plainly.** Earlier in this project the stated goal was a
> **≤$10/month ceiling** on Firebase. This migration lands at **≈$16/month, guaranteed** — i.e.
> the fixed cost of escaping the tail risk is *higher than the budget that motivated escaping it*.
> That is not an argument against the decision: the point was never the expected cost, it was
> that Firebase's worst case is unbounded and the card is not the owner's. Bounded-and-higher
> beats unbounded-and-lower here. But it should be a chosen trade, and it is recorded as one.

| Line item | Monthly | Basis |
|---|---|---|
| ~~IONOS VPS, 2 vCPU / 4 GB / 160 GB~~ | ~~**~$8**~~ | Not chosen — §2.2 shows the stock stack OOMs at the bad end |
| **IONOS VPS, 8 GB (CHOSEN)** | **~$15** | [ionos.com](https://www.ionos.com/servers/vps) VPS L+ (promo $6, renewal higher) — see §2.2 |
| Domain | ~$1 | ~$12–15/yr amortized; may already be owned |
| **Firebase Auth** | **$0** | Spark, 50k MAU free — far above our ceiling |
| **Firebase Hosting** (2 sites) | **$0** | Spark: 10 GB stored / 360 MB day. §1.1 quantifies the ceiling |
| Off-box backups | **$0–1** | Backblaze B2 first 10 GB free / Cloudflare R2 10 GB free. `pg_dump -Fc` of this dataset is small |
| Cloudflare (DNS + optional CDN) | $0 | Free tier |
| MapTiler | $0 | Free tier, unchanged |
| Stripe | $0 | Per-transaction only; **dormant** (`PAYMENTS_ENABLED = false`) |
| **Total, 4 GB box** | **≈ $9–10/mo** | |
| **Total, 8 GB box (recommended)** | **≈ $13–17/mo** | |
| *Break-glass reserve — Supabase Cloud Pro* | *$25, only if invoked* | §3.3 mitigation 5. Not a running cost |

**Against today: $0–2/month.**

So the migration's steady-state cost is roughly **+$8 to +$15/month**, on top of the ~137
person-days MIGRATION_PLAN §Totals estimates. Restating §0's framing without softening it:

> **The purchase is not a saving. It is the removal of an unbounded tail — replaced by a bounded
> bill and a new, real availability risk.** At today's traffic this is a financial loss and an
> availability regression, bought deliberately because the owner cannot absorb a four-figure
> Firebase day billed to a family member's card. That is a legitimate reason. It is the only one,
> and no commit message on this branch should claim another.

---

## 7. Open questions this document cannot close

| # | Question | Owner | Needed by |
|---|---|---|---|
| ~~D1~~ | ✅ **CLOSED** — owner chose the **8 GB tier (~$15/mo)**. Trimming still applies; see §6. | Owner (budget) | Decided |
| D2 | Can GoTrue be dropped entirely, given Firebase Auth is kept? Depends on whether Realtime/Storage need it present. | `docs/migration/AUTH.md` | Phase 0 |
| D3 | How is the Supabase-compatible HS256 token minted for Realtime/Storage (§4.3)? Design belongs to AUTH.md; it determines a route on this server. | `docs/migration/AUTH.md` | Phase 4/5 |
| D4 | Does Realtime's memory footprint hold under 39 ported listeners × N concurrent participants? Estimate only until measured. | `docs/migration/REALTIME_AND_OFFLINE.md` + D3 soak | Phase 5 |
| D5 | Are on-box measured figures within §2.2's estimated ranges? **Replace that table with `docker stats` output in Phase 0.** | Whoever provisions the box | Phase 0 |
| D6 | Are custom domains being adopted, or do both apps stay on `*.web.app`? Affects CORS config, the CDN mitigation in §1.1, and the TWA (`twa-manifest.json`). | Owner | D4 |

---

## Sources

- [IONOS VPS pricing (ionos.com)](https://www.ionos.com/servers/vps)
- [IONOS pricing incl. renewal costs (HostAdvice)](https://hostadvice.com/hosting-company/ionos-reviews/pricing/)
- [Firebase — default bucket & billing requirements after Sept 2024](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [Self-host Supabase on an Ubuntu VPS (MassiveGRID)](https://massivegrid.com/blog/self-host-supabase-ubuntu-vps/)
- [Docker container resource tuning for self-hosted Supabase (supascale)](https://www.supascale.app/blog/docker-container-resource-tuning-for-selfhosted-supabase)
- [Supabase — self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- In-repo: `MIGRATION_PLAN.md` · `DEPLOY.md` · `CLAUDE.md` · `docker-compose.supabase.yml` ·
  `firebase.json` · `.firebaserc` · `twa-manifest.json` · `storage.rules` ·
  `scripts/check-bundle-budget.mjs` · `apps/play-web/src/services/firebase.ts` ·
  `packages/shared/src/freeMode.ts`
