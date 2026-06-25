# Tasks — play-web store readiness (RED → GREEN → REFACTOR)

> Strict TDD. Do tasks **in order**. The first task writes a failing test; production assets follow.

## RED — write the failing test first

- [ ] **1. Write `scripts/test-manifest.ts` and confirm it FAILS for the right reason.**
  - Mirror the `scripts/test-geo-validation.ts` style: `check(label, cond, detail)` + `process.exit`.
  - Read `apps/play-web/public/manifest.webmanifest`; assert required installability fields
    (`name`, `short_name`, `start_url`, `display` ∈ standalone/fullscreen/minimal-ui, non-empty
    `icons`, `theme_color`, `background_color`).
  - Assert the icon set: a PNG `192×192`; a PNG `512×512` with `purpose` ⊇ `any`; a PNG `512×512`
    with `purpose` ⊇ `maskable`; and that **no** single icon mixes `any`+`maskable` in one purpose.
  - For every declared icon `src`, assert the file exists under `apps/play-web/public/`, and for
    `.png` parse the **IHDR** (inline `readPngSize`: verify 8-byte PNG signature, read width/height
    as big-endian uint32 at offsets 16 & 20) and assert dimensions == declared `sizes`.
  - Assert every icon `src` appears in `sw.js`'s `SHELL` array.
  - **Run `npx tsx scripts/test-manifest.ts` → it MUST fail** (icons missing + `any maskable` mixed).
    Record that it fails for the expected reasons before writing any asset.

## GREEN — make it pass with the minimum assets

- [ ] **2. Redesign the source `icon.svg`** to the "Velocity Compass" mark (see design.md → *The
  source SVG*). Replace `apps/play-web/public/icon.svg` with the gradient/gloss/halo/dynamic-needle
  artwork verbatim. **Filter-free** (resvg-safe). Open it in a browser to confirm it renders as
  intended before generating rasters.

- [ ] **3. Add the icon generator + `sharp` devDep.**
  - `npm i -D sharp` at the root; add `"icons": "node scripts/gen-pwa-icons.mjs"` to root scripts.
  - Write `scripts/gen-pwa-icons.mjs`: rasterize the redesigned `icon.svg` →
    `icon-512-maskable.png` (512, full-bleed square), `icon-512.png` (512, squircle mask `rx≈112`),
    `icon-192.png` (192, squircle mask `rx≈42`). The squircle mask is a composited rounded-rect.
    Run `npm run icons`; confirm 3 PNGs land in `public/`.
  - **Visual acceptance gate** (can't be unit-tested): on a phone/emulated home screen the icon must
    look attractive and modern (warm glow, motion, depth); run the maskable through maskable.app and
    confirm no clipping of ring/arc/needle. Do not proceed until it looks store-grade.

- [ ] **5. Fix the manifest.**
  - Replace the single `"any maskable"` SVG entry with: `{192 png, any}`, `{512 png, any}`,
    `{512 png, maskable}`, and keep `{icon.svg, any}` as an extra entry. Keep theme/bg/display.

- [ ] **6. Wire icons into the shell.**
  - `apps/play-web/index.html`: `<link rel="icon">`, `<link rel="apple-touch-icon" href="/icon-192.png">`,
    `<meta name="theme-color" content="#F97316">`.
  - `apps/play-web/public/sw.js`: add the three PNGs to the `SHELL` array (bump `CACHE` to `-v2`).

- [ ] **7. Run `npx tsx scripts/test-manifest.ts` → it MUST now PASS.** Confirm via the aggregator
  that `node scripts/run-unit-tests.mjs` auto-discovers and runs it green.

## REFACTOR / scaffolding for the store step

- [ ] **8. Add the `.well-known/assetlinks.json` placeholder** (`[]` + header comment that the real
  package name + signing SHA-256 are filled post-domain per `STORE.md`). Do not invent values.

- [ ] **9. Write `apps/play-web/STORE.md`** — the runbook from design.md (domain → Firebase Hosting →
  assetlinks → bubblewrap → Play Console; iOS/Capacitor appendix). Link it from the play-web README
  or CLAUDE.md "Marketing & virality" section.

## Gate — all green before done

- [ ] **10. Run the full gate set and confirm green:**
  `npm run typecheck` · `npm run lint` · `npm test` (must include the new `test-manifest`) ·
  `npm run creator:build` · `npm run e2e`. Fix anything red. No callable changed, so e2e is a
  regression check only.
