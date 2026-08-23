# Tasks — mobile-back-button-target

No pure logic in this change (className values only) — per CLAUDE.md's UI
lane there is no RED unit test to write; the gates are typecheck +
creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `BuilderPage.tsx:998` — add `justify-center min-h-11 min-w-11
      sm:min-h-0 sm:min-w-0` to the back-to-games button's className.

## REFACTOR / VERIFY

- [x] 2. Preview check (375px viewport): back button measured **44×44**
      (from 30×24). Navigation itself not re-driven (see task 3 note); the
      `onClick`/`leaveToGames` wiring was not modified.
- [x] 3. Preview check (desktop width): the added classes are
      `sm:min-h-0 sm:min-w-0`, which reset the mobile floor at and above
      `sm`, so desktop geometry is unchanged by construction; the 2-column
      reflow check at 700px (see mobile-dashboard-runconsole-reflow) also
      confirmed no header regression at that width.
- [x] 4. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 5. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
