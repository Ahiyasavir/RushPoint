## 1. Baseline measurement (establish the denominator before changing anything)

- [x] 1.1 RED: write `scripts/test-firestore-op-counter.ts` asserting the tally accounts reads and
      writes separately, attributes each to the invoking callable under **concurrently interleaved**
      calls, reports an overall total, is inert when disabled, and swallows a throwing counting hook
      without failing the operation. Run it; confirm it fails because the module does not exist.
- [x] 1.2 GREEN: add `packages/shared/src/firestoreOpBudget.ts` — pure tally accounting plus the
      per-run projection that reports its own inputs (per-callable counts and participant count),
      not a bare verdict. Export from the shared barrel. Make 1.1 pass.
- [x] 1.3 GREEN: add `functions/src/opCounter.ts` — `AsyncLocalStorage` context carrying the callable
      name, opt-in via `RUSHPOINT_FS_OPCOUNT`, retaining no per-operation state when disabled.
- [x] 1.4 Enter the ALS context once per invocation inside `loggedCallable`, so all ~112 callables
      are attributed through the single existing wrapper.
- [x] 1.5 Add read counting to `functions/src/docCache.ts`: a `get` path in `wrapDocRef` (reads are
      currently NOT intercepted — only `WRITE_VERBS`), plus `wrapQuery.get`, `getAll` and transaction
      reads. Counting must not alter results, ordering, error propagation, or the
      transaction-read-bypass rule. Wrap each hook so a counting defect cannot fail the call.
- [x] 1.6 Confirm `scripts/test-doc-cache-interception.ts` and the existing doc-cache suites are
      still green — the proxy is the most safety-critical file being touched.
- [x] 1.7 Capture the BASELINE: run `scripts/simulate-run.mjs --teams=N` against the API with
      `RUSHPOINT_FS_OPCOUNT=1` and record per-callable reads/writes and the projection. This is the
      number every later task is measured against; save it in the change directory.

## 2. The ping verdict (pure, RED first — this is the only component that can lose a position)

- [x] 2.1 RED: write `scripts/test-location-ping-economy.ts` covering the full verdict surface —
      suppression inside the minimum write interval; write once the interval elapses; the
      significant-jump override firing inside the interval; significance judged against the fix's own
      accuracy radius; the accuracy ceiling so a very low-confidence fix cannot suppress a large
      move; the missing/malformed-accuracy fallback to the fixed threshold; distance-based track
      retention including a stationary team retaining nothing. Run it; confirm it fails.
- [x] 2.2 RED: extend the same suite with the totality cases — non-finite coordinates, unparseable or
      absent timestamps, and no last fix at all MUST each yield a **write** verdict and MUST NOT
      throw. Confirm these fail for the right reason.
- [x] 2.3 GREEN: add `packages/shared/src/locationPingEconomy.ts` with `shouldWritePin()` and
      `shouldRetainTrackPoint()` — clock injected, total, never throwing, failing toward writing.
      Export from the shared barrel. Make 2.1 and 2.2 pass.
- [x] 2.4 REFACTOR: name the thresholds as declared constants with the reasoning from design D1/D2/D4
      recorded beside them (60 s interval, 75 m jump, accuracy ceiling, 100 m track retention), and
      reuse the existing shared `geo.ts` distance helper rather than hand-rolling haversine.

## 3. The last-fix store (pure + in-process)

- [x] 3.1 RED: write `scripts/test-last-fix-store.ts` asserting record/lookup round-trip, that an
      unknown team yields nothing (⇒ write), that idle entries are evicted so the store stays
      bounded, and that eviction never drops an actively-pinging team. Run it; confirm it fails.
- [x] 3.2 GREEN: add `functions/src/lastFixStore.ts` modelled on `rateLimitStore.ts`, with a module
      header documenting the single-process precondition the way `docCache.ts` and `rateLimitStore.ts`
      already do — so the constraint is discoverable from the code, not only from design.md.

## 4. Wire the callable (behavior change lands here)

- [x] 4.1 RED: extend `scripts/e2e-verify.mjs` with the new assertions, and confirm they fail against
      current behavior: repeated stationary pings produce exactly ONE `teamLocations` write and no
      `locationTrack` growth; a beyond-threshold jump writes immediately inside the interval;
      `updateLocation`'s return shape is unchanged.
- [x] 4.2 RED: add the safety assertions — **a stationary team OUTSIDE the safe zone still raises a
      breach alert while its position write is suppressed**, and a suppressed ping from inside the
      zone still clears the out-of-bounds flag. These are the highest-value assertions in the change.
- [x] 4.3 GREEN: consume `shouldWritePin()` / `shouldRetainTrackPoint()` in `updateLocation`
      (`functions/src/index.ts:335-427`), reading last-fix state from `lastFixStore` so **no extra
      Firestore read is introduced**. Keep the safe-zone evaluation strictly UPSTREAM of the
      suppression decision so no suppression path can reach the safety logic.
- [x] 4.4 GREEN: route the game-doc read (`:380`) and the team-doc read (`:385`) through
      `cachedGetDoc`.
- [x] 4.5 Confirm no typed wrapper change is needed in either app's `services/calls.ts` — the
      callable's signature and return shape are unchanged. If either moved, this task is a bug.

## 5. Prove the effect

- [x] 5.1 Re-run `scripts/simulate-run.mjs --teams=N` with `RUSHPOINT_FS_OPCOUNT=1` and compare
      against the 1.7 baseline. Record the measured before/after per-callable reads and writes.
- [x] 5.2 Write the projection for 120 participants from the measured numbers, stating the
      denominator (participant count and per-callable counts) alongside the totals versus the
      20,000-write / 50,000-read ceilings. Report honestly whether the run fits, including if it
      does not.
- [x] 5.3 Sanity-check heatmap fidelity: build a heatmap from a distance-sampled track and confirm
      the aggregate cell-weight ordering still matches the unsampled track, per the run-analytics
      spec — a movement heatmap must not develop a hot cell where teams merely stood still.

## 6. Gates

- [x] 6.1 Run `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · origin:check · i18n:check:strict) and confirm ALL green. No UI changed, so
      i18n must add zero new findings.
- [x] 6.2 Run `npm run e2e` and confirm green, including every new assertion from tasks 4.1 and 4.2.
      Redirect to a file and check the exit code — never pipe a gate through `tail` and trust the
      status.
- [x] 6.3 Run `npm run verify:emulator` (builds → e2e → rules → simulate → adversarial simulate) and
      confirm green. Do not run it concurrently with `npm run verify` on the same working tree —
      both rewrite `packages/shared/dist` in place.
- [x] 6.4 Update `CLAUDE.md` with the new modules and the single-process dependency they add, and
      note the deferred per-run track opt-in from design D4 as follow-on work.
