# Design — Smart Game Composer

## Context

`apps/creator-web/src/components/NewGameWizard.tsx` asks for a name, then forks into
`scratch` (blank) or `guided` (clone one admin-authored template, personalised by
`createGameFromTemplate`). The fork's state machine is the pure reducer in
`apps/creator-web/src/lib/newGameWizard.ts`; the commit happens in
`apps/creator-web/src/pages/DashboardPage.tsx`.

Both existing paths produce a game whose *content* is fixed. The template path
personalises capacity, mode, consent and pacing (`packages/shared/src/gamePersonalization.ts`)
but never changes which missions the creator gets. Generating twice gives the same missions
twice.

This change adds a third path that composes the mission list itself.

**Constraints that shape the design:**

- Creator-web is Hebrew-first; `npm run i18n:check:strict` is a hard gate and PART B (no
  hardcoded UI strings) must gain zero new findings.
- `updateGame` re-validates every saved game (`stagesProblems` → `gameStructureProblems` +
  `requiredTaskCountProblem` + `validateUnlockGraph` + `validateAvailabilityWindow`). A
  composed game that fails those is worse than no feature: the creator is handed a game
  Launch then refuses.
- There is no component test runner in creator-web, so every rule worth guaranteeing has to
  live in a pure module with a `scripts/test-*.ts` beside it.
- `crypto.randomUUID()` means "identical output" can only ever mean "identical modulo ids".

## Goals / Non-Goals

**Goals:**

- A composed game is launch-valid *by construction*, not by post-hoc repair.
- Every emitted Quick Setup step resolves to a real settable field — verified through the
  platform's own `resolveWizardTarget`, never a reimplementation.
- Two generations with the same answers differ in both stage shape and mission content.
- Composition is a pure function of `(bank, answers, copy, rng, recent)` so all of the
  above is a unit test rather than a click-through.
- The generic stepped-wizard shell is reusable by the later story-path migration with no
  rework.

**Non-Goals:**

- No callable, no Firestore collection, no rules change, no new dependency.
- No migration of the story path onto the new shell (separate change).
- No cross-creator/shared bank (separate change).
- No new mission *content* — the bank's seed content is migrated verbatim from
  `templates.ts`.

## Decisions

### D1. Bank tags are a flat registry; the entry type never grows a dimension

`apps/creator-web/src/bankTags.ts` exports one `BANK_TAGS` object (`id → { he, en }`) and
`export type BankTagId = keyof typeof BANK_TAGS`. Source grouping is comments only.
Filtering is always `entry.tags.includes(id)`.

*Alternative rejected:* a structured `{ audience, setting, prep, activity }` record. It
reads better but every new dimension is then a type change plus a migration of every
entry plus a new accessor — exactly the growth this feature will have. A flat open
vocabulary makes "add a tag" one registry line.

Two narrow aliases are derived from the registry for the answers, because a questionnaire
answer is not a free tag:

```ts
export type AudienceTagId = 'kids' | 'youth' | 'adults' | 'corporate' | 'mixed';
export type SettingTagId  = 'outdoor' | 'indoor' | 'fromAnywhere';
```

Typing `ComposerAnswers.audience` as `AudienceTagId` (not `BankTagId`) makes
"setting passed where audience belongs" a compile error.

### D2. The bank is a peer module, and it declares its own difficulty

`apps/creator-web/src/taskBank.ts`:

```ts
export interface TaskBankSetup { field: string; prompt: string; required?: boolean }

export interface TaskBankEntry {
  key: string;                 // stable, never reused — the recency key
  build: () => Task;           // fresh id on every call
  tags: BankTagId[];
  difficulty: number;          // 1-10, MUST equal build().difficulty (pinned by test)
  minAge?: number;             // a threshold, deliberately NOT a tag
  setup?: TaskBankSetup[];
  sourceTemplateKey: string;   // traceability only
}
export const TASK_BANK: TaskBankEntry[] = [ /* ~30 entries */ ];
```

`difficulty` is duplicated onto the entry **on purpose**. Scoring needs it for every
candidate at every slot; the alternative is calling `build()` to read it, which mints and
discards a uuid per candidate per slot and makes a pure scoring function allocate. The
duplication is a drift risk, so `test-task-bank.ts` asserts `entry.difficulty ===
entry.build().difficulty` for every entry — the drift is impossible to ship.

*Why a peer of `templates.ts`, not nested inside it:* a runtime
`TEMPLATES.flatMap(t => t.build())` would mint fresh uuids on every call, so nothing keyed
on entry identity (recency, no-reuse, tests) could work.

### D3. The mission shorthands move to their own module

`templates.ts`'s `task/stage/photo/quiz/numeric/selfReport/survey/sequence` are module-
private. The bank must build the same shapes. Rather than duplicate them (drift) or export
them from a 487-line data file, they move to a new
**`apps/creator-web/src/taskShorthands.ts`**, and `templates.ts` imports them.

This is the only edit to `templates.ts` in this change: an import replacing eight local
definitions. No template data changes, and
`apps/creator-web/src/lib/__tests__/templatesValid.test.ts` already asserts every template
still builds valid stages with fresh ids — it is the regression guard for the move.

*(This corrects the proposal's "`templates.ts` is not modified": it is, minimally and
mechanically, and the existing test proves the move is behaviour-preserving.)*

### D4. The composer is pure, injected, and returns `null` rather than an invalid game

`apps/creator-web/src/lib/composeGame.ts`:

```ts
export interface ComposerAnswers {
  audience: AudienceTagId;
  setting: SettingTagId;
  people: number;
  minutes: number;
  ageBandId: string;
  difficultyPreference: 'easy' | 'balanced' | 'hard';
  preferredTags?: BankTagId[];
}

export interface ComposerDescriptionCopy extends NewGameDescriptionCopy {
  /** The composed opening clause. */
  composedLead(input: { people: number; minutes: number; ageLabel: string }): string;
  /** A human phrase for an activity tag, e.g. "משימות צילום". */
  activityPhrase(tag: BankTagId): string;
  /** How two/three activity phrases are joined into one sentence. */
  activityJoin(phrases: string[]): string;
  /** The tag word for an activity tag. */
  activityTag(tag: BankTagId): string;
}

export interface RecentPickState { recentBankKeys: string[] }  // most-recent FIRST

export interface ComposerResult {
  stages: Stage[];
  description: string;
  tags: string[];
  wizardSteps: TemplateWizardStep[];
  scoringPreset: ScoringPreset;
  mode: GameMode;
  estimatedMinutes: number;
  /** The keys used, in slot order — what the caller records as recency. */
  usedBankKeys: string[];
  /** The blueprint that shaped it — diagnostics and variety assertions. */
  blueprintKey: string;
}

export function composeGame(
  bank: readonly TaskBankEntry[],
  answers: ComposerAnswers,
  copy: ComposerDescriptionCopy,
  rng: () => number = Math.random,
  recent: RecentPickState = { recentBankKeys: [] },
): ComposerResult | null;
```

**`null` is a real outcome**, returned only when the bank yields zero usable entries. The
alternative — returning a one-blank-mission starter — silently degrades a "smart build"
into a blank game with no way for the caller to say so. `null` lets `DashboardPage` fall
back to the blank path *and* tell the creator. With the bundled bank (≥25 entries, gated)
it is unreachable in production; it exists so the function is total.

`rng` is injected exactly like `now` is in `lib/teamAttention.ts` and
`lib/photoReviewQueue.ts`. `composeGame.ts` also exports `seededRng(seed: number)` (a
mulberry32) so tests and the determinism guarantee share one generator rather than the
tests inventing their own.

Because ids are always fresh, "identical output" is asserted through an exported
`composerFingerprint(result)` that returns the id-free shape (blueprint key, per-stage
mission counts, `requiredTaskCount`s, `usedBankKeys`, description, tags, and each wizard
step's field + prompt + required + the *index* of the mission it points at). Exporting it
keeps the test from reimplementing "what counts as the same game".

### D5. Budget → blueprint → slots, in a fixed order, with a fixed rng call sequence

Determinism means the *sequence* of `rng()` calls must be fixed. The pipeline is:

1. **`usableBank`** — drop entries failing the hard filters (D6), preserving bank array
   order. If empty → return `null`.
2. **`targetTaskCount`** = `clamp(round(minutes / 2.5), 4, min(30, usableBank.length))`,
   and if `usableBank.length < 4`, it is `usableBank.length`. Clamping against the bank
   size is load-bearing: with a ~30-entry bank a 180-minute answer would otherwise ask for
   more slots than there are missions and leave slots unfillable.
3. **Eligible blueprints** = those with `stageCount <= targetTaskCount`. Never empty
   (`classic-3` has 3, and `targetTaskCount >= 3` whenever the bank has ≥3 entries; a bank
   smaller than 3 falls to a single synthesized one-stage blueprint).
4. **Blueprint pick** — one `rng()` call, weighted uniformly among eligible.
5. **Per-stage mission counts** — pure, no `rng()`: give every stage 1, distribute the
   remainder by the **largest-remainder method** over `taskWeights`, ties broken by lower
   stage index. Deterministic and always sums exactly to `targetTaskCount`.
6. **Slot fill order** — bookends **first**, then the rest left to right:
   `[stage 0, slot 0] → [last stage, last slot] → every remaining slot in stage/slot order`.
   Reserving the bookends first is load-bearing: filling left to right could exhaust the
   finale pool on an ordinary slot and make the finale requirement unsatisfiable.
   Each slot consumes exactly one `rng()` call (the band sample), so the call sequence is a
   function of the slot count alone.
7. **Stage assembly** — `order: i`, `isFinal: i === last`,
   `requiredTaskCount: tasks.length`.
8. **Duration fit** — `planDurationFit(stages, answers.minutes)` and apply its overrides.
   Note the platform's rule: it only trims a stage that is neither first nor last, is not
   final, and already carries a positive `requiredTaskCount` — which is why step 7 sets an
   explicit count on every stage. `estimatedMinutes` comes from the returned plan, not
   from a second estimate.
9. **Description, tags, wizard steps** — pure, no `rng()`.

A slot whose pool is empty is **dropped**, and a stage left with zero missions is dropped
with it; `isFinal` is then re-stamped on the surviving last stage. This can only happen
with a degenerate bank, but it means the "no empty stage" and "exactly one final stage"
invariants hold structurally rather than by luck.

### D6. Fit score — named terms, hard filters, deterministic ties

Same shape as `functions/src/routing/assignNextTask.ts`'s `priorityScore`, with
authoring-time terms:

```
fitScore(entry, ctx) =
    0.30 * audienceMatch      // 1 exact tag · 0.6 'mixed' · 0 otherwise
  + 0.25 * settingMatch       // 1 exact tag · 0.8 'fromAnywhere' · 0 otherwise
  + 0.20 * difficultyFit      // 1 - |entry.difficulty - stageTarget| / 9   (clamped ≥ 0)
  + 0.10 * ageFit             // 1 when minAge <= band.from, else linear decay to 0.2 — SOFT
  + 0.15 * preferredOverlap   // |entry.tags ∩ preferredTags| / |preferredTags|, 0 if none asked
  - recencyPenalty(entry.key) // 0.35 * (1 - index/RECENCY_WINDOW), 0 when absent
```

**Hard filters (`-Infinity`, applied before scoring so they never enter the band):**

- already used in this game;
- `answers.setting === 'fromAnywhere'` and the entry is `locationBased` without
  `fromAnywhere` — the creator said there is no venue;
- for a bookend slot, not carrying that slot's bookend tag.

**Age is never a hard filter.** A stated band below every candidate's `minAge` must still
yield a mission; the penalty only reorders.

**Ties are broken by `key`, ascending.** Float sums produce exact ties often enough that
leaving order to `Array.prototype.sort`'s stability across engines would make the
determinism test flaky. The comparator is `(b.score - a.score) || a.key.localeCompare(b.key)`.

**Band sampling.** Candidates within `TOP_K_MARGIN = 0.15` of the best score form the
band. Weight of candidate *i* = `(score_i - minScoreInBand) + BAND_EPSILON` (0.01), so a
band of equal scores samples uniformly and a spread band leans to the top. One `rng()`
call, cumulative-sum pick. Never argmax — argmax with a fixed bank would make every game
with the same answers identical no matter the seed.

**Recency shape.** `recentBankKeys` is most-recent-first, capped at
`RECENCY_WINDOW = 40` (≈5 generations at ~8 missions each). Penalty decays linearly with
position, reaching 0 at the window edge — so "used last generation" is strongly
deprioritised and "used five generations ago" is effectively free. The penalty is bounded
(0.35) and strictly below the score range, so it can bias but never veto.

### D7. Difficulty arc

`stageTarget(i) = clamp(blueprint.difficultyCurve[i] + shift, 1, 10)` where `shift` is
`-2 / 0 / +2` for `easy / balanced / hard`. The preference **shifts** the curve; it does
not flatten it, so a "hard" game still opens easier than it ends.

### D8. Quick Setup is built against real ids, in one pass

`templates.ts` declares setup by *position* and resolves it after `build()`
(`templateWizardSteps`). The composer does not need that indirection: it mints the mission
and knows its id in the same statement. Each chosen entry's `setup[]` becomes one
`TemplateWizardStep` with `stageId`/`taskId` set to the ids just minted, and
`id: qs-<slotIndex>-<field>` (slot index, not entry key, so the id is stable under a
renamed entry and unique when two slots declare the same field).

The guarantee is proven by resolving every emitted step through the real
`resolveWizardTarget` from `packages/shared/src/templateWizard.ts` against the composed
game. Reimplementing the resolver in the test would prove only that the test agrees with
itself.

### D9. Description and tags reuse the existing description machinery

`composerDescription(answers, activityTags, copy)` builds
`copy.composedLead(...)` + `copy.activityJoin(activityTags.map(copy.activityPhrase))`,
collapses to one paragraph and slices to `MAX_BLENDED_DESCRIPTION_LEN` — the same bound
`blendGameDescription` uses.

`activityTags` are the **activity** tags actually present among the chosen missions,
ordered by frequency then tag-registry order, capped at 2. So the description can only
name what the game actually contains.

Tags = `derivedGameTags(answers, copy)` (existing, age + duration words) plus
`copy.activityTag(t)` for each of those activity tags, run through `normalizeTags` so the
clamp, dedupe and separator rules cannot drift from what `updateGame` enforces. Raw
`BankTagId`s never reach `Task.tags` — only the localized tag *words*.

`composeGame.ts` contains no Hebrew and no English, exactly like `describeNewGame.ts`, so
the i18n gate keeps meaning something.

### D10. Recency memory is I/O kept outside the pure core

`apps/creator-web/src/lib/recentBankPicks.ts`:

```ts
export const RECENCY_WINDOW = 40;
export function recentPicksKey(uid: string | undefined | null): string;   // `smartBuildRecentKeys:<uid>`
export function readRecentPicks(uid?: string | null): RecentPickState;    // never throws
export function recordRecentPicks(uid: string | null | undefined, usedKeys: string[]): void; // never throws
```

Both wrappers are wrapped in `try/catch` and tolerate absent/throwing/malformed storage
(Safari private mode, disabled storage, a hand-edited value) by degrading to an empty
memory. A signed-out uid gets a stable anonymous key rather than a crash. Newest keys are
unshifted to the front and the list is sliced to `RECENCY_WINDOW`.

Storage is injectable (`readRecentPicks(uid, store = globalThis.localStorage)`) so the test
drives a fake store — including one that throws — with no global monkey-patching.

### D11. UI — a generic shell plus a separate state machine

- **`components/SteppedWizard.tsx`** — presentational only: `steps: WizardStepConfig[]`
  (`id`, `title`, `subtitle?`, `render(ctx)`), `index`, `onBack`, `onNext`, `canAdvance`,
  and a "step N of M" progress bar. It knows nothing about games, templates or the bank,
  which is what lets the story path adopt it later without rework.
- **`lib/smartBuildWizard.ts`** — smart build's own pure reducer + step config, same idiom
  as `newGameWizard.ts`: `SMART_BUILD_QUESTION_ORDER`, `initialSmartBuildState()`,
  `smartBuildReducer()`, `smartBuildDefaults()`, `isSmartBuildComplete()`,
  `smartBuildAnswers(state): ComposerAnswers`. A **separate** machine from `wizardReducer`
  — bolting six more questions into the existing reducer would put the two flows' rules in
  one switch and make the existing tests guard both.
- **`components/SmartBuildWizard.tsx`** — renders the shell with the questions. `ChipRow`
  is hoisted out of `NewGameWizard.tsx` into `components/ui.tsx` so both use one copy.
- **`lib/newGameWizard.ts`** — additive only: `WizardPath | 'smart_build'`,
  `WizardStep | 'smartBuildDetails'`, and a `CreationPlan` arm
  `{ kind: 'smart_build'; title: string; composerAnswers: ComposerAnswers }`. `choosePath`
  routes `smart_build` to the new step; `back` from it returns to `path` with `path: null`,
  matching the `details` arm. Existing arms are untouched, and
  `scripts/test-new-game-wizard.ts` must stay green without edits to its existing
  assertions.

### D12. Commit — the existing two calls, composed before either

```ts
if (plan.kind === 'smart_build') {
  const result = composeGame(TASK_BANK, plan.composerAnswers, composerCopy,
                             Math.random, readRecentPicks(user?.uid));
  if (!result) { /* toast + fall back to the blank path */ }
  const { gameId } = await createGame({ title: plan.title, mode: result.mode, tags: [] });
  await updateGame({ gameId, stages: result.stages, scoringPreset: result.scoringPreset,
                     description: result.description, tags: result.tags,
                     wizardSteps: result.wizardSteps });
  recordRecentPicks(user?.uid, result.usedBankKeys);
  nav(`/build/${gameId}`);
}
```

Composition completes before the first call, so a composition problem can never leave a
half-built game on the server. `recordRecentPicks` runs only after both calls succeed —
recording a generation the creator never received would push good missions out of the
window for nothing. Failures surface through the page's existing error handling; no new
error path.

## Test strategy

Everything guaranteeable is pure, so the lane is `scripts/test-*.ts`, auto-discovered by
`scripts/run-unit-tests.mjs` and therefore in `npm test` with no wiring.

| Test file | Requirement(s) covered |
|---|---|
| `scripts/test-bank-tags.ts` | Canonical bank tag registry |
| `scripts/test-task-bank.ts` | Tagged mission bank (keys, fresh ids, difficulty parity, bookend pools, classifiability, setup fields) |
| `scripts/test-composer-fit-score.ts` | Fit-scored slot selection; recency scoring shape |
| `scripts/test-composer-blueprints.ts` | Mission budget and pacing; structural variety |
| `scripts/test-composer-bookends.ts` | Purposeful bookends |
| `scripts/test-composer-validators.ts` | Launch-valid by construction (the matrix) |
| `scripts/test-composer-determinism.ts` | Reproducibility; content variety across generations |
| `scripts/test-composer-description-tags.ts` | Composed description and tags |
| `scripts/test-composer-wizard-steps.ts` | Quick Setup always completes (via real `resolveWizardTarget`) |
| `scripts/test-composer-robustness.ts` | Composition totality: junk answers, empty bank, degenerate bank |
| `scripts/test-recent-bank-picks.ts` | Recency memory scoping, bounding, broken-store tolerance |
| `scripts/test-smart-build-wizard.ts` | Questionnaire reducer, defaults, back/forward, plan gating |
| `scripts/test-new-game-wizard.ts` (extended) | Third path in the fork; existing paths untouched |
| `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts` (extended) | Smart-build copy in both dictionaries |

`test-composer-validators.ts` is the load-bearing one: a matrix over
`{durations} × {audiences} × {settings} × {difficultyPreferences} × {seeds}` run through
the exact battery `templatesValid.test.ts` uses (`gameStructureProblems`,
`requiredTaskCountProblem`, `validateUnlockGraph`, `validateAvailabilityWindow`) plus
`maxCompletableTasks`. "Passes this" must mean "`updateGame` accepts it".

**UI** has no component runner, so it is verified through the preview tools: click blank →
story → smart build, complete the questionnaire, confirm the progress bar, confirm the
game opens in the Builder, and **walk Quick Setup to completion with zero errors** — the
explicit product acceptance bar. Plus `npm run i18n:check:strict` with zero new PART B
findings.

**Gates:** `npm run verify` (all nine) and `npm run e2e` — the latter confirms
`updateGame`'s validators still gate a composed-shaped payload. No new e2e scenario is
needed: no callable was added, and the callable-coverage guard is therefore unaffected.

## Risks / Trade-offs

- **Bank size caps game length.** `targetTaskCount` is clamped to the usable bank size, so
  a 3-hour answer with a ~30-entry bank yields ~30 missions, not 72. → Accepted and
  explicit: `estimatedMinutes` reports the truth, and the later shared-bank change is what
  grows the ceiling. The clamp is asserted so it can never silently become "unfillable
  slots" instead.
- **`entry.difficulty` duplicates `build().difficulty`.** → Pinned by `test-task-bank.ts`
  for every entry; drift cannot ship.
- **Moving the shorthands touches `templates.ts`.** → Mechanical import swap, no data
  change, guarded by the existing `templatesValid.test.ts`.
- **Float ties could make determinism engine-dependent.** → Explicit `key`-ascending
  tie-break in the one comparator; asserted directly rather than assumed.
- **Weighted-random means a rare weak game.** A band sample can pick a merely-good entry
  over the best one. → Intentional: an always-argmax composer is a template with extra
  steps. The band is narrow (0.15) and hard filters keep genuinely wrong missions out
  entirely.
- **Recency lives in `localStorage`,** so a cleared browser or a second device forgets it.
  → Acceptable: the failure mode is "one repeated mission", and the alternative is server
  state this change deliberately does not add.
- **Two wizard state machines** in one component. → The alternative is one switch owning
  both flows' rules. They share only the `CreationPlan` union, and each has its own test.
- **`composeGame` returning `null`** adds a branch at the call site. → One `if`, in
  exchange for never being able to hand a creator an invalid game.

## Migration Plan

Additive and client-only. No data migration, no Firestore index, no rules change, no env
var, no deploy ordering constraint. A rollback is reverting the commit: the new files are
unreferenced by any existing path, and the edits to `newGameWizard.ts`,
`NewGameWizard.tsx` and `DashboardPage.tsx` are additive arms on existing unions and
switches.

Note for the implementer: the working tree currently carries uncommitted
`builder-first-task-flow` edits to `DashboardPage.tsx` and `i18n.ts`; this change's edits
to those two files land on top of them.

## Open Questions

None blocking. Two deliberately deferred to the later changes:

- The blueprint set starts at four shapes. Whether it needs more is a content question
  best answered once the bank grows past the migrated ~30 missions.
- `2.5` minutes-per-mission is a seed estimate used only to size the budget *before* real
  missions are known; the real pacing comes from `planDurationFit` on the actual chosen
  missions. It can be retuned without touching any interface.
