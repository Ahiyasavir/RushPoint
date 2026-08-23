# Tasks — mobile-dashboard-runconsole-reflow

No pure logic in this change (className grid-column tokens only) — per
CLAUDE.md's UI lane there is no RED unit test to write; the gates are
typecheck + creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `DashboardPage.tsx:681` — `grid grid-cols-2 lg:grid-cols-3` →
      `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- [x] 2. `DashboardPage.tsx:1037` (loading skeleton) — same class change,
      kept identical to task 1 so loading→loaded never reflows.
- [x] 3. `RunConsolePage.tsx:1749` — `grid grid-cols-3 gap-2` →
      `grid grid-cols-1 sm:grid-cols-3 gap-2`.

## REFACTOR / VERIFY

- [x] 4. Preview check (375px viewport): Dashboard stat-tile grid measured
      `grid-template-columns: 343px` — a single track holding all 3 tiles.
- [ ] 5. Preview check (`sm`+ widths): Dashboard grid measured
      `328px 328px` at 700px — 2 columns restored, no regression above the
      breakpoint. **Hot Zone form NOT verified**: reaching it needs a live
      run in the Run Console, which this session did not launch. The class
      change is the same one-token pattern verified on the Dashboard grid.
- [x] 6. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 7. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
