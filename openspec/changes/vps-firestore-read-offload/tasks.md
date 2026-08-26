## 1. Rate limiter — move the store into the API process

- [x] 1.1 RED: write `scripts/test-rate-limit-store.ts` covering admit-inside-budget, trip at `max`
  with the bilingual `resource-exhausted` message, reset on the window boundary, bucket/uid
  independence, and unknown-bucket fail-open-with-warning. Inject a `db` stub that THROWS if any
  Firestore method is touched, so "no Firestore round-trip" is asserted rather than assumed. Run
  `npx tsx scripts/test-rate-limit-store.ts` and confirm it fails for the right reason (the store
  still calls Firestore), not on a typo or a missing import.
- [x] 1.2 GREEN: reimplement `functions/src/rateLimitStore.ts` over an in-process
  `Map<string, WindowState>`, keeping `rateLimit()` / `RATE_LIMITS` from `@rushpoint/shared`
  untouched and `enforceRateLimit(uid, bucket, budget?)`'s signature unchanged. Confirm 1.1 passes.
- [x] 1.3 RED: extend `scripts/test-rate-limit-store.ts` with reclamation — a window-elapsed key is
  discarded and then behaves as first-ever; a live exhausted key survives reclamation and is still
  refused. Confirm the new assertions fail.
- [x] 1.4 GREEN: add bounded reclamation of window-elapsed keys. Confirm the suite passes.
- [x] 1.5 Verify `scripts/test-callable-hardening.ts` is still green — the callable surface's auth
  and audit markers must be unaffected by the store swap.

## 2. Pure cache policy

- [x] 2.1 RED: write `scripts/test-doc-cache.ts` against a fake Firestore-shaped driver that counts
  reads. Cover: warm read performs no driver read; cold read falls back and warms; a non-existent
  document is NOT cached as existing; eviction degrades to a correct cold read; an explicit bypass
  forces a driver read and refreshes the held copy. Confirm it fails (no module yet).
- [x] 2.2 GREEN: create `packages/shared/src/docCachePolicy.ts` — pure hit/miss/invalidate/evict
  decisions, path→key derivation, LRU bound, clock injected, zero Firestore imports. Confirm 2.1
  passes.
- [x] 2.3 RED: extend `scripts/test-doc-cache.ts` with collection membership (design D3) — a child
  create invalidates parent membership so a new member appears; a child update invalidates only
  that child, so assembling the collection re-reads one document, not all of them. Confirm failure.
- [x] 2.4 GREEN: add membership tracking to `docCachePolicy.ts`. Confirm the suite passes.

## 3. Interception at the `db` handle

- [x] 3.1 RED: extend `scripts/test-doc-cache.ts` with write invalidation — `doc().update()`,
  `.set()`, `.delete()` and `.create()` each invalidate; a transaction invalidates its touched paths
  AFTER `runTransaction` resolves, and also invalidates when the transaction REJECTS. Confirm
  failure.
- [x] 3.2 GREEN: create `functions/src/docCache.ts` binding the pure policy to the real Firestore
  handle, wrapping the write verbs on both `DocumentReference` and the transaction object per
  design D2/D1 (invalidate, never merge). Head the file with the sole-writer + single-process
  precondition. Confirm 3.1 passes.
- [x] 3.3 RED: write `scripts/test-doc-cache-interception.ts` — the structural guard. Assert every
  write verb reachable from the exported handle routes through the interceptor, and that no module
  under `functions/src` constructs its own `admin.firestore()` handle. Confirm it fails while the
  handle is still un-wrapped.
- [x] 3.4 GREEN: export the cache-aware handle from `functions/src/firebase.ts` so all 18 importing
  modules get it without edits. Confirm 3.3 passes and `npm run typecheck` is clean.

## 4. Read paths

- [ ] 4.1 RED: add an assertion to `scripts/e2e-verify.mjs` that a team written through
  `submitTaskAnswer` is reflected by a subsequent `getMyTeamState` (cross-callable coherence).
  Run `npm run e2e` and confirm the new assertion is the one that fails.
- [x] 4.2 GREEN: route `getMyTeamState`'s game and run reads in `functions/src/runs/index.ts`
  through the cache. Leave every authorization check, the payload shape and
  `sanitizeTaskForParticipant` untouched. Confirm 4.1 passes.
  **Scope correction:** `resolveCallerTeam`'s TEAM read is deliberately left uncached, against
  the original task text. The team document is the most-written document in a live run and it is
  the participant's own state — the thing a stale read would corrupt most visibly. Leaving it on
  Firestore costs one read per poll and removes the entire class of "a player sees their own
  score wrong". getMyTeamState still drops from 4 reads + 1 write to ~1 read + 0 writes.
- [ ] 4.3 RED: add `scripts/e2e-verify.mjs` assertions for the roster — after listing a run once,
  a newly joined team appears in `listRunTeams`; and after `updateLocation`, that row's
  last-location timestamp moves. Confirm both fail.
- [x] 4.4 GREEN: serve `listRunTeams`' team roster and location freshness from the cache, falling
  back to Firestore on a cold roster. Confirm 4.3 passes and the rows are byte-identical to the
  pre-change shape.
- [x] 4.5 Drop a run's cache entries when it finalizes (design D5). Confirm `npm run e2e`'s
  finalize and post-finalize-freeze scenarios stay green.

## 4b. Deployment topology (added after the first emulator run)

- [x] 4b.1 The first `npm run e2e` failed 11 scenarios on cross-callable coherence. Confirmed the
  cause is NOT the invalidation logic: `firebase-tools` runs callables through a
  `RuntimeWorkerPool` (`lib/emulator/functionsRuntimeWorker.js:228`), so the single-process
  precondition is false in the emulator.
- [x] 4b.2 RED: assert the cache is DISABLED unless explicitly enabled, in
  `scripts/test-doc-cache.ts`. Confirm it fails while the default is "on".
- [x] 4b.3 GREEN: add `enabled` to `createDocCachePolicy` (default false); wire
  `RUSHPOINT_DOC_CACHE === '1'` in `functions/src/firebase.ts`; set it in
  `docker-compose.api.yml` with a warning against adding replicas.
- [x] 4b.4 Re-run `npm run e2e` with the safe default and confirm every scenario is green.
- [ ] 4b.5 Because the emulator is multi-process, the ENABLED read path has no integration
  coverage. Add a post-deploy check on the VPS (warm a run, mutate through one callable, read
  through another, confirm the mutation is visible) and record the result. Do NOT claim the
  enabled path is verified until this is done.

## 4c. Adversarial audit of the interception layer

Five real defects, found by auditing rather than by a failing gate. Recorded because each one
was invisible at runtime until a live game would have shown a wrong value.

- [x] 4c.1 **Arity-sensitive `doc()`.** `collection.doc()` with NO argument auto-generates an id;
  the proxy forwarded an explicit `undefined`, which is a validation error. Failed 101 e2e
  scenarios. Fixed by forwarding arguments faithfully (`...args` / `apply`).
- [x] 4c.2 **Snapshot references escaped interception.** A ref reached through `snap.ref` or
  `snap.docs[i].ref` is a RAW DocumentReference. Three live call sites write through one —
  `admin/templates.ts:321` (a GAME doc), `maintenance/index.ts:125` (a TEAM doc) and
  `runs/index.ts:2618` (a TEAM doc) — all cached paths, so all three were stale-document bugs.
  Fixed by wrapping snapshots and the whole query builder (`QUERY_CHAIN`), so `.ref` always comes
  back intercepted. The claim "covered by construction" in D2 was FALSE before this.
- [x] 4c.3 **`collectionGroup`, `getAll` and `recursiveDelete` were not intercepted.**
  `recursiveDelete` never touches `doc()`/`collection()` at all, so a purged game would have kept
  answering reads as though it still existed. Fixed; `recursiveDelete` now drops the subtree.
- [x] 4c.4 **Warm collection reads reordered rows.** Re-read documents were appended to the end
  instead of held in position, so a team would jump position in the Run Console purely because it
  had just been written — i.e. exactly when the run is busiest. Fixed, and `getAll` results are
  now matched by id rather than by position.
- [x] 4c.5 **The limiter's memory bound was soft.** It could exceed `MAX_KEYS` without limit when
  every window was live — reachable, since play-web signs in anonymously and a script can mint
  uids freely. Fixed with a hard trim applied after every insert.
- [x] 4c.6 Verified no code depends on reference identity (`isEqual`, `===` on refs, refs as
  Map/Set keys) and that nothing uses `db.bulkWriter()` — a route that cannot be intercepted.
  The guard now fails the build if `bulkWriter` appears.

## 4d. Integration coverage for the ENABLED path

- [x] 4d.1 The gap from 4b.5 is closed locally rather than deferred to production.
  `scripts/check-doc-cache-emulator.ts` runs ONE process against the REAL Firestore emulator with
  the cache ON — the real Admin SDK, real `FieldValue.increment` inside a real transaction, real
  batches, real query snapshots. Named `check-` not `test-` because the pure aggregator runs every
  `scripts/test-*.ts` without an emulator.
- [x] 4d.2 The check is proven NON-VACUOUS: it first mutates a document through a RAW handle that
  bypasses the interceptor and asserts the cached read does NOT see it. Without that, every
  "a write is visible" assertion would pass trivially with the cache off.
- [x] 4d.3 Wired into `npm run verify:emulator`, after e2e.
- [ ] 4d.4 Still outstanding: confirm on the VPS after deploy that the topology really is single
  process (the check proves the cache is correct in one process; it cannot prove the container
  runs only one).

## 5. Prove it under concurrency and authz

- [ ] 5.1 Re-run the existing authz denial matrix in `scripts/e2e-verify.mjs` against a WARMED run
  and confirm a non-owner / other-run-staff / participant is refused exactly as before — a cached
  read must not widen access.
- [ ] 5.2 Confirm the station-contention race scenario stays green — it exercises
  `FieldValue.increment` on `taskCounts`, the case design D1 refuses to merge locally.
- [ ] 5.3 Run `npm run simulate -- --teams=8` and confirm the leaderboard invariants hold and every
  station counter returns to 0.

## 6. Measure the actual saving

- [ ] 6.1 Instrument a counting run: record Firestore reads and writes for one simulated 29-team
  run before and after, and record the numbers in the change. The proposal claims ~90% fewer reads
  and ~95% fewer writes — confirm or correct that claim with measured figures rather than shipping
  the estimate.
- [ ] 6.2 If the measured saving is materially below the claim, identify the remaining hot reads and
  note them as follow-up rather than silently accepting the gap.

## 7. Documentation

- [x] 7.1 Add the sole-writer + single-process precondition to CLAUDE.md's conventions/gotchas — a
  future change that scales the API horizontally must revisit this design first.
- [x] 7.2 Note in CLAUDE.md that `enforceRateLimit` no longer persists counters, and that the
  `rateLimits/*` documents are inert pending a prune.

## 8. Gates

- [ ] 8.1 Run `npm run verify` (typecheck · lint · test · creator:build · play:build ·
  bundle:budget · base:check · origin:check · i18n:check:strict) and confirm all nine are green.
  No UI is touched, so i18n must add zero new findings.
- [ ] 8.2 Run `npm run verify:emulator` (builds → e2e → rules → simulate → adversarial simulate),
  redirecting to a file and capturing the exit code — never piped through `tail`. Confirm every
  stage ran and passed.
- [ ] 8.3 Report the measured read/write reduction from 6.1 alongside the green gates. If any gate
  is red or any stage was skipped, say so explicitly rather than reporting completion.
