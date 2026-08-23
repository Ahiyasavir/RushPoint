## 1. RED — onboarding checklist derivation

- [x] 1.1 Create `apps/creator-web/src/lib/__tests__/creatorOnboarding.test.ts` with failing tests
      for `buildOnboardingChecklist` from `../creatorOnboarding` (module does not exist yet): zero
      games yields all five steps not done and `visible: true`; the five steps appear in the defined
      order. Run `npm test` and confirm it fails on the missing module, not on a typo.
- [x] 1.2 Add failing tests for step derivation: one game with zero tasks ticks only `createGame`;
      a game with at least one task ticks `addTask`; a test-drive-only run ticks `testRun` but not
      `launch`; one non-test run ticks both `testRun` and `launch`. Confirm RED.
- [x] 1.3 Add failing tests for retirement: `dismissed: true` yields `visible: false`; all steps done
      yields `visible: false`; an established account (a game plus a real run) never shows it. Add a
      determinism test: recomputing from the same input yields an identical result and depends on no
      stored progress flag. Confirm RED.
- [x] 1.4 Add failing tests for `readPreviewedGames(raw)` / `writePreviewedGames(ids)`: round-trip;
      malformed JSON returns an empty set without throwing. Confirm RED.

## 2. GREEN — onboarding checklist derivation

- [x] 2.1 Create `apps/creator-web/src/lib/creatorOnboarding.ts` with `OnboardingStepId`,
      `OnboardingInput`, `buildOnboardingChecklist` and the two storage parsers. Pure: no React, no
      Firebase, no component imports.
- [x] 2.2 Run `npm test` and confirm sections 1.1-1.4 are green and nothing else regressed.

## 3. RED/GREEN — template labels and settings description

- [x] 3.1 Create `apps/creator-web/src/lib/__tests__/templateLabels.test.ts` with failing tests:
      every key in `TEMPLATES` resolves to a non-empty name and description in **both** the `he` and
      `en` dictionaries; an unknown key returns the defined fallback rather than `undefined`. Confirm
      RED.
- [x] 3.2 Add failing tests for `describeGameSettings(mode, preset, dict)`: it is total over every
      `GameMode` x `ScoringPreset` pair and returns non-empty creator-facing text for each. Confirm
      RED.
- [x] 3.3 Add failing tests for `quickCardTarget(cardId, games)`: the builder card never returns the
      dashboard route; with no games it returns the create path; with games it returns a builder
      path. Confirm RED.
- [x] 3.4 Create `apps/creator-web/src/lib/templateLabels.ts` with all three functions and confirm
      GREEN.

## 4. RED/GREEN — navigation destinations

- [x] 4.1 Create `apps/creator-web/src/lib/__tests__/creatorNav.test.ts` with the failing test that
      encodes the new nav behavior: `buildNavDestinations` from `../creatorNav` **never** includes
      `/live`, in either payments state. Run `npm test` and confirm RED on the missing module.
- [x] 4.2 Add failing tests: `paymentsEnabled: false` omits the wallet destination and `true`
      includes it; the desktop nav and the mobile drawer receive the identical list because both call
      the same function; every returned `to` is a route the app registers. Confirm RED.
- [x] 4.3 Add failing tests for `liveRunForGame(gameId, runs)`: returns the matching run; returns
      nothing when the game has no live run; never returns another game's run; an empty list does not
      throw. Confirm RED.
- [x] 4.4 Create `apps/creator-web/src/lib/creatorNav.ts` with `NavDestinationId`,
      `buildNavDestinations` and `liveRunForGame`, and confirm GREEN.

## 5. RED/GREEN — floating bar suppression

- [x] 5.1 Extend `apps/creator-web/src/hooks/__tests__/liveRunsPolling.test.ts` with a failing test:
      `shouldShowBar` is false on a **non-featured** run's console path (`/run/:gameId/:runId`), not
      only on the featured run's. Keep the existing assertions (false on `/live` and `/live/…`, true
      on the dashboard, gallery, wallet and builder). Confirm RED.
- [x] 5.2 Change `shouldShowBar` in `apps/creator-web/src/hooks/liveRunsPolling.ts:47-55` to match
      the run-console route shape rather than comparing against `runConsolePath(featured)`. Leave
      `barMode` and the `/live` rule untouched. Confirm GREEN.

## 6. i18n — new and reworded copy

- [x] 6.1 Add the template names and descriptions to BOTH `he` and `en` in
      `apps/creator-web/src/i18n.ts` under a `dashboard.templates` map keyed by template key, using
      the current Hebrew literals from `templates.ts:41-42, 54-55, 67-68, 89-90, 95-96, 111-112,
      121-122` as the Hebrew values and authoring the English ones.
- [x] 6.2 Add the checklist step titles and descriptions, the dismiss control's label, the
      plain-language play-mode and scoring-style descriptions, the game card's "open the live run"
      action, and the three empty-state title/body/action sets (dashboard, live-runs overview, run
      console team list) to both dictionaries.
- [x] 6.3 Unify the run-ending verb: collapse `endRun` (`i18n.ts:885`) and `finalizeRun` (`:1316`)
      onto one English label and repoint the other's consumers. The Hebrew (`:30`, `:467`) is already
      identical; keep it that way and leave exactly one key per language.
- [x] 6.4 Reword the engine vocabulary in both dictionaries, string values only: `fireQuestion`
      (`:1459`), `partialStarvationWarn` (`:1419`), `typeSelfReport` (`:1570`), `expiryWindowError`
      (`:1448`), `tolerance` (`:1548`), `estMin` (`:1557`), the dashboard game-card type chips, and
      any copy naming "smart routing" (define it in place or stop naming it). Change no field, no
      validation, no default.
- [x] 6.5 Run `npm run i18n:check` and confirm PART A is clean. Run `npm test` and confirm
      `scripts/test-no-dashes.ts` stays green (no `—`, `–` or ` - ` as a separator in the new copy).

## 7. Wire the UI — onboarding

- [x] 7.1 Render the checklist on `DashboardPage.tsx` from `buildOnboardingChecklist`, fed by the
      games the page already loads and the runs from the existing `useLiveRuns` hook. Add the
      dismiss control. No new callable, no new read.
- [x] 7.2 Record the preview signal when a creator opens the Builder's preview tab, through
      `writePreviewedGames`, and read it back through `readPreviewedGames` on the dashboard.
- [x] 7.3 Fix `DashboardSkeleton` (`DashboardPage.tsx:446-480`) so an account known to be empty does
      not render six game-card placeholders that then collapse into an empty state.

## 8. Wire the UI — templates and creation

- [x] 8.1 Remove `label` and `description` from `GameTemplate` (`templates.ts:29-36`) and from all
      seven template objects, deleting the hardcoded Hebrew literals. Leave every template's `build()`
      content untouched. Let `npm run typecheck` find every consumer.
- [x] 8.2 Resolve names and descriptions in the picker and in `newGame()`
      (`DashboardPage.tsx:101-111`) through `templateLabel` / `templateDescription`, so the created
      game's title follows the interface language.
- [x] 8.3 Show the template's play mode and scoring style in the picker via `describeGameSettings`,
      and let the creator change the scoring style before confirming. Pass the choice through the
      existing `createGame` + `updateGame` calls; **do not change either callable's signature**.

## 9. Wire the UI — navigation and live-run entry points

- [x] 9.1 Replace the inline `NAV` array in `App.tsx:49-56` with `buildNavDestinations`, and have
      both the desktop nav and the mobile drawer (`:122-141`) render from that one list. `/live` is
      no longer a destination.
- [ ] 9.2 <!-- unticked: needs emulator/browser evidence --> Verify by inspection and by running the app that the `/live` `<Route>` and
      `RunsOverviewPage` are still registered and render, and that `ActiveRunBar.tsx:85-93` still
      navigates there for the "+N more" case. Do not change that link's target.
- [x] 9.3 Add an "open the live run" action to a Dashboard game card whose game has a run in
      progress, using `liveRunForGame` over the runs from `useLiveRuns`. A game with no live run
      gains no new control.

## 10. Wire the UI — empty states and the dead quick card

- [x] 10.1 Replace the hand-rolled dashboard empty block (`DashboardPage.tsx:216-227`), the bare
      `Card` on the live-runs overview (`RunsOverviewPage.tsx:49`) and the run console's "no one
      joined yet" line (`RunConsolePage.tsx:270`) with the existing `EmptyState` primitive from
      `components/ui.tsx` (do not edit `ui.tsx`), each with a title, a body and an action where one
      is meaningful.
- [x] 10.2 Replace the positional target list `['/', '/gallery', '/wallet']`
      (`DashboardPage.tsx:370`) with targets carried alongside the card copy, and point the builder
      quick card at `quickCardTarget` so it never navigates to the screen the creator is already on.

## 11. REFACTOR

- [x] 11.1 Remove any nav, template-label or empty-state logic left duplicated inline now that the
      `lib/` modules own it, so each rule has exactly one home.
- [x] 11.2 Re-read the changed screens and confirm no capability was lost: every template still
      creates the same stages, every setting still has its previous default, every route still
      resolves, and every control that existed before still exists.

## 12. Verify — full gate set

- [ ] 12.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build` and confirm all green.
- [ ] 12.2 Run `npm run i18n:check` (PART A must be clean, hard gate) and
      `npm run i18n:check:strict`. Confirm this change adds **zero** new PART B findings and that the
      seven hardcoded Hebrew template literals are gone, so the count goes down rather than sideways.
- [ ] 12.3 Run `npm run test:ui` and confirm the dashboard, the template picker and the run console
      still render without a crash.
- [ ] 12.4 Manual preview pass. Fresh gameless account: the checklist appears, no six-card skeleton,
      English interface shows English template names, the picker discloses play mode and scoring
      style and lets the scoring style change, creating a game ticks step 1, adding a task ticks
      step 2. Two live runs: opening either console hides the floating bar. Navigation: "Live runs"
      is absent from both the desktop nav and the mobile drawer, a direct visit to `/live` still
      renders the overview, the bar's "+N more" still lands there, and a game with a run in progress
      offers "open the live run" on its card. Copy: the run-ending action reads the same in the bar
      and the console in both languages, and the builder quick card lands in a builder.
      `npm run e2e` is deliberately **not** run for this change: no callable, payload, rule or shared
      type is touched, and the emulator is owned by another process.
