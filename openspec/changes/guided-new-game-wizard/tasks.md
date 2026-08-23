## 1. Confirm the open questions

- [x] 1.1 Band values confirmed — see design.md "Resolved decisions". Product owner approved
  the proposed defaults; the guardian-consent threshold was set to **14** (not the proposed
  18) on research grounds, because `requiresGuardianConsent` gates PLAY and defaulting it on
  for a 14–17 youth group would strand teenagers mid-event. Declare all of them as named
  exported constants at the top of `packages/shared/src/gamePersonalization.ts`:
  `SMALL_GROUP_MAX_PEOPLE = 5`, `UNLIMITED_CAPACITY_THRESHOLD = 100`,
  `GUARDIAN_CONSENT_AGE_THRESHOLD = 14`, `TYPICAL_TEAM_SIZE = 5`, plus the age, duration and
  group-size bands. Every later task reads these constants — no magic numbers anywhere else.

## 2. Structural personalization rules (pure, shared) — RED

- [x] 2.1 Write `scripts/test-game-personalization.ts` with FAILING assertions for capacity
  scaling: never below 1, never above the estimated team count, a task at or above the
  unlimited threshold is untouched, and capacity GROWS when the team count exceeds the
  authored value. Run it, confirm it fails because the module does not exist yet.
- [x] 2.2 Extend that test with failing assertions for `defaultModeForGroupSize`: a group at
  or below the small-group threshold yields `individual`, above it keeps the template's mode.
- [x] 2.3 Extend it with failing assertions for `estimateStageMinutes` / `estimateGameMinutes`:
  the estimate counts the `requiredTaskCount` LONGEST completable tasks, an exclusive group
  contributes at most one member (its longest), and durations come from
  `effectiveExpectedDurationMinutes`.
- [x] 2.4 Extend it with failing assertions for `planDurationFit`: deterministic; trims the
  largest-contribution eligible stage first with ties broken by highest `order`; never trims
  the first stage or the `isFinal` stage; never trims a stage with NO explicit
  `requiredTaskCount`; never goes below 1; leaves `requiredTaskCountProblem` clean; never
  pads a game already inside the budget; returns `fits: false` rather than throwing when it
  cannot fit.
- [x] 2.5 Extend it with failing assertions for totality: malformed, missing and
  out-of-range inputs skip their rule and never throw.

## 3. Structural personalization rules — GREEN

- [x] 3.1 Create `packages/shared/src/gamePersonalization.ts` implementing the minimum to
  pass 2.1–2.5, reusing `maxCompletableTasks` / `requiredTaskCountProblem`
  (`mutualExclusion.ts`) and `effectiveExpectedDurationMinutes` (`taskDuration.ts`). Export
  it from `packages/shared/src/index.ts`. Run `node --import tsx scripts/test-game-personalization.ts`
  and confirm green.
- [x] 3.2 REFACTOR: extract shared helpers, write the module header comment explaining WHY
  eligibility is narrow (an unset `requiredTaskCount` means "do all of these", and trimming
  the story template's gold stage would delete its climax). Re-run the test, still green.

## 4. Description blend and derived tags (pure, creator-web) — RED then GREEN

- [x] 4.1 Write `scripts/test-describe-new-game.ts` with FAILING assertions: at least one
  answer-derived value appears in the OPENING sentence; the template's description does not
  appear as an unmodified contiguous prefix followed only by appended detail; the result is a
  single paragraph with no blank-line breaks; it is bounded by a documented maximum length;
  it is byte-identical across two identical calls; a template with an empty/missing
  description still yields usable text. Confirm it fails.
- [x] 4.2 Create `apps/creator-web/src/lib/describeNewGame.ts` (blend + derived tag words,
  taking the resolved dictionary as an argument so it needs no React) implementing the
  minimum to pass 4.1. Confirm green.

## 5. Wizard flow logic (pure, creator-web) — RED then GREEN

- [x] 5.1 Write `scripts/test-new-game-wizard.ts` with FAILING assertions: the name is the
  first question; a blank name resolves to the existing untitled-game fallback; the scratch
  path asks no further questions; every guided question has a documented default and can be
  skipped; game type maps story→story template and missions→missions template; abandoning
  mid-flow yields no creation payload. Confirm it fails.
- [x] 5.2 Create `apps/creator-web/src/lib/newGameWizard.ts` implementing the minimum to pass
  5.1. Confirm green.

## 6. Callable: copy fidelity + personalization — RED

- [x] 6.1 Extend the existing template scenario in `scripts/e2e-verify.mjs` (after the id-remap
  assertions, ~line 7529) with FAILING assertions for COPY FIDELITY: a template carrying
  `instructions`, `manualLeaderboardReveal: true`, custom `registrationFields`,
  `scoringOptions` and `tags` produces a copy carrying all of them. Run `npm run e2e` and
  confirm these fail against today's lossy copy.
- [x] 6.2 Add FAILING assertions that the copy carries NO `isTemplate`, `templateEmoji`,
  `templateOrder`, `templateGroupKey` or `templateLang`, and does not appear in
  `listGameTemplates`.
- [x] 6.3 Add FAILING assertions for the new personalization inputs: `groupSize` changes
  `maxConcurrentTeams`; a small group yields `mode: 'individual'`; an age below the threshold
  sets `minAge` + `requiresGuardianConsent`; an invalid age leaves them unset and still
  creates; `durationMinutes` below the estimate lowers `requiredTaskCount` only on
  author-declared partial stages; the response reports `estimatedMinutes` and
  `fitsRequestedDuration`; client-supplied `description` / `tags` are stored with tags still
  respecting `MAX_TAGS`.
- [x] 6.4 Add a FAILING assertion for BACKWARDS COMPATIBILITY: a call with none of the new
  fields produces exactly today's result, so the existing picker path cannot regress.

## 7. Callable: copy fidelity + personalization — GREEN

- [x] 7.1 Rewrite the `newGame` construction in `createGameFromTemplate`
  (`functions/src/admin/templates.ts`) to copy an explicit ALLOW-LIST of authored fields and
  explicitly omit every template marker. Do not use a spread. Confirm 6.1/6.2 pass.
- [x] 7.2 Apply the personalization inputs in the same callable using
  `gamePersonalization.ts`, validating `minAge` through the existing `validateMinAge`, and
  return `{ gameId, estimatedMinutes, fitsRequestedDuration }`. Confirm 6.3/6.4 pass.
- [x] 7.3 Widen the typed wrapper in `apps/creator-web/src/services/calls.ts` for the new
  optional inputs and the wider response. Confirm `npm run typecheck` passes.
- [x] 7.4 REFACTOR: keep the callable thin — all decisions in the shared pure module, none
  inline. Re-run `npm run e2e`, still green.

## 8. Wizard UI (mobile-first)

- [x] 8.1 Add every new user-facing string to BOTH dictionaries in
  `apps/creator-web/src/i18n.ts` (name prompt, the two path cards, the four questions and
  their options, the preview line, the "may run longer than you asked" notice). No literal
  in any component.
- [x] 8.2 Build `apps/creator-web/src/components/NewGameWizard.tsx` — screen 1 (name + the two
  equally weighted path cards), screen 2 (the four questions as compact chip groups plus the
  chosen template's name/emoji/stage count/mission count above the CTA). Design at 390px
  FIRST, before checking any wider viewport.
- [x] 8.3 Replace the picker modal entry in `apps/creator-web/src/pages/DashboardPage.tsx`
  with the wizard, keeping the scratch path calling exactly today's blank-game code and the
  guided path calling `createGameFromTemplate` with the personalization payload, then
  navigating to `/build/<gameId>` (which already auto-opens Quick Setup via
  `shouldAutoOpenQuickSetup`). Surface the "may run longer" notice when
  `fitsRequestedDuration` is false.
- [x] 8.4 Verify in the browser with the preview tools at a 390px viewport: walk BOTH paths,
  confirm no horizontal overflow and no clipped or overlapping control on either screen, and
  confirm the guided path lands in Quick Setup on a game that is already named and described.

## 9. Builder first-open spotlight

- [x] 9.1 Write `scripts/test-builder-spotlight.ts` with FAILING assertions: at most three
  steps; every step's anchor string actually exists as a `data-tour` attribute in
  `BuilderPage.tsx` (read the file, as `scripts/test-geocode.ts` does); a missing anchor
  skips that step; the seen-record uses a key distinct from `TOUR_SEEN_KEY_PREFIX`; the
  spotlight does not start while the full tour or Quick Setup is active; an unwritable
  storage does not throw. Confirm it fails.
- [x] 9.2 Add the spotlight steps, reducer and seen-record to
  `apps/creator-web/src/lib/creatorOnboarding.ts` to pass 9.1. Confirm green.
- [x] 9.3 Render the spotlight variant via `apps/creator-web/src/components/CreatorTour.tsx`
  and start it from `apps/creator-web/src/pages/BuilderPage.tsx` only when neither the full
  tour nor Quick Setup is active. Add its copy to both dictionaries.
- [x] 9.4 Verify in the browser at 390px: the card is fully visible, does not cover the
  element it describes, its dismiss control is tappable, and it does NOT appear on a
  guided-path game (where Quick Setup owns the screen).

## 10. Full gate run

- [x] 10.1 Run `npm run verify` (typecheck · lint · test · creator:build · play:build ·
  bundle:budget · base:check · origin:check · i18n:check:strict) and confirm ALL green, with
  zero new PART B hardcoded-string findings.
- [ ] 10.2 Run `npm run e2e` and confirm all scenarios pass, including the callable-coverage
  guard.
- [x] 10.3 Confirm the four new pure suites are picked up by the aggregator (they appear in
  the `npm test` output) — a pure-logic test that is not wired into the gate is the exact
  rot this repo added the aggregator to prevent.
