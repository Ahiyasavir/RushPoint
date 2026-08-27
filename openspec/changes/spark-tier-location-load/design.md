## Context

`updateLocation` (`functions/src/index.ts:335-427`) is the platform's highest-frequency callable and
the single largest consumer of Firestore quota. Per ping it performs:

| Op | Line | Cost |
|---|---|---|
| `teamLocations/{teamId}` merge-set | `:369` | 1 write |
| `locationTrack` `.add()` | `:374` | 1 write |
| game doc `.get()` for `safeZone` | `:380` | 1 read |
| team doc `.get()` for out-of-bounds state | `:385` | 1 read |

The participant app pings every 20 s from the controller device only
(`apps/play-web/src/screens/PlayScreen.tsx:278-284`). For 120 participants over 75 minutes that is
~27,000 pings ⇒ **~54,000 writes and ~54,000 reads**, against Spark ceilings of 20,000 writes and
50,000 reads per day. Location alone exceeds both.

Two existing platform properties are load-bearing for this design and are already documented
preconditions elsewhere in the codebase:

1. **The API is exactly one Node process.** `functions/server.js` has no `cluster`;
   `docker-compose.api.yml` runs a single replica and warns against raising it.
2. **The API is the sole writer of run-scoped documents.** `firestore.rules` denies client writes on
   runs and their subcollections.

These are the same two facts that make `functions/src/docCache.ts` and
`functions/src/rateLimitStore.ts` correct. This change leans on them again rather than introducing a
third consistency model.

## Goals / Non-Goals

**Goals:**
- Cut location's Firestore cost by roughly 4× on writes and to near-zero on reads, with no client
  release and no change to the `updateLocation` signature.
- Make Firestore operation cost *measurable and attributable*, so quota headroom stops being an
  estimate and a future regression is detectable.
- Keep safe-zone breach detection bit-for-bit identical in behavior.

**Non-Goals:**
- No new transport (no WebSocket/SSE/push). Listener fanout for feed, chat, announcements and the
  team-doc listener stays on Firestore and is deliberately out of scope.
- No change to scoring, task completion, routing or `finalizeRun`.
- No client changes: not the ping interval, not the listener set, not the 12 s `getMyTeamState` poll.
- No new Firestore index and no security-rule change.

## Decisions

### D1 — The primary lever is a minimum write interval, not a movement threshold

A movement threshold alone only helps *stationary* teams; a walking team exceeds any sane threshold
on every 20 s ping and would still write 225 times. Bounding the write *rate* is what actually caps
the cost.

`teamLocations` is therefore written at most once per **60 s** per team, with an immediate write on a
significant jump (> 75 m) so a fast-moving team stays responsive on the map. The live map's position
error is bounded by the jump threshold, and its staleness by the interval plus one ping period.

- **Chosen:** 60 s interval + 75 m jump override → ~75 writes/team ⇒ **~9,000 writes** for 120 teams.
- **Rejected — movement threshold only:** ~16,000 writes; barely helps the moving majority.
- **Rejected — raise the client ping interval:** requires a participant app release, and degrades the
  safe-zone check's sampling rate, which is the one thing that must not get coarser.

The safe-zone evaluation deliberately stays *upstream* of this decision and runs on every ping, so
detection latency is unchanged at 20 s.

### D2 — Significance is judged against the fix's own error radius

A stationary phone reporting 20 m accuracy jitters by 10–30 m, which would defeat a fixed 15 m
threshold and make suppression useless in exactly the urban conditions the platform runs in.

Significance is therefore `distance > max(BASE_MOVE_M, min(accuracyMeters, ACCURACY_CEILING_M))`.
This mirrors `packages/shared/src/safeZone.ts`, which already refuses to treat a boundary crossing as
real unless it exceeds the fix's own error radius — the same idea, applied to the same class of
input. The ceiling stops a garbage 5 km accuracy from suppressing everything; a missing or malformed
accuracy falls back to the fixed base.

### D3 — The last-written fix lives in process memory, not Firestore

Reading `teamLocations/{teamId}` to decide whether to write it would add a read per ping and cancel
the saving outright. The last written fix is instead held in an in-process `Map`, exactly as
`functions/src/rateLimitStore.ts` holds rate budgets — and correct for the same reason: the API is
the sole writer of that document and there is one process.

Consequences, accepted deliberately:
- A restart loses the records, and every team writes once on its next ping. Failing toward *writing*
  is the only safe direction.
- The store must be bounded. Entries are evicted by idle age (a team that has stopped pinging), so a
  long-lived process holding many finished runs cannot grow without limit.
- **This makes `updateLocation` a third module that hard-depends on the single-process
  deployment.** That constraint is already absolute; this change does not add a new one, but it does
  raise the cost of ever relaxing it. Recorded in Risks.

### D4 — `locationTrack` is retained by distance travelled, not by ping count

`locationTrack` feeds only the post-run movement heatmap, whose aggregator bins onto a ~55 m grid
(`packages/shared/src/movementHeatmap.ts:15`). Retaining a point every 20 s is far finer than the
consumer's own resolution.

Retention is by **distance travelled since the last retained point (100 m)**, which is strictly
better than count-based sampling for a *movement* heatmap:
- A stationary team contributes nothing — correct, since standing still is not foot traffic, and
  count-based sampling would wrongly build a hot cell wherever teams idle.
- It is deterministic and reproducible for a given ping sequence.

At ~4 km of real walking per team this yields ~40 points/team ⇒ **~4,800 writes** for 120 teams.

Per-team tracks become sparser than the grid, so a single team may skip a crossed cell. This is
acceptable *and* is why the spec defines fidelity at the aggregate level across all 120 teams rather
than per team — the honest guarantee, rather than a per-cell one the arithmetic will not support.

**Considered and deferred:** gating the track behind a per-run opt-in (default off) would take it to
zero for runs that never look at the heatmap. It needs a new setting, Builder UI, i18n and a
`BUILDER_EDITABLE_FIELDS` entry — scope creep for this change. Noted as follow-on.

### D5 — Both reads route through the existing document cache

The game doc (`:380`) and the team doc (`:385`) go through `cachedGetDoc`. The game template does not
change during a run, so its read collapses to roughly one per run. The team doc is invalidated by
completions and scoring, so it will still miss periodically — correct, and still far below one read
per ping.

Both are already `db`-handle reads, so `wrapFirestore`'s existing invalidation covers them; no new
consistency surface is introduced.

### D6 — Op-counter attribution uses `AsyncLocalStorage`

The Firestore proxy in `functions/src/docCache.ts` is a process-global. To attribute an operation to
the callable that caused it, the callable name must ride the async context. Node 20's
`AsyncLocalStorage` does this correctly across `await` boundaries; `loggedCallable` is the single
wrapper every callable already passes through, so one hook covers all ~112 of them.

- **Rejected — a mutable "current callable" global:** silently wrong under concurrency, which is
  precisely the condition being measured.
- **Rejected — threading a context argument through call sites:** 216 write sites across 18 modules;
  the same rot argument that put interception in the proxy in the first place
  (`functions/src/docCache.ts:15-20`).

Reads are **not** currently intercepted by the proxy — only `WRITE_VERBS` are
(`functions/src/docCache.ts:108`). `wrapDocRef` needs a `get` counting path, and `wrapQuery.get`,
`getAll` and transaction reads need counting hooks added. Counting is wrapped so a defect in it can
never fail the underlying operation.

The counter is off unless `RUSHPOINT_FS_OPCOUNT=1`, and when off must retain no per-operation state.

### D7 — Measurement reuses the existing simulator

`scripts/simulate-run.mjs --teams=N` already drives N concurrent teams through a real run. Pointing
it at an op-counting API is a far cheaper path to ground truth than a new 120-team load harness, and
it exercises the real callable surface.

## Projected effect

| Source | Today | After | Basis |
|---|---|---|---|
| `teamLocations` writes | ~27,000 | ~9,000 | 60 s interval (D1) |
| `locationTrack` writes | ~27,000 | ~4,800 | 100 m retention (D4) |
| game-doc reads | ~27,000 | ~120 | cached (D5) |
| team-doc reads | ~27,000 | partial | cached, invalidated by scoring (D5) |
| **Location total** | **~54k W / ~54k R** | **~14k W / low R** | |

This leaves roughly 6,000 writes of the 20,000 ceiling for missions, feed, chat and leaderboard —
tight but viable, and for the first time *measured*. Whether the full run fits is the question the
counter exists to answer; closing any remaining gap is follow-on work, not a claim of this change.

## Files to touch

**New — `packages/shared/src`**
- `locationPingEconomy.ts` — the pure verdict: `shouldWritePin()` and `shouldRetainTrackPoint()`.
  Clock injected, total, never throws, fails toward writing (D1, D2, D4).
- `firestoreOpBudget.ts` — pure tally accounting and the per-run projection that reports its own
  denominator.

**New — `functions/src`**
- `lastFixStore.ts` — the bounded in-process last-fix map with idle eviction (D3), modelled on
  `rateLimitStore.ts`.
- `opCounter.ts` — `AsyncLocalStorage` context + tally, opt-in via `RUSHPOINT_FS_OPCOUNT` (D6).

**Modified**
- `functions/src/index.ts` `updateLocation` (`:335-427`) — consume the verdict; route both reads
  through `cachedGetDoc`. Safe-zone block stays upstream and untouched.
- `functions/src/docCache.ts` — add read counting to `wrapDocRef`/`wrapQuery`/`getAll`/transaction
  reads; keep write invalidation exactly as-is.
- `functions/src/logging.ts` (or wherever `loggedCallable` lives) — enter the ALS context per call.
- `packages/shared/src/index.ts` — barrel exports for the new pure modules.

**Untouched:** `firestore.rules`, both apps, scoring, routing, `finalizeRun`.

## Test strategy

Every item is RED first, per the project's task-ordering rule.

**Pure lane (`npm test`, no emulator)**
- `scripts/test-location-ping-economy.ts` — the whole verdict surface: suppression inside the
  interval; write once elapsed; jump override; accuracy-radius significance with the ceiling and the
  missing-accuracy fallback; distance-based track retention; and the totality cases (non-finite
  coords, unparseable timestamps, absent last fix) asserting a *write* verdict and no throw.
- `scripts/test-last-fix-store.ts` — record/lookup, idle eviction bound, empty-on-restart ⇒ write.
- `scripts/test-firestore-op-counter.ts` — reads and writes tallied separately and attributed to the
  right callable under **concurrent interleaved** calls (the case a global would fail); inert when
  disabled; a throwing counting hook does not fail the operation.
- The existing `scripts/test-doc-cache-interception.ts` must stay green — it fails the build if a
  module reaches around the `db` handle.

**Emulator lane (`npm run e2e`)** — new assertions in `scripts/e2e-verify.mjs`:
- Repeated pings from a stationary team produce exactly one `teamLocations` write and no
  `locationTrack` growth.
- A ping beyond the jump threshold writes immediately, inside the interval.
- **A stationary team outside the safe zone still raises a breach alert while its write is
  suppressed** — the highest-value assertion in this change.
- Returning inside the zone clears the flag under suppression.
- `updateLocation`'s return shape is unchanged.

**Measurement** — `scripts/simulate-run.mjs --teams=N` against the API with `RUSHPOINT_FS_OPCOUNT=1`,
before and after, reporting per-callable reads/writes and the projection.

**No UI change**, so no preview verification and no `i18n:check` finding is expected — but
`npm run verify` runs it regardless and must stay clean.

## Risks / Trade-offs

- **Suppression hides a team's liveness on the staff map** → The pin's `updatedAt` is also read as
  "last seen". A stationary team could look offline for up to ~80 s. Bounded by the 60 s interval;
  if the console needs a true liveness signal it should not be inferred from a position write.
- **A third module hard-depends on single-process deployment** (D3) → Documented in the module header
  the way `docCache.ts` and `rateLimitStore.ts` already do, so the constraint is discoverable from
  the code rather than only from this document.
- **Sparser per-team heatmap tracks** (D4) → Accepted and specified at the aggregate level; a run
  with very few teams will produce a visibly thinner heatmap than today.
- **The op counter adds a hot-path hook** → Off by default and inert when off; wrapped so a counting
  defect cannot fail a Firestore call.
- **Adding read interception to the proxy touches the most safety-critical file in the backend** →
  Counting is strictly additive and must not alter the read result or the transaction-bypass rule;
  the existing interception test plus new counter tests guard it.
- **The projection may still show 120 players not fitting** → That is a legitimate outcome, not a
  failure of this change; it converts an unknown into a number and scopes the follow-on work.

## Migration Plan

No data migration, no backfill, no new document fields — the verdict needs only `lat`, `lng` and
`updatedAt`, which `teamLocations` already carries.

Rollback is a code revert; there is no persisted state whose shape changes. If suppression misbehaves
in production it can be neutralised by setting the interval and jump thresholds to zero, which
restores write-every-ping without a deploy of new logic.

## Open Questions

- Should `locationTrack` retention become a per-run opt-in (default off)? It would take the track to
  zero writes for runs that never open the heatmap, at the cost of a new Builder setting (D4).
  Deferred out of this change.
- Is the team-doc read at `:385` needed on every ping, or only when a safe zone is configured *and*
  the team is near the boundary? A cheaper predicate may exist but needs the counter's data first.
