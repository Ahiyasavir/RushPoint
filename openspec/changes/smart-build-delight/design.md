## Context

The smart-build path is three pieces today:

- `apps/creator-web/src/lib/smartBuildWizard.ts` — a pure reducer over eight questions. Total,
  defaulted, back-out-signalling.
- `apps/creator-web/src/components/SmartBuildWizard.tsx` — renders those questions through
  `SteppedWizard`, one per screen, with chip rows (`ChipRow` / `MultiChipRow` / `RatingRow`).
  Calls `onFinish(answers)` and creates nothing itself.
- `apps/creator-web/src/pages/DashboardPage.tsx` — receives the answers and calls
  `composeGame(TASK_BANK, answers, composerCopy, Math.random, readRecentPicks(uid))`, then
  `createGame` + `updateGame`, then navigates to the Builder.

Three existing facts constrain everything below, and all three were found in the code rather than
assumed:

1. **Stage count is a random draw.** `composeGame` picks the blueprint with
   `pickBlueprint(eligible, rng)` (`composeGame.ts:1272`) unless the occasion supplies one
   (`occasionBlueprint(...) ?? drawn`, line 1281). The draw is documented as the composer's
   **first** draw, and the module header says the draw order must not be reordered.
2. **A prior change already refused to preview the shape.** `previewComposition`'s docstring says
   it *"Deliberately reports ONLY the mission count. Stage count comes from a randomly drawn
   blueprint … so previewing either would show the creator a game they are not going to get."*
   This change overturns that decision, and must earn it.
3. **Planned slots can be dropped.** When a slot's candidate pool is exhausted the composer skips
   it — `if (!picked) continue; // pool exhausted — the slot is dropped, never faked`
   (`composeGame.ts:1323`). The delivered game can therefore hold fewer missions than were planned.

`seededRng(seed)` already exists and is exported from `composeGame.ts` precisely "so tests and the
determinism guarantee share ONE" implementation. The seeding tool is already in the box.

## Goals / Non-Goals

**Goals:**
- Show the creator the shape of their game while they answer, without showing which missions were
  chosen.
- Guarantee the shape shown is the shape delivered — structurally, not by care.
- Make the finish a moment rather than a navigation.
- Leave the composed output byte-identical for the same answers and seed.

**Non-Goals:**
- Changing which missions the composer picks, or how it scores them.
- Changing the questions, their order, their defaults or the reducer's contract.
- Any server work: no callable, no Firestore write, no shared type, no rules change, no new env
  var, no new index.
- Previewing mission content before the reveal.

## Decisions

### D1. Overturn "never preview the stage count" — by seeding, not by guessing

The prior refusal was correct **given an unseeded `Math.random`**: the composer would draw a
blueprint the preview could not have known. It is no longer correct once the questionnaire owns a
seed, because the blueprint draw is the composer's *first* draw. A preview that seeds a fresh
stream with the same value and takes exactly one draw gets exactly the blueprint the composer will
get, without touching the composer's own stream.

*Alternative considered — compose on every answer and show the result.* Rejected: it re-runs the
whole draw sequence per keystroke, so missions visibly reshuffle while the creator answers, and it
spoils the reveal. It is also the specific thing the module header warns against.

*Alternative considered — show a vague shape ("about 3 stages").* Rejected: a hedged number is
still a promise, and it fails the same way the docstring describes, just less legibly.

### D2. One planning function, called by both — not two that agree

`previewShape` must not re-implement the budget/blueprint/spread logic. The existing
`usableBankFor` docstring already sets the house rule: preview and compose share the filter,
because *"A preview derived independently would drift the first time either side was tuned."*

So: extract the planning steps (`targetTaskCount` → `eligibleBlueprints` → synth fallback →
`pickBlueprint` → `occasionBlueprint` → `distributeTaskCounts`) into one internal
`planStages(bank, answers, rng, recentKeys)` returning `{ blueprint, counts, usable, budget }`.
`composeGame` calls it and continues into slot-filling. `previewShape` calls it and stops. Drift
becomes impossible rather than merely tested-against.

Both stay in `apps/creator-web/src/lib/composeGame.ts`. A separate `previewShape.ts` would import
half the composer's internals and would be the first place drift reappears.

### D3. The seed lives in the questionnaire's reducer state

`SmartBuildAnswers` is the wrong home — it is the composer payload and the seed is not an answer.
Add `seed: number` to `SmartBuildState` beside `index` and `answers`, drawn once in
`initialSmartBuildState()`. It survives navigation for free (the reducer already preserves
unrelated state), and a fresh questionnaire draws a fresh seed, so the same answers can still yield
a different game on a second run.

`onFinish` widens from `(answers)` to `(answers, seed)`; `DashboardPage` swaps `Math.random` for
`seededRng(seed)`. That single-line swap is also what makes the delivered game reproducible for
support ("what did this creator actually get?"), which it is not today.

*Alternative considered — seed derived by hashing the answers.* Rejected: editing any answer would
re-roll the blueprint, so the panel would flicker between shapes for reasons the creator cannot
see.

### D4. Fix the drift `previewComposition` already has

`previewComposition` passes `{ recentBankKeys: [] }` while `composeGame` is handed
`readRecentPicks(uid)`. Recent picks feed `fitScore`, which feeds `usableBankFor`, which feeds the
budget — so today's "how many missions you'll get" number can already disagree with the game
delivered, for any creator who has composed before. Threading the real recent keys into the
preview is in scope here because the shape is built on the same budget; leaving it would build the
panel on a known-wrong number.

### D4b. Stage names belong to the reveal, not the panel

`nameStages` is called **last** in `composeGame` (line 1432), documented as "Named last, so every
draw above kept the sequence it had before stages had names at all". The names therefore consume
draws *after* every slot fill, and no preview can know them without running the entire fill
sequence — the exact thing D1 forbids.

The panel labels stages by position ("stage 1") from `t.*`; the composed names appear for the
first time at the reveal. This is a better split anyway: the shape is what the creator is
watching accumulate, and the naming is part of the payoff.

### D5. The panel plans, the reveal reconciles

Because of dropped slots (context #3), the panel's count is a **plan**, not a promise. The reveal
fills the slots it can and visibly retires any the composer dropped, rather than leaving a
placeholder that never fills. The specs encode this as its own scenario so nobody later "fixes" it
by hiding the discrepancy.

### D6. Presentation stays out of the shell

`SteppedWizard.tsx` is documented as presentational-only and copy-free, and the story path is due
to move onto it. It gains the completion ring and the transition wrapper — both content-free — and
learns nothing about games, missions or shapes. The panel is rendered by `SmartBuildWizard.tsx`
beside the shell, not inside it.

## Risks / Trade-offs

- **Preview and composer drift apart** → D2 makes them one function; `scripts/test-preview-shape.ts`
  asserts agreement across a matrix, driving both sides from the same seed. A test that seeds them
  differently asserts nothing — that is the trap to avoid when writing it.
- **The seed is threaded through but ignored somewhere** → the same test composes twice with one
  seed and asserts identical output, which fails loudly if `Math.random` survives anywhere on the
  path.
- **Dropped slots make the reveal look broken** → D5 retires them visibly; scenario-covered.
- **Refactoring `composeGame` changes composed output** → the change is an extraction with no
  reordering of draws. The existing composer suites (`test-composer-validators`,
  `test-smart-build-wizard`) must stay green untouched; if any of them moves, the extraction was
  not behaviour-preserving and must be redone.
- **Animation harms the phone experience** → the panel is a scrollable strip above the question on
  narrow viewports, never a second column; reduced-motion is honoured throughout.
- **New UI leaks untranslated strings** → all copy through `t.*`; `i18n:check:strict` must add zero
  PART B findings.

## Test Strategy

**Pure logic — `scripts/test-preview-shape.ts`** (new; auto-discovered by
`scripts/run-unit-tests.mjs`). This is the RED-phase test and is written first:

1. For a matrix over occasions × who × durations × prep levels × difficulty, with a fixed seed per
   case: `previewShape(TASK_BANK, answers, seed)` and `composeGame(TASK_BANK, answers, copy,
   seededRng(seed), recent)` agree on stage count, stage order and per-stage planned count.
2. `previewShape` is total: defaults, partial answers, malformed values and a malformed seed all
   return a shape or the explicit no-shape result, never a throw.
3. `previewShape` selects no missions — its result carries no bank key.
4. Determinism: same answers + same seed → identical shape twice; and `composeGame` under one seed
   twice → identical `usedBankKeys`.
5. Impossibility: answers the composer refuses yield `possible: false` from the preview.

**Regression:** `scripts/test-composer-validators.ts` and `scripts/test-smart-build-wizard.ts` must
pass **unmodified** — they are the proof that D2's extraction changed no behaviour.

**UI** (no component runner exists): verify through the preview tools —
- panel present on question 1, updating as answers change, slots empty throughout;
- narrow viewport puts the panel above the question and the page does not scroll horizontally;
- reduced-motion disables the slide and the fill;
- reveal reachable by keyboard, every control has an accessible name;
- the composed game opens in the Builder after the reveal is dismissed.

**Gates:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
**`npm run i18n:check:strict`** (mandatory, zero new PART B findings) — i.e. `npm run verify`.
`npm run e2e` is unaffected (no callable changes) but must stay green.

## Migration Plan

No data migration and no deploy coordination: this is client-only, and a creator mid-flow at
deploy time simply gets the new flow on their next visit. Rollback is reverting the commit —
nothing is persisted in the new shape and no stored document gains a field.

## Resolved Questions

- **Illustrations — DECIDED: new per-option artwork**, drawn as **inline SVG React components**,
  one per option, under `apps/creator-web/src/components/illustrations/`. Inline rather than
  `.svg` files or raster assets because: they inherit the theme through `currentColor` and the
  `--ink-*` / `--surface-*` tokens instead of shipping two colour variants; they add no network
  request and no asset-pipeline step; and they are tree-shaken with the component that uses them.
  Each carries `aria-hidden` — the label beside it is the accessible name, so the artwork never
  becomes a second thing a screen reader reads.
  ⚠️ Drawn flat and geometric (no gradients, no text inside the artwork): text inside an SVG would
  bypass `t.*` and become an untranslatable string the i18n gate cannot see.
- **Panel placement on desktop — DECIDED: trailing side**, so the RTL default keeps the questions
  in the reading-start position.
