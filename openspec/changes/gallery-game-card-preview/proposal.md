## Why

In the creator Gallery (`apps/creator-web/src/pages/GalleryPage.tsx`) the two card types behave
inconsistently for the same "inspect before I take it" intent:

- A **mission** card (task library tab) is a `role="button"` that opens `GalleryTaskDetailModal` —
  a creator can read the full mission detail before copying it (`GalleryPage.tsx` task card, the
  `role="button"` div wiring `setDetailTask`).
- A **game** card (games tab) offers only a **Copy** button (`GalleryPage.tsx` game card, the
  trailing `<Button ... onClick={() => void copyAction.run(pg)}>{gl.copyBtn}</Button>`). There is no
  way to look inside a whole game — its stages, task count, length, description, tags — before
  duplicating it into your own account.

So a creator can preview a single mission but must copy an entire game blind. This is a small
consistency gap on an otherwise-polished surface.

## What Changes

- Make each **game card openable** into a lightweight, read-only detail (a modal mirroring the
  mission detail pattern) showing the game's title, description, mode, stage count, task count,
  estimated length, play count, approximate location label, and tags — all fields already present on
  the `PublicGame` the card already holds. Nothing is fetched on open.
- Keep **Copy** available both on the card and inside the detail, so previewing never gates copying.
- The detail is built by a pure view-model (`buildGalleryGameDetail`) that copies only named fields
  OUT of the `PublicGame`, mirroring `lib/galleryTaskDetail.ts`, so an unknown future field can never
  reach the screen. This gives the change a unit-testable pure core.

## What does NOT change

- **Copy stays the primary action and is never gated.** It remains on the card exactly as today and
  is additionally offered inside the detail. Ability preserved: copying a game — still one tap on the
  card; the callable (`copyAction.run`) is unchanged.
- **No new data and no fetch on open.** The detail renders from the `PublicGame` the games list
  already returned (`searchGallery`); no new callable, no server change.
- **Mission cards and `GalleryTaskDetailModal` are untouched.** This only brings game cards up to the
  same affordance.
- **No exact location leaks.** `PublicGame` already carries only the coarse `approxLocation` (the
  world-readable write-path contract); the detail shows only its `label`, never coordinates.

## Impact

- `apps/creator-web` — `src/pages/GalleryPage.tsx` (make the game card open the detail + keep Copy),
  new `src/components/GalleryGameDetailModal.tsx`, new `src/lib/galleryGameDetail.ts` (pure
  view-model) + its unit test, a few new `gallery` i18n labels in `src/i18n.ts` (HE + EN).
- **Not touched:** `functions/`, `packages/shared`, `apps/play-web`, `firestore.rules`.
