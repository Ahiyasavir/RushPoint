# Tasks — mobile-slidepanel-keyboard-avoidance

No pure logic in this change (a single Tailwind unit token) — per
CLAUDE.md's UI lane there is no RED unit test to write; the gates are
typecheck + creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `App.tsx:90` — change the Builder shell's `h-screen` to `h-dvh`
      (keep `overflow-hidden flex flex-col` unchanged).

## REFACTOR / VERIFY

- [x] 2. Preview check (375px viewport, keyboard closed): Builder shell
      measured 812px tall against an 812px viewport — `h-dvh` resolves to
      the same height `h-screen` did with no keyboard up, as intended. The
      3-pane workspace, header, stage rail and task cards all rendered and
      measured normally throughout this session's checks; no horizontal
      overflow.
- [x] 3. Preview check (desktop/700px): no visual regression observed
      during the reflow checks at that width.
- [x] 4. Recorded explicitly that keyboard-open behavior on a real iOS
      device was not (and could not be, in this tooling) directly verified
      — confidence rests on this being the same fix pattern already proven
      in `GalleryGameDetailModal.tsx` / `GalleryTaskDetailModal.tsx`.
- [x] 5. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 6. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
