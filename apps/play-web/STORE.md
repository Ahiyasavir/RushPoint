# Play Store readiness — RushPoint participant app (PWA → TWA)

`apps/play-web` is an installable PWA. This runbook turns it into a **Trusted Web Activity**
(TWA) on the Google Play Store. No game/run/scoring logic is involved — only static
assets + signing/hosting config that depends on a purchased domain.

## What already ships in the repo

- **Installable manifest** — `public/manifest.webmanifest` with store-grade icons:
  `icon-192.png` (192, `any`), `icon-512.png` (512, `any`, squircle), `icon-512-maskable.png`
  (512, `maskable`, full-bleed). No `any maskable` mix.
- **Single source of truth** — `public/icon.svg` (the "Velocity Compass" mark). Regenerate the
  PNGs reproducibly with **`npm run icons`** (`scripts/gen-pwa-icons.mjs`, uses `sharp`).
- **Offline-cached** — all icons are in the service-worker `SHELL` (`public/sw.js`, cache `-v2`).
- **Contract test** — `scripts/test-manifest.ts` (in `npm test`) asserts the manifest is valid,
  every declared icon exists at its declared pixel size, and all are SW-cached.
- **Asset-links placeholder** — `public/.well-known/assetlinks.json` (`[]`). Its real content is
  filled in step 2 below; it cannot be authored until the domain + signing key exist.

## Post-domain runbook (out of scope to execute here)

1. **Domain + hosting.** Buy a domain, point it at **Firebase Hosting**
   (`firebase deploy --only hosting:play`) for free HTTPS. TWA requires a real HTTPS origin.
2. **Digital Asset Links.** Generate the Play upload/signing key, read its SHA-256 fingerprint,
   and write `public/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "app.rushpoint.play",
       "sha256_cert_fingerprints": ["<YOUR:SIGNING:KEY:SHA256>"]
     }
   }]
   ```
   Re-deploy so it is served at `https://<domain>/.well-known/assetlinks.json`.
3. **Wrap with bubblewrap.**
   `npx @bubblewrap/cli init --manifest https://<domain>/manifest.webmanifest` → `bubblewrap build`
   → produces a signed `.aab`. The icons declared in the manifest become the Android launcher icons.
4. **Play Console.** One-time $25 registration → upload the `.aab` → Google verifies the Digital
   Asset Links → release to the internal-testing track first, then production.

## iOS appendix (a later, separate change)

iOS has no TWA equivalent; wrap the same PWA with **Capacitor**:
`npx cap init` + `npx cap add ios`, build in Xcode on a Mac, enrol in the Apple Developer Program
($99/yr). Verify Firebase anonymous auth and the MapLibre render inside `WKWebView` before submitting.

## Visual acceptance (human gate)

Automated tests prove **structure** only. Before shipping, confirm the icon **aesthetics**:
run `public/icon.svg` / the PNGs through [maskable.app](https://maskable.app) — the ring, speed
arc, and needle must stay inside every crop with no clipping — and check it looks attractive and
recognizable shrunk to ~48 px on a real home screen.
