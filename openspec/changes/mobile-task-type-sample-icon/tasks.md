# Tasks — mobile-task-type-sample-icon

No pure logic in this change (className size values only) — per CLAUDE.md's
UI lane there is no RED unit test to write; the gates are typecheck +
creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `TaskWizard.tsx` — grow the sample (✨) button from
      `w-4 h-4 text-[10px]` to `w-6 h-6 text-[11px]`, and widen the type
      button's reserve `pe-11` → `pe-12` so the wider overlay clears the
      label. (First tried `w-7 h-7` at `pe-11`; measurement showed it
      covered 2 of 9 labels — see design.md §3.)

## REFACTOR / VERIFY

- [x] 2. Preview check (375px viewport): sample button measured **24×24**;
      overlay 42px inside the 48px reserve; label coverage measured on
      **all 9** task types — 0 covered, clearance 3-11px each. Verified
      live at 375px after the emulator was restored.
- [x] 3. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 4. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
