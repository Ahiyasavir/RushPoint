## 1. The disk store (pure module, RED first — this is where corruption would happen)

- [x] 1.1 RED: write `scripts/test-track-store.ts` against a real temp directory
      (`node:fs` + `node:os.tmpdir()`, the same class of filesystem test as
      `scripts/test-emulator-gate-isolation.ts`). Cover: append/read round-trip; ordering
      preserved; two runs never share a file; `readTrackPoints` returns `null` for "no file"
      but `[]` for "empty file" (the D4 fallback contract). Run it; confirm it fails because
      the module does not exist.
- [x] 1.2 RED: add the concurrency assertion — many promises appending to the SAME run key at
      once; every record must come back complete and independently parseable, and the count
      must equal the number appended. This is the single most important test in the change.
- [x] 1.3 RED: add the safety assertions — a run reference that would resolve outside the
      configured root is REFUSED; a broken root (root is a file / unwritable) does not throw
      from any of append/read/delete; `deleteRunTrack` on a never-written run is a silent no-op;
      and with storage disabled every operation is inert.
- [x] 1.4 GREEN: add `functions/src/trackStore.ts` — per-run JSONL append, the
      `safeUploadPath`-style path guard, the per-run promise-chain write queue (D2), and the
      best-effort non-throwing contract (D3). Header must document the single-process
      precondition the way `docCache.ts` / `rateLimitStore.ts` / `lastFixStore.ts` do.
- [x] 1.5 REFACTOR: expose the enabled check and the root as an injectable factory
      (`createTrackStore({ root })`) plus a module singleton reading `RUSHPOINT_TRACK_DIR`,
      matching `createLastFixStore` / `createRateLimiter`. Tests must drive the factory, never
      `process.env`.

## 2. Record at full fidelity (the behavior change)

- [x] 2.1 GREEN: in `updateLocation` (`functions/src/index.ts`), when the track store is
      enabled, append EVERY ping's point to disk and skip `shouldRetainTrackPoint` entirely
      (D5). When disabled, leave today's Firestore + distance-sampling path byte-for-byte
      unchanged.
- [x] 2.2 Confirm `packages/shared/src/locationPingEconomy.ts` and
      `scripts/test-location-ping-economy.ts` are UNTOUCHED — the sampling verdict still governs
      the Firestore fallback exactly as `spark-tier-location-load` left it. If either changed,
      this task is a bug.

## 3. Read it back (the heatmap)

- [x] 3.1 GREEN: in `getRunHeatmap` (`functions/src/runs/index.ts`), call `readTrackPoints()`
      first; if it returns non-null use it and SKIP the Firestore read entirely; if `null` fall
      back to today's Firestore read unchanged (D6).
- [x] 3.2 Confirm `buildMovementDensity` is called identically in both paths — the aggregator
      must not learn where its points came from.

## 4. Retention parity

- [x] 4.1 GREEN: in `pruneRunPII` (`functions/src/maintenance/index.ts`), call
      `deleteRunTrack()` alongside the existing Firestore bulk delete, best-effort. Leave
      `locationTrack` in `PII_BULK_SUBCOLLECTIONS` — Firestore-mode runs still need purging
      there (D7).
- [x] 4.2 Confirm the existing `scripts/test-*.ts` covering `PII_BULK_SUBCOLLECTIONS`
      completeness still passes — the retention list is a declared contract.

## 5. Prove it end to end

- [x] 5.1 RED then GREEN: extend `scripts/e2e-verify.mjs` — `getRunHeatmap` for a
      Firestore-mode run is unchanged from today (the fallback still works), and a run with no
      track at all still renders no cells without error.
- [x] 5.2 Assert the disk path directly in the pure lane rather than through the emulator: the
      emulator has no VPS disk topology, so drive `trackStore` + `buildMovementDensity`
      together and assert a full-fidelity track yields strictly more points than the sampled
      equivalent over the same walk.
- [x] 5.3 Document the deployment change: the new `RUSHPOINT_TRACK_DIR` env var and its volume
      mount in `docker-compose.api.yml` / `api.env.example`, following how `UPLOAD_DIR` is
      already documented.

## 6. Gates

- [x] 6.1 Run `npm run verify` and confirm ALL green. No UI changed, so i18n must add zero new
      findings.
- [x] 6.2 Run `npm run e2e` (redirect to a file and check the exit code — never pipe a gate
      through `tail` and trust the status) and confirm green.
- [x] 6.3 Run `npm run verify:emulator` and confirm green. Do not run it concurrently with
      `npm run verify` on the same working tree.
- [x] 6.4 Update `CLAUDE.md`: the new module, the new env var, and the fact that this is now the
      FIFTH module depending on the single-process precondition.
