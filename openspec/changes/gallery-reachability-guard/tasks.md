# Tasks — gallery-reachability-guard (TDD: RED → GREEN)

## 1. Reproduce + confirm the code is correct (not a logic bug)
- [x] Run `searchGallery`/`searchTaskLibrary` against a freshly-built emulator via the
      e2e harness → they return normally (no INTERNAL). Confirms the outage is a stale
      shared bundle at deploy time, not a code defect.

## 2. Fix: functions can never inline a stale shared
- [x] Add `prebuild` to `functions/package.json` that builds `@rushpoint/shared` first
      (`npm --prefix ../packages/shared run build`). No dependency change (npm ci safe).
- [x] Verify a clean `npm run build --workspace=functions` runs shared's tsc first and the
      emitted `lib/index.js` now contains `applyGalleryFacets` (was `undefined`).

## 3. Fix: auto-deploy build order
- [x] `scripts/playtest-forever.mjs` `buildProd()` rebuilds shared before the functions
      compile-gate; a shared-build failure skips the launch and retries.

## 4. Fix: friendly client error
- [x] `GalleryPage` catch shows localized `t.gallery.searchFailed`; logs the real error.

## 5. TDD — build-integrity guard (pure, in `npm test`)
- [x] `scripts/test-functions-shared-bundle.ts`: functions declares shared; shared is
      bundled not `--external`; the build rebuilds shared before esbuild. Source-only.
- [x] Verified RED→GREEN: fails (exit 1) with `prebuild` removed, passes (4/4) with it.

## 6. TDD — e2e reachability scenario
- [x] Added "gallery reachability" scenario to `scripts/e2e-verify.mjs`: publish a game
      with a tag + located + locationless mission; assert reachable via searchGallery
      (text / tag / mode+sort) and searchTaskLibrary (tag / type+hasLocation);
      getPopularTags no throw.
- [x] `node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"` → GREEN: 9/9 checks,
      0 failures suite-wide; callable-coverage guard stays satisfied.

## 7. Gates
- [x] `npm run verify` (typecheck · lint · test · builds · bundle · base · i18n) green
      (includes the new build guard).
- [x] `npm run e2e` (under emulator-exec) green end to end (exit 0, twice).
- [x] Commit + push (c43dea6, a81c9a6, ac47d63, 7468845, ed2e1ff). The auto-deploy host
      self-heals on its next poll (the direct functions build now rebuilds shared first);
      no supervisor restart required.
