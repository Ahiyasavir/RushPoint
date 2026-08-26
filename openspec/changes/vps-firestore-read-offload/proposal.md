## Why

On 2026-08-26 a live 29-participant exam ("מבחן כאב לרופאים בקהילה", run `PCWxijOxcB1bzOhSwIqS`)
died mid-run. At 06:26:06 UTC every callable began failing with
`8 RESOURCE_EXHAUSTED: Quota exceeded` from Firestore; there were **zero** successful callables
between 06:30 and 06:59 UTC and service returned at 07:00 UTC — midnight Pacific, i.e. the daily
free-tier quota reset. No participant finished; the completion spread was `0,0,1,2,…,8,9,10` of
20 required, and every one of them was cut off inside the same 90-second window.

The cause is not a bug in game logic — it is read volume. Counting Firestore operations per
callable against that run:

| callable | ops per call | composition |
|---|---|---|
| `getMyTeamState` | **4 reads + 1 write** | rate-limit txn (1r+1w) + team + game + run |
| `listRunTeams` | **~60 reads** | run + game + 29 `teamLocations` + 29 `teams` |
| `refreshLeaderboard` | ~30 reads | every team doc |

`listRunTeams` is polled every 5s by the Run Console (`RunConsolePage.tsx:269`) — **720 reads per
minute from one open browser tab**. Measured against the 9 minutes of actual play, the run cost
**~17,000 reads and ~2,000 writes**, i.e. ~113,000 reads/hour against a 50,000 reads/day quota. A
29-person run exhausts the entire daily budget in roughly 26 minutes. This will recur on every
comparable run.

Two facts make this cheap to fix rather than expensive:

- `firestore.rules` denies client writes on `runs`, `teams` and every run sub-collection
  (`allow write: if false`), and the Builder persists through the `updateGame` callable rather than
  a direct write. **The API process is the sole writer** of game, run and team documents.
- The API is a single Node process (`functions/server.js`, no `cluster`).

So state the server already owns can be held in that process and served from there, instead of
being re-read from Firestore on every poll.

## What Changes

- **Call budgets are enforced in the API process, not in Firestore.** `enforceRateLimit` currently
  runs a Firestore transaction (one read + one write) on *every* callable invocation. The same
  budgets are enforced from process memory. Observable consequences: budgets are per-process and
  reset when the API restarts, and a tripped budget still returns the identical bilingual
  `resource-exhausted` error. **BREAKING** for anything that inspected the `rateLimits/*` documents
  — they are no longer written.
- **A coherent write-through document cache serves game, run and team reads.** Because the API is
  the only writer, every mutation it performs updates the cached copy, so a cached read is never
  staler than the last write the server itself made. A cache miss falls back to Firestore.
- **`listRunTeams` stops re-reading the whole run on every poll.** The team roster and each team's
  `lastLocationAt` are maintained in process from the writes the server already performs
  (`updateLocation`, and every team mutation), so a warm poll costs ~0 Firestore reads instead
  of ~60.
- **A cache-bypass path stays available** so an operator can force a cold read when a document is
  suspected to have drifted.
- **Serving reads from memory is opt-in and OFF by default.** It is only correct where one process
  is the sole writer, and that is a property of the deployment rather than of the code: it holds
  for the single-process VPS container (which sets `RUSHPOINT_DOC_CACHE=1`), and does not hold
  under the Firebase Functions emulator or on auto-scaled Cloud Functions. Defaulting to off means
  an unverified topology loses a speed-up instead of serving stale game state. Write invalidation
  runs either way.

Expected effect on the same 9-minute workload, with the cache enabled: reads fall from ~17,000 to
~1,700 (~90%) and writes from ~2,000 to ~100 (~95%). These are projections from the per-callable
op counts above, not measurements — task 6.1 replaces them with measured figures before the change
is archived. The rate-limiter half (~2,300 reads and ~2,300 writes) is unconditional and does not
depend on the flag.

## Non-goals

This change is the read-volume lane only. It deliberately does **not** address, and these remain
open for a follow-up resilience change:

- The client's 3-second reconnect retry loop (`PlayScreen.tsx:254`), which turned the outage into
  9,530 errors in ten minutes.
- The absence of a timeout on Firestore calls, which let requests hang 260–303 seconds before
  failing (`"ms":260063`) so participants saw a frozen screen rather than an error.
- Mapping `RESOURCE_EXHAUSTED` to a participant-facing message; today the raw numeric gRPC code
  `8` reaches the client.
- The participant `onSnapshot` listeners that read Firestore directly and bypass the API entirely
  (`PlayScreen.tsx:218`, `LiveOps.tsx:97,111`).
- Poll-cadence changes in either app, and any billing-plan decision.

No UI text changes, so no i18n surface is touched.

## Capabilities

### New Capabilities
- `api-rate-limiting`: where and how per-uid call budgets are enforced, what a caller observes when
  a budget trips, and what survives an API restart.
- `server-doc-cache`: the coherence contract for server-held copies of game/run/team documents and
  the derived per-run team roster — what may be served from memory, when a cached entry must be
  discarded, and how a cold read is forced.

### Modified Capabilities
<!-- None: no existing spec's requirements change. `authorization` and `input-validation` are
     unaffected — every auth assertion, ownership check and validation gate runs exactly as before;
     only the storage location of the rate-limit counters and the source of cached reads change. -->

## Impact

- `functions/src/rateLimitStore.ts` — reimplemented over an in-process store; the exported
  `enforceRateLimit` signature is unchanged, so its ~99 call sites are untouched.
- `functions/src/runs/index.ts` — `getMyTeamState`, `listRunTeams`, `resolveCallerTeam` and the team
  mutation paths read through the cache and write through it.
- New pure modules + their `scripts/test-*.ts` suites (auto-discovered by the aggregator).
- `FIRESTORE_PATHS.rateLimit` becomes unused by the server; the path helper stays for the existing
  documents until they are pruned.
- No callable is added, removed or renamed, and no callable's request/response shape changes — so
  the e2e callable-coverage guard is unaffected. Existing e2e scenarios gain assertions that a
  cached read still reflects a write made through a different callable.
- No Firestore rules change. No client change. No shared-type change.
