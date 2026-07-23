## 1. RED — failing unit tests first

- [x] 1.1 Create `functions/src/maintenance/runRetention.test.ts` (vitest, co-located, no emulator)
      importing `evaluateRunPrune` and `RUN_PRUNE_REASONS` from `./runRetention`.
- [x] 1.2 Encode every case from the design's Test Strategy table: live mid-play; abandoned inside the
      window; abandoned long past it; the **max-anchor** case (ancient `createdAt`/`launchedAt`, fresh
      `updatedAt` → never pruned); finished inside/past the window; draft inside/past; `piiPrunedAt`
      short-circuit; all-absent and all-unparseable timestamps; mixed parseable/unparseable; a
      finished run with an unparseable `finishedAt` falling back to the activity anchor; clock skew
      (future anchor, and future by 1 ms); the boundary at `-1 ms` / exact / `+1 ms` on both anchors;
      and a `days` override of 0 and 1.
- [x] 1.3 Add the cross-cutting invariants: the **recency veto** (any parseable timestamp newer than
      `now - days` ⇒ `prune === false`, every status), totality (never throws for `undefined`, `null`,
      wrong types, `NaN`), purity (two identical calls are equal; the input object is not mutated),
      and that every returned `reason` is a member of the closed union.
- [x] 1.4 Run `npx vitest run src/maintenance/runRetention.test.ts` from `functions/` and confirm it
      FAILS because the module does not exist. **Record the failure verbatim in the report.**

## 2. GREEN — the pure predicate

- [x] 2.1 Create `functions/src/maintenance/runRetention.ts`: `RunRetentionFacts`,
      `RUN_PRUNE_REASONS`, `RunPruneDecision`, and
      `evaluateRunPrune(facts, now, days = RUN_DATA_RETENTION_DAYS)` implementing D1 — `piiPrunedAt`
      short-circuit, finished-anchor on `finishedAt`, otherwise the **max** of every parseable
      timestamp, future-anchor rejection, inclusive `anchor + days` boundary. Import
      `RUN_DATA_RETENTION_DAYS` from `@rushpoint/shared`; no I/O, no default `new Date()` inside the
      maths.
- [x] 2.2 Export `ABANDONABLE_RUN_STATUSES` (`['draft','live']`) and `isRunPathShapeValid` /
      `parseRunPath` from the same module so the sweep's guards are unit-testable too.
- [x] 2.3 Re-run the vitest file and confirm GREEN.

## 3. GREEN — wire the sweep

- [x] 3.1 Rewrite `sweepExpiredRuns` in `functions/src/maintenance/index.ts` to run query A (unchanged
      finished query) and query B (`status in ABANDONABLE_RUN_STATUSES` ∧ `createdAt < cutoff`,
      ordered by `createdAt` ascending), union + dedupe by document path, and gate every candidate on
      `evaluateRunPrune`. Do not modify `pruneRunPII`.
- [x] 3.2 Add the path-shape guard (`parseRunPath`) — skip and `logger.warn` on a malformed path or a
      blank id, so no identifier can ever reach `runPhotoPrefix` blank.
- [x] 3.3 Add the per-invocation cap (`maxRuns`, default 100) and return/log `stoppedEarly`. Surface
      the count through `pruneExpiredRunData` (log) and `pruneExpiredRunDataNow` (response).
- [x] 3.4 Add the `runs` COLLECTION_GROUP composite index `(status ASC, createdAt ASC)` to
      `firestore.indexes.json`, leaving the existing entries untouched.

## 4. E2E assertions (written, NOT run)

- [x] 4.1 In the callable-coverage scenario of `scripts/e2e-verify.mjs`, beside the existing
      `pruneExpiredRunDataNow` assertion: back-date a **live** run's `createdAt`/`launchedAt`/
      `updatedAt` beyond the window with the Admin SDK, run the sweep, and assert the run now carries
      `piiPrunedAt`.
- [x] 4.2 Assert the negative in the same block: a **fresh** live run is untouched by the same sweep
      (no `piiPrunedAt`).
- [x] 4.3 Do **not** run `npm run e2e` — a live playtest stack is serving from this tree. State in the
      report that these assertions are written but unrun.

## 5. REFACTOR

- [x] 5.1 Re-read the final `sweepExpiredRuns` for scope: no behavior change to `pruneRunPII`, no
      inline Storage prefixes, no new `WriteBatch`, no unrelated edits (another lane is concurrently
      editing `functions/src`).
- [x] 5.2 Comment the *why* at both sites — the module header explains that `status:'finished'` is a
      record of a click, not a fact about the world; the sweep explains that the query filters and the
      predicate decides.

## 6. Gates

- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm run lint`
- [x] 6.3 `npm test`
- [x] 6.4 `npm run creator:build`
- [x] 6.5 `npm run play:build`
- [x] 6.6 `npm run i18n:check:strict` — **not applicable**, no UI copy is touched. Record that.
