## Context

The 2026-08-26 outage (see proposal.md) was a read-volume failure, not a logic failure. Two
structural facts decide the design:

- **The API process is the sole writer** of game, run and team documents. `firestore.rules` is
  `allow write: if false` on `users/{uid}/games/{gameId}/runs/{runId}`, its `teams` subcollection
  and every other run subcollection; the Builder persists through the `updateGame` callable rather
  than a direct write (`apps/creator-web/src/pages/BuilderPage.tsx:360`). The only direct client
  writes anywhere in creator-web are to `users/{uid}` profile docs.
- **The API is one Node process.** `functions/server.js` has no `cluster`, no `worker_threads`, and
  runs as a single container (`rushpoint-api-1`). There is no second process whose cache could
  disagree with this one.

Together these mean process-local state is authoritative, not a guess. No distributed cache, no
pub/sub invalidation, no TTL-based staleness budget is needed.

The scale of the problem, measured on the incident run over nine minutes of play:

| callable | calls | Firestore ops each | total |
|---|---|---|---|
| `getMyTeamState` | 1,516 | 4 reads + 1 write | 6,064 r / 1,516 w |
| `listRunTeams` | 132 | ~60 reads | ~7,920 r |
| `refreshLeaderboard` | 35 | ~30 reads | ~1,050 r |
| `requestNextTask` + `submitTaskAnswer` | 300 | ~6 reads | ~1,800 r |

`listRunTeams` is polled every 5s by `apps/creator-web/src/pages/RunConsolePage.tsx:269`.

## Goals / Non-Goals

**Goals:**

- Remove the Firestore round-trip from rate-limit enforcement entirely.
- Serve repeat reads of game, run and team documents, and the per-run team roster and location
  freshness, from the API process.
- Make cache coherence **structural** rather than a convention each future call site must remember.
- Keep every callable's request/response shape, authorization and error behavior identical.

**Non-Goals:**

- The resilience lane listed in the proposal's Non-goals (client retry backoff, Firestore call
  timeouts, `RESOURCE_EXHAUSTED` participant copy, the direct `onSnapshot` listeners, poll cadence).
- Caching anything the API process does not solely write — `publicGames`, `publicTasks`,
  `accessCodes`, `wallets`, `auditLogs` and `users/{uid}` are out of scope.
- Any billing-plan decision.

## Decisions

### D1 — Invalidate on write; never merge a cached value

A write updates the cache by **dropping** the entry, not by applying the patch to the held copy.

The rationale is `FieldValue` sentinels. `taskCounts` is maintained with `FieldValue.increment`,
and other writes use `arrayUnion` / `serverTimestamp`. The server cannot compute the resulting
document locally without reimplementing Firestore's merge semantics, and a subtly wrong merge in a
live game is far worse than the quota problem being solved. Dropping costs exactly one Firestore
read on the next access and can never produce a wrong value.

*Alternative considered:* write-through with local merge. Rejected — it makes correctness depend on
faithfully reimplementing `FieldValue`, `set({merge:true})` and dotted-path semantics, including the
array-coercion footgun already documented in CLAUDE.md.

### D2 — Intercept at the `db` handle, not at the 216 call sites

`functions/src/firebase.ts` exports a single `db`. There are **216 write call sites across 18
modules and 44 transactions**. Requiring each to remember an invalidation call is exactly the class
of convention that rots: one missed site is a silently stale document served to a live game.

Instead the cache wraps the Firestore handle. `db.doc(path).set/update/delete/create` and the
transaction object's `set/update/delete/create` route through a thin layer that records the touched
paths and invalidates them. Existing code is unchanged and future code is covered by construction.

Transaction handling: `tx.*` mutations are buffered by Firestore and applied on commit, and a
contended transaction may retry. Touched paths are therefore accumulated per transaction attempt
and invalidated **after `runTransaction` resolves**. If it rejects, the paths are invalidated
anyway — invalidation is never wrong, only occasionally wasteful (D1), so failing toward a cold read
is the safe direction.

*Alternative considered:* explicit `cache.invalidate(path)` beside each write. Rejected on the
maintenance argument above.

### D3 — A per-document cache; collections are derived, not cached separately

The roster that `listRunTeams` needs is *the set of team documents of one run*, and
`teamLocations` is the same shape. Rather than caching query results (which would need their own
invalidation rules), the cache holds:

- individual documents, keyed by full path; and
- per-collection **membership** (the set of child document ids), keyed by collection path.

A collection read is then served by reading membership and assembling the member documents from the
document cache, re-reading from Firestore only the members that were invalidated. A write to any
child path invalidates that child *and* the parent collection's membership when the write creates or
deletes a document, so a newly joined team appears without a full re-read of the rest.

This makes the common case cheap in the right way: over the incident's nine minutes there were ~300
team mutations against 132 `listRunTeams` polls, so a warm poll re-reads roughly two documents
instead of sixty.

### D4 — The limiter keeps the pure decision function and replaces only the store

`rateLimit()` and `RATE_LIMITS` in `packages/shared/src/rateLimit.ts` are already pure with an
injected clock and are not touched. Only `functions/src/rateLimitStore.ts` changes: the Firestore
transaction is replaced by a `Map<string, WindowState>` read-modify-write. Node's single-threaded
execution makes that atomic without a transaction — the `await` that made the Firestore version need
one is gone.

`enforceRateLimit(uid, bucket, budget?)` keeps its signature, so its call sites across the callable
surface are untouched, and `scripts/lib/callableHardening.mjs` continues to see the same shape.

### D5 — Bounded memory, and eviction is always safe

Both stores are bounded (LRU over document entries and roster memberships; reclamation of
window-elapsed limiter keys). Per the spec, evicting anything only ever costs a Firestore read.
Run entries are additionally dropped when a run finalizes, since a finished run's documents are
never on a hot path again.

### D7 — The read cache is opt-in, and off by default

**This decision replaces an assumption the original design got wrong.** D2/D3 rest on "one
process is the sole writer". That is true of the code, but it is a property of the DEPLOYMENT,
and the first emulator run proved it: 11 e2e scenarios failed on cross-callable coherence —
`listRunTeams` returned a team row ten seconds stale, `startTeams` set `launched` and the console
still showed the team held, a published leaderboard never reached the participant.

The invalidation logic was correct. The precondition was false. `firebase-tools` runs callables
through a **`RuntimeWorkerPool`** (`lib/emulator/functionsRuntimeWorker.js:228`) — several Node
processes — so a write handled by worker A cannot invalidate worker B's copy. Real Cloud
Functions would be worse: it auto-scales to many instances.

So the fast path is opted into by the one environment whose topology has been checked. The VPS
container sets `RUSHPOINT_DOC_CACHE=1` (`docker-compose.api.yml`, with a warning against adding
replicas); everywhere else reads go straight to Firestore. A wrong topology now costs a
performance win instead of corrupting a live game.

The consequence for verification is stated plainly rather than papered over: **the emulator lane
cannot exercise the enabled read path at all.** It is covered by the pure suites (which are
single-process by construction) and must be confirmed on the VPS after deploy. `npm run e2e`
proves only that the disabled path is unchanged — which is exactly what it should prove, since
that is what every other environment runs.

### D6 — A bypass path exists for operator recovery

Reads accept an explicit bypass so a document suspected of having drifted can be re-read without
restarting the API. This is the escape hatch for the one failure mode the design cannot rule out
by construction: a write that reaches Firestore without going through this `db` handle.

## Files to touch

- `functions/src/firebase.ts` — export the cache-aware handle.
- **New** `functions/src/docCache.ts` — the interception layer binding the pure cache to Firestore.
- **New** `packages/shared/src/docCachePolicy.ts` — the pure cache: hit/miss/invalidate/evict
  decisions and path→key derivation, clock injected, no Firestore types.
- `functions/src/rateLimitStore.ts` — in-process store; `enforceRateLimit` signature unchanged.
- `functions/src/runs/index.ts` — `listRunTeams` reads the roster and location freshness through
  the cache; `getMyTeamState` and `resolveCallerTeam` read game/run/team through it. No change to
  their authorization checks, their payloads, or `sanitizeTaskForParticipant`.

No new env var. No new Firestore index. No `firestore.rules` change. No shared *type* change (the
new module is pure logic). No client change.

## Test strategy

Pure lane (`scripts/test-*.ts`, auto-discovered by `scripts/run-unit-tests.mjs`) — written first,
failing, per the TDD ordering:

- **`scripts/test-rate-limit-store.ts`** — admits inside budget; trips at `max` with the bilingual
  `resource-exhausted`; resets on the window boundary; buckets and uids are independent; an unknown
  bucket fails open and warns; a window-elapsed key is reclaimed and then behaves as first-ever;
  a live exhausted key survives reclamation and still refuses. Asserts zero Firestore access by
  injecting a `db` stub that throws if touched.
- **`scripts/test-doc-cache.ts`** — over a fake Firestore-shaped driver: warm read performs no
  driver read; cold read falls back and warms; a non-existent document is not cached as existing;
  a write through `doc().update()` invalidates; a write through a transaction invalidates **after**
  commit and also on rejection; a child create invalidates parent membership so a new member
  appears; eviction degrades to a correct cold read; bypass forces a driver read and refreshes.
- **`scripts/test-doc-cache-interception.ts`** — the structural guard, in the spirit of
  `test-upload-origin-parity`: every write verb reachable from the exported handle (including the
  transaction object's) routes through the interceptor, and no module under `functions/src`
  constructs its own `admin.firestore()` handle to bypass it. This is the test that keeps D2 true
  as the codebase grows.

Emulator lane (`scripts/e2e-verify.mjs`, `npm run e2e`) — new assertions inside existing scenarios,
since no callable is added:

- Write a team through `submitTaskAnswer`, then read it through `getMyTeamState`; assert the read
  reflects the write (cross-callable coherence, spec: "A write through one callable is visible to
  another").
- With a run already listed once, join a new team, then `listRunTeams`; assert the new team is
  present (roster membership invalidation).
- `updateLocation`, then `listRunTeams`; assert the row's last-location timestamp moved.
- Re-run the existing authz denial matrix against a **warmed** run, asserting a non-owner is still
  refused (spec: "Cached reads never widen access").
- The station-contention race scenario must stay green — it exercises `FieldValue.increment` on
  `taskCounts`, which is precisely the case D1 refuses to merge locally.

No UI is touched, so no preview verification and no new i18n surface — but `npm run i18n:check:strict`
still runs as part of `npm run verify`.

Gates: the full `npm run verify` (nine gates) plus `npm run e2e`, and `npm run simulate --teams=8`
plus the adversarial simulate via `npm run verify:emulator`, which is where a coherence bug under
real concurrency would surface.

## Risks / Trade-offs

- **A write that bypasses the exported `db` handle would serve a stale document.** → D2 puts
  interception at the single choke point, and `test-doc-cache-interception.ts` fails the build if a
  module constructs its own handle. D6's bypass is the runtime escape hatch.
- **A second API process (scaling out, a blue/green deploy overlap) would break the sole-writer
  assumption** — two caches, one stale. This is no longer hypothetical: it is exactly what the
  emulator does, and it failed 11 e2e scenarios. → D7 makes the read path opt-in and off by
  default, so only a deployment explicitly declared single-process gets it. The precondition is
  documented at the top of `docCache.ts` and `docCachePolicy.ts`, restated beside the compose
  env var, and CLAUDE.md gains the same note.
- **The enabled read path is not covered by any integration test**, because the only integration
  environment available (the emulator) is multi-process. → Covered by the pure suites and by a
  post-deploy check on the VPS. This is a real gap, not a solved problem, and it is the main
  reason the read cache ships behind a flag that can be turned off without a code change.
- **Rate-limit budgets reset on API restart.** → Accepted and specified. The limiter bounds abuse;
  a handful of extra calls after a restart is a far smaller cost than a read and a write on every
  callable invocation.
- **Memory growth across many concurrent runs.** → Bounded stores (D5), plus eviction on run
  finalize. Eviction is never a correctness risk, only a cost one.
- **The `taskCounts` increment path is the sharpest correctness edge.** → D1 forbids local merging
  outright, and the existing station-contention e2e race is the regression test.
- **This does not, by itself, make the platform safe on the free tier.** It removes ~90% of reads
  and ~95% of writes on the measured workload, which takes a 29-person run from ~113k reads/hour to
  roughly 11k — inside the quota with real headroom. It is not a substitute for deciding the
  billing plan, and the resilience lane is still needed so a future quota event degrades visibly
  instead of silently.

## Migration Plan

The change is deploy-and-done: no data migration, no backfill, no rules deploy. Documents already
written under `FIRESTORE_PATHS.rateLimit(bucket, uid)` become inert and can be pruned separately.

Rollback is a redeploy of the previous API image; nothing persisted by this change needs undoing.
Note the known ~40s 503 window while the container rebuilds and Caddy re-probes — deploy outside a
live run.

## Open Questions

- Should run-scoped cache entries also be dropped on `pruneExpiredRunData`, or is finalize plus LRU
  sufficient? Finalize plus LRU is assumed here.
- The inert `rateLimits/*` documents: prune in this change or leave to a maintenance sweep? Left
  out of scope above.
