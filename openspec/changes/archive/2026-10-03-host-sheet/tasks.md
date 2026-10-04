## 1. RED: the model

- [x] 1.1 Write `scripts/test-host-sheet.ts` before `lib/hostSheet.ts` exists: a how-to kind and an answer for each of the nine task types (survey says there is no right answer); numeric "37 (±2)"; sequence lists every step; ordering lists the order; hidden mission shows spot + clue; locationless says from anywhere.
- [x] 1.2 Stage rules: "2 of 4", all, "only one of", release after N minutes, final.
- [x] 1.3 Approval: per-task auto, run-wide auto, none, code missions automatic, video length caveat.
- [x] 1.4 Secrecy: with answers off, a deep sweep finds none of the seeded secret values and there is no staff page.
- [x] 1.5 Staff page: run + answers ⇒ present, disabled excluded; no run ⇒ absent.
- [x] 1.6 Coverage guard over every `Task` field (with its denominator) and no stale ignored entries; a malformed or empty game does not throw. Run it and watch it fail.

## 2. GREEN

- [x] 2.1 `apps/creator-web/src/lib/hostSheet.ts`: `buildHostSheet`, `approvalMode`, `stepAnswerSummary`, `stageRule`, `HOST_SHEET_IGNORED_TASK_FIELDS`.
- [x] 2.2 `pages/HostSheetPage.tsx` + route `/host-sheet/:gameId` via `lazyWithRetry`; switches; print CSS (A4, no chrome, light, break-inside avoid); SVG station plot; navigation QR per located card; staff codes from the run listener.
- [x] 2.3 Entry points: Builder `⋯` menu; Run Console button.
- [x] 2.4 i18n HE + EN for every string.

## 3. Verify

- [x] 3.1 Browser: the demo game in print preview at A4 (Hebrew and English), a small and a large game, and the page at 375px.
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.
