## 1. RED, the recipe registry and its guarantees

- [ ] 1.1 Write `scripts/test-recipes.ts` asserting the registry exists, ids are unique and URL
      shaped, and every recipe carries a name in both languages. Run it and confirm it fails because
      `apps/creator-web/src/lib/recipes.ts` does not exist.
- [ ] 1.2 Add the assertion that matters most: every recipe, merged with `smartBuildDefaults()` and
      passed to the real `composeGame` against the real `TASK_BANK`, produces a game that passes the
      same structural validation the server enforces on save, across several seeds. Confirm it fails.
- [ ] 1.3 Add the invariants: no recipe declares a value equal to the default for a field its name
      does not settle; any declared `prepEffort` is level 1; every declared preferred tag is in
      `preferredTagOptions(recipe.areas)`; every occasion, area, audience and activity id is a member
      of its registry. Confirm they fail.

## 2. RED, the wizard and the deep link

- [ ] 2.1 Extend `scripts/test-smart-build-wizard.ts` with `remainingQuestions`: full ordered list
      for an empty recipe, correct subset for a partial one, empty list for a complete one, and the
      full list for garbage input rather than a throw. Confirm it fails.
- [ ] 2.2 Add navigation assertions over the reduced set: forward past the last remaining question
      finishes, back from the first leaves, and no sequence of next and back reaches a skipped
      question. Confirm it fails.
- [ ] 2.3 Add `readRecipeIntent` assertions to the onboarding test: a known id resolves, and unknown,
      empty, malformed and non string input all yield null without throwing. Confirm it fails.

## 3. GREEN, the two occasions

- [ ] 3.1 Add `education` and `home` to `OCCASION_IDS` in `apps/creator-web/src/lib/occasions.ts`
      with the profiles from the design, each carrying a comment saying what it is tuned for and,
      for `home`, why `chores` is deliberately not favoured and `action` deliberately absent.
- [ ] 3.2 Run `npm run typecheck` immediately. `OCCASIONS` is a total record and other code may
      switch exhaustively on `OccasionId`, so fix every site the compiler names before going on.
- [ ] 3.3 Confirm `other` is untouched: still no favoured tags, still no blueprint.

## 4. GREEN, the registry

- [ ] 4.1 Create `apps/creator-web/src/lib/recipes.ts` with the `Recipe` type holding a
      `Partial<SmartBuildAnswers>`, and a comment explaining why partial rather than complete: a
      declared value is the recipe speaking, a defaulted one is a guess handed to the creator as
      their own choice.
- [ ] 4.2 Declare the eleven recipes from the design's table.
- [ ] 4.3 Add `remainingQuestions(answers)`, pure and total, returning the questions in
      `SMART_BUILD_QUESTION_ORDER` whose key is absent from the partial.
- [ ] 4.4 Run `npx tsx scripts/test-recipes.ts` and confirm every assertion from group 1 passes,
      the compose guarantee included. Fix the recipes, not the test, if a game fails to compose.

## 5. GREEN, the wizard opens part answered

- [ ] 5.1 Read the CURRENT working tree state of `apps/creator-web/src/lib/smartBuildWizard.ts`
      before editing. It carries a large uncommitted change from an earlier session; build on it.
- [ ] 5.2 Add an initial state constructor that takes a partial answer set, seeds the answers with
      it, and records which questions remain.
- [ ] 5.3 Make `next` and `back` walk the remaining questions rather than all eight, so the finished
      and left sentinels still mean what they mean today.
- [ ] 5.4 Run the wizard test and confirm group 2's assertions pass with no existing assertion
      broken.

## 6. GREEN, the deep link

- [ ] 6.1 Add `readRecipeIntent(search)` beside `readStartIntent` in `creatorOnboarding.ts`, total
      and fail closed, with a comment saying an unrecognised id is not an error but simply not an
      instruction.
- [ ] 6.2 Store the held recipe the way `markStartIntent` stores its own, session scoped, so it
      survives the sign in redirect. This is the single point where the whole feature can silently
      become worthless.
- [ ] 6.3 Wire the dashboard and the wizard components to open holding the recipe, composing
      immediately when no question remains.
- [ ] 6.4 Add the recipe display names to `apps/creator-web/src/i18n.ts` in both languages, and run
      `npm run i18n:check:strict`.

## 7. GREEN, the landing pages lead with the recipes

- [ ] 7.1 Add an optional `recipes` list to the landing page type in `scripts/lib/landingPages.ts`,
      each entry `{ id, label, blurb }`, with a comment recording that only the id is shared with the
      app and why the generator does not import the app's registry.
- [ ] 7.2 Declare recipes for the four door subjects in both languages, marketing voice, no dashes.
- [ ] 7.3 Render them as cards with real links carrying `?start=game&recipe=<id>`, placed BEFORE the
      first body section, with the generic call to action kept after them.
- [ ] 7.4 Extend `scripts/test-landing-pages.ts`: every named id exists in the registry, every door
      subject carries at least two, they render before the first section, each link carries its id,
      and the generic action survives. Run and confirm green.
- [ ] 7.5 Run `npm run seo:build` and confirm the regenerated pages carry the new buttons.

## 8. Verify what a source scan cannot see

- [ ] 8.1 Open a one question recipe link against the local creator console and confirm the
      questionnaire shows only that question.
- [ ] 8.2 Open `home-couples-trivia` and confirm no questionnaire appears and a game is composed.
- [ ] 8.3 Open an unknown recipe id and confirm the ordinary wizard opens with no error.
- [ ] 8.4 Confirm the held recipe survives a sign in round trip.
- [ ] 8.5 Confirm the composed game is editable afterwards, and that a pre answered value can still
      be changed.

## 9. Gates

- [ ] 9.1 `npm test`, both lanes green.
- [ ] 9.2 `npm run i18n:check:strict` clean, zero new PART B findings.
- [ ] 9.3 `npm run verify` in full, all nine gates green. Report the result honestly, naming any
      gate that fails.
