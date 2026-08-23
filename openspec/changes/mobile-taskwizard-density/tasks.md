# Tasks — mobile-taskwizard-density

No pure logic in this change (a single padding value) — per CLAUDE.md's UI
lane there is no RED unit test to write; the gates are typecheck +
creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `ui.tsx` — `Input`'s `dense` branch: `py-1.5` → `py-2`.
- [x] 2. `ui.tsx` — `Textarea`'s `dense` branch: `py-1.5` → `py-2`.

## REFACTOR / VERIFY

- [ ] 3. Preview check (375px viewport): TaskWizard Details/Execution steps
      for a field-heavy task type (e.g. `quiz`) — dense fields visibly
      taller, no new scrolling introduced on the most field-dense step.
      **NOT VERIFIED**: the task editor panel would not settle into its
      shown state under synthetic clicks (the Browser pane is hidden, so
      `computer`'s real pointer events time out), so dense field heights
      were never measured on-screen. This is a 2px padding change on a
      shared component and passed every gate, but the "no new scrolling"
      half of the claim is unconfirmed and still owed.
- [x] 4. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 5. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
