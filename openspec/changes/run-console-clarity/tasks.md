# Tasks — run-console-clarity

Strict RED → GREEN → REFACTOR. Every behavioural decision lands in a pure module first, proven by a
failing test, before the page renders it.

## RED

- [x] 1. Add the `buildRunSignals` suite to `apps/creator-web/src/lib/__tests__/runConsole.test.ts`
      against the not-yet-existing `lib/runConsoleSignals.ts`: quiet run and finished run return
      `[]`; the design §2 table row by row; `photoPending` suppressed while `photoOverdue` fires;
      deterministic total order (severity, then `panelPriority`, then declaration order); totality
      against `undefined` / `null` / `NaN` / `Infinity` / negative / non-number counters; and the
      **reachability property** that every fired signal's panel is catalogued and appears in the
      plan's pinned zone or one of its sections. Record the RED output.
- [x] 2. Add the `summaryChips` / rail-state suite: a non-empty chip list for every entry of
      `SECTION_ORDER` at every run status (iterate, do not hand-list), and chip values equal to the
      state's counts. RED.
- [x] 3. Add the `defaultSection` / `resolveSectionWithReason` suite: a finished run opens on the
      reports section; `sectionEmptied` is reported only for a known section that is absent right
      now; junk degrades to `default`; and the **shape-stability property** across
      `photoQueueCount × chatThreadCount × feedItemCount ∈ {0, n}` on a live run. RED.
- [x] 4. Add the `CONSEQUENCE` / `teamRowActions` suite: totality over `RUN_ACTION_IDS` by
      iteration; every `destructive` action confirms; every `public` or `allTeams` action confirms;
      every `copyKey` resolves in BOTH dictionaries; the team row partitions its actions with the
      safety release inline, nothing destructive inline and at most one inline control. RED.
- [x] 5. Add the `PANEL_COPY` suite (total over `ALL_PANEL_IDS`, no extras, title and help non-empty
      in HE and EN), the `resolveEnumLabel` suite (never returns the raw input, total over
      `null`/`undefined`/non-string), the `pinnedPanelIds` suite (`stationQr` pinned iff no team has
      joined, reachability preserved) and the `publishesOnShare` suite. RED.

## GREEN

- [x] 6. Create `lib/runConsoleSignals.ts`: the `SignalId` union, the `count()` totality gate, the
      §2 table, the severity + `panelPriority` ordering, and the silence rules. Green for task 1.
- [x] 7. `lib/runConsoleLayout.ts`: extend `RunConsoleState` and `GroupSummary`; rewrite
      `summaryFor` as an exhaustive switch over `GroupId` with **no `default:`**; add
      `summaryChips`. Green for task 2.
- [x] 8. `lib/runConsoleLayout.ts`: `photoReview` / `chat` become live-gated, `analytics` becomes
      always visible (verified: `getRunAnalytics` is not finished-gated server side); add
      `defaultSection`, `resolveSectionWithReason`, and route `resolveSection` through it. Green for
      task 3.
- [x] 9. `lib/runConsoleActions.ts`: the `CONSEQUENCE` record over the closed `RunActionId` union,
      `runActionConsequence`, `runActionNeedsConfirm`, `teamRowActions`. Green for task 4.
- [x] 10. `lib/runConsolePanelMeta.ts` (icon + structural flags per panel),
      `lib/runConsoleLabels.ts` `resolveEnumLabel`, `lib/runConsoleLayout.ts` `pinnedPanelIds`,
      `lib/runShareArtifacts.ts` `publishesOnShare`. Green for task 5.
- [x] 11. `i18n.ts`: the new `runConsole.signal.*`, `runConsole.panel.*` and
      `runConsole.consequence*` blocks in BOTH languages. Additive only in this task, so the
      dictionary parity suite stays green while the page is rewired.
- [x] 12. `pages/RunConsolePage.tsx` — render the decisions: the pinned signal strip, the rail chips
      from `summaryChips`, the relocation notice from `resolveSectionWithReason`, `PanelShell` over
      every panel, the team-row overflow menu, the consequence-driven confirms, and every control's
      variant through `runActionVariant`. No new decision logic in the page.
- [x] 13. `pages/RunConsolePage.tsx` — the empty/failure states: the five bare grey divs become
      `EmptyState`, `SurveyResultsPanel` gets a real empty branch and an error branch, and
      `ensureBoardPublished` reports its failure instead of swallowing it.
- [x] 14. `pages/RunConsolePage.tsx` + `lib/runConsoleLabels.ts` — apply `resolveEnumLabel` at the
      alert type, the analytics task type and the summary issue label; route the trackables holder
      and the zone holder through `resolveTeamLabel`.

## REFACTOR / VERIFY

- [x] 15. P9 copy pass in `i18n.ts` (both languages): plain-language section titles, one verb per
      action, statuses as statuses, Hebrew plural imperatives, the photo-review task line as one
      formatter, the CSV header marked `// i18n-ignore`, and the six dead keys removed from BOTH
      dictionaries.
- [x] 16. Run the whole pure lane green:
      `cd apps/creator-web && npx vitest run src/lib/__tests__/runConsole.test.ts src/lib/__tests__/i18nDictionary.test.ts`.
- [x] 17. `npx tsc --noEmit -p apps/creator-web/tsconfig.json`, `npx eslint` on every touched file,
      and `npx tsx scripts/check-i18n.ts --strict` — PART A clean, zero NEW PART B findings.
- [x] 18. Report to the parent: this lane must NOT run `npm run verify` / `verify:emulator` /
      `shared:build` (a concurrent lane owns `packages/shared/dist`); name the gates the parent has
      to run sequentially afterwards and the risks to watch.
