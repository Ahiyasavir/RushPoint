# Tasks — mobile-touch-target-baseline

No pure logic in this change (className values only) — per CLAUDE.md's UI
lane there is no RED unit test to write; the gates are typecheck +
creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `ui.tsx:59` — `min-h-[40px]` → `min-h-[44px]` on the shared
      `Button`.
- [x] 2. `TaskWizard.tsx:210`, `TaskWizard.tsx:551`, `BuilderPage.tsx:2788`
      — grew each identical close button from `w-7 h-7` to `w-11 h-11`
      (kept the full 44px on all three — none needed the `w-9 h-9`
      fallback per typecheck/build passing with no layout errors, though a
      live crowding check is still owed per task 3).

## REFACTOR / VERIFY

- [x] 3. Preview check (375px viewport): shared `Button` measured **44px**
      on short-label buttons (`← המשחקים`, `הפעל ריצה`, `עוד`,
      `＋ הוסף משימה`). Task-editor close measured **44×44**. The
      `w-9 h-9` fallback was NOT needed: the 3 wizard step tabs measure
      92px each, so 3×92 + 44 close = 320px of the 375px row — no
      crowding.
- [x] 4. Preview check: no layout regression at 375px — no horizontal
      overflow (`documentElement.scrollWidth === 375`), step-tab row fits
      as measured above.
      Note: the map-modal close (`TaskWizard.tsx:551`) and stage-settings
      close (`BuilderPage.tsx:2788`) were changed identically but not
      individually measured — neither surface was opened this session.
      A separate 11×20 `✕` on the stage header remains untouched, as
      scoped out in the proposal's Non-goals.
- [x] 5. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 6. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
