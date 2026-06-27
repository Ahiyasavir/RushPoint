# Tasks — Universal share branding (RED → GREEN → REFACTOR)

> Strict TDD. Pure logic first (the only unit-testable surface), then the canvas wire-ins (preview).
> This change is the branding foundation that [`run-recap`](../run-recap/tasks.md) builds on.

## Pure logic — the QR target + watermark layout

- [x] **1. RED (pure):** new `scripts/test-watermark.ts` (auto-discovered by `run-unit-tests.mjs`) —
  assert `resolveShareQrTarget` (accessCode → join URL, gameId → promo URL, neither → base) and
  `computeWatermarkLayout` (logo + QR boxes inside the margin, non-overlapping, clear of the center
  band). Run via `npm test` → fails RED (helpers absent).
- [x] **2. GREEN:** add `resolveShareQrTarget` + `computeWatermarkLayout` to `packages/shared/src`,
  export from `packages/shared/src/index.ts`. Re-run → green.

## The watermark helper + QR

- [x] **3.** Add `qrcode` to `apps/play-web/package.json` (+ `@types/qrcode` dev).
- [x] **4.** New `apps/play-web/src/lib/brandWatermark.ts`: `loadImage(src)`, `makeQrImage(target)`
  (both resolve `null` on failure), and `stampBrand(ctx, opts)` using `computeWatermarkLayout` — draws
  logo (or text fallback) + URL + QR chip. No new test runner; verified via the story card in step 5.

## Wire every share through the stamp

- [x] **5. GREEN (UI):** refactor `apps/play-web/src/lib/storyCard.ts` to call `stampBrand` instead of
  the inline wordmark/CTA lines (signature + return unchanged); story card now shows the QR. Verify via
  preview tools: render the finish card → screenshot shows logo + URL + scannable QR on the side.
- [x] **6. GREEN (UI):** new `apps/play-web/src/lib/sharePhoto.ts` — `sharePhoto(photoUrl, brandData)`
  loads the photo to a canvas, `stampBrand`s it, routes through the native-share/download/clipboard
  ladder (cross-origin taint → fall back to URL + branded caption). Add a "share photo" affordance on a
  completed photo task / final screen. Verify via preview.
- [x] **7. REFACTOR:** confirm the fallback paths — force `logoImg=null` (text wordmark renders) and
  simulate a tainted canvas (falls back, no throw). Preview-verify both.

## Gate — all green before done
- [x] **8. Full gate set:** `npm run typecheck` · `npm run lint` · `npm test` (incl. `test-watermark`)
  · `npm run creator:build` · `npm run e2e` (unchanged — no callable). Update TECH_SPEC Appendix B
  (new share-branding row) status.
