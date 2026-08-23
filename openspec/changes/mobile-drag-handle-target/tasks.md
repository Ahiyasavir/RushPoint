# Tasks — mobile-drag-handle-target

No pure logic in this change (className/wrapper edit only) — per CLAUDE.md's
UI lane there is no RED unit test to write; the gates are typecheck +
creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `TaskCard.tsx:105-112` — wrap the `⠿` handle in a 44×44px
      flex-centered touch target, moving `handleProps` onto the wrapper.
      Keep the glyph's own font-size/color unchanged.
- [x] 2. `StageRail.tsx:100-111` — same wrapper pattern for the stage drag
      handle, keeping `ref={setActivatorNodeRef}` and
      `{...attributes} {...listeners}` on the wrapper.

## REFACTOR / VERIFY

- [x] 3. Preview check (375px viewport): both handles measured **44×44**
      (from 12×24). Overlap with the adjacent type chip measured at 0px
      after splitting the negative margin per axis to match each row's gap
      (see design.md §2) — a uniform `-m-2.5` had measured a 2px overlap.
      Task row height unchanged at 24px.
- [ ] 4. Preview check: drag a task to reorder within a stage, drag a task to
      a different stage via the rail, and drag a stage to reorder in the
      rail — all three still work starting from anywhere in the enlarged
      handle. **NOT VERIFIED**: the Browser pane is hidden in this
      environment, so `computer` (real pointer events) times out and
      synthetic `.click()` cannot drive a dnd-kit pointer drag. Geometry is
      confirmed; the drag gesture itself still needs a human pass. No
      sensor/collision code was touched, only the handle's box.
- [x] 5. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed, PART A + PART B both pass.
- [x] 6. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
