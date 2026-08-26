## 1. Prep scale — RED

- [x] 1.1 Extend `scripts/test-composer-prep.ts` with the level→tolerance table from design §1
      (1,2→0 · 3,4→1 · 5→2), `prepWantsPlacedMissions` (false at 1, true at 2–5), and coercion of
      `0` / `9` / `'full'` / `null` / `undefined` into a level that excludes outside-partner
      missions. Run it, confirm it fails because `PREP_SCALE` / `prepWantsPlacedMissions` do not
      exist yet.
- [x] 1.2 Extend `scripts/test-smart-build-wizard.ts`: prep default is 1, `locationMissions` is
      absent from `SmartBuildAnswers` and derived in `smartBuildAnswers()`, no `setLocationMissions`
      action, and a malformed prep level yields a usable state. Run it, confirm RED.

## 2. Prep scale — GREEN

- [x] 2.1 In `apps/creator-web/src/bankTags.ts`: replace `PREP_LEVELS`/`PrepLevel` with the numeric
      `PREP_SCALE` (1–5), rewrite `prepToleranceOf` over it, add `prepWantsPlacedMissions`. Leave
      `PREP_TAG_IDS` and `prepTierOf` untouched. Run 1.1 — GREEN.
- [x] 2.2 In `lib/smartBuildWizard.ts`: `prepEffort` becomes the numeric level with default 1, drop
      the `locationMissions` answer and its action, and derive `locationMissions` in
      `smartBuildAnswers()`. Keep `sanitizeAnswers` clamping the level into range. Run 1.2 — GREEN.
- [x] 2.3 In `lib/composeGame.ts`: `ComposerAnswers.prepEffort` takes the numeric level; update the
      doc comment that still describes `'light'`. Run `npm test` — the whole composer suite green.

## 2b. The `home` area

- [x] 2b.1 Extend `scripts/test-bank-tags.ts`: `home` is a known tag with a HE and an EN label, is
      in `AREA_KIND_TAG_IDS`, and `AREA_SETTING.home === 'indoor'`; `settingForAreas(['home'])` is
      `'indoor'`. Confirm RED.
- [x] 2b.2 Add `home` to `BANK_TAGS` (בית / Home), to `AREA_KIND_TAG_IDS` at the head of the indoor
      group, and to `AREA_SETTING` as indoor. Confirm GREEN — the existing "the classification
      covers exactly the area KINDS" invariant proves nothing was missed.

## 3. Level-4 placed-mission bias — RED → GREEN

- [x] 3.1 Add to `scripts/test-composer-fit-score.ts`: at prep level ≥ 4 a `locationBased` mission
      scores exactly `PLACED_PREFERENCE_BONUS` above an otherwise identical one; at level 3 the two
      score equal; levels 3 and 4 admit exactly the same mission set (no exclusion difference).
      Confirm RED.
- [x] 3.2 Implement the additive bonus in `fitScore` (design §3) — outside `TERM_WEIGHTS`, which
      must still sum to 1. Confirm GREEN and that `test-composer-determinism.ts` still passes.

## 4. Occasion registry — RED → GREEN

- [x] 4.1 Write `scripts/test-composer-occasion.ts` (new, auto-discovered): `occasionProfile` is
      total (unknown/`null`/`42` → the neutral profile); every `OCCASION_IDS` entry has a profile;
      favoured tags are all real `ActivityTagId`s; every occasion blueprint's `taskWeights` length
      equals its `stageCount` and its curve is in 1–10. Confirm RED.
- [x] 4.2 Create `apps/creator-web/src/lib/occasions.ts` with `OCCASION_IDS`, `OccasionProfile`,
      `OCCASIONS` (favoured tags + per-occasion blueprint per the design §4 table) and the total
      `occasionProfile`. Confirm GREEN.

## 5. Occasion drives composition — RED

- [x] 5.1 In `scripts/test-composer-occasion.ts`: a mission carrying a favoured activity tag
      outranks an identical one that does not; the neutral occasion reproduces the pre-change score
      **exactly**; a bank where nothing carries a favoured tag still composes a complete game.
      Confirm RED.
- [x] 5.2 Same file: the occasion's blueprint is used when the budget holds it; a too-small budget
      falls back to an eligible authored blueprint with every stage at or above
      `MIN_MISSIONS_PER_STAGE`; two occasions with different blueprints compose to different stage
      counts or per-stage counts. Confirm RED.
- [x] 5.3 Extend `scripts/test-composer-stage-names.ts`: occasion titles are used when supplied;
      absent `occasionStageNames` falls back to the generic `stageNames`; a callback that throws or
      returns garbage still leaves every stage with a non-empty title. Confirm RED.
- [x] 5.4 Extend `scripts/test-composer-determinism.ts`: the same seed + answers reproduce
      identically under BOTH `pickBlueprint` branches, proving the RNG draw is consumed either way.
      Confirm RED (it will pass only once the discarded draw is implemented).

## 6. Occasion drives composition — GREEN

- [x] 6.1 `ComposerAnswers` gains `occasion?: OccasionId`; `FitContext` gains `favouredTags`;
      `buildFitContext` fills it from the occasion (empty for neutral/malformed). Add the bounded
      additive `occasionBonus` to `fitScore`. Confirm 5.1 GREEN.
- [x] 6.2 `pickBlueprint` prefers the occasion's blueprint when eligible and **consumes the RNG draw
      in both branches**; `ComposerResult.blueprintKey` reports the occasion key. Confirm 5.2 + 5.4
      GREEN.
- [x] 6.3 `ComposerDescriptionCopy` gains optional `occasionStageNames(occasion, role)`; stage
      naming tries it first behind the existing throw-guard and falls back to `stageNames`. Confirm
      5.3 GREEN.
- [x] 6.4 Extend `scripts/test-composer-blueprints.ts`: each occasion blueprint at its own minimum
      budget respects `MIN_MISSIONS_PER_STAGE`. Fix any blueprint that fails. Confirm GREEN.

## 7. Questionnaire wiring — RED → GREEN

- [x] 7.1 Extend `scripts/test-smart-build-wizard.ts`: `SMART_BUILD_QUESTION_ORDER` is the 8-entry
      order with `occasion` first; the occasion default is `other`; every default AND every offered
      option of every question composes a complete game through the real composer; answers survive
      back-and-forward; Back on question 1 signals `SMART_BUILD_LEFT`. Confirm RED.
- [x] 7.2 Add `occasion` to `SMART_BUILD_QUESTION_ORDER`, `SmartBuildAnswers`, the defaults, the
      sanitizer and `smartBuildAnswers()`. Confirm GREEN.
- [x] 7.3 REDIRECTED — `test-composer-wizard-steps.ts` turned out to cover Quick Setup, not the
      component's step array (which no runner can reach). The real risk — a chip rendering a raw id —
      is now guarded purely instead: `scripts/test-smart-build-wizard.ts` asserts every occasion and
      every prep level has a label AND an explanation in BOTH dictionaries, that every declared
      occasion stage-title set is well-formed, and that the retired `prep{None,Light,Full}*` /
      `locationMissions*` keys are GONE rather than merely unused.

## 8. UI + i18n

- [x] 8.1 `components/SmartBuildWizard.tsx`: add the occasion step first; remove the pin-missions
      `ChipRow` + hint from the `areas` step; turn the `prep` step into an ordered 1–5 rating showing
      the selected level's sentence beneath it. Every string via `t.*`. Confirm 7.3 GREEN.
- [x] 8.2 `apps/creator-web/src/i18n.ts`: HE + EN copy for the occasion question (title, subtitle,
      label, 6 option labels), the 5 prep level labels + 5 hints, and the 5×3 occasion stage titles.
      Delete the now-dead `locationMissions*` and old `prep{None,Light,Full}*` keys.
- [x] 8.3 Run `npm run i18n:check:strict` — PART A clean, **zero new** PART B findings.
- [ ] 8.4 NOT RUN — verify in the browser via the preview tools: walk the smart-build path end to end in
      Hebrew, confirm 8 questions, the occasion chips, no pin question in "where", the 1–5 rating
      with a per-level sentence, and that the composed game's stage titles match the occasion.

## 9. Gates

- [x] 9.1 `npm run typecheck` — green (expect fallout wherever `PrepLevel` was a string).
- [x] 9.2 `npm run lint` — 0 errors.
- [x] 9.3 `npm test` — the whole pure-logic lane green, including every extended composer suite.
- [x] 9.4 `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · origin:check · i18n:check:strict) — all nine green in one pass.
- [ ] 9.5 NOT RUN (no functions/auth emulator available locally) — `npm run e2e` — unchanged and green (no callable was touched; this proves it).
