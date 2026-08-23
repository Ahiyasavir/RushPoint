## Why

A creator's very first screen after "+ New game" is a list of template cards, and the
hardest reported problem with the product is not building a mission — it is understanding
what the app is for and getting far enough in to feel like it is working. The picker asks a
creator to choose between things they cannot evaluate yet, then drops them into a Builder
holding an untitled game whose description, capacity and pacing describe someone else's
event. The vocabulary ("stage", "mission", "template") has to be learned BEFORE any
progress is possible.

The two templates that exist today are well authored and already carry a fully resolved
`wizardSteps` list, so the machinery to guide a creator field-by-field is already built and
already reachable — it just starts too late, after the creator has already had to make the
choices they are least equipped to make.

## What Changes

- **A short pre-Builder wizard replaces the cold template picker** as the "+ New game"
  entry point. It asks the game NAME first (every path needs it, so no creator ever lands
  on "Untitled Game" again), then offers two EQUALLY prominent paths: **start from scratch**
  (today's blank-page behavior, unchanged and never visually subordinate) and **build it for
  me**.
- **The "build it for me" path asks four questions** — game type (story / missions), how
  many people, duration, and age — on as few phone-sized screens as possible. Game type maps
  1:1 onto the two existing admin-flagged templates; the other three answers PERSONALIZE the
  copy rather than select among templates.
- **The copied game is personalized before the creator ever sees it**:
  - Title is the name they typed.
  - Description is a BLEND of the template's authored description and their answers, read as
    one coherent paragraph — not the template's text with an answers block bolted on.
  - Tags derived from age band and duration band are merged into the template's own tags.
  - Group size scales `Task.maxConcurrentTeams` (real station capacity, not decoration) and
    can default `Game.mode` to `individual` for a very small group.
  - Age sets the EXISTING `Game.minAge` / `Game.requiresGuardianConsent` fields, wiring the
    already-built guardian-consent flow to a question a creator can actually answer.
  - Duration shortens the game when the template's estimated run time overruns, by lowering
    `Stage.requiredTaskCount` on eligible stages within the existing winnability ceiling —
    NOT by authoring separate short/long template variants.
- **`createGameFromTemplate` stops silently dropping authored template fields.** It
  currently hardcodes `tags: []` and `registrationFields: DEFAULT_REGISTRATION_FIELDS`, and
  never copies `instructions`, `scoringOptions`, `allowInstantPlay`, `powerUpsEnabled` or
  `manualLeaderboardReveal` at all. Today that means a copy of the story template loses its
  "שם היחידה" registration field, its tone-setting operator instructions, and its
  `manualLeaderboardReveal: true` — the setting that holds the standings back for the plot
  twist. Personalizing a copy is meaningless while the copy is lossy, so this is in scope.
- **After personalization the creator is routed straight into the existing Quick Setup
  flow**, which already consumes the copied `wizardSteps`. No change to Quick Setup itself.
- **A short contextual spotlight on first Builder open** (2–3 steps: "this is a stage",
  "this is a mission") explains the vocabulary in situ. It is separate from, and does not
  replace, the existing 15-step `CreatorTour`, which owns first-signup and was deliberately
  kept from auto-firing on an empty dashboard.

## Capabilities

### New Capabilities
- `guided-new-game-wizard`: The pre-Builder question flow — name first, the equally
  prominent scratch/build fork, the four build-it-for-me questions, and the handoff into
  Quick Setup. Covers what is asked, in what order, what a creator may skip, and what
  happens on each path.
- `template-personalization`: The deterministic rules that turn a template copy plus four
  answers into a personalized game — description blend, tag merge, capacity scaling, mode
  default, minAge wiring, and duration-driven shortening. Also covers the copy fidelity
  requirement (which authored template fields MUST survive `createGameFromTemplate`).
- `builder-first-open-spotlight`: The short in-situ Builder explainer, its trigger
  condition, its persistence, and its relationship to the existing full tour.

### Modified Capabilities
- `guardian-consent`: adds a requirement that a game's `minAge` / `requiresGuardianConsent`
  MAY be set at creation time from the wizard's age answer, rather than only by editing game
  settings after the fact. The consent mechanism itself is unchanged.

## Impact

**Surfaces touched**: creator-web (new wizard UI + Builder spotlight), a modified callable
(`createGameFromTemplate`), shared types are read but not changed.

**Callable change** — `createGameFromTemplate` (functions/src/admin/templates.ts) gains
optional personalization inputs and stops dropping authored template fields. It needs a typed
wrapper update in `apps/creator-web/src/services/calls.ts` and e2e coverage in
`scripts/e2e-verify.mjs` (the callable-coverage guard already requires every callable be
exercised; the assertions must grow to cover the new inputs and the copy-fidelity fix).

**Client code**: `apps/creator-web/src/pages/DashboardPage.tsx` (picker → wizard entry),
a new wizard component, new pure logic modules under `apps/creator-web/src/lib/`, and
`apps/creator-web/src/lib/creatorOnboarding.ts` + `components/CreatorTour.tsx` for the
spotlight (reusing the existing `data-tour` anchor mechanism — `builder-canvas`,
`builder-breadcrumb` and `builder-tabs` already exist in BuilderPage.tsx).

**Reused without modification**: `cloneTemplateStagesWithMap`, `remapWizardStepIds`,
`pruneWizardSteps`, `QuickSetup.tsx` / `lib/quickSetup.ts`, `normalizeTags`
(packages/shared/src/tags.ts), `maxCompletableTasks` / `requiredTaskCountProblem`
(packages/shared/src/mutualExclusion.ts), `effectiveExpectedDurationMinutes`
(packages/shared/src/taskDuration.ts), `validateMinAge`
(packages/shared/src/guardianConsent.ts), `templateCache.ts` / `templatePicker.ts`.

**i18n**: all new copy goes through both dictionaries in `apps/creator-web/src/i18n.ts`;
`npm run i18n:check:strict` must stay clean.

**Mobile**: every new screen is designed and verified at ~390px FIRST. This repo has a
documented pattern of creator-web UI shipping desktop-first and being patched for phones
afterward (the Quick Setup step bar and the mission-editor sheet both did exactly this).

## Non-goals

- **No LLM / AI free-text box.** A "describe your event" field was considered and
  deliberately rejected: it would require either a paid API dependency, a self-hosted model
  on a cost-constrained VPS, or shipping model weights to a phone against the existing bundle
  budget. The structured questions deliver the same outcome deterministically and for free.
- **No admin-template cleanup.** Only the two correct templates are flagged today; nothing
  to remove.
- **No deletion of the dead `apps/creator-web/src/templates.ts`.** It is genuinely unused
  (nothing imports `TEMPLATES`), but removing it is unrelated tech debt and must not ride
  along inside this change.
- **No new template authoring.** The two existing templates are the content; shortening is
  mechanical, never a hand-written second variant.
- **No change to the Quick Setup flow itself**, to the full 15-step `CreatorTour`, or to the
  guardian-consent mechanism.
- **No change to the blank/scratch path's behavior.** It keeps working exactly as it does
  now, and must remain exactly as prominent as the guided path.
