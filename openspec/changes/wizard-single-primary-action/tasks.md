# Tasks — wizard-single-primary-action

UI lane (creator-web has ESLint, no component test runner). One component; no i18n edit.

## Implement

- [x] 1. **Swap footer primary by step** — in `apps/creator-web/src/components/TaskWizard.tsx` footer,
      make "Next →" the primary (drop its `variant="ghost"`, keep `disabled={!canGoNext(stepKey, task)}`
      and the advance `onClick`) on non-final steps, and make "Done" secondary there
      (`variant={step < lastStep ? 'ghost' : undefined}`, keep `onClick={finish}`, never disabled). On
      the final step "Done" stays primary and "Next →" is not rendered. (design.md §The fix)
- [x] 2. **Leave everything else in the footer untouched** — Back, the Delete-task link, the `ms-auto`
      wrapper, step chips and step bodies unchanged. (design.md §Non-regression)

## Verify (build lane — this agent)

- [ ] 3. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. No new i18n key.
- [ ] 4. `npx openspec validate wizard-single-primary-action --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 5. On steps 1-2 "Next →" is the visually primary button and "Done" is the ghost/secondary; on
      the last step "Done" is primary; "Done" is clickable on every step (reveals blockers / closes)
      exactly as before.
