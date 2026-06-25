# Proposal — play-web store readiness (PWA → TWA / Play Store)

## Why

`apps/play-web` is already a PWA (service worker + offline shell + manifest), but it is **not
installable to store standards**. The manifest points at a single `icon.svg` with a conflicting
`"any maskable"` purpose and no raster icons. As a result:

- Lighthouse's *Installable PWA* audit fails (no 192px / 512px PNG icon).
- `bubblewrap` (the Google tool that wraps a PWA into a Trusted Web Activity APK/AAB) cannot build
  — it requires real PNG icons at declared sizes.
- Android adaptive icons need a dedicated **maskable** asset with a safe zone; one SVG flagged
  `any maskable` is rejected by stricter validators and crops badly on round launchers.

This change makes the participant app **installable to Google Play store standards via TWA**, and
lays the groundwork for a later iOS Capacitor wrapper — without touching any game/run/scoring logic.

## What Changes

> Observable behavior — no game/run/scoring logic is touched.

- The participant PWA becomes **installable** (Chrome "Install app" prompt fires; Lighthouse PWA
  installability passes) on a real HTTPS origin.
- The brand mark is **redesigned** from the flat hobby compass into a modern, store-grade
  "Velocity Compass" icon (rich warm gradient, glossy depth, cyan glow halo, a dynamic
  forward-leaning needle that reads as motion) — engineered filter-free so it rasterizes cleanly.
  It must be attractive enough to earn a tap on a crowded home screen, not just technically valid.
- The web manifest declares proper raster icons: `192×192` and `512×512` (`purpose: any`) plus a
  `512×512` **maskable** icon, generated reproducibly from the redesigned `icon.svg`.
- A repeatable icon-generation script exists so the redesigned mark stays the single source of truth.
- A **TDD test** asserts the manifest is valid and installable (required fields present, every
  declared icon file exists on disk at its declared pixel size, purposes correct) — wired into
  `npm test` so the contract can never silently rot.
- A short, committed runbook documents the post-domain steps (Firebase Hosting deploy →
  `assetlinks.json` → bubblewrap → Play Console) so buying the domain is unblocked work, not research.

## Capabilities

### New Capabilities
- `pwa-installability`: the participant PWA is installable to store standards (valid manifest +
  192/512/512-maskable PNG icons, no `any maskable` conflict), and the redesigned "Velocity Compass"
  brand mark rasterizes filter-free and reproducibly from a single source SVG.

### Modified Capabilities
<!-- None — introduced as a new capability; becomes the baseline at archive time. -->

## Surfaces touched

- **play-web only**: `apps/play-web/public/manifest.webmanifest`, new PNG icons under
  `apps/play-web/public/`, `apps/play-web/index.html` (icon `<link>` tags).
- **scripts/**: new `scripts/gen-pwa-icons.mjs` (generator) + `scripts/test-manifest.ts` (TDD lane).
- **Tooling**: add `sharp` as a root devDependency (SVG→PNG rasterizer) — no runtime dep.
- **Docs**: new `apps/play-web/STORE.md` runbook.
- **No callable, no shared types, no Firestore rules, no game logic** are touched.

## Non-goals

- **No iOS build** in this change. Capacitor wrapping is scoped/documented only (follow-up change).
- **No `assetlinks.json` content** is finalized — it requires the purchased domain + the signing-key
  SHA-256 fingerprint, neither of which exists yet. We add the `.well-known/` placeholder + runbook.
- **No actual Play Console submission**, no domain purchase, no Firebase Hosting config change.
- **No push notifications, no native camera bridge** — TWA keeps the existing web capabilities.
- **No creator-web changes** — this is the participant app only.
