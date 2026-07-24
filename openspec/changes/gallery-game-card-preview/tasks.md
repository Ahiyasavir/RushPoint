# Tasks — gallery-game-card-preview

Pure-logic core is TDD (RED→GREEN); the modal + wiring are a UI lane (no component test runner).

## RED

- [x] 1. **Write the failing view-model test** — `scripts/test-gallery-game-detail.ts`: assert
      `buildGalleryGameDetail(game)` surfaces title, description, mode, stages, tasks, minutes, plays,
      location label and tags from a representative `PublicGame`; and a **secrecy sweep** — an input
      carrying an unknown extra field plus a planted exact `coordinates` yields output containing
      neither. Import the not-yet-existing `../packages…`/`src/lib/galleryGameDetail` so it fails.
      (design.md §Test strategy)

## GREEN

- [x] 2. **Add the pure view-model** — `apps/creator-web/src/lib/galleryGameDetail.ts`
      `buildGalleryGameDetail(game: unknown)` copying ONLY named fields out of the input (never a
      spread), mirroring `lib/galleryTaskDetail.ts`. Make task 1 green. (design.md §The fix #1)
- [x] 3. **Add the detail modal** — `apps/creator-web/src/components/GalleryGameDetailModal.tsx`
      mirroring `GalleryTaskDetailModal` chrome (portal, Escape/backdrop/✕, scroll-lock, focus
      trap/restore), rendering the view-model, with a Copy action calling the passed `onCopy`. No
      `GalleryMap` import. (design.md §The fix #2)
- [x] 4. **Wire the game card** — in `apps/creator-web/src/pages/GalleryPage.tsx` give the game card a
      `role="button"` tappable region (`aria-label={pg.title}`, `onClick` → `setDetailGame(pg)`, the
      `e.target !== e.currentTarget`-guarded Enter/Space `onKeyDown`) while keeping the Copy button and
      LikeButton independently clickable; add `detailGame` state and render `GalleryGameDetailModal`
      beside the existing `detailTask` modal. (design.md §The fix #3)
- [x] 5. **i18n strings** — add the new `gallery.*` labels (modal title + any meta labels not already
      present, close aria-label) to BOTH dictionaries in `apps/creator-web/src/i18n.ts`; reuse
      `stages`/`tasks`/`plays`/`copyBtn`. HE + EN, no hardcoded literals, no em-dash. (design.md §RTL/i18n)

## REFACTOR

- [x] 6. Deduplicate any modal chrome trivially shareable between the task and game detail modals ONLY
      if it is genuinely identical and low-risk; otherwise leave the two modals separate (secrecy of
      the mission modal must not regress). DECISION: kept the two modals SEPARATE — the game modal
      omits the map/type-about/secret-note sections and carries a different secrecy contract
      (approxLocation.label vs answer keys), so sharing chrome would risk regressing the mission
      modal's secrecy. (design.md §The fix)
      if it is genuinely identical and low-risk; otherwise leave the two modals separate (secrecy of
      the mission modal must not regress). (design.md §The fix)

## Verify (build lane — this agent)

- [ ] 7. `npm test` — the new `test-gallery-game-detail` passes (incl. the secrecy sweep).
- [ ] 8. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green; especially lint (no unused import) and i18n parity.
- [ ] 9. `npx openspec validate gallery-game-card-preview --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 10. Open a game card in the Gallery → read-only detail shows stages/tasks/length/tags/mode/
      location label; Copy from card and from detail both duplicate the game; like button toggles
      without opening the detail; Escape/backdrop/✕ close.
