## 1. RED — step order and placement state

- [x] 1.1 Create `apps/creator-web/src/lib/__tests__/builderFirstTaskFlow.test.ts` with failing tests
      for `WIZARD_STEP_ORDER`, `stepKeyAt` and the re-keyed `canGoNext` from `../wizardLogic`: the
      order is exactly `['details', 'interaction', 'placement']`; `canGoNext('details', task)` is
      false for an empty title and true for a non-empty one; `canGoNext` is **true** for
      `'interaction'` and `'placement'` regardless of coordinates, trigger mode or answer key.
      Run `npm test` and confirm it fails on the missing exports, not on a typo.
- [x] 1.2 Add failing tests for `taskPlacementState` from `../wizardLogic`: a located mode with
      `{lat: 0, lng: 0}` is `'unplaced'`; a located mode with real coordinates is `'placed'`;
      `locationless`, `instant` and `task.locationless` are `'notRequired'`. Add the equivalence test
      `isTaskLocationValid(t) === (taskPlacementState(t) !== 'unplaced')` over a table covering every
      trigger mode. Confirm RED.

## 2. GREEN — step order and placement state

- [x] 2.1 In `apps/creator-web/src/lib/wizardLogic.ts` add `WizardStepKey`, `WIZARD_STEP_ORDER`,
      `stepKeyAt`, `stepIndexOf` and `taskPlacementState`; re-key `canGoNext` to the step key with
      the title as its only gate; reimplement `isTaskLocationValid` as
      `taskPlacementState(task) !== 'unplaced'`. Leave `blankTask()` byte-identical, including its
      `{ lat: 0, lng: 0 }` sentinel. Confirm sections 1.1 and 1.2 are GREEN.
- [x] 2.2 Run `npm test` and confirm `scripts/test-wizard.ts` and
      `apps/creator-web/src/components/__tests__/BuilderRedesign.test.ts` still pass. If either pins
      the old numeric `canGoNext(1|2|3, …)` signature, update only the call shape, never an asserted
      behavior, and note the edit in the task checkbox.

## 3. RED/GREEN — reveal gating

- [x] 3.1 Add failing tests for `initialRevealState`, `markTouched`, `shouldReveal` and
      `nextFinishAction` from a new `../taskValidationGating`: a fresh state reveals **nothing** for
      every `ValidationField` (this is the error-on-open regression test);
      `markTouched(s, 'quizChoices')` reveals `quizChoices` and still hides `numericAnswer`;
      touching is monotonic and a repeat `markTouched` is a no-op; `initialRevealState({ revealAll:
      true })` reveals every field with no touch. Confirm RED on the missing module.
- [x] 3.2 Add failing tests for `nextFinishAction(state, blockers)`: `'reveal'` when a blocker is not
      yet revealed, `'close'` once the blockers are revealed, `'close'` immediately when the blocker
      list is empty. Add a totality test that `shouldReveal` accepts every member of the
      `ValidationField` union. Confirm RED.
- [x] 3.3 Create `apps/creator-web/src/lib/taskValidationGating.ts` with `ValidationField`,
      `RevealState` and the four functions. Pure: no React, no DOM, no component imports. Confirm
      GREEN.

## 4. RED/GREEN — samples

- [x] 4.1 Add failing tests for `samplesForType` and `sampleWouldOverwrite` from `../taskTemplates`:
      every `TaskType` yields at least one sample, each with a non-empty label and a non-empty task
      title; `sampleWouldOverwrite` returns `[]` for a blank draft and names the title, description
      and answer-key fields for an authored one. Confirm RED on the missing exports.
- [x] 4.2 Add failing property tests over the **whole** `TASK_SAMPLES` catalogue: applying any sample
      to a draft with a real id, real coordinates and an explicit trigger mode leaves all three
      byte-identical; and for every type whose completion needs an answer key, every sample of that
      type yields `isTaskInteractionValid === true`. Confirm RED (or note which already pass, and
      keep them as the regression net).
- [x] 4.3 Add `samplesForType` and `sampleWouldOverwrite` to
      `apps/creator-web/src/lib/taskTemplates.ts`. Do **not** modify `applySample` or the sample data.
      Confirm GREEN.

## 5. RED/GREEN — game readiness (shared with the launch guard)

- [x] 5.1 Add failing tests for `computeGameReadiness` from a new `../gameReadiness`: a game with
      three uncompletable tasks returns **three** issues, not one; one issue is produced per rule
      (stage with no tasks, task with no answer key, located task at `{0,0}`, stage failing
      `validateUnlockGraph`); a locationless task at `{0,0}` produces **no** `taskNotPlaced` issue.
      Confirm RED on the missing module.
- [x] 5.2 Add failing tests for issue shape and ordering: every issue carries a resolvable `stageId`,
      a task issue carries a resolvable `taskId`, and issues come back ordered by stage order then
      task order so the panel is stable across renders. Add `canLaunchGame` tests: a fully valid game
      returns `[]` and `canLaunchGame` is true. Confirm RED.
- [x] 5.3 Add the **identity test**: over a table of games covering all four rules plus the valid
      case, `canLaunchGame(game)` equals "none of the four legacy guard predicates fires", with those
      four predicates re-expressed inline in the test from `BuilderPage.tsx:293-321`, so the
      extraction is proven faithful rather than assumed. Confirm RED.
- [x] 5.4 Create `apps/creator-web/src/lib/gameReadiness.ts` with `ReadinessCode`, `ReadinessIssue`,
      `computeGameReadiness` and `canLaunchGame`, lifting the four predicates verbatim from
      `BuilderPage.tsx:293-321` — including that `validateUnlockGraph` **warnings** block a launch
      exactly as they do today. Confirm GREEN.

## 6. RED/GREEN — honest advanced badge

- [x] 6.1 Add failing tests for `sectionSummary('advanced', …)` and `defaultOpenSections(…).advanced`
      from `../wizardSections`: a task with `expiresAfterMinutes` reports 1 and starts **open**; a
      task with `expiresAfterMinutes` and `releaseAt` reports 2; a fresh `blankTask()` reports 0 and
      starts closed; a task carrying only `pointValue` / `estimatedMinutes` / `maxConcurrentTeams`
      reports 0; and `defaultOpenSections(t).advanced === (sectionSummary('advanced', t) > 0)` over
      that table. Confirm RED.
- [x] 6.2 Replace the hardcoded `advanced: false` (`wizardSections.ts:65`) and the hardcoded
      `advanced → 0` (`:80-83`) with a count over the section's optional fields
      (`expiresAfterMinutes`, `releaseAfterMinutes`, `releaseAt`) and derive the auto-open flag from
      that same count. Confirm GREEN, so the invariant stated at `wizardSections.ts:10-14` becomes
      true.
- [x] 6.3 Update `scripts/test-wizard-sections.ts:73` ("advanced never auto expands"), which pins the
      bug being fixed: it becomes "advanced auto expands when a setting is configured". Leave `:74`
      ("advanced carries no badge" for a fresh task) unchanged, since a fresh task carries none of the
      three fields. Run `npm test` and confirm both lanes are green.

## 7. i18n — new and reworded copy

- [x] 7.1 Add every new string to BOTH `he` and `en` in `apps/creator-web/src/i18n.ts` under
      `builder`: the three step labels in the new order; the "not placed yet" title, body and place-it
      action; the sample-picker heading and the overwrite confirmation naming the fields it would
      replace; the readiness panel title, its ready-to-launch empty state, one label per
      `ReadinessCode`, and the blocking-issue count format; the launch-refused pointer to the panel;
      and the `releaseAt` disclosure.
- [x] 7.2 Reword `expiryReleaseAtWarn` (`i18n.ts:646` Hebrew, `:1539` English) from a conditional
      warning into a plain statement of the instant the task opens, since it becomes read-only
      disclosure rather than a warning.
- [x] 7.3 Run `npm run i18n:check` and confirm PART A is clean (key parity + Hebrew is Hebrew, English
      is English). Run `npm test` and confirm `scripts/test-no-dashes.ts` stays green: no `—`, `–` or
      ` - ` as a separator in the new copy (INSTRUCTIONS.md §3.C).

## 8. Wire the UI — step reorder and the "not placed yet" state

- [x] 8.1 In `apps/creator-web/src/components/TaskWizard.tsx`, drive both the step tabs (`:81-92`) and
      the step bodies (`:103-105`) from `WIZARD_STEP_ORDER` / `stepKeyAt`, so `DetailsStepBody` is
      step 1, `InteractionStepBody` is step 2 and `LocationStepBody` is step 3. Keep each body's
      internals unchanged.
- [x] 8.2 Delete `stepValid` (`:74`) and its use in the Next control (`:119`), so placement no longer
      gates navigation. Verify by inspection that `isTaskLocationValid` now has no navigation call
      site and survives only in `gameReadiness` and `taskPlacementState`.
- [ ] 8.3 <!-- unticked: needs emulator/browser evidence --> Render the "not placed yet" state on the placement step when
      `taskPlacementState(task) === 'unplaced'`, in the calm informational register the step already
      uses (`TaskWizard.tsx:203-206`, `--ink-3` on `--surface-2`), with a place-it action. It must not
      use the `rp-fire` error styling. Confirm no map is mounted on step 1 by loading a fresh task and
      checking the network panel.

## 9. Wire the UI — reveal gating

- [x] 9.1 Hold a `RevealState` in `TaskWizard`, keyed by `task.id` so it resets when a different task
      opens, seeded `revealAll: true` only when the editor was opened from a readiness entry (task
      10.3). Pass `shouldReveal` down to the editors that render messages.
- [x] 9.2 Gate `interactionIncomplete` (`TaskWizard.tsx:109-111`) and the ordering-count error
      (`:298-304`) on `shouldReveal`, and have each editor call `markTouched` on its own field group's
      first change. The auto-padded ordering rows (`:274-278`) must produce no message before a row is
      typed into.
- [x] 9.3 Gate `quizNeedsCorrect` in `apps/creator-web/src/components/QuizChoicesEditor.tsx:92-96` on
      `shouldReveal('quizChoices')`, keeping the two seeded empty rows (`:34-39`) that invite
      authoring. A brand-new quiz must be silent.
- [x] 9.4 Replace the disabled Done control (`TaskWizard.tsx:121`) with an always-enabled one driven by
      `nextFinishAction`: the first press with unrevealed blockers reveals them, keeps the editor open
      and scrolls to the first offender; the next press closes. Never disable it.

## 10. Wire the UI — readiness surface and launch

- [x] 10.1 Render the readiness panel in `apps/creator-web/src/pages/BuilderPage.tsx` beside the launch
      controls (`:411-412`), visible on the build tab without a launch attempt, using the existing
      `Advanced` (`components/ui.tsx:167-190`), `EmptyState` (`:210`) and `Badge` (`:142`) primitives.
      Do not edit `ui.tsx`. It lists every entry from `computeGameReadiness(game)`; an empty result
      renders the ready-to-launch state.
- [x] 10.2 Replace the four sequential guards in `saveAndLaunch` (`BuilderPage.tsx:293-321`) with a
      single `if (!canLaunchGame(game))` that focuses the readiness panel and returns. Delete the four
      `dialog.alert` calls. Leave the save-failure guard (`:292`) and the billing error handling
      (`:325-334`) untouched, and apply the same rule to the test-drive launch (`:411`).
- [x] 10.3 Make each readiness entry navigate: activating one sets the active stage via
      `setActiveStageId` and, for a task issue, opens that task's editor with
      `initialRevealState({ revealAll: true })` so the creator lands on the visible problem. An empty
      game's entry renders without a navigation target.

## 11. Wire the UI — samples and the advanced section

- [x] 11.1 Add the sample action to each card of the type picker
      (`TaskWizard.tsx:807-838`), labelled with the existing `b.loadSampleFor(label)`
      (`i18n.ts:728` / `:1622`). A type with one sample applies it directly; a type with more than one
      presents its sample labels. Applying sets `task.type` and the sample content in a single
      `onChange` so the auto-save debounce sees one coherent task.
- [x] 11.2 Guard the action with `sampleWouldOverwrite`: when it returns a non-empty list, name those
      fields in a `dialog.confirm` before applying; declining leaves the draft unchanged. Applying a
      sample marks nothing touched.
- [x] 11.3 Remove the dead `releaseAt` warning (`TaskWizard.tsx:1014-1016`) and replace it with an
      unconditional read-only disclosure, rendered whenever `task.releaseAt` is present, of the instant
      the task opens. Keep the `validateAvailabilityWindow` error branch (`:1012-1013`) unchanged.
      Verify the advanced section's badge now counts the disclosed setting.

## 12. REFACTOR

- [x] 12.1 Remove any readiness, placement or reveal logic left duplicated inline in `TaskWizard.tsx`
      or `BuilderPage.tsx`, so each rule has exactly one home in `src/lib/`. Confirm by grep that
      `isTaskInteractionValid` and `isTaskLocationValid` are called from `gameReadiness.ts` and the
      placement predicate only, never from a launch guard.
- [x] 12.2 Re-read the task editor against the field inventory and confirm **no capability was lost**:
      every `Task` field reachable before is still reachable, every trigger mode still selectable,
      every collapsible section still present, and the four launch rules still refuse the same games.
- [x] 12.3 Confirm the sample catalogue is still exactly 13 samples across all 9 types and that
      `applySample` is unmodified, so `scripts/test-builder-redesign.ts:84-97` and
      `BuilderRedesign.test.ts:71-86` pass untouched.

## 13. Verify — full gate set

- [ ] 13.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build` and
      `npm run play:build`, and confirm all green.
- [x] 13.2 Run `npm run i18n:check` (PART A must be clean, hard gate) and `npm run i18n:check:strict`,
      and confirm this change adds **zero** new PART B hardcoded-string findings.
- [ ] 13.3 Run `npm run test:ui` and confirm the Builder still renders without a crash after the step
      reorder.
- [ ] 13.4 Manual preview pass. A fresh task opens on the name field, focused, with no map request and
      nothing disabled. A brand-new quiz, ordering quiz, numeric, station and sequence task each show
      **no** message until a field is edited. Loading a sample makes each of the nine types completable
      in one click, and a sample over authored content asks first. A game with three broken tasks shows
      three readiness entries at once; activating one opens the offending task with its message
      visible; launch refuses while entries remain and proceeds once they are gone. A task with an
      expiry shows the advanced badge and the section opens by itself.
      `npm run e2e` is deliberately **not** run for this change: no callable, payload, Firestore rule
      or shared type is touched, and a live playtest tunnel owns the emulator.
