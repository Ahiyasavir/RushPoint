# Design — Universal share branding

## Current behavior (authoritative refs)

- `apps/play-web/src/lib/storyCard.ts` — `buildStoryCard(data)` draws a 1080×1920 canvas; the brand
  is a **text** wordmark `ctx.fillText('RUSHPOINT', …)` (L60) and a CTA URL line (L120–123).
  `shareStoryCard(data, text)` (L132) builds the blob and routes to `navigator.share` (files) →
  download → clipboard, returning `'shared' | 'downloaded' | 'copied' | 'failed'`.
- `apps/play-web/public/icon.svg` is the brand mark; `play-web-store-readiness` adds raster
  `icon-192.png` / `icon-512.png`. No QR library is installed (`apps/play-web/package.json`).
- Individual task photos live at `TaskState.photoUrl` per team; nothing lets a participant re-share one.

## Approach

Extract one reusable **brand stamp** and feed every share through it.

### Pure, DOM-free helpers (the TDD lever) → `packages/shared/src`

```
resolveShareQrTarget({ playBaseUrl, gameId?, accessCode? }) → string
  // accessCode present  → `${playBaseUrl}/?code=${accessCode}`   (joinable)
  // gameId present       → `${playBaseUrl}/?game=${gameId}`        (promo)
  // neither              → playBaseUrl                              (generic)

computeWatermarkLayout({ canvasW, canvasH, logoSize, qrSize, margin }) → {
  logo: {x,y,w,h}, qr: {x,y,w,h}, url: {x,y,maxW}
}
  // deterministic "side" placement: logo + URL bottom-left, QR bottom-right,
  // all inside `margin`, never overlapping the canvas center (the subject).
```

These are unit-tested in `scripts/test-watermark.ts` (tsx, no DOM): exact coordinates, no overlap
between logo/QR boxes, everything within bounds, and each QR-target branch.

### Canvas helper → `apps/play-web/src/lib/brandWatermark.ts`

```
stampBrand(ctx, { canvasW, canvasH, logoImg|null, qrImg|null, url, layout }) → void
```

Draws the logo (or, if `logoImg` is null, the existing `RUSHPOINT` text fallback), the URL line, and
the QR chip onto an already-drawn canvas using `computeWatermarkLayout`. `loadImage(src)` and
`makeQrImage(target)` (via the `qrcode` lib → data URL → `HTMLImageElement`) are the only DOM/async
bits; both resolve to `null` on failure so `stampBrand` degrades gracefully.

### Wire-ins

| File | Change |
|---|---|
| `apps/play-web/src/lib/storyCard.ts` | Replace the inline wordmark + CTA lines with `stampBrand(...)`. Story card gains the QR (target = the game's promo/join URL). Signature/return unchanged. |
| `apps/play-web/src/lib/sharePhoto.ts` (**new**) | `sharePhoto(photoUrl, brandData)`: load the photo onto a canvas, `stampBrand` it, route through the same native-share/download/clipboard ladder as `shareStoryCard`. |
| run-recap collage | The recap montage calls `stampBrand` too (single source of branding). |
| play surfaces | A "share photo" affordance on a completed photo task / final screen calls `sharePhoto`. |
| `packages/shared/src/index.ts` | Export `resolveShareQrTarget`, `computeWatermarkLayout`. |
| `apps/play-web/package.json` | Add `qrcode` (+ `@types/qrcode` dev). |

## Test strategy (TDD — proves the change)

- **Pure (RED first)** → `scripts/test-watermark.ts` (auto-discovered by `run-unit-tests.mjs`):
  - `resolveShareQrTarget` returns the join URL for an accessCode, the promo URL for a gameId, the
    base URL otherwise.
  - `computeWatermarkLayout` keeps logo + QR boxes inside the margins, non-overlapping, and clear of
    the canvas center band. Fails RED before the helpers exist.
- **UI** → preview tools: render a story card and a watermarked photo; screenshot shows logo + URL +
  scannable QR on the side; confirm the fallback path (force `logoImg=null`) still renders the text.
- **No emulator / e2e** — this change adds no callable.

## Conventions / footguns respected

- No server state, no Firestore writes, no callables — pure client-side composition.
- `qrcode` is a client dep but only loaded inside the lazy share path; share is not on the hot route.
- Cross-origin photo onto a canvas: load with `crossOrigin = 'anonymous'`; if the draw taints the
  canvas (`toBlob` throws), fall back to sharing the original URL + branded caption text (never fail).
- Answer-key secrecy, FIRESTORE_PATHS, server-write rules are all untouched (no data layer here).
