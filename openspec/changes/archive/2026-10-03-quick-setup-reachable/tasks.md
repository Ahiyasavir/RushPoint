## 1. RED — the predicate and the grouping

- [x] 1.1 In `scripts/test-quick-setup-flow.ts`, assert `isQuickSetupDecision` before it exists: fresh `idle` ⇒ false; `idle` + a deferred id ⇒ true; `idle` + index 2 ⇒ true; `closed`/`done`/`running` ⇒ true; null/junk ⇒ false. Run it and watch it fail.
- [x] 1.2 Write `scripts/test-readiness-grouping.ts`: six `taskNotPlaced` + one `taskNotNamed` ⇒ two groups in first-appearance order with counts 6 and 1; `first` is the first issue of each kind; empty ⇒ empty; junk ⇒ empty, no throw. Watch it fail.
- [x] 1.3 Add a source assertion that BuilderPage's phone overflow menu dispatches `resume` behind a `qsSteps.length > 0` guard, and that the load effect uses `isQuickSetupDecision`. Watch it fail.

## 2. GREEN

- [x] 2.1 `isQuickSetupDecision` in `lib/quickSetup.ts`.
- [x] 2.2 BuilderPage load effect: `hasRecord: isQuickSetupDecision(rec)`; persist effect skips (and best-effort removes) a non-decision.
- [x] 2.3 Phone `⋯` menu entry "Quick Setup (N left)" dispatching `resume`, only when the game has steps.
- [x] 2.4 `groupReadinessIssues` in `lib/gameReadiness.ts`; ReadinessPanel renders groups (counted label for >1, today's row for 1).
- [x] 2.5 Reveal: DashboardPage passes grouped readiness of the composed stages; SmartBuildReveal renders the "left before launch" lines.
- [x] 2.6 Accessible names on the path cards and the questionnaire chips. (Path cards keep their visible title+body as the name; their icon is `aria-hidden`. The chips get `aria-label`; `ChoiceArt` already hides its svg. Guarded by `scripts/test-choice-accessible-names.ts`.)
- [x] 2.7 i18n HE + EN for every new string.

## 3. Verify

- [x] 3.1 Browser at 375px: compose a level-3 game, land in the Builder, open `⋯`, Quick Setup is there; leave and re-open, the invitation is offered; readiness shows one grouped row.
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.
