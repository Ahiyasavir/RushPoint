# Tasks — Smart Game Composer

Strict TDD. Every group is **RED** (write the failing test, run it, confirm it fails for
the *right reason* — not a syntax error, not a missing import) → **GREEN** (the minimum
code that passes) → **REFACTOR** (tidy, re-run, still green).

Run a single pure test with:

```bash
npx tsx scripts/test-<name>.ts
```

Spec references are to `specs/smart-game-composer/spec.md`; design references (D1–D12) are
to `design.md`.

---

## 1. Prep — extract the mission shorthands (D3)

- [x] 1.1 Confirm the guard passes **before** touching anything:
      `npx vitest run apps/creator-web/src/lib/__tests__/templatesValid.test.ts` from the
      creator-web workspace is green. This test is the regression guard for the move — if
      it is red now, stop and fix that first.
- [x] 1.2 Create `apps/creator-web/src/taskShorthands.ts` exporting `uuid`, `task`,
      `stage`, `photo`, `quiz`, `numeric`, `selfReport`, `survey`, `sequence` — the
      **exact** current bodies from `templates.ts`, moved verbatim, no behavior change.
- [x] 1.3 Delete those definitions from `apps/creator-web/src/templates.ts` and import them
      from `./taskShorthands` instead. Change no template data.
- [x] 1.4 Re-run `templatesValid.test.ts` — still green. Run `npm run typecheck`. This
      group ships no behavior change; if anything differs, the move was not verbatim.

## 2. Bank tag registry (spec: *Canonical bank tag registry*)

- [x] 2.1 **RED** — write `scripts/test-bank-tags.ts` asserting:
      (a) `BANK_TAGS` is non-empty; (b) every id maps to an object with a non-empty `he`
      and a non-empty `en`; (c) every `he` value contains Hebrew characters and no Latin
      letters, and every `en` value contains Latin letters and no Hebrew (the same leak
      predicate the i18n gate uses — import it from `scripts/lib/i18nLeak.ts`, do not
      re-implement it); (d) the ids expected by the composer's narrow aliases
      (`kids`/`youth`/`adults`/`corporate`/`mixed`, `outdoor`/`indoor`/`fromAnywhere`,
      `start`/`finish`) are all present. Run it, confirm it fails on the missing module.
- [x] 2.2 **GREEN** — create `apps/creator-web/src/bankTags.ts` with `BANK_TAGS`,
      `BankTagId`, `AudienceTagId`, `SettingTagId` and the grouped-in-comments-only layout
      from D1. Run the test, confirm green.
- [x] 2.3 **REFACTOR** — add the module header explaining that grouping is documentation
      only, that filtering is always flat `tags.includes(id)`, and that adding a dimension
      must be one registry line. Re-run.

## 3. Tagged mission bank (spec: *Tagged mission bank*)

- [x] 3.1 **RED** — write `scripts/test-task-bank.ts` asserting, over `TASK_BANK`:
      (a) at least 25 entries; (b) every `key` is unique; (c) every `key` is non-empty and
      kebab-case; (d) `build()` called twice yields different `id`s but otherwise
      deep-equal tasks (compare with ids stripped) — the same collision check
      `templatesValid.test.ts` runs; (e) `entry.difficulty === entry.build().difficulty`
      for every entry (D2's anti-drift pin); (f) every tag in `entry.tags` is a key of
      `BANK_TAGS`; (g) at least 4 entries tagged `start` **and** at least 4 tagged
      `finish`; (h) every entry carries ≥1 audience tag and ≥1 of
      `outdoor`/`indoor`/`fromAnywhere`; (i) every `setup[].field` names a field that is
      actually settable on the task `build()` returns (assert the field exists on the built
      task, or is one of the known optional answer-key fields for that task type);
      (j) every `setup[].prompt` is non-empty; (k) every `sourceTemplateKey` matches a real
      `TEMPLATES` key. Run it, confirm it fails on the missing module.
- [x] 3.2 **GREEN (part 1 — content)** — create `apps/creator-web/src/taskBank.ts` with the
      `TaskBankSetup` / `TaskBankEntry` types and migrate the missions from the 11
      templates, **one template at a time**, prose **verbatim** (the bilingual
      `"Hebrew\n\nEnglish"` strings must survive byte-for-byte), reusing the shorthands
      from task 1.2. Do the templates in `TEMPLATES` order and check the diff of each
      before moving to the next.
- [x] 3.3 **GREEN (part 2 — tagging)** — tag every entry against `BANK_TAGS`: every
      template's **opening** task gets `start`, every template's **final-stage** task gets
      `finish`, plus the activity / setting / prep / audience / difficulty-band tags that
      fit. Set `difficulty` to the built task's difficulty, `minAge` where an entry really
      needs one, and carry across each `TemplateSetupStep` that pointed at that exact task
      as that entry's own `setup` (field + prompt + required, dropping the positional
      stage/task indexes).
- [x] 3.4 Run `test-task-bank.ts` — green. Do **not** migrate stage-level
      `narrative.intro/outro`: the bank is a flat mission pool, stage composition is the
      composer's job, and narrative belongs to the later story-path change.
- [x] 3.5 **REFACTOR** — module header explaining why the bank is a peer of `templates.ts`
      and never a runtime `TEMPLATES.flatMap(t => t.build())` (fresh uuids per call would
      break every identity-keyed rule). Re-run.

## 4. Composer foundations — seeded rng, fingerprint, types

- [x] 4.1 **RED** — write `scripts/test-composer-determinism.ts` with only its *first*
      assertions for now: `seededRng(1)` and `seededRng(1)` produce identical sequences of
      20 values; `seededRng(1)` and `seededRng(2)` diverge within 20 values; every value is
      in `[0, 1)`. Run it, confirm it fails on the missing export.
- [x] 4.2 **GREEN** — create `apps/creator-web/src/lib/composeGame.ts` with the exported
      types from D4 (`ComposerAnswers`, `ComposerDescriptionCopy`, `RecentPickState`,
      `ComposerResult`), the `seededRng(seed)` mulberry32, and a `composeGame` stub that
      returns `null`. Run 4.1's test, confirm green.

## 5. Fit score (spec: *Fit-scored slot selection*, *Content variety…* scoring half)

- [x] 5.1 **RED** — write `scripts/test-composer-fit-score.ts` against an exported
      `fitScore(entry, ctx)`, using small hand-built fixture entries (never `TASK_BANK`, so
      the test cannot rot when bank content changes). Assert:
      (a) an entry tagged with the answered audience scores higher than an otherwise
      identical `mixed`-tagged one, which scores higher than an unrelated-audience one;
      (b) the same ordering for setting, with `fromAnywhere` between exact and unrelated;
      (c) `difficultyFit` is maximal when `entry.difficulty === stageTarget` and decreases
      monotonically as the gap widens, never below 0;
      (d) an entry overlapping `preferredTags` scores higher, and when `preferredTags` is
      absent or empty the term contributes 0 to *every* candidate (it must not silently
      penalise);
      (e) an entry whose `minAge` exceeds the band scores lower but **never** `-Infinity`;
      (f) an entry already used is exactly `-Infinity`;
      (g) a `locationBased`-without-`fromAnywhere` entry is exactly `-Infinity` when
      `setting === 'fromAnywhere'`, and is **not** excluded when the setting is
      `outdoor`/`indoor`;
      (h) recency: an entry at position 0 of `recentBankKeys` scores strictly lower than
      the same entry absent from it; position 39 scores higher than position 0; an entry
      beyond `RECENCY_WINDOW` scores exactly as if absent; the penalty never turns a
      finite score into `-Infinity`.
      Run it, confirm it fails on the missing export.
- [x] 5.2 **GREEN** — implement `fitScore` with D6's exact named terms, weights, hard
      filters and recency shape. Run, confirm green.
- [x] 5.3 **RED** — extend the same file for the **band sampler**: against an exported
      `pickFromBand(candidates, rng)`, assert (a) only candidates within `TOP_K_MARGIN` of
      the best are reachable across many seeds; (b) with a band of equal scores every
      member is reachable; (c) with a spread band the top member is picked more often than
      the bottom one over many seeds; (d) a single candidate is returned without consuming
      more than one `rng()` call; (e) an empty candidate list returns `null` rather than
      throwing; (f) exactly one `rng()` call is consumed per invocation (assert with a
      counting rng); (g) **ties break by `key` ascending** — two candidates with byte-equal
      scores always order the same way regardless of their input order.
- [x] 5.4 **GREEN** — implement `pickFromBand` per D6 (band = within `TOP_K_MARGIN` of
      best; weight = `score - minInBand + BAND_EPSILON`; cumulative-sum pick; explicit
      `(b.score - a.score) || a.key.localeCompare(b.key)` comparator). Run, confirm green.
- [x] 5.5 **REFACTOR** — pull the weights and constants (`TOP_K_MARGIN`, `BAND_EPSILON`,
      `RECENCY_WINDOW`, `RECENCY_MAX_PENALTY`, the five term weights) into named exported
      constants so the test asserts against the names, not against magic numbers. Re-run.

## 6. Budget and blueprints (spec: *Mission budget and pacing…*, *Structural variety…*)

- [x] 6.1 **RED** — write `scripts/test-composer-blueprints.ts` asserting, against exported
      `targetTaskCount(minutes, usableBankSize)`, `eligibleBlueprints(target)` and
      `distributeTaskCounts(blueprint, target)`:
      (a) `targetTaskCount` grows monotonically with minutes;
      (b) it is clamped to `[4, 30]` and additionally to `usableBankSize` — a 180-minute
      answer with a 30-entry bank yields 30, not 72 (D5 step 2);
      (c) a bank smaller than 4 yields exactly the bank size;
      (d) junk minutes (0, negative, `NaN`, `Infinity`, `undefined`) yield a value still
      inside the clamp;
      (e) `eligibleBlueprints` excludes any blueprint with `stageCount > target` and is
      never empty for a target ≥ 3;
      (f) `distributeTaskCounts` returns an array of length `stageCount` that sums
      **exactly** to the target, with every element ≥ 1, for every blueprint × every target
      from `stageCount` to 30 (exhaustive loop — this is where off-by-one lives);
      (g) `distributeTaskCounts` is pure: same inputs, same output, no `rng`;
      (h) the distribution respects the blueprint's relative weights (the stage with the
      largest weight never receives fewer missions than one with a smaller weight).
      Run it, confirm it fails on the missing exports.
- [x] 6.2 **GREEN** — implement `STAGE_BLUEPRINTS` (the four shapes from D5),
      `targetTaskCount`, `eligibleBlueprints` and `distributeTaskCounts` (largest-remainder
      over `taskWeights`, floor 1, ties to the lower stage index). Run, confirm green.
- [x] 6.3 **RED** — extend the file for **blueprint selection**: against
      `pickBlueprint(eligible, rng)`, assert (a) exactly one `rng()` call is consumed;
      (b) across many seeds every eligible blueprint is reachable; (c) with one eligible
      blueprint it is returned; (d) with none it returns `null`.
- [x] 6.4 **GREEN** — implement `pickBlueprint`. Run, confirm green.
- [x] 6.5 Assert each blueprint's own shape as data: `taskWeights.length === stageCount`,
      `difficultyCurve.length === stageCount`, every weight > 0, every curve value in
      `[1, 10]`, and every blueprint `key` unique. A malformed blueprint must fail here,
      not at composition time.

## 7. Slot fill and bookends (spec: *Purposeful bookends*, *Fit-scored slot selection*)

- [x] 7.1 **RED** — write `scripts/test-composer-bookends.ts` running the **full**
      `composeGame` over a fixture bank (built to have ≥4 openers, ≥4 finales and enough
      filler) across many seeds and several answer sets. Assert:
      (a) the first mission of stage 0 is always an entry tagged `start`;
      (b) the last mission of the final stage is always an entry tagged `finish`;
      (c) opener and finale are always two **different** entries when the game has >1
      mission;
      (d) across seeds, more than one distinct opener and more than one distinct finale
      appear (they are sampled, not fixed);
      (e) no bank entry appears twice in a composed game;
      (f) with a fixture bank holding **exactly one** opener and one finale, composition
      still succeeds and uses them;
      (g) **bookends are reserved first** — with a fixture bank whose only `finish` entry
      is also the best-scoring entry for every ordinary slot, the finale slot still gets
      it (this is the regression test for filling left-to-right, D5 step 6).
      Run it, confirm it fails.
- [x] 7.2 **GREEN** — implement the fill pipeline of D5 steps 1 and 6: `usableBank` hard
      filter, then `[stage 0 slot 0] → [last stage last slot] → remaining slots in
      stage/slot order`, each slot scoring the remaining pool with `fitScore` and sampling
      with `pickFromBand`. A slot whose pool is empty is dropped; a stage left empty is
      dropped with it. Run, confirm green.
- [x] 7.3 **REFACTOR** — comment the fill order with *why* bookends are reserved first.
      Re-run.

## 8. Stage assembly, duration fit and launch validity (spec: *…launch-valid by construction*)

- [x] 8.1 **RED** — write `scripts/test-composer-validators.ts` running `composeGame` over
      a **matrix** of `{30, 60, 90, 120, 180} minutes × {kids, youth, adults, corporate,
      mixed} × {outdoor, indoor, fromAnywhere} × {easy, balanced, hard} × 5 seeds`, over
      the **real** `TASK_BANK`. For every result assert:
      (a) `gameStructureProblems(stages)` is empty;
      (b) `requiredTaskCountProblem(stage)` is null for every stage;
      (c) `validateUnlockGraph(stage).errors` is empty for every stage (it takes a
      **stage**, not the stages array — mirror `templatesValid.test.ts:81`);
      (d) `validateAvailabilityWindow(task)` is null for every task (it takes a **task**,
      mirroring `templatesValid.test.ts:87`);
      (e) exactly one stage has `isFinal === true`, and it is the last one;
      (f) every stage has ≥1 task;
      (g) every stage's `requiredTaskCount` is ≥1 and ≤ `maxCompletableTasks(stage)`;
      (h) no stage carries `exclusiveGroups`, and no task carries `unlockAfterTaskIds` or
      availability-window fields;
      (i) every `stage.order` equals its index;
      (j) all stage ids and all task ids are globally unique within the result.
      Import the validators from `@rushpoint/shared` — the same ones
      `templatesValid.test.ts` uses — never a reimplementation. Run it, confirm it fails.
- [x] 8.2 **GREEN** — implement D5 steps 7–8: stage assembly (`order`, `isFinal`,
      `requiredTaskCount = tasks.length`), then `planDurationFit(stages, answers.minutes)`
      and apply its overrides, taking `estimatedMinutes` from the returned plan. Run,
      confirm green.
- [x] 8.3 Add one explicit assertion that `requiredTaskCount` is set on **every** stage
      before `planDurationFit` runs — the platform's trimmer only touches a stage that
      already carries a positive count, so a stage left without one is silently
      un-trimmable (D5 step 8).
- [x] 8.4 **REFACTOR** — extract stage assembly into a named helper if the main function is
      getting long. Re-run the matrix.

## 9. Determinism and variety (spec: *Composition is reproducible*, *Content variety…*)

- [x] 9.1 **RED** — extend `scripts/test-composer-determinism.ts` (past 4.1's rng
      assertions) against an exported `composerFingerprint(result)`. Assert:
      (a) two runs with `seededRng(7)` and otherwise identical inputs yield **equal**
      fingerprints;
      (b) their `stages` are equal once ids are stripped;
      (c) **no** stage id and **no** task id is shared between the two runs (ids are always
      fresh);
      (d) across `seededRng(1..30)` with identical answers, at least two distinct
      `blueprintKey`s appear (structural variety) and at least two distinct
      `usedBankKeys` sets appear (content variety);
      (e) a second run whose `recent` is the first run's `usedBankKeys` shares
      meaningfully fewer entries with the first than a second run with empty recency —
      averaged over ≥20 seed pairs, so one unlucky sample cannot make it flaky;
      (f) `composeGame` consumes rng **only** through its argument: running with a counting
      rng gives the same call count for the same inputs.
      Run it, confirm the new assertions fail.
- [x] 9.2 **GREEN** — implement `composerFingerprint` per D4 (blueprint key, per-stage
      mission counts, `requiredTaskCount`s, `usedBankKeys`, description, tags, and each
      wizard step's field + prompt + required + the *index* of the mission it points at —
      never a raw id). Fix any non-determinism the test exposes; the usual culprits are an
      unstable sort and an unordered `Set`/`Object.keys` iteration. Run, confirm green.
- [x] 9.3 **REFACTOR** — document at the top of `composeGame.ts` the exact `rng()` call
      sequence (one for the blueprint, one per slot), because determinism depends on it and
      a future edit that adds a call in the middle would silently change every seeded
      result. Re-run.

## 10. Description and tags (spec: *Composed description and tags…*)

- [x] 10.1 **RED** — write `scripts/test-composer-description-tags.ts` with a fake
      `ComposerDescriptionCopy` whose functions return traceable sentinel strings.
      Assert:
      (a) the description is non-empty and is one paragraph (no newline, no double space);
      (b) it never exceeds `MAX_BLENDED_DESCRIPTION_LEN`, including with deliberately
      enormous sentinel copy;
      (c) every activity phrase named in it corresponds to an activity tag actually carried
      by a chosen mission — assert by mapping the sentinel back to its tag;
      (d) at most 2 activity phrases are named;
      (e) tags include the age word and duration word from the existing `derivedGameTags`,
      plus one word per named activity tag;
      (f) tags pass `normalizeTags` unchanged (idempotence) and number ≤ `MAX_TAGS`;
      (g) **no raw `BankTagId` string appears** in either the description or the tags —
      only copy-provided words;
      (h) `composeGame.ts` source contains no Hebrew character and no English prose
      literal (read the file and assert, the same way `describeNewGame` keeps itself
      language-free).
      Run it, confirm it fails.
- [x] 10.2 **GREEN** — implement `composerDescription` and the tag derivation per D9,
      reusing `derivedGameTags`, `MAX_BLENDED_DESCRIPTION_LEN` and `normalizeTags`. Run,
      confirm green.

## 11. Quick Setup steps (spec: *A composed game's Quick Setup always completes*)

- [x] 11.1 **RED** — write `scripts/test-composer-wizard-steps.ts` running `composeGame`
      over the matrix from 8.1 (a smaller seed count is fine). For every result, build the
      `Game`-shaped object the Builder would hold (`{ stages }`) and assert:
      (a) **every** emitted `TemplateWizardStep` resolves to a non-null target through the
      **real** `resolveWizardTarget` from `packages/shared/src/templateWizard.ts` — import
      it, never reimplement it;
      (b) each step's `stageId` and `taskId` name a stage and task actually present in
      `result.stages`;
      (c) a step exists for a chosen entry's declared setup, and **no** step exists for an
      entry that was not chosen;
      (d) step ids are unique within a result;
      (e) a fixture bank whose entries declare no setup yields `wizardSteps: []` and a
      still-valid game;
      (f) two slots declaring the same `field` produce two distinct step ids;
      (g) every `isRequired` step's target field is one a creator can actually set (the
      resolved target is a real task field, not a stage-only pointer with an empty
      `taskId`, unless the step was declared stage-level).
      Run it, confirm it fails.
- [x] 11.2 **GREEN** — implement the wizard-step build per D8: bind each chosen entry's
      `setup[]` to the ids just minted, id `qs-<slotIndex>-<field>`. Run, confirm green.
- [x] 11.3 **REFACTOR** — note in a comment why the composer does **not** need
      `templates.ts`'s positional build-then-resolve two-step. Re-run.

## 12. Totality and robustness (spec: *Composition produces a complete game*, totality half)

- [x] 12.1 **RED** — write `scripts/test-composer-robustness.ts` asserting `composeGame`
      **never throws** and returns either a valid result or `null`:
      (a) `minutes` of `0`, `-5`, `NaN`, `Infinity`, `1e9`, `undefined`, `'90'` (wrong
      type) — each yields a result that still passes the 8.1 validator battery;
      (b) `people` of `0`, `-1`, `NaN`, `undefined` — same;
      (c) an unknown `ageBandId`, an unknown `audience`, an unknown `setting`, an unknown
      `difficultyPreference` — each yields a valid result;
      (d) `preferredTags` containing unknown ids, duplicates, or non-strings — ignored, not
      thrown on;
      (e) an **empty** bank returns exactly `null`;
      (f) a bank where every entry is hard-filtered out (all `locationBased`, setting
      `fromAnywhere`) returns exactly `null`;
      (g) a 1-entry bank returns either `null` or a game passing the full validator
      battery — never a half-built one;
      (h) a bank entry whose `build()` throws does not take the whole composition down (it
      is skipped);
      (i) `recent` being `undefined`, `null`, `{}`, or holding non-strings is tolerated;
      (j) a `copy` object whose functions return `undefined` still yields a valid result
      with a string description.
      Run it, confirm it fails.
- [x] 12.2 **GREEN** — harden `composeGame` until every case passes. Prefer clamping and
      skipping over throwing; the only non-result outcome is `null`. Run, confirm green.
- [x] 12.3 **REFACTOR** — make sure the hardening is guard clauses at the edges, not
      `try/catch` wrapped around the whole body: a swallowed bug is worse than a thrown
      one. The single permitted `try/catch` is around an individual `entry.build()` call
      (case h). Re-run.

## 13. Recency memory (spec: *Recency memory is per creator…*)

- [x] 13.1 **RED** — write `scripts/test-recent-bank-picks.ts` against an injectable fake
      store. Assert:
      (a) `recentPicksKey(uid)` is `smartBuildRecentKeys:<uid>` and is stable;
      (b) two different uids never read each other's memory;
      (c) a signed-out uid (`undefined`/`null`/`''`) yields a stable anonymous key, not a
      throw and not `smartBuildRecentKeys:undefined`;
      (d) `recordRecentPicks` puts the newest keys **first**;
      (e) the stored list is capped at `RECENCY_WINDOW`, dropping the oldest;
      (f) recording the same key again moves it to the front rather than duplicating it;
      (g) a store that **throws** on `getItem` yields `{ recentBankKeys: [] }`;
      (h) a store that **throws** on `setItem` makes `recordRecentPicks` a silent no-op;
      (i) an absent store (`undefined`) yields an empty memory and a no-op write;
      (j) malformed stored content (`'not json'`, `'{}'`, `'[1,2,3]'`, `'null'`) yields an
      empty memory, never a partially-typed array;
      (k) `recordRecentPicks` with a non-array, or an array holding non-strings, stores
      only the valid strings.
      Run it, confirm it fails.
- [x] 13.2 **GREEN** — implement `apps/creator-web/src/lib/recentBankPicks.ts` per D10 with
      the injectable store parameter. Run, confirm green.
- [x] 13.3 Assert in `test-composer-fit-score.ts` (or a one-line source check in
      `test-composer-robustness.ts`) that `composeGame.ts` **imports nothing** from
      `recentBankPicks.ts` — the pure core must only ever receive a value (D10).

## 14. Smart-build questionnaire reducer (spec: *Smart-build questionnaire*)

- [x] 14.1 **RED** — write `scripts/test-smart-build-wizard.ts` asserting:
      (a) `SMART_BUILD_QUESTION_ORDER` lists audience, setting, people, duration, age,
      difficulty (and preferred tags if included), and its length matches the step config's
      length;
      (b) `initialSmartBuildState()` starts at index 0 with every answer at its default
      from `smartBuildDefaults()`;
      (c) every default is a value the composer accepts (feed each straight into
      `composeGame` and assert a non-null result);
      (d) `next` advances, `back` retreats, and neither runs past either end;
      (e) `back` from index 0 yields the documented "leave the questionnaire" state;
      (f) an answer set, then `back`, then `next`, is still set (answers survive
      navigation);
      (g) `isSmartBuildComplete` is false at every index before the last and true only
      after the last step is confirmed;
      (h) `smartBuildAnswers(state)` returns a well-typed `ComposerAnswers` for **every**
      reachable state, including one where nothing was answered;
      (i) the reducer is **total**: an unknown action type, an `undefined` action, and a
      malformed state each return a usable state rather than throwing;
      (j) selecting then deselecting a preferred tag leaves the list empty, not
      `[undefined]`.
      Run it, confirm it fails.
- [x] 14.2 **GREEN** — implement `apps/creator-web/src/lib/smartBuildWizard.ts` per D11.
      Run, confirm green.

## 15. New-game wizard fork (spec: *Third creation path*, *Nothing is created until…*)

- [x] 15.1 **RED** — extend `scripts/test-new-game-wizard.ts` **additively** (do not edit
      any existing assertion) with:
      (a) `choosePath('smart_build')` moves the wizard to `smartBuildDetails` and sets
      `path: 'smart_build'`;
      (b) `buildCreationPlan` returns `null` for that state (nothing created yet);
      (c) `back` from `smartBuildDetails` returns to `path` with `path: null`;
      (d) `cancel` from `smartBuildDetails` yields `closed` and a `null` plan;
      (e) reaching `done` on the smart-build path yields a plan with
      `kind: 'smart_build'`, the resolved title (including the untitled fallback for a
      blank name), and a `composerAnswers` object the composer accepts;
      (f) the `scratch` and `guided` arms produce byte-identical states and plans to what
      they produced before this change (snapshot the existing expectations explicitly, so
      a regression in the shared reducer is caught here).
      Run it, confirm only the new assertions fail.
- [x] 15.2 **GREEN** — extend `apps/creator-web/src/lib/newGameWizard.ts` additively per
      D11: `WizardPath | 'smart_build'`, `WizardStep | 'smartBuildDetails'`, the new
      `CreationPlan` arm, and the `choosePath`/`back`/`cancel` handling. Touch no existing
      arm. Run the whole file, confirm green.

## 16. UI — stepped shell and questionnaire

- [x] 16.1 Create `apps/creator-web/src/components/SteppedWizard.tsx` — presentational
      only, per D11: `steps`, `index`, `onBack`, `onNext`, `canAdvance`, and a "step N of M"
      progress bar. No game/template/bank knowledge, no callable, no store. Every string
      comes from props.
- [x] 16.2 Hoist `ChipRow` out of `NewGameWizard.tsx` into `components/ui.tsx` and point
      the existing usage at it. No visual change.
- [x] 16.3 Create `apps/creator-web/src/components/SmartBuildWizard.tsx` rendering
      `SteppedWizard` over `smartBuildWizard.ts`'s step config: audience, setting, people,
      duration, age, difficulty preference, optional preferred tags. All copy through
      `t.*`; bank tags rendered via their `BANK_TAGS` label for the current language, never
      their id.
- [x] 16.4 Extend `apps/creator-web/src/components/NewGameWizard.tsx`: a third card on the
      `path` screen (🧠, `t.*` copy) and a render branch for `state.step ===
      'smartBuildDetails'` → `SmartBuildWizard`. Leave the name screen and the two existing
      cards untouched.
- [x] 16.5 Verify RTL: no physical-direction Tailwind class (`ml-`/`mr-`/`text-left`/
      `text-right`/`pl-`/`pr-`) in the new components — use `ms-`/`me-`/`text-start`/
      `text-end`. Creator-web is Hebrew-first.
- [x] 16.6 Do not reach for `text-zinc-*` in the new components — the creator-web scale is
      reversed and reads as ~1.2:1 on light surfaces. Use the `--ink-*` / `--surface-*`
      tokens.

## 17. i18n (spec: *All smart-build copy is translatable*)

- [x] 17.1 **RED** — extend
      `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts` (or add the assertions to
      `scripts/test-bank-tags.ts` if that is where the dictionary lane lives for this
      surface) asserting every new smart-build key exists in **both** dictionaries, with
      the Hebrew value Hebrew and the English value English, using the shared leak
      predicate from `scripts/lib/i18nLeak.ts`. Run, confirm it fails.
- [x] 17.2 **GREEN** — add the Hebrew and English copy to `apps/creator-web/src/i18n.ts`:
      the third fork card, every questionnaire question and option, the progress label, the
      `ComposerDescriptionCopy` implementation (`composedLead`, `activityPhrase`,
      `activityJoin`, `activityTag`), and the fallback toast for a `null` composition. Run,
      confirm green.
- [x] 17.3 Run `npm run i18n:check:strict` and confirm **zero new PART B findings**. Route
      any hardcoded string through `t.*`; use `// i18n-ignore` only for a deliberate
      non-switchable literal, with a reason.

## 18. Commit path (spec: *A composed game is committed through the existing save path*)

- [x] 18.1 Wire the `smart_build` branch into `apps/creator-web/src/pages/DashboardPage.tsx`
      per D12: compose **first**, then `createGame`, then `updateGame`, then
      `recordRecentPicks(user?.uid, result.usedBankKeys)` (only after both calls
      succeeded), then navigate to `/build/<gameId>`.
- [x] 18.2 Handle `composeGame` returning `null`: show the localized fallback toast and
      fall back to the blank creation path. The creator must never be left on a dead
      screen.
- [x] 18.3 Confirm no new callable, no new `services/calls.ts` wrapper, no Firestore rule
      change and no new collection were introduced — `git diff --stat` must show zero
      changes under `functions/`, `firestore.rules` and `firestore.indexes.json`.
- [x] 18.4 Confirm the uncommitted `builder-first-task-flow` edits already present in
      `DashboardPage.tsx` and `i18n.ts` are preserved, not overwritten.

## 19. Preview verification (the product acceptance bar)

- [x] 19.1 `npm run dev:all`, open the creator console, click **+ משחק חדש**, and confirm
      the fork shows **three** cards.
- [x] 19.2 Walk the blank path and the story path end to end — both must behave exactly as
      before.
- [x] 19.3 Walk the smart-build path: every question renders, the progress bar reads
      "step N of M" and advances, back/next preserve answers, and the created game opens in
      the Builder.
- [x] 19.4 **Open Quick Setup on the composed game and complete every required step to a
      working finish** — no broken field reference, no dead end, no step pointing at a
      mission that is not there. This is the explicit product acceptance bar (spec: *A
      composed game's Quick Setup always completes*).
- [x] 19.5 Generate **three** games with identical answers and confirm by eye that they
      differ in stage count and in missions — the whole point of the feature.
- [x] 19.6 Confirm the composed game **launches** (or that Builder readiness reports no
      structural problem), proving the by-construction validity claim end to end.
- [x] 19.7 Switch the console to English and repeat 19.3 — no Hebrew leaks into the English
      flow and no raw tag ids are shown.
- [x] 19.8 Check the browser console for React warnings from the new components (keys,
      conditional hooks). `react-hooks/rules-of-hooks` is a real gate here — a `useState`
      below an early return is exactly how a past crash shipped.

## 20. Full gate run

- [x] 20.1 `npm run typecheck` — green.
- [x] 20.2 `npm run lint` — 0 errors. Confirm `@rushpoint/creator-web:lint` actually appears
      in turbo's output; a gate that never ran looks identical to one that passed.
- [x] 20.3 `npm test` — green, and confirm every new `scripts/test-*.ts` from this change
      appears in the aggregator's output by name. A test file that was never picked up is
      the failure mode this lane exists to prevent.
- [x] 20.4 `npm run creator:build` and `npm run play:build` — green.
- [x] 20.5 `npm run i18n:check:strict` — clean, zero new PART B findings.
- [x] 20.6 `npm run verify` — all nine gates green in one pass.
- [x] 20.7 `npm run e2e` — green, confirming `updateGame`'s server-side validators still
      accept a composed-shaped payload.
- [x] 20.8 Re-read the diff end to end before committing: no debug logging, no `console.log`,
      no commented-out code, no `any` that could have been typed, and every new module
      carrying a header that explains *why* it exists — matching the surrounding code's
      documentation density.
