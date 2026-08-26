## Why

Today "+ משחק חדש" offers exactly two ways to start: a blank page, or a clone of one
admin-authored template. A creator whose event does not match one of the ~11 hardcoded
shapes must either hand-edit somebody else's game or build from nothing — and a creator
who generates twice gets the same record twice. Neither path produces a game that is
paced for *their* audience, venue, duration and age group.

This change adds a third path: answer a short questionnaire, get back a genuinely
personalized, well-paced game assembled from a tagged task bank — different in both
structure and content on every generation, and launch-valid the moment it opens.

## What Changes

- **New creation path.** The New Game wizard's step-2 fork becomes three cards:
  blank / story-with-plot (today's template path, unchanged here) / **בניית משחק חכמה**
  (smart build). The name screen that already precedes the fork is unchanged.
- **New questionnaire.** Smart build asks audience, setting, group size, duration, age
  band, difficulty preference and (optionally) preferred activity kinds — rendered by a
  new generic stepped-wizard shell with a "step N of M" progress bar and back/next.
- **New composed output.** A pure, client-side composer assembles stages and missions
  from a tagged task bank and returns a complete game: stages (exactly one `isFinal`),
  a written description, derived tags, a Quick Setup step list, scoring preset, mode and
  an estimated duration.
- **Two independent variety layers,** so repeat generations do not feel templated:
  *structural* — the stage shape is drawn from a set of hand-authored blueprints;
  *content* — each slot is filled by weighted-random sampling among near-best-fitting
  bank entries, biased away from what this creator was given recently.
- **Purposeful bookends.** The first mission is drawn only from entries tagged as
  openers and the last only from entries tagged as finales — still fit-scored against
  the creator's answers, never inserted as generic filler.
- **A composed game is launch-valid by construction** — it satisfies the same structural
  validators `updateGame` enforces on save, so a creator can never be handed a game that
  Launch then refuses.
- **A composed game's Quick Setup always completes** — every emitted step resolves to a
  real, settable field on the game that was just created; no dangling pointers, no dead
  ends.
- **No new callable, no new Firestore collection, no rules change.** The composed game is
  committed through the existing `createGame` + `updateGame` pair, exactly like today's
  blank path.

## Capabilities

### New Capabilities
- `smart-game-composer`: the smart-build creation path — its questionnaire, the
  composition rules that turn answers into a paced game, the variety guarantees across
  repeated generations, and the validity/Quick-Setup guarantees on the result.

### Modified Capabilities
<!-- None. No capability currently in openspec/specs/ owns the new-game creation paths,
     and no existing requirement changes: the blank and template paths keep their exact
     current behavior. -->

## Non-goals

- **Not** migrating today's template/"story" path onto the new stepped-wizard shell.
  That is a separate later change; the shell is built generic here so it can be reused
  without rework, but the story path is not touched.
- **Not** a shared or cross-creator task bank. The bank in this change is bundled,
  client-side, and identical for every creator. Submitting, moderating and drawing from
  other creators' missions is a separate later change (it is the one that adds callables
  and a Firestore collection).
- **Not** an LLM or any network call at composition time. Composition is pure local
  computation with no secrets and no cross-owner reads.
- **Not** a change to any existing creation path's behavior, to the template picker, or to
  the seeded template content. (`templates.ts` is touched only to move its private mission
  shorthands into a shared module the bank can reuse — a mechanical import swap with no
  data change, guarded by the existing template validity test. See design D3.)
- **Not** a change to the free-text gallery tag vocabulary (`Task.tags`). The bank's tag
  registry is a separate, closed vocabulary used only for composition.
- **Not** authoring new mission content. The bank's seed content is migrated verbatim
  from the existing templates.

## Impact

**Surfaces touched:** creator-web only. No shared types, no callable, no play-web, no
`firestore.rules`, no Firestore schema.

- **New (creator-web):** `src/bankTags.ts` (canonical tag registry),
  `src/taskShorthands.ts` (mission shorthands, extracted), `src/taskBank.ts`
  (tagged mission pool), `src/lib/composeGame.ts` (pure composer),
  `src/lib/recentBankPicks.ts` (per-creator recency memory, `localStorage`),
  `src/lib/smartBuildWizard.ts` (pure reducer), `src/components/SteppedWizard.tsx`
  (generic shell), `src/components/SmartBuildWizard.tsx`.
- **Extended (creator-web, additively):** `src/lib/newGameWizard.ts` (a third
  `WizardPath`, a new `WizardStep`, a new `CreationPlan` arm),
  `src/components/NewGameWizard.tsx` (third fork card + render branch),
  `src/pages/DashboardPage.tsx` (the smart-build commit branch), `src/i18n.ts`
  (questionnaire + composed-description copy, HE and EN).
- **Refactored, no behavior change:** `src/templates.ts` — its private mission shorthands
  (`task`/`stage`/`photo`/`quiz`/`numeric`/`selfReport`/`survey`/`sequence`) move to a new
  `src/taskShorthands.ts` that both it and the bank import, so the two cannot drift.
- **Read, not modified:** `src/lib/describeNewGame.ts`, `packages/shared`
  (`planDurationFit`, `maxCompletableTasks`, `resolveWizardTarget`, the structural
  validators).
- **Storage:** one new `localStorage` key per creator uid. No server state.
- **Bundle:** the bank and composer are plain data and pure functions in the creator-web
  entry graph; no new dependency.
