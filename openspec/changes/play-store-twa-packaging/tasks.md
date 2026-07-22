## 1. RED — failing pure-logic tests

- [x] 1.1 Create `scripts/test-play-store.ts` in the existing `scripts/test-*.ts` style (check/PASS-FAIL harness, `process.exit`), importing the not-yet-existing helpers from `../packages/shared/src/playStore`. Encode assertions for: `buildAssetLinks` (single fingerprint → one statement with correct relation/namespace/package; two fingerprints → deduped in one statement); `normalizeFingerprint` (lowercase + colon-less input → canonical uppercase colon-separated; non-32-byte input → throws); `isValidAndroidPackageName` (accepts `app.rushpoint.play`, rejects `foo`/empty); `validateAssetLinks` (empty `[]` → `ok:false`; statement missing relation/namespace/fingerprints → `ok:false` with named problem; generated payload → `ok:true`); `validateWebManifestForPlay` (missing maskable icon → fail; `display:'browser'` → fail; a fixture object mirroring the real manifest → pass).
- [x] 1.2 Add to `scripts/test-play-store.ts` a real-file assertion: read + `JSON.parse` `apps/play-web/public/manifest.webmanifest` and assert `validateWebManifestForPlay` returns `ok:true` on it (guards against a future manifest regression).
- [x] 1.3 Run `npx tsx scripts/test-play-store.ts` and confirm it FAILS for the right reason (module `playStore` not found / exports undefined), not a syntax error.

## 2. GREEN — implement the shared module

- [x] 2.1 Create `packages/shared/src/playStore.ts` with: `PLAY_PACKAGE_NAME` constant (`app.rushpoint.play`); `AssetLinkStatement` type; `normalizeFingerprint`; `isValidAndroidPackageName`; `buildAssetLinks`; `validateAssetLinks`; `validateWebManifestForPlay` — implemented per design.md (icon `sizes`/`purpose` token parsing, `display ∈ {standalone,fullscreen}`, default `purpose:'any'` when absent).
- [x] 2.2 Re-export everything from `packages/shared/src/index.ts`.
- [x] 2.3 Run `npx tsx scripts/test-play-store.ts` and confirm ALL assertions pass. Run `npm run shared:build` and confirm the module compiles into `dist`.

## 3. REFACTOR

- [x] 3.1 Tidy `playStore.ts` — dedupe validation branches, add doc comments explaining the Google Asset Links + TWA install requirements each check enforces, ensure no `any` leaks in exported signatures. Re-run the test to confirm still green.

## 4. Generator + pre-submission check + npm scripts

- [x] 4.1 Create `scripts/gen-assetlinks.mjs` — reads package (default `PLAY_PACKAGE_NAME`) + `--fingerprint=` (repeatable) / `PLAY_SHA256_FINGERPRINT` env, imports built shared helpers, writes `apps/play-web/public/.well-known/assetlinks.json` via `buildAssetLinks` (pretty JSON). Exit non-zero with a pointer to `PLAY_STORE.md` when no fingerprint is supplied. Do NOT overwrite the file during this change (no real fingerprint yet — it stays `[]`).
- [x] 4.2 Create `scripts/check-play-store.ts` — load the real `manifest.webmanifest` + `.well-known/assetlinks.json`, run both validators, print a readable report, exit non-zero on any failure. Confirm it currently exits non-zero (assetlinks is `[]`) with the expected "no statements" message.
- [x] 4.3 Add root `package.json` scripts: `play:store:check` (`npx tsx scripts/check-play-store.ts`), `play:twa:init` (`npx @bubblewrap/cli init --manifest ./twa-manifest.json`), `play:twa:build` (`npx @bubblewrap/cli build`).

## 5. Bubblewrap config + runbook

- [x] 5.1 Create `twa-manifest.json` at repo root per design.md (packageId `app.rushpoint.play`, host/startUrl for the production origin, name/launcherName, theme `#F97316` / background `#FBF7F0`, icon + maskable icon URLs, standalone, portrait, signing-key alias `rushpoint`, appVersion seed).
- [x] 5.2 Create `PLAY_STORE.md` — ordered submission runbook. Mark **🔴 HUMAN STEP** on: Play Console account ($25), keystore generation via Bubblewrap/`keytool` + reading the SHA-256 fingerprint, running `npm run play:store:check` + `node scripts/gen-assetlinks.mjs --fingerprint=...` + redeploying the file, `.aab` upload, adding the Play-managed app-signing fingerprint after first upload, Data Safety form (mapped to the Privacy Policy: location, photos, crash reports/Sentry, no sale/share), and the Families / target-audience declaration (guardian-consent minor participants). Cross-link `apps/creator-web/src/pages/LegalPage.tsx` privacy sections.

## 6. Gates

- [x] 6.1 Run `npm run typecheck`, `npm test` (confirm `test-play-store.ts` green in the aggregator), `npm run play:build`, `npm run lint` — all green. (No UI change → `i18n:check` N/A; no callable → no e2e change.) Confirm `npm run play:store:check` reports assetlinks as not-ready (expected, pre-signing) and the manifest as ready.
