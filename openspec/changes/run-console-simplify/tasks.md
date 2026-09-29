# Tasks: run-console-simplify

Source: `docs/field-report-2026-09-27.md` item 2. Last in order: it gives a home to the actions the
earlier changes add (team lifecycle, routing, arrival, flash missions, review alarm).

## 1. RED
- [x] 1.1 `runConsoleSimplify.test.ts`: panel-home coverage, `buildInbox`, default section, row
      inline action. Confirm RED.

## 2. GREEN
- [x] 2.1 `runConsoleLayout.ts` new section model + `PANEL_HOME` + `buildInbox`. 1.1 → green.
- [ ] 2.2 `components/console/` split: ConsoleHeader, NowScreen, TeamsScreen, GameScreen,
      SetupSheet; `ConsoleTabs` three tabs; behind `?console=next`.
- [x] 2.3 TeamPage grouped action set (D4); team row single inline action.
- [ ] 2.4 Parity walk of the D2 table in preview; make it the default; delete the old shell.
- [x] 2.5 i18n he/en.

## 3. Verify
- [ ] 3.1 Preview desktop + phone on a seeded busy run.
- [ ] 3.2 `npm run verify`, exit code to a file.

## Progress (2026-09-28)

Done as a REGROUP rather than a rewrite: Now (inbox + queues) / Teams / Game, setup+reports compact at the end, inbox panel, default = Now. Browser-verified. D4 done: `teamPageActionGroups` (Play in a fixed frequent-first order, Score, Danger; unknown keys fall to Play), RED first in runConsoleSimplify.test.ts; the row's ⋯ is replaced by "כל הפעולות" which opens the team page, and the page gained skip-stage + let-back-in so nothing the ⋯ offered became unreachable. Browser-verified (4 rows, 0 menus, groups in order). NOT done: splitting RunConsolePage.tsx into components/console/ (D5); the ?console=next staging is moot (no parallel shell was built).
