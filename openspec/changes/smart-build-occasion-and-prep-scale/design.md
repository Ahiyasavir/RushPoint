## Context

The `smart_build` path of the new-game flow is a pure questionnaire (`lib/smartBuildWizard.ts`, a
reducer) feeding a pure composer (`lib/composeGame.ts`) over a tagged mission bank (`taskBank.ts`
+ `bankTags.ts`). No callable, no Firestore write, no server state — the whole feature is decided
client-side and only the finished `Game` is saved through the existing `updateGame` path.

Two shapes in that flow are wrong today:

- **Preparation is asked twice on two scales.** Question 6 collects `prepEffort`
  (`'none' | 'light' | 'full'` → a HARD tolerance over the bank's three prep tags), while question
  2 carries an unrelated yes/no for `locationMissions` (pin play-from-anywhere missions to real
  spots). Both are questions about how much work the creator will do; neither admits the step
  between them.
- **Nothing asks what the event is.** `STAGE_BLUEPRINTS` is picked uniformly at random from
  whatever fits the budget, and stage titles come from one generic per-role list — so a wedding
  and a youth-movement activity compose identically.

Constraints inherited from the existing code and its tests:

- `fitScore`'s soft terms are a weighted sum whose weights (`TERM_WEIGHTS`) sum to exactly 1, so a
  perfect mission scores 1. `scripts/test-composer-fit-score.ts` asserts against that.
- Blueprint choice consumes **exactly one RNG draw**; `scripts/test-composer-determinism.ts` pins
  seeded reproducibility.
- Every questionnaire answer must have a default that the composer actually accepts
  (`scripts/test-smart-build-wizard.ts` feeds every default and every offered option through the
  real composer), and the reducer must be total.

## Goals / Non-Goals

**Goals:**
- One monotone 1–5 preparation question that includes "just place the missions on the map" as a
  real, nameable level, and derives pinning from it.
- An occasion question that measurably changes the composed game — the missions it favours, the
  stage structure, and the stage titles.
- Every existing seeded-determinism, bookend, family and prep guarantee stays true.

**Non-Goals:**
- Re-tagging the mission bank. The three prep tags and every entry's tags are untouched, and no
  bank entry gains an occasion tag.
- A fourth bank prep tier for "set it up on site". Levels 3 and 4 share the `needsSetup`
  tolerance.
- Persisting the occasion on the `Game` document, or relating it to `Game.templateGenre`
  (`story | missions`, an admin template flag — a different axis entirely).
- Touching the `scratch` or `guided` creation paths, play-web, functions, or rules.

## Decisions

### 1. `PrepLevel` becomes the number 1–5, not a wider string union

`bankTags.ts` keeps `PREP_TAG_IDS` (`noPrep` / `needsSetup` / `needsPartner`) exactly as it is and
replaces `PREP_LEVELS`/`PrepLevel` with a numeric scale:

```ts
export const PREP_SCALE = [1, 2, 3, 4, 5] as const;
export type PrepLevel = typeof PREP_SCALE[number];
/** Level → index into PREP_TAG_IDS. 1,2 → 0 · 3,4 → 1 · 5 → 2. */
export function prepToleranceOf(level: unknown): number;
/** Level → does the creator want missions pinned to real spots? Level ≥ 2. */
export function prepWantsPlacedMissions(level: unknown): boolean;
```

*Why numeric over five string ids (`'none' | 'pins' | 'homePrep' | 'onSite' | 'partner'`):* the
control is a rating, the semantics are "each level includes the ones below", and both mappings
above are monotone functions of the number. With string ids every one of those becomes a lookup
table that can silently disagree about ordering. A number also makes the "coerce anything into
range" rule one `clamp`, which is what keeps the reducer total.

*Why `prepToleranceOf` keeps returning an index rather than a tag:* `fitScore` already compares
`prepTierOf(tags) > ctx.prepTolerance`, and that comparison is the hard exclusion the whole prep
question exists for. Changing its shape would touch the one line the feature turns on.

**Default = 1.** Today's defaults are `prepEffort: 'light'` (tolerance 1) and
`locationMissions: false`. The single scale cannot preserve both, and the rule this codebase
already follows is that a default must never impose work the creator did not ask for — pinning
obligates them to place every mission in Quick Setup, and self-prep obligates an afternoon. Level
1 imposes nothing. The cost is a smaller default pool (50 `noPrep` bank entries instead of 64),
which is still far above the `MAX_TASKS = 30` ceiling. Alternative considered: default 3 (the
middle of the scale, closest to today's behaviour) — rejected because a creator who taps through
would silently be handed a game requiring them to prepare props and place pins.

### 2. The occasion registry is its own pure module, not a bank tag

New `apps/creator-web/src/lib/occasions.ts`:

```ts
export const OCCASION_IDS = ['birthday','mitzvah','wedding','teamBuilding','youthGroup','other'] as const;
export type OccasionId = typeof OCCASION_IDS[number];

export interface OccasionProfile {
  /** Activity tags this occasion favours. Empty = no bias. */
  favouredTags: readonly ActivityTagId[];
  /** The stage shape this occasion prefers, or null to keep the random pick. */
  blueprint: StageBlueprint | null;
}
export const OCCASIONS: Record<OccasionId, OccasionProfile>;
export function occasionProfile(id: unknown): OccasionProfile; // total, `other` fallback
```

*Why not a `BANK_TAGS` entry:* `bankTags.ts` is explicitly a vocabulary that missions are tagged
with and `fitScore` filters on via `tags.includes(id)`. No mission is tagged "wedding" and none
will be (non-goal above) — an occasion is a property of the *event*, expressed as a bias over tags
that already exist. Putting it in the tag registry would create ids nothing carries, which is
exactly the silent-empty-pool failure `scripts/test-bank-tags.ts` was written to catch.

*Labels live in `i18n.ts`, not here* — same as `SMART_BUILD_WHO`, whose option labels come from
`w.whoOptions[id]`. `occasions.ts` stays free of user-facing text so it can be unit-tested without
a dictionary.

### 3. The occasion bias is an ADDITIVE bonus, never a `TERM_WEIGHTS` member

`TERM_WEIGHTS` sums to 1 by contract. Adding a seventh term means re-weighting the other six,
which changes every score the composer has ever produced and breaks the spec's "the neutral
occasion changes nothing" guarantee. Instead, `fitScore` gains a bonus in the same position
`recencyPenalty` already occupies — outside the normalized sum:

```ts
return base + occasionBonus(tags, ctx.favouredTags) - recencyPenalty(entry.key, ctx.recentIndex);
```

with `OCCASION_BONUS = 0.10` scaled by the share of favoured tags the mission carries, and
identically `0` when `favouredTags` is empty. Same for the level-4 "prefers real spots" nudge:
`PLACED_PREFERENCE_BONUS = 0.08` applied only when the prep level is ≥ 4 and the mission is
`locationBased`. Both are strictly bounded and strictly soft — no mission is excluded, so the
"bias never empties a pool" scenario holds by construction.

### 4. Blueprint selection: prefer the occasion's, fall back to the existing random pick

`pickBlueprint` today draws uniformly from `eligibleBlueprints(budget)` using one RNG draw. The new
rule, in that same function:

1. If the occasion declares a blueprint AND it is eligible for the budget
   (`stageCount * MIN_MISSIONS_PER_STAGE <= budget`) → use it.
2. Otherwise → today's uniform draw over `STAGE_BLUEPRINTS`.

**The RNG draw is consumed in BOTH branches**, discarded in branch 1. Not an optimisation to skip:
every later draw (band sampling, name picking) reads from the same seeded stream, so a branch that
consumes one fewer draw would shift every subsequent decision and make two occasions differ in ways
that have nothing to do with the occasion — and would break `test-composer-determinism.ts`'s
premise that a seed pins the whole composition.

Occasion blueprints are hand-authored per occasion and carry their own `key` (e.g. `wedding-3`), so
`ComposerResult.blueprintKey` keeps naming exactly what shaped the game:

| Occasion | Stages | Shape |
|---|---|---|
| birthday | 3 | front-loaded, quick and playful, gentle curve |
| mitzvah | 4 | even middle, a bigger finale stage |
| wedding | 3 | few stages, many missions each — guests are dressed up and not walking far |
| teamBuilding | 5 | a real arc with a mid-game twist stage |
| youthGroup | 4 | steady, highest difficulty ceiling |
| other | — | `null`: today's random pick, unchanged |

### 5. Stage titles: an optional occasion-aware copy callback

`ComposerDescriptionCopy` gains `occasionStageNames?(occasion: OccasionId, role: StageRole): string[]`.
The existing `stageNames(role)` stays and is the fallback. The composer's existing `listFor(role)`
helper already guards a throwing/malformed callback and falls back to an empty list; the new lookup
sits in front of it with the same guard, so "no occasion copy" and "the copy threw" both degrade to
the generic titles rather than to an untitled stage.

*Why an optional callback rather than a required map:* it keeps every existing caller of
`composeGame` (tests, the preview path) compiling and behaving exactly as before, so the occasion
work cannot regress the generic path.

### 6. The questionnaire shape

`SMART_BUILD_QUESTION_ORDER` becomes
`['occasion','who','areas','people','duration','difficulty','prep','preferred']` (8).
`SmartBuildAnswers` gains `occasion: OccasionId`, changes `prepEffort` to the numeric level, and
**drops `locationMissions`** — `smartBuildAnswers()` derives it via `prepWantsPlacedMissions`. The
`setLocationMissions` action is removed with the chip it drove.

UI (`components/SmartBuildWizard.tsx`): a new first step of occasion chips; the `areas` step loses
its `ChipRow` + hint for pinning; the `prep` step's `ChipRow` becomes an ordered 1–5 rating whose
selected level's sentence is shown beneath it — same "one sentence under the control, not five
side by side on a phone" treatment the three chips already use.

## Test Strategy

Pure-logic lane only (`npm test`, auto-discovered) — the feature has no callable and no server
state, so nothing goes into `scripts/e2e-verify.mjs`. RED first in every case.

| Suite | New assertions |
|---|---|
| `scripts/test-smart-build-wizard.ts` (extend) | 8 questions in order, occasion first; every default composes; occasion default is `other`; prep default is 1; a `0`/`9`/`"full"`/`null` prep level coerces into 1–5; `locationMissions` is derived, not settable; answers survive back-and-forward; back from question 1 signals "left" |
| `scripts/test-composer-prep.ts` (extend) | level→tolerance table (1,2→0 · 3,4→1 · 5→2); no outside-partner mission at levels 1–4; levels 3 and 4 admit the same mission set; absent/malformed level excludes outside-partner |
| `scripts/test-composer-occasion.ts` (**new**) | favoured mission outranks an identical unfavoured one; neutral occasion reproduces the pre-change score exactly; bias never empties a pool; occasion blueprint used when it fits; falls back when the budget is too small; two occasions with different blueprints compose differently |
| `scripts/test-composer-blueprints.ts` (extend) | every occasion blueprint's per-stage counts respect `MIN_MISSIONS_PER_STAGE` at its own minimum budget |
| `scripts/test-composer-determinism.ts` (extend) | the same seed + same answers still reproduce byte-identically, in BOTH branches of `pickBlueprint` |
| `scripts/test-composer-stage-names.ts` (extend) | occasion titles are used; missing occasion copy falls back to generic; a throwing copy callback still yields non-empty titles |
| `scripts/test-composer-fit-score.ts` (extend) | `TERM_WEIGHTS` still sums to 1; the occasion bonus is additive and bounded by `OCCASION_BONUS` |

UI verification: run the creator dev server and click the smart-build path end to end (occasion →
… → prep rating), confirming the location chip is gone and each prep level shows its own sentence.
**`npm run i18n:check:strict` is mandatory** — every new string (6 occasions, 5 level labels, 5
level hints, 5×3 occasion stage titles, question titles/subtitles) goes through `t.*` in
`apps/creator-web/src/i18n.ts` in both HE and EN, zero new PART B findings.

No new Firestore index, no rules change, no env var, no new dependency.

## Risks / Trade-offs

- **Prep default drops from tolerance 1 to tolerance 0, shrinking the tap-through pool** → 50
  `noPrep` bank entries still exceed the 30-mission ceiling; `previewComposition` already shows the
  creator the resulting mission count on the last step, and the shortfall path already explains a
  short game.
- **A creator can no longer ask for outside-party coordination WITHOUT pinned missions** → inherent
  to a monotone scale, and accepted deliberately: the combination is rare, and the pins are a
  Builder step they can undo per mission afterwards.
- **Two more strings-heavy dictionaries (occasion titles ×3 roles) are easy to leak the wrong
  language into** → exactly what `i18n:check:strict` PART A hard-fails on; the suite runs in
  `npm run verify`.
- **Occasion blueprints could over-constrain small games** → they are eligibility-checked against
  the same `MIN_MISSIONS_PER_STAGE` rule as the authored ones and fall back silently, and
  `test-composer-blueprints.ts` asserts each one at its own minimum budget.
- **Reordering `SMART_BUILD_QUESTION_ORDER` desynchronises the component's `steps` array**, which
  is indexed positionally by the shell → the existing rule ("one entry per id, in the same order")
  is already load-bearing; `test-composer-wizard-steps.ts` covers the pairing and is extended with
  the new step.
