# Tasks — mobile-move-task-visibility

No pure logic in this change (a single opacity value) — per CLAUDE.md's UI
lane there is no RED unit test to write; the gates are typecheck +
creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `TaskCard.tsx:154-156` — change the move-to-stage `<select>`'s rest
      opacity from `opacity-0` to `opacity-60`, keeping the existing
      `group-hover/card:opacity-100 focus:opacity-100 focus-visible:opacity-100`
      escalation untouched.

## REFACTOR / VERIFY

- [x] 2. Preview check (375px viewport): both move-to-stage controls
      measured `opacity: 0.6` at rest with a non-zero box — visible without
      hover, where they previously computed to `opacity: 0`.
- [ ] 3. Preview check (desktop width): card still reads calm at rest and
      brightens fully on hover/focus. **PARTIAL** — the rest state is
      confirmed by the computed `0.6`; the hover escalation to `1` was not
      driven, since the Browser pane is hidden here and `computer` (real
      pointer events) times out. The hover/focus classes were not modified.
- [x] 4. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 5. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
