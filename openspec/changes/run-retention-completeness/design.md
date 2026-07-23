## Context

Everything below was read in this working tree, not inferred.

- **The sweep.** `sweepExpiredRuns` (`functions/src/maintenance/index.ts:154-175`) builds
  `cutoff = now - RUN_DATA_RETENTION_DAYS`, queries
  `collectionGroup('runs').where('status','==','finished').where('finishedAt','<',cutoff)`, skips any
  doc already carrying `piiPrunedAt`, splits the path into `ownerUid/gameId/runId` and calls
  `pruneRunPII`. It is driven daily by `pruneExpiredRunData` (`:221-231`) and on demand by the
  admin-only `pruneExpiredRunDataNow` (`:235-239`).
- **The only writer of `status: 'finished'`.** `finalizeRun` (`functions/src/runs/index.ts:1537-1556`)
  writes `{ status:'finished', finishedAt: now, leaderboard:{…frozen}, taskCounts, updatedAt }` in one
  `runRef.update`. A grep of `functions/src` finds no other `status: 'finished'` write on a run doc
  and no trigger, timeout or scheduler that finalizes on the creator's behalf.
- **`RunStatus`** is `'draft' | 'live' | 'finished'` (`packages/shared/src/types/index.ts:161`).
- **Timestamps a run carries** (`types/index.ts:682-715`): `launchedAt?`, `finishedAt?`, `createdAt`,
  `updatedAt` — the last two non-optional. `launchRun` stamps all three of
  `launchedAt/createdAt/updatedAt` (`runs/index.ts:258`); `updatedAt` is re-stamped by joins
  (`:515`, `:547`), device joins (`:2571`), hot-zone activate/clear (`:1388`, `:1404`), the frozen
  final board (`:1555`) and other run-doc writes.
- **What a prune destroys.** `pruneRunPII` (`maintenance/index.ts:80-150`) bulk-deletes
  `PII_BULK_SUBCOLLECTIONS` (`teamLocations`, `locationTrack`, `zones`, `feedItems`, `alerts`,
  `chat`) plus trackable travel logs through `deleteDocsInChunks` (≤ `MAX_BATCH_OPS = 450` per commit,
  `functions/src/batchUtil.ts:10`), nulls `taskSubmissions[*].photoUrl` and the guardian name per
  team, deletes `consentTokens`, `deleteFiles({ prefix: runPhotoPrefix(runId) })`, and stamps
  `piiPrunedAt`.
- **The published promise.** `apps/creator-web/src/pages/LegalPage.tsx:384-385` / `:150-151`:
  GPS data and uploaded photos are "auto-deleted 90 days after run completion".
  `RUN_DATA_RETENTION_DAYS = 90` (`types/index.ts:1007`).

**The defect, stated precisely:** the policy's "run completion" is a *fact about the world* (the game
ended); the code's `status === 'finished'` is a *record of a creator's click*. When those diverge —
which is the normal outcome for an abandoned run — the data is retained forever.

**Hard constraint on this work:** a live playtest/dev stack (Vite 5180/5181, Firestore emulator 8080)
is serving from this tree and holds preserved user data. No emulator is started, stopped or queried;
no prune code is executed against it. Verification is the pure-logic lane only.

## Goals / Non-Goals

**Goals**
- Every run that is over is pruned on schedule, finalized or not.
- The destroy/keep decision is a pure, total, fail-closed function that can be attacked in tests.
- It is *provably impossible* for the sweep to touch a run with any sign of recent life.
- The sweep is bounded: no unbounded batch, no unbounded per-invocation work, no prefix built from an
  id that could be blank.

**Non-Goals**
- Changing what `pruneRunPII` destroys, or how.
- Changing `hideFeedItem` (D5), the ceremony feed, URL tokenization, or any legal copy.
- Auto-finalizing abandoned runs. Scores and rankings are aggregate data the policy does **not**
  promise to delete; inventing a synthetic finalize would fabricate standings nobody asked for.
  This change deletes PII from abandoned runs; it leaves them un-finalized.

## Decisions

### D1 — The prune anchor: `finishedAt` when finalized, otherwise the **maximum** of every known timestamp

```
anchorMs =
  status === 'finished' && finishedAt parses   →  finishedAt
  otherwise                                    →  max(finishedAt, updatedAt, launchedAt, createdAt)
                                                  over only the values that parse
eligibleAtMs = anchorMs + days * 86_400_000
prune        = now >= eligibleAtMs             (inclusive at the boundary)
```

*Why `finishedAt` alone for a finalized run:* it preserves today's behavior exactly (no regression),
and it is literally the policy's clock — "90 days after run completion". Using the max would let a
post-finalize touch (`refreshLeaderboard({ publish:true })` a month later, an `adjustTeamScore`)
silently push a participant's photos past the promised 90 days. A finalized run is by definition not
being played, so there is no safety reason to wait for other signals.

*Why the max for a non-finalized run:* the anchor must answer "when did anything last happen here?",
and the only honest answer is the newest evidence available. `createdAt` alone would be catastrophic —
a long-running series, a run created from a duplicated template, or simply a run that has been live
for months would look ancient while play was ongoing. Taking the **maximum** means a single fresh
timestamp vetoes the prune. This is the load-bearing choice of the whole change.

### D2 — Safety argument: why this can never touch a live run

The claim is that a run being played *now* cannot be selected. Four independent barriers:

1. **The magnitude of the window.** Eligibility requires `now - anchor >= 90 days`. A field game runs
   for hours; the longest plausible multi-session event is days. There is no legitimate run whose
   *most recent* activity is 90 days old and which is still being played.
2. **The anchor is a maximum, not a minimum.** For a non-finalized run every one of
   `createdAt`, `launchedAt`, `updatedAt` and `finishedAt` must be ≥ 90 days old. `updatedAt` is
   re-stamped by `joinRun` (`:515`, `:547`), `joinTeamAsDevice` (`:2571`), hot-zone changes and the
   leaderboard writes. Any of those inside 90 days is an absolute veto. There is no combination of
   inputs where a recent timestamp is outvoted by old ones — `max` has no averaging behavior to
   exploit.
3. **Fail-closed on every ambiguity.**
   - No parseable timestamp at all → **never** pruned (`no_usable_timestamp`). A corrupt run doc is a
     reason to stop, not a licence to destroy — the same stance `isPurgeDue` takes on a corrupt game
     tombstone (`gameLifecycle.ts:19-22`).
   - Anchor **in the future** (clock skew, a bad client-supplied string) → **never** pruned
     (`future_timestamp`), rather than treated as "very old" or wrapped into a negative age.
   - A non-blank `piiPrunedAt` short-circuits to `already_pruned` before any timestamp maths.
4. **The query is a filter; the predicate is the authority.** The Firestore queries can only ever
   *narrow* the candidate set. Nothing is destroyed because a query returned it — `evaluateRunPrune`
   re-decides from the document's own fields, so an over-broad or mis-indexed query cannot cause a
   deletion. Conversely the query condition is a strict *necessary* condition of the predicate
   (`createdAt <= anchor` always, since the anchor is a max that includes `createdAt`), so the filter
   can never hide a run the predicate would have pruned.

The residual risk this consciously accepts: a run *legitimately* dormant for >90 days and resumed
afterwards loses its GPS pings and photos. That is not a bug — it is exactly what the Privacy Policy
promises participants, and their consent is the stronger claim.

### D3 — Queries and the index

Two collection-group queries, unioned and deduplicated by document path:

| # | Query | Purpose |
|---|---|---|
| A | `status == 'finished'` ∧ `finishedAt < cutoff` | unchanged — existing index |
| B | `status in ['draft','live']` ∧ `createdAt < cutoff` | new — abandoned/stale runs |

`createdAt` is the right query field for B because it is **non-optional on every run** and is a lower
bound on the anchor (the anchor is a max that includes it). So `createdAt < cutoff` is implied by
eligibility: B cannot omit a prunable run, and every extra row it returns is rejected in memory by the
predicate at no data cost.

An `in` filter is an equality filter, so B needs one composite index:

```json
{ "collectionGroup": "runs", "queryScope": "COLLECTION_GROUP",
  "fields": [ { "fieldPath": "status", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "ASCENDING" } ] }
```

**Deploy ordering is a hard requirement:** indexes first, functions second. A missing index makes B
throw `FAILED_PRECONDITION` at runtime. Query A runs first and is `await`ed separately, so the
existing finished-run prune still completes; only the new path degrades — but it degrades *silently
except for the thrown error in logs*, which is why the ordering is called out in the proposal and the
report rather than left to be discovered.

*Alternative rejected:* a single unfiltered `createdAt < cutoff` collection-group query (one
single-field `fieldOverride`, no composite). Simpler, but it re-reads every already-pruned run in the
system on every sweep forever, and the read cost grows without bound. Two status-scoped queries keep
the scan proportional to what is actually actionable.

### D4 — Bounding the sweep

- **Batch cap:** unchanged and already correct — all deletes go through `deleteDocsInChunks`
  (≤ 450 ops/commit). No new code path assembles a `WriteBatch`. A previous lane shipped an
  unchunked sweep; this one adds no batch at all.
- **Per-invocation cap:** the sweep prunes at most `maxRuns` (default 100) runs per invocation and
  reports whether it stopped early. Rationale: the sweep now has a second, previously unserved
  backlog; the first production run could face a large set, and a scheduled function that times out
  mid-prune is worse than one that finishes and resumes. Progress is monotone because `pruneRunPII`
  stamps `piiPrunedAt`, so the next invocation starts where this one stopped. Ordering is
  oldest-`createdAt`-first within each query so the backlog drains deterministically.
- **Path shape guard:** `users/{ownerUid}/games/{gameId}/runs/{runId}` is 6 segments. Before any id is
  used the split is checked for length and for `parts[4] === 'runs'`, and all three ids must be
  non-empty. A blank `runId` reaching `runPhotoPrefix` would throw (`storagePaths.ts:18-26` — by
  design, since `runs/` as a prefix deletes every run's uploads in the bucket), but a thrown error
  inside a sweep is a bad way to learn that; the guard skips and logs instead. `runPhotoPrefix`
  remains the only place a Storage prefix is constructed — no inline template literals.

### D5 — `hideFeedItem`: investigated, **no behavior change**, and why

The assessment document claimed `hideFeedItem` "revokes nothing" and that this contradicts Terms
§5.5(e). Verified reading of `functions/src/index.ts:911-935` (the assessment's line numbers were off;
this is the real implementation):

```ts
if (restore) itemRef.update({ active:true, hiddenAt:delete, hiddenBy:delete, reportsCleared:true });
else         itemRef.update({ active:false, hiddenAt:now, hiddenBy:context.auth.uid });
```

The claim is factually right: only `active` and the audit fields move; `photoUrl` stays on the doc and
the Storage object stays. **But the promise it is measured against does not say what the assessment
says it says.** The actual copy (`LegalPage.tsx:832`) is:

> **(e) Removal authority:** the game's Creator and their designated staff **may hide any photo at any
> time, and may restore a photo removed in error.**

The Terms promise hiding **and restoring**. The implementation does exactly, and only, that. There is
no contradiction between copy and behavior — so by this lane's own scope rule ("implement only what is
unambiguously a bug"), there is nothing here to implement.

Independently, making hide destroy the object would be a **new and worse defect**:

- Hiding is **participant-triggerable**. `reportFeedItem` → `applyReport`
  (`packages/shared/src/feedReports.ts:84-89`) sets `active:false` automatically once
  `FEED_AUTO_HIDE_REPORTS = 2` *distinct teams* report an item. Two rival teams colluding could then
  permanently destroy another team's photo — the exact griefing the design amendment at
  `feedReports.ts:6-13` was written to prevent, escalated from "temporarily hidden" to "irrecoverably
  deleted".
- Restore would become a lie. `hideFeedItem({ restore:true })` exists precisely to reverse an
  erroneous or malicious hide (change `feed-ugc-safety`); after a Storage delete it would restore a
  doc pointing at a 404.
- The same object is the **task submission evidence**. The photo lives at
  `teams/{teamId}.taskSubmissions[taskId].photoUrl` as well as in the feed item; the run console and
  `reviewStationSubmission` read it to justify a score. Feed moderation must not destroy scoring
  evidence.

**Conclusion:** hiding is legitimately a moderation-*visibility* action, the copy already describes it
correctly, and the behavior stays as-is. The retention sweep (this change) is what makes the object
eventually unreachable — and with the abandoned-run fix, that now actually happens for every run. Any
desire for immediate revocation is a product decision (signed URLs / a proxy), explicitly out of
scope, and left to the user.

### D6 — Where the pure predicate lives

`functions/src/maintenance/runRetention.ts`, **not** `packages/shared`. It is server-only policy — no
client surface reads it — and adding a shared export would require rebuilding `packages/shared/dist`,
which this lane is forbidden from doing while another agent serializes `shared:build`. The
`RUN_DATA_RETENTION_DAYS` constant is still imported from `@rushpoint/shared` so there is one number.

## Risks / Trade-offs

- **This code deletes data.** Mitigations: purity + totality, max-anchor, fail-closed on every
  ambiguity, predicate-over-query authority, exact boundary tests, path-shape guard.
- **A dormant-then-resumed run loses its PII.** Accepted and documented in D2 — it is the promise.
- **Index deploy ordering.** Called out in the proposal, in this design, and in the final report.
- **Runs with a status outside `RunStatus`.** Not matched by either query, therefore never pruned.
  Fail-closed and consistent with the rest of the design; noted as a known, deliberate blind spot.
- **E2E is written but unrun.** A live stack is serving from this tree. Stated explicitly rather than
  quietly skipped.

## Migration Plan

1. Deploy `firestore.indexes.json`; wait for the `runs (status, createdAt)` index to finish building.
2. Deploy functions.
3. Optionally invoke `pruneExpiredRunDataNow` (admin-only) once and read `prunedCount` /
   `stoppedEarly` from the response to see the size of the historical backlog; re-invoke until
   `stoppedEarly` is false. The daily schedule then keeps up on its own.

No backfill or data migration: eligibility is derived from fields every run already carries, and
`piiPrunedAt` already exists as the idempotence tombstone.

## Test Strategy

**Lane:** pure logic, vitest, co-located in `functions/` — `runRetention.test.ts`. No emulator, no
clock reads (`now` is injected), no fixtures on disk.

`evaluateRunPrune` cases, all against an injected `now` and `days = 90`:

| Case | Expected |
|---|---|
| `status:'live'`, created/launched/updated 2 h ago | `prune:false`, `within_retention` |
| `status:'live'`, everything 200 days old | `prune:true`, `abandoned_retention_elapsed` |
| `status:'live'`, created/launched 200 days ago, `updatedAt` 1 h ago | `prune:false` — **the max-anchor guarantee** |
| `status:'live'`, created 200 days ago, launched 1 day ago | `prune:false` |
| `status:'finished'`, `finishedAt` 10 days ago | `prune:false`, `within_retention` |
| `status:'finished'`, `finishedAt` 200 days ago | `prune:true`, `finished_retention_elapsed` |
| `status:'draft'`, created 200 days ago | `prune:true` |
| `status:'draft'`, created 10 days ago | `prune:false` |
| any status, `piiPrunedAt` set | `prune:false`, `already_pruned` (checked before timestamps) |
| every timestamp absent | `prune:false`, `no_usable_timestamp` |
| every timestamp `'not-a-date'` / `''` / `null` / non-string | `prune:false`, `no_usable_timestamp` |
| mixed: `createdAt` unparseable, `launchedAt` 200 days old | `prune:true` (unparseable values ignored, not fatal) |
| `status:'finished'`, `finishedAt` unparseable, other timestamps 200 days old | `prune:true` via the abandoned anchor |
| anchor 1 day in the **future** (clock skew) | `prune:false`, `future_timestamp` |
| anchor in the future by 1 ms | `prune:false`, `future_timestamp` |
| `now === anchor + 90d - 1 ms` | `prune:false` |
| `now === anchor + 90d` exactly | `prune:true` (inclusive boundary, matches `isPurgeDue`) |
| `now === anchor + 90d + 1 ms` | `prune:true` |
| same, on the finished path | identical boundary behavior |
| `days` override (0 / 1) | honoured, so an admin override is provable both ways |

Invariants asserted across a seeded sweep of generated runs:
- **Recency veto:** for any run with at least one parseable timestamp newer than `now - days`,
  `prune` is `false`. No exceptions, any status.
- **Totality:** every input yields a decision with a `reason` from the closed union; the function
  never throws, for any input including `undefined`, `null`, wrong types and `NaN`.
- **Determinism/purity:** calling twice with the same inputs returns equal results and does not mutate
  the input object.

**E2E (written, NOT run):** in `scripts/e2e-verify.mjs`'s callable-coverage scenario, next to the
existing `pruneExpiredRunDataNow` assertion — back-date a **live** run's `createdAt/launchedAt/
updatedAt` past the window via the Admin SDK, run the sweep, and assert the run now carries
`piiPrunedAt` and its `teamLocations` are gone; and assert a **fresh** live run is untouched by the
same sweep. Left unrun because a live playtest stack is serving from this tree.

**Not covered here:** the scheduled trigger firing, and real Storage deletion — both need the
emulator.
