# Tasks: mission-editor-value-rows

Source: Ahiya 2026-10-02. Research and measurements: `docs/mission-editor-step3-simplification-2026-10-02.md`.

## 0. Baseline
- [x] 0.1 Re-measure step 3 in the browser (1280x800 and 375x812, one game per preset): height at rest,
      with each chip open, all open. Record next to the research doc's section 1 numbers.

## 1. RED
- [x] 1.1 `scripts/test-mission-settings-rows.ts`: `scoringRowFor`, `fieldIgnoredByPreset`,
      `releaseAnswerOf` / `applyReleaseAnswer` (incl. `combined`, sibling rule, clears with `undefined`),
      `closeAnswerOf` / `applyCloseAnswer`, `timeLimitChoiceOf`, `stepPoints`, `rowSummary` (key + params),
      `moreSettingsActive`, and the round trip "no row operation drops a field it did not replace".
      Confirm RED (module missing).
- [x] 1.2 Quick Setup test: every `QUICK_SETUP_FIELDS` entry names a valid row key; a `difficulty` step
      is dropped in a `fixed_points_speed` game and kept in `smart_weighted`; `pointValue` is dropped in
      `time_only`. Confirm RED.
- [x] 1.3 `scripts/test-task-opt-in-groups.ts` rewritten to the row keys. Confirm RED.

## 2. GREEN
- [x] 2.1 `apps/creator-web/src/lib/missionSettingsRows.ts` (pure, total, never throws). 1.1 green.
- [x] 2.2 `lib/taskOptInGroups.ts` → row keys `scoring | hint | opens | timeLimit | more`; keep
      `foldGroupAway` semantics (opening/closing writes nothing). 1.3 green.
- [x] 2.3 `lib/quickSetup.ts`: re-point `QUICK_SETUP_FIELDS`; `quickSetupSteps` filters preset-ignored
      targets. 1.2 green.
- [x] 2.4 `BuilderPage` passes `scoringPreset` into `TaskWizard`.
- [x] 2.5 `TaskWizard`: a `SettingsRow` primitive (44px, `aria-expanded`, single open, Esc closes)
      replacing `OptInChip` / `OptInGroup` in step 3; the five rows per design D2 to D7; `data-qs-field`
      anchors kept on the same inputs; `focusGroup` opens the owning row.
- [x] 2.6 "עוד הגדרות" contents per D6; tag suggestions only on focus, filtered by input.
- [x] 2.7 i18n HE + EN: row labels, value summaries, answers, tooltips (explanations moved from inline).
      Remove the strings that no longer render (`chipAddHint`, `chipSetTimerPoints`, `chipRules`,
      `sectionSetCount` if unused).

## 3. REFACTOR
- [x] 3.1 Delete `OptInChip` / `OptInGroup` / `AdvGroup` and dead helpers once nothing references them;
      `ExecutionStepBody` should shrink, not grow.
- [x] 3.2 Update the living spec references in code comments (`task-editor-progressive-disclosure`).

## 4. Verify
- [x] 4.1 Guards: `test-game-presentation`, `test-save-payload-undefined`, `test-creator-tap-targets`,
      `test-creator-a11y-scan`, `test-brand-class-scan`, `test-no-dashes`, `npm run i18n:check:strict`.
- [ ] 4.2 Browser, per preset, at 1280x800 and 375x812: re-measure (target: at rest ≤ 5 rows, any single
      row except "עוד הגדרות" open fits the 555px panel); keyboard only pass; set and clear every
      setting and read the saved task in the emulator (exact fields, ABSENT not null); open a mission
      with `combined` release conditions (seeded by hand) and confirm nothing is lost; run one Quick
      Setup template end to end.
      DONE: both presets at 1280 and 375, set and clear read back from the emulator (absent, never null),
      Esc closes only the row. NOT YET: keyboard only pass, a hand-seeded `combined` mission, a Quick
      Setup template run.
- [x] 4.3 `npm run verify` (exit code to a file). No callable changed; e2e for regression only.
