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
- [ ] `npx tsx scripts/test-functions-shared-bundle.ts` passes; and it goes RED if the
      `prebuild` is removed (spot-check by temporarily deleting it).

## 6. TDD — e2e reachability scenario
- [ ] Add "gallery reachability" scenario to `scripts/e2e-verify.mjs`: publish a game with
      a tag + located + locationless mission; assert reachable via searchGallery (text /
      tag / mode+sort) and searchTaskLibrary (tag / type+hasLocation); getPopularTags no
      throw.
- [ ] `node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"` → the new scenario is
      GREEN and the callable-coverage guard stays satisfied.

## 7. Gates
- [ ] `npm run verify` (typecheck · lint · test · builds · bundle · base · i18n) green.
- [ ] `npm run e2e` (under emulator-exec) green end to end.
- [ ] Commit + push. The auto-deploy host self-heals on its next poll (the direct
      functions build now rebuilds shared first); no supervisor restart required.
