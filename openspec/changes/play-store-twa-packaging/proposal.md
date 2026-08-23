## Why

RushPoint's participant app (`play-web`) is a PWA, but the only way onto Google Play for a PWA is a Trusted Web Activity (TWA) — a thin native wrapper Google verifies against the web origin via a Digital Asset Links file. That verification file already exists at `apps/play-web/public/.well-known/assetlinks.json` but is an empty `[]`, so any TWA build would show the browser URL bar instead of running full-screen and would fail Play's origin check. There is no `.aab`, no Bubblewrap config, and no submission checklist. The archived `apps/mobile` Expo app requests `ACCESS_BACKGROUND_LOCATION` (Google's strictest review tier) and is not maintained — so the realistic, low-risk path to Play is wrapping `play-web`, not reviving native.

## What Changes

- **New pure-logic capability `play-store-packaging`** in `@rushpoint/shared`: functions that build and validate the Digital Asset Links (`assetlinks.json`) payload from a package name + SHA-256 signing-cert fingerprint, and a validator that asserts a web manifest meets TWA/Play install requirements (name, `short_name`, `standalone` display, a 512px `any` icon **and** a 512px `maskable` icon, `start_url`, colors). All deterministic and unit-testable with no emulator.
- **A Bubblewrap `twa-manifest.json`** config (checked in) that declares the package id `app.rushpoint.play`, the launch origin, launcher name, colors sourced from the existing web manifest, and the signing-key alias — the single source of truth Bubblewrap reads to produce the `.aab`.
- **A generator script** (`scripts/gen-assetlinks.mjs`) that takes a package name + fingerprint (arg/env) and writes a correct `apps/play-web/public/.well-known/assetlinks.json`, replacing the broken empty `[]`.
- **Three npm scripts**: `play:store:check` (runs the manifest + assetlinks validators as a pre-submission gate), `play:twa:init` (scaffolds/refreshes the Bubblewrap project), `play:twa:build` (produces the `.aab`).
- **A `PLAY_STORE.md` submission checklist** covering the full path to a live listing, with the human-only steps clearly flagged: the one-time $25 Play Console account, keystore generation (which produces the real fingerprint fed to the generator), `.aab` upload, the Data Safety form, and the **minors / target-audience declaration** (the app supports guardian-consent minor participants, which triggers Google's Families policy).

## Capabilities

### New Capabilities
- `play-store-packaging`: deterministic generation + validation of the Google Play TWA artifacts — the Digital Asset Links payload and the web-manifest install-readiness check — that gate a correct, verifiable submission.

### Modified Capabilities
<!-- None. No existing spec's requirements change; no callable, Firestore, or scoring behavior is altered. -->

## Impact

- **New files:** `packages/shared/src/playStore.ts` (+ export from `packages/shared/src/index.ts`); `scripts/test-play-store.ts` (pure-logic TDD, auto-run by `npm test`); `scripts/gen-assetlinks.mjs`; `twa-manifest.json`; `PLAY_STORE.md`.
- **Modified files:** `apps/play-web/public/.well-known/assetlinks.json` (empty `[]` → real payload, written by the generator once a fingerprint exists); root `package.json` (three new scripts).
- **No backend/runtime impact:** no callable, no Firestore rule, no scoring/routing change; nothing server-write-only is touched. The `play-web` runtime bundle is unchanged (assetlinks is a static file served from `/.well-known/`).
- **Non-goals:**
  - Not reviving or shipping the archived `apps/mobile` Expo app (stays out of workspaces).
  - Not adding Google Play Billing / in-app purchases — `play-web` has no purchase flow (credits/Pro live only in `creator-web`), so Play's billing cut does not apply.
  - Not creating a Play Console account, generating the keystore, uploading the `.aab`, or filling the Data Safety form — these require the owner's Google account and are documented as human steps, not automated.
  - Not an App Store (iOS) submission.
