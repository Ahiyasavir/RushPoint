## Context

`play-web` is a light-theme React PWA. Its web manifest (`apps/play-web/public/manifest.webmanifest`) is already install-grade: `standalone` display, `name`/`short_name`, theme + background colors, and — critically — both a 512 `any` icon and a 512 `maskable` icon. A service worker (`apps/play-web/public/sw.js`) provides the offline shell. The one thing standing between this and a Google Play listing is a **Trusted Web Activity (TWA)**: a thin Android wrapper that Google verifies against the web origin through a Digital Asset Links file at `/.well-known/assetlinks.json`. That file exists but is an empty `[]`, so a TWA would (a) fail origin verification and (b) render with a browser URL bar instead of full-screen. There is no Bubblewrap config, no `.aab`, and no submission runbook.

The archived `apps/mobile` Expo app is out of scope (not in workspaces; requests `ACCESS_BACKGROUND_LOCATION` → Google's strictest review tier). The realistic, low-risk path is wrapping `play-web`.

The generated code here is **build/release tooling**, not runtime or backend. It touches no callable, no Firestore doc, no security rule, no scoring/routing math. So none of the server-write-only / FIRESTORE_PATHS / answer-key-secrecy / merge-footgun constraints are in play — but the TDD and gate discipline still is.

## Goals / Non-Goals

**Goals:**
- A pure, unit-tested `@rushpoint/shared` module that (1) builds a correct Digital Asset Links payload from a package name + SHA-256 fingerprint(s), (2) validates such a payload, and (3) validates a web manifest against Play/TWA install criteria.
- A generator script that turns a real signing fingerprint into a correct `apps/play-web/public/.well-known/assetlinks.json`, replacing the broken `[]`.
- A checked-in Bubblewrap `twa-manifest.json` as the single source of truth for the wrapper.
- `play:store:check` as a submission gate that fails loudly while the web-side artifacts are not ready.
- A `PLAY_STORE.md` runbook that a non-engineer owner can follow, with every human-only step (Play Console account, keystore, upload, Data Safety, minors declaration) explicitly flagged.

**Non-Goals:**
- No `apps/mobile` revival, no iOS/App Store, no Google Play Billing (play-web has no purchase flow).
- Not *running* Bubblewrap in CI or committing a `.aab`/keystore (keystores are secret; fingerprints are environment-specific).
- Not automating account creation, `.aab` upload, or the Data Safety form — these require the owner's Google identity.

## Decisions

**1. New shared module `packages/shared/src/playStore.ts`, re-exported from `packages/shared/src/index.ts`.**
Three pure exports plus small helpers:
- `PLAY_PACKAGE_NAME = 'app.rushpoint.play'` — the canonical Android application id (reverse-DNS of `rushpoint.app`, kept as one constant so the generator, Bubblewrap config, and validator agree).
- `normalizeFingerprint(raw: string): string` — strips whitespace/colons, upper-cases, validates it decodes to exactly 32 bytes (64 hex chars), re-inserts colons every 2 chars. Throws on malformed input.
- `isValidAndroidPackageName(pkg: string): boolean` — at least two dot-separated segments, each `[a-zA-Z][a-zA-Z0-9_]*`.
- `buildAssetLinks(packageName: string, fingerprints: string[]): AssetLinkStatement[]` — returns one statement, `relation: ['delegate_permission/common.handle_all_urls']`, `target.namespace: 'android_app'`, deduped normalized fingerprints. Throws on invalid package/fingerprint/empty list.
- `validateAssetLinks(value: unknown): { ok: boolean; problems: string[] }` — non-empty array; each statement has the relation, `android_app` namespace, a valid package name, and ≥1 fingerprint.
- `validateWebManifestForPlay(manifest: unknown): { ok: boolean; missing: string[] }` — enforces name, short_name, `display ∈ {standalone, fullscreen}`, start_url, theme_color, background_color, a 512 `any` icon, a 512 `maskable` icon. Icon `sizes` parsed by splitting on whitespace and matching a `512x512` token; `purpose` parsed by splitting on whitespace (default `any` when absent, per the manifest spec).

Types (`AssetLinkStatement`) live in the same module and are exported for the script + tests.

**2. Generator `scripts/gen-assetlinks.mjs` (Node ESM, matches existing `scripts/*.mjs`).**
Reads package name (default `PLAY_PACKAGE_NAME`) and fingerprint(s) from CLI args (`--fingerprint=...`, repeatable) or `PLAY_SHA256_FINGERPRINT` env. Imports the compiled shared helpers, calls `buildAssetLinks`, `JSON.stringify(..., null, 2)`, writes to `apps/play-web/public/.well-known/assetlinks.json`. Refuses (non-zero exit) when no fingerprint is supplied, printing where to get it (`PLAY_STORE.md` §keystore). This keeps secrets out of the repo — the file is only populated when the owner runs it with their real fingerprint.

**3. Bubblewrap config `twa-manifest.json` at repo root.**
Declares `packageId: app.rushpoint.play`, `host`/`startUrl` for the production origin (`rushpoint.app` — placeholder documented in PLAY_STORE.md if the play-web origin differs), `name`/`launcherName` from the web manifest, `themeColor`/`backgroundColor`/`navigationColor` mirroring the manifest (`#F97316` / `#FBF7F0`), `iconUrl`/`maskableIconUrl` pointing at the served 512 icons, `display: standalone`, `orientation: portrait`, `signingKey` alias `rushpoint` at `android.keystore`, `appVersion`/`appVersionCode` seed. Bubblewrap is invoked via `npx @bubblewrap/cli` (no new workspace dependency — it's a one-shot tool the owner runs locally with the Android SDK/JDK present).

**4. npm scripts (root `package.json`).**
- `play:store:check` → `npx tsx scripts/check-play-store.ts` — loads the real manifest + assetlinks files, runs both validators, prints a readable report, exits non-zero on any failure. This is the automated gate. (Named `check-play-store.ts`, NOT `test-play-store.ts`, so the `run-unit-tests` aggregator doesn't pick up a file that reads the intentionally-empty assetlinks and fails the whole `npm test` lane.)
- `play:twa:init` → `npx @bubblewrap/cli init --manifest ./twa-manifest.json` (documented; needs JDK+Android SDK).
- `play:twa:build` → `npx @bubblewrap/cli build` (produces `app-release-bundle.aab`).

**5. `PLAY_STORE.md` runbook** — ordered, with a clear **🔴 HUMAN STEP** marker on: Play Console account ($25), `keytool`/Bubblewrap keystore generation and how to read the SHA-256 fingerprint, running `gen-assetlinks` + deploying the updated file, `.aab` upload, Data Safety form answers (map to the Privacy Policy we just hardened — location, photos, crash reports/Sentry, no sale/share), and the **Families / target-audience declaration** because guardian-consent minor participants are a real audience.

## Test Strategy

- **Pure logic (primary):** `scripts/test-play-store.ts` — a tsx assertion script in the existing `scripts/test-*.ts` style (auto-discovered by `scripts/run-unit-tests.mjs`, so it runs under `npm test` and can never silently rot). Written **RED first**: assertions for `buildAssetLinks` (single/multi/dedup fingerprints, namespace, relation), `normalizeFingerprint` (colon/lowercase normalization + reject non-32-byte), `isValidAndroidPackageName`, `validateAssetLinks` (empty `[]` → invalid; missing relation/namespace/fingerprints → invalid; generated payload → valid), and `validateWebManifestForPlay` (missing maskable → fail; `display: browser` → fail; a fixture mirroring the real play-web manifest → pass). Confirm all fail against an empty module, then implement `playStore.ts` to green.
- **Real-file guard:** `scripts/test-play-store.ts` also imports and parses the actual `apps/play-web/public/manifest.webmanifest` and asserts `validateWebManifestForPlay` passes on it — so a future manifest regression (e.g. dropping the maskable icon) fails the unit lane.
- **Command behavior:** `check-play-store.ts` is exercised manually / documented; its two states (empty assetlinks → non-zero, valid → zero) are the two spec scenarios. It is not added to `npm test` (it is designed to fail while assetlinks is legitimately empty pre-signing).
- **No UI, no i18n:** nothing user-facing changes, so `i18n:check` is N/A. No emulator, no e2e callable added.
- **Gates:** `npm run typecheck` (shared + scripts), `npm test` (new pure-logic file green), `npm run play:build` (manifest/static assets still build), `npm run lint`. The generated `assetlinks.json` stays `[]` in the repo until a real fingerprint exists — `play:store:check` is expected to report it as not-ready until then, which is the correct signal, not a gate failure.

## Risks / Trade-offs

- **Origin mismatch:** if `play-web` is served from a path or subdomain other than `rushpoint.app` root, both the `twa-manifest.json` `host`/`startUrl` and the deployed `assetlinks.json` location must match exactly or verification silently fails (URL bar shows). Mitigated by documenting the origin as the one value to confirm in `PLAY_STORE.md`, and by `play:store:check` validating the file *content* (the *location* is a deploy concern the runbook calls out).
- **Fingerprint source of truth:** Play App Signing re-signs the app, so the *effective* production fingerprint is the Play-managed key, not the local upload key. The generator accepts multiple fingerprints precisely so both can be listed; `PLAY_STORE.md` instructs adding the Play-managed fingerprint after the first upload. Risk: an owner lists only the upload key and deep links fail post-Play-signing — mitigated by an explicit callout.
- **Bubblewrap toolchain:** `play:twa:init`/`build` need a JDK + Android SDK locally; they are not CI-wired and not gate-blocking. Trade-off accepted: keeping the `.aab`/keystore out of the repo (security) is worth the manual local build.
- **Minors policy:** Google's Families policy is global and stricter than the Israeli-law framing in our Privacy Policy. The runbook flags the target-audience declaration as a decision the owner must make deliberately; getting it wrong risks removal. This is documentation, not something code can enforce.
