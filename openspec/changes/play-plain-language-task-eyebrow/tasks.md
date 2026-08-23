# Tasks — play-plain-language-task-eyebrow

Copy-only UI lane. One dictionary value per language; no logic.

## Implement

- [x] 1. In `apps/play-web/src/i18n.ts`, change the HE `task.routedTask` value from `'משימה מנוהלת'`
      to `'המשימה שלכם'`. (design.md §The fix)
- [x] 2. In `apps/play-web/src/i18n.ts`, change the EN `task.routedTask` value from `'Routed task'`
      to `'Your task'`. (design.md §The fix)
- [x] 3. Do NOT touch `TaskRunner.tsx` — the `task.routedTask` key and the eyebrow selection stay as
      they are; only the resolved copy changes.

## Verify (build lane — this agent)

- [x] 4. `npm run i18n:check:strict` — green (HE stays HE, EN stays EN, key parity, zero new PART B).
- [x] 5. `npm run play:build` — green.
- [x] 6. `npx openspec validate play-plain-language-task-eyebrow --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 7. On a full multi-task stage the eyebrow reads "Your task" / "המשימה שלכם"; partial "Stop X of
      Y" and single-task "Your task" are unchanged.
