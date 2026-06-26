# Design — play-web store readiness

## Current behavior (authoritative refs)

- `apps/play-web/public/manifest.webmanifest` declares one icon: `{ "src": "/icon.svg",
  "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }`. Theme `#F97316`,
  background `#FBF7F0`, `display: standalone`, `orientation: portrait`.
- `apps/play-web/public/icon.svg` — 64×64 viewBox brand mark (dark rounded-rect bg `#0B0F17`,
  cyan ring `#22D3EE`, amber pointer `#F59E0B`).
- `apps/play-web/public/sw.js` caches an app shell incl. `/manifest.webmanifest` and `/icon.svg`.
- No raster icons exist; no image library is installed (`package.json` has `ajv` but no `sharp`).
- Pure-logic tests are plain `tsx` assertion scripts under `scripts/test-*.ts`, auto-discovered by
  `scripts/run-unit-tests.mjs` and run by `npm test`. Style: `check(label, cond)` + `process.exit`.

## Icon visual design spec — premium redesign ("Velocity Compass")

> **Decision:** the current `icon.svg` is a flat, hobby-grade compass (a thin cyan ring + a static
> amber triangle on near-black). That does **not** earn a tap on a crowded home screen. This change
> **redesigns the brand mark** into a modern, app-store-grade icon and makes the redesigned SVG the
> single source of truth that the generator rasterizes. The mark stays a compass (the navigation
> metaphor fits the race), but is elevated with the techniques premium 2026 app icons use: a rich
> multi-stop gradient, a glossy light dome for depth, a baked glow halo, and a **dynamic
> forward-leaning needle** that reads as *motion / speed*, not a static north pointer.

### Design concept

An energetic, glowing compass whose needle leans forward like it's mid-race. It should feel **fun,
fast, and premium** — inviting for the social-game audience (bar-mitzvah / youth events) while still
looking like a polished product, not a toy.

**Design principles applied (why each is here):**
- **Vibrant gradient background, not flat** — modern icons (iOS/Android 2024+) read as gradients;
  flat fills look dated and recede. A warm amber→ember gradient matches the brand `theme_color`
  (`#F97316`) and pops against the mostly-light/blue icons on a typical home screen.
- **Glossy dome highlight** — a top radial light overlay gives a subtle 3D, "glass-button" depth
  that signals craft. (Baked as a radial gradient, not a CSS/blur effect — see rasterizer note.)
- **Glow halo behind the mark** — a soft cyan ring of light makes the compass feel illuminated and
  draws the eye to center. Baked as concentric-opacity radial gradient (blur filters don't rasterize
  reliably across engines — see note).
- **Dynamic, forward-leaning needle (38°)** — a static north arrow is inert. Tilting the needle and
  adding a cyan **speed arc** conveys momentum, differentiating from every generic compass icon.
- **Single bold focal point** — recognizable at 48 px (the smallest launcher size). No text, no fine
  detail that mushes when downscaled.
- **Brand-true palette** — keeps the identity colors (navy hub `#0B0F17`, cyan `#22D3EE`, warm
  amber/orange) so it ties to the play-web "Warm Trail" theme and the manifest `theme_color`.

### The source SVG (authored at a 512 viewBox — the apply phase writes this verbatim)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Warm energetic base gradient (matches brand theme_color #F97316) -->
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FCA855"/>
      <stop offset="0.45" stop-color="#F97316"/>
      <stop offset="1" stop-color="#DC4F08"/>
    </linearGradient>
    <!-- Glossy top-dome highlight → depth -->
    <radialGradient id="gloss" cx="256" cy="150" r="300" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <!-- Soft cyan glow halo (baked as opacity ramp, NOT a blur filter) -->
    <radialGradient id="halo" cx="256" cy="256" r="170" gradientUnits="userSpaceOnUse">
      <stop offset="0.70" stop-color="#22D3EE" stop-opacity="0"/>
      <stop offset="0.86" stop-color="#22D3EE" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#22D3EE" stop-opacity="0"/>
    </radialGradient>
    <!-- Needle vertical shading → 3D dimensionality -->
    <linearGradient id="needle" x1="256" y1="120" x2="256" y2="392" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#FFE3C2"/>
    </linearGradient>
  </defs>

  <!-- Full-bleed background (OS masks corners for adaptive icons) -->
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#gloss)"/>

  <!-- Glow halo + track ring + cyan speed arc -->
  <circle cx="256" cy="256" r="150" fill="url(#halo)"/>
  <circle cx="256" cy="256" r="132" fill="none" stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="10"/>
  <path d="M 256 124 A 132 132 0 0 1 388 256" fill="none" stroke="#22D3EE" stroke-width="10" stroke-linecap="round"/>

  <!-- Dynamic forward-leaning needle (motion) -->
  <g transform="rotate(38 256 256)">
    <path d="M256 132 L286 256 L256 286 L226 256 Z" fill="url(#needle)"/>           <!-- north blade -->
    <path d="M256 380 L286 256 L256 286 L226 256 Z" fill="#0B0F17" fill-opacity="0.35"/> <!-- south tail -->
  </g>

  <!-- Center hub -->
  <circle cx="256" cy="256" r="20" fill="#0B0F17"/>
  <circle cx="256" cy="256" r="9" fill="#22D3EE"/>
</svg>
```

### Why one artwork serves both `any` and `maskable` (safe-zone math)

The Android adaptive-icon **safe zone** is the inner circle of radius `0.66 × 256 ≈ 169 px`. Every
element of the mark sits inside it: the track ring is `r=132`, the speed arc and needle tip reach
`r≈132`, the halo fades by `r≈150`. So the **same full-bleed artwork is both the `any` and the
`maskable` source** — masking only trims the gradient background, never the mark. No separate
scaled-down maskable layout is needed (the old "render at 64%" plan is superseded — it would have
left the maskable icon looking tiny and timid).

### Rendering rules per variant (the generator's job)

| Output | Size | Corners | Source |
|---|---|---|---|
| `icon-512-maskable.png` (`maskable`) | 512×512 | **square, full-bleed** (OS clips) | the SVG as-is |
| `icon-512.png` (`any`) | 512×512 | **squircle** — composite a rounded-rect mask, `rx ≈ 112` (~22%) | the SVG + corner mask |
| `icon-192.png` (`any`) | 192×192 | squircle, `rx ≈ 42` (~22%) | downscaled SVG + corner mask |

The `any` variants get baked-in squircle corners so they look like a finished app icon where the OS
**doesn't** mask (Android legacy launchers, the PWA install chip, favicons). iOS ignores baked
corners and applies its own squircle mask to `apple-touch-icon`, so a full square is safe there too.

### Rasterizer-safe constraints (hard requirements on the SVG)

`sharp` rasterizes SVG via **resvg/librsvg** — it renders `linearGradient`, `radialGradient`,
`stroke`, `fill-opacity`, and `transform` reliably, but **does NOT reliably render SVG filter
primitives** (`feGaussianBlur`, `feDropShadow`, `feColorMatrix`). Therefore:
- **No `<filter>` elements.** Every "glow"/"depth" effect is achieved with **layered gradients and
  opacity ramps** (the `gloss` dome, the `halo`), which rasterize identically everywhere.
- Soft edges come from gradient stops, not blur.
- No external font / image references — fully self-contained vector primitives.

This is why the design above looks rich but uses **zero filters** — it's engineered to survive
server-side rasterization byte-for-byte.

### Color tokens

| Token | Hex | Used for |
|---|---|---|
| Gradient light | `#FCA855` | background top-left |
| Gradient mid (brand) | `#F97316` | background middle = manifest `theme_color` |
| Gradient ember | `#DC4F08` | background bottom-right |
| Cyan | `#22D3EE` | glow halo, speed arc, hub core |
| Hub navy | `#0B0F17` | center hub, needle tail |
| Needle | `#FFFFFF`→`#FFE3C2` | the forward blade (shaded) |
| Splash bg (manifest) | `#FBF7F0` | manifest `background_color` (unchanged) |

### Visual acceptance (human check after `npm run icons`)

- On a real phone home screen the icon **stands out** — warm glow, clear glowing compass, sense of
  motion. Recognizable shrunk to ~48 px.
- Maskable: render it through [maskable.app](https://maskable.app) — the mark stays fully inside the
  circle/squircle/teardrop crops with no clipping of the ring, arc, or needle.
- `any`: visible squircle corners; no hard square edges on a light home screen.
- No banding in the gradient, no aliasing on the needle tip or arc cap at 192 px.

> The automated `test-manifest.ts` proves **structure** (sizes, purposes, files exist, SW-cached).
> The *aesthetic* quality above is verified by the human visual check — it can't be unit-tested, so
> it's an explicit acceptance gate in `tasks.md`.

## Files to touch

| File | Change |
|---|---|
| `apps/play-web/public/icon.svg` | **redesigned** — replace the flat hobby mark with the "Velocity Compass" source SVG above (gradient bg + gloss dome + glow halo + dynamic needle). This is the single source of truth. |
| `scripts/gen-pwa-icons.mjs` | **new** — rasterize the redesigned `icon.svg` via `sharp`: `icon-512-maskable.png` (full-bleed square), `icon-512.png` + `icon-192.png` (composite a squircle rounded-rect mask, `rx ≈ 22%`). No SVG `<filter>` usage (resvg-safe — all depth via gradients). |
| `apps/play-web/public/icon-192.png` | **new** — generated, committed. |
| `apps/play-web/public/icon-512.png` | **new** — generated, committed. |
| `apps/play-web/public/icon-512-maskable.png` | **new** — generated, committed. |
| `apps/play-web/public/manifest.webmanifest` | split icons into 3 entries; `192 any`, `512 any`, `512 maskable`. Keep `icon.svg` as an extra `any` entry (modern browsers prefer it). |
| `apps/play-web/index.html` | ensure `<link rel="icon">` + `<link rel="apple-touch-icon" href="/icon-192.png">` + `<meta name="theme-color" content="#F97316">`. |
| `apps/play-web/public/sw.js` | add the three PNGs + the maskable to the cached `SHELL` array so they're available offline (and don't 404 the install). |
| `apps/play-web/public/.well-known/assetlinks.json` | **new placeholder** — empty `[]` with a comment header; real entry added post-domain (runbook). |
| `scripts/test-manifest.ts` | **new TDD test** (see strategy). |
| `package.json` (root) | add `sharp` devDep; add `"icons": "node scripts/gen-pwa-icons.mjs"` script. |
| `apps/play-web/STORE.md` | **new** runbook: domain → Hosting → assetlinks → bubblewrap → Play; iOS/Capacitor appendix. |

## Test strategy (TDD — proves the change)

This is **pure logic / filesystem assertion**, no emulator. New `scripts/test-manifest.ts`
(tsx, auto-picked by `run-unit-tests.mjs`), matching the `check(label, cond)` style. It asserts:

1. **Manifest parses** as JSON and has required installability fields: `name`, `short_name`,
   `start_url`, `display` (`standalone`/`fullscreen`/`minimal-ui`), `icons` (non-empty),
   `theme_color`, `background_color`.
2. **Icon set is store-valid**: there is ≥1 PNG icon `192×192`, ≥1 PNG icon `512×512` with a
   `purpose` containing `any`, and ≥1 PNG icon `512×512` with a `purpose` containing `maskable`.
3. **No single icon carries both** `any` *and* `maskable` in one `purpose` string (the original bug).
4. **Every declared icon `src` exists on disk** under `apps/play-web/public/` and, for PNGs, the
   real pixel dimensions (parsed from the PNG **IHDR** chunk — bytes 16–24, big-endian) **equal the
   declared `sizes`**. No image library needed; we read the 24-byte PNG header directly.
5. **No declared icon 404s the SW**: every icon `src` is present in `sw.js`'s `SHELL` array.

Test #4's PNG-dimension parse is the key TDD lever: the test fails RED before the generator exists
(files missing), and the manifest-vs-actual-size check fails if a future edit declares a wrong size.

A helper `readPngSize(path)` (8-byte signature check + IHDR width/height) lives inline in the test;
if reused later it can graduate to `packages/shared`. Pure, deterministic, no network.

## Conventions / footguns respected

- **No server state, no callables, no Firestore writes** — manifest/icons are static assets; rules
  untouched, no new index, no env var.
- `sharp` is **devDependency only** (build-time rasterizer) — it never ships in the client bundle,
  so the lazy-load/bundle-budget rules are unaffected.
- Generated PNGs are **committed** (not built on deploy) so Firebase Hosting and bubblewrap get them
  without a build step, and the test can assert against real bytes.
- `assetlinks.json` stays a placeholder: its real content (package name + signing SHA-256) is
  unknowable until the domain is bought and the AAB is signed — documented in `STORE.md`, not faked.

## Post-domain runbook (documented, out of scope to execute)

1. Buy domain → point at **Firebase Hosting** (`firebase deploy --only hosting:play`) → free HTTPS.
2. Generate the Play upload key; read its SHA-256; write `public/.well-known/assetlinks.json`.
3. `npx @bubblewrap/cli init --manifest https://<domain>/manifest.webmanifest` → `build` → AAB.
4. Play Console ($25 one-time) → upload AAB → Digital Asset Links verified → internal-testing track.
5. **iOS (later change):** `npx cap init` + `cap add ios`, build in Xcode on a Mac, Apple Developer
   Program ($99/yr); verify Firebase anonymous auth + MapLibre render inside WKWebView.
