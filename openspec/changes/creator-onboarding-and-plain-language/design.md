## Context

`apps/creator-web` is Hebrew-first with an English toggle, and every user-facing string is supposed
to come from `src/i18n.ts` via `t.*` (INSTRUCTIONS.md §3.D). The first screen a creator ever sees
breaks that rule outright: `src/templates.ts` hardcodes each template's `label` and `description` as
Hebrew string literals (`:41-42`, `:54-55`, `:67-68`, `:89-90`, `:95-96`, `:111-112`, `:121-122`)
inside the exported `TEMPLATES` array, and `DashboardPage.tsx:103` turns that literal into the new
game's title. The template *content* (Hebrew stage names, task prompts, sample answers) is authored
demo data and is a separate concern from the picker chrome.

`DashboardPage.tsx` already holds all the data the onboarding needs: `listGames` populates `games`
(with `stages[].tasks[]`, so task counts are local) and the dashboard already renders per-game play
counts. `useLiveRuns` (`src/hooks/useLiveRuns.ts`) plus `LiveRunSummary` from `@rushpoint/shared`
supply live-run state. Nothing new needs to be fetched, and therefore no callable changes.

`src/hooks/liveRunsPolling.ts` is the precedent this change follows for testability: it is
explicitly "dependency-free (no React, no Firebase) so it runs in the node-env vitest lane"
(`:1-3`) and already exports pure policy (`pollDelayFor`, `selectFeaturedRun`, `runConsolePath`,
`shouldShowBar`, `barMode`). `shouldShowBar` (`:47-55`) currently suppresses the bar on `/live` and
on `runConsolePath(featured)` — i.e. only on the **featured** run's console — which is the bug
behind the "bar offers to end a different run" case in the proposal.

`apps/creator-web/vitest.config.ts` runs `src/**/*.test.ts` in a node environment and is wired into
the repo-wide `npm test` through `turbo run test`. `src/components/__tests__/BuilderRedesign.test.ts`
is the house pattern: prove UI behavior at the pure-logic layer, never by rendering React.

## Goals / Non-Goals

**Goals:**

- A creator who has never used RushPoint can get from an empty account to a live run by following
  the product, without reading documentation.
- The checklist tells the truth: its state is a function of the creator's real games and runs, so it
  can never claim a step is done when it isn't, or vice versa.
- An English-speaking creator's first screen is in English.
- Nothing that shapes a game is decided on the creator's behalf without being shown.
- One action has one name; one concept has one home; no affordance leads to the screen you are on.
- The product describes itself in the creator's words.

**Non-Goals:**

- **No backend work.** No callable added, changed or removed; no Firestore rule, index or security
  change; no `packages/shared` type change; no new env var.
- **No route is deleted.** `/live` is removed from the primary navigation only; `RunsOverviewPage`
  and its `<Route>` remain, because the floating bar navigates into them (`ActiveRunBar.tsx:87`) and
  bookmarks must keep resolving.
- **No capability removal.** Every template, setting, route, control and screen survives. The
  scoring styles and play modes keep their existing values and defaults; only their visibility
  changes.
- **No new dependency** and **no new UI primitive**. `EmptyState`, `Card`, `Button`, `Badge` and
  `Advanced` in `components/ui.tsx` are reused as-is; `ui.tsx` itself is not edited.
- **No visual redesign** beyond that reuse and the existing Tailwind tokens. No new colour, spacing
  or typography system.
- **No `play-web` change**, and no change to what participants or staff see.
- **No translation of template content.** The seeded Hebrew stages, task prompts and sample answers
  inside each template's `build()` stay as authored demo data; only the picker's name and
  description become localized. Translating the content is a separate, larger content decision.
- **No interactive product tour / coach marks.** The checklist is a static, derived list. A
  step-by-step overlay tour is a bigger surface with its own dismissal, focus-management and
  accessibility problems, and is not needed to unblock a first run.
- **No consolidation of the launch entry points or the two analytics homes** beyond naming them
  consistently. Merging them would change routing and Builder tab structure, which belongs with
  `frontend-component-decomposition`, not here.

**Design principle: calm by default, complete on demand.**

## Decisions

### D1 — The checklist is derived, never stored

`src/lib/creatorOnboarding.ts`:

```
type OnboardingStepId = 'createGame' | 'addTask' | 'preview' | 'testRun' | 'launch';

type OnboardingInput = {
  games: { id: string; stages: { tasks: unknown[] }[]; playCount?: number }[];
  runs: { runId: string; testDrive?: boolean; status?: string }[];
  previewedGameIds: string[];   // local-only signal, see D2
  dismissed: boolean;
};

buildOnboardingChecklist(input): {
  visible: boolean;
  steps: { id: OnboardingStepId; done: boolean }[];
  completedCount: number;
}
```

Rules: `createGame` ← `games.length > 0`; `addTask` ← some game has a stage with ≥1 task;
`preview` ← the creator has opened the Builder's preview for a game they own; `testRun` ← a run
exists (test or real — a real launch implies the rehearsal step is behind them); `launch` ← a
non-test run exists. `visible` is `false` when `dismissed` is true or every step is done.

The only stored bit is `dismissed`. Everything else is recomputed from data the dashboard already
loads. *Alternative considered:* persist per-step progress in the user doc. Rejected twice over —
`users/{uid}` writes would need a callable (client writes to owned profile fields exist, but adding
onboarding state there is backend surface this change explicitly excludes), and a stored flag is
exactly the thing that drifts from reality when a creator deletes their only game.

### D2 — The one signal that cannot be derived

"Preview the game" leaves no trace in Firestore — previewing is a Builder tab, not a mutation. It is
therefore recorded as a local-only signal (a set of previewed game ids in `localStorage`), read
through pure `readPreviewedGames(raw)` / `writePreviewedGames(ids)` helpers so malformed or stale
stored data degrades to "not previewed" instead of throwing. This is the honest trade-off: the step
is optimistic across devices, and the checklist's other four steps are not. It is called out here so
the derivation rule in D1 is not mistaken for being total.

### D3 — Template labels move to i18n, template content does not

`GameTemplate` (`templates.ts:29-36`) keeps `key`, `emoji`, `mode`, `scoringPreset` and `build`, and
**drops** `label` / `description` as data. A new pure `templateLabel(key, dict)` /
`templateDescription(key, dict)` in `src/lib/templateLabels.ts` resolves them from
`t.dashboard.templates[key]`, with both `he` and `en` entries added to `i18n.ts`. The picker and
`newGame()` (`DashboardPage.tsx:101-111`) call the resolver, so the created game's title follows the
interface language. An unknown key returns a safe fallback rather than `undefined`, which is a named
test.

*Alternative considered:* keep `label` on the object and add a parallel `labelKey`. Rejected — two
sources of truth for the same string is how the Hebrew literal survived this long.

### D4 — Mode and scoring style are disclosed at creation

The template picker (`DashboardPage.tsx:389-410`) gains, per template, a plain-language line naming
the play mode and the scoring style, plus a control to change the scoring style before confirming.
The mapping from `ScoringPreset` / `GameMode` to creator words is a pure
`describeGameSettings(mode, preset, dict)` in `src/lib/templateLabels.ts`, keyed by the closed unions
from `@rushpoint/shared`, so a new preset cannot be added without a description (typecheck failure).
`newGame()` passes the creator's choice through to the existing `createGame` + `updateGame` calls —
**no callable signature changes**; the same fields are sent, now with values the creator saw.

### D5 — Verb unification and the dead card

- `i18n.ts:885` (`endRun: 'End run'`) and `:1316` (`finalizeRun: 'Finalize run'`) collapse onto one
  English label; the Hebrew is already identical at `:30` and `:467`. One key is kept, the other's
  consumers are repointed, so no duplicate synonym can drift again.
- Quick card #1's target list `['/', '/gallery', '/wallet']` (`DashboardPage.tsx:370`) is replaced by
  targets carried alongside the card copy, and the builder card points at the creator's most recent
  game's builder — or, when the account has no game, at the template picker (the actual next step)
  rather than at `'/'`. The chosen target is a pure `quickCardTarget(cardId, games)` so the
  "navigates to the current screen" case is a test, not a review catch.

### D6 — `shouldShowBar` suppresses on any run console

`liveRunsPolling.ts:47-55` changes from comparing against `runConsolePath(featured)` to matching the
`/run/:gameId/:runId` route shape. The bar then never coexists with a run console, which removes the
"End run ends run A while you are looking at run B" case entirely. `/live` suppression and the
Builder `compact` mode (`barMode`, `:63-65`) are unchanged. This module is already node-env pure and
already has a test lane, so the change is a straight RED-first edit.

### D7 — Live Runs leaves the nav, keeps its route

`App.tsx:49-56` builds a single `NAV` array that is rendered twice: as the desktop inline links and,
below `sm`, as the mobile drawer (`:122-141`). It already has a conditional member —
`...(PAYMENTS_ENABLED ? [{ to: '/wallet', … }] : [])` at `:53` — so it is a rule, not a constant, and
belongs in `src/lib/creatorNav.ts`:

```
type NavDestinationId = 'myGames' | 'gallery' | 'wallet' | 'settings';

buildNavDestinations(input: { paymentsEnabled: boolean }):
  { id: NavDestinationId; to: string; end?: boolean }[]
```

`'/live'` is simply not in the union. Because both renderers consume the same function, the desktop
nav and the drawer cannot diverge, and "is `/live` in the menu?" becomes a unit test instead of a
visual review.

**The route survives.** `<Route path="/live" element={<RunsOverviewPage />} />` and
`RunsOverviewPage.tsx` are untouched, for two verified reasons:

1. `ActiveRunBar.tsx:85-93` renders a "+N more" control whose handler is `nav('/live')` (`:87`).
   Deleting the route would leave the run bar navigating to a not-found screen — a regression in the
   one piece of chrome this change is otherwise strengthening.
2. A creator who bookmarked `/live`, or who follows an older link, must not get a 404.

The "+N more" link **keeps** pointing at `/live`. That is the one job the overview does better than
anything else: showing several concurrent runs side by side. The bar already features exactly one
run (`selectFeaturedRun`, `liveRunsPolling.ts:24-35`), so the overflow case needs a list, and the
list already exists. Redirecting it to the dashboard would replace a purpose-built multi-run screen
with a game grid.

**The new entry point** is the game card. `DashboardPage.tsx` gains live-run awareness via the
existing `useLiveRuns` hook (already used by `ActiveRunBar`; it wraps the existing `listLiveRuns`
call, so **no new callable and no new read pattern**), and a game whose id matches a live run's
`gameId` shows an "open the live run" action alongside Edit / Launch / Test run. The match is a pure
`liveRunForGame(gameId, runs)` in `creatorNav.ts`, so the "shows the action for the wrong game" and
"shows it when there is no run" cases are tests.

### D8 — What this leaves of the three-layer duplication

With `/live` out of the menu and `shouldShowBar` suppressed on **any** run console (D6), the three
chrome layers collapse to two complementary ones: the floating bar (return to a run, from anywhere
else) and the console itself (operate the run). `/live` becomes an overflow screen reached from the
bar or from a bookmark, not a competing home. **The verb problem is not solved by this** and stays a
requirement: the bar's "End run" (`ActiveRunBar.tsx:99-101`, `i18n.ts:885`) and the console's
"Finalize run" (`RunConsolePage.tsx:249`, `i18n.ts:1316`) still call the same `finalizeRun` callable
under two English names, while the Hebrew (`i18n.ts:30`, `:467`) is identical in both. Removing a
menu entry does not make two names for one action correct.

### D9 — Empty states

`DashboardPage.tsx:216-227` (hand-rolled), `RunsOverviewPage.tsx:49` (bare `Card` of text) and the
run console's "no one joined yet" line (`RunConsolePage.tsx:270`) are replaced by `EmptyState` from
`components/ui.tsx:210-221` with title/body/action from `t.*`. `ui.tsx` is not edited. The dashboard
skeleton (`DashboardPage.tsx:446-480`) stops hardcoding six card placeholders; when the account is
known to be empty it renders the hero/stat placeholders only.

### D10 — Plain-language pass is copy-only

The reworded keys are `i18n.ts:1459` (`fireQuestion`), `:1419` (`partialStarvationWarn`), `:1570`
(`typeSelfReport`), `:1448` (`expiryWindowError`), `:1548` (`tolerance`), `:1557` (`estMin`), the
dashboard game-card type chips, and any copy naming "smart routing". Both dictionaries change
together; **no behavior, field, validation or default changes** — the rewrite is confined to string
values. INSTRUCTIONS.md §3.C applies to the new wording (no `—`, `–` or ` - ` as a separator).

## TEST STRATEGY

`apps/creator-web` has **no component test runner**, so every decision above is pushed into a pure
function under `apps/creator-web/src/lib/` (or the already-pure `src/hooks/liveRunsPolling.ts`) and
tested with co-located vitest files picked up by `apps/creator-web/vitest.config.ts`
(`include: ['src/**/*.test.ts']`) and therefore by the repo-wide `npm test`. **No emulator is
needed.** Tests are written RED first, before any component is touched.

**Lane 1 — pure logic (vitest):**

- `apps/creator-web/src/lib/__tests__/creatorOnboarding.test.ts`
  - zero games → all five steps not done, `visible: true`
  - one game, zero tasks → `createGame` done, `addTask` not done
  - one game with a task → `addTask` done
  - only a test-drive run → `testRun` done, `launch` not done
  - one non-test run → both `testRun` and `launch` done
  - `dismissed: true` → `visible: false` regardless of steps
  - all steps done → `visible: false` even when not dismissed
  - established account (game + real run) → `visible: false`
  - determinism: same input recomputed yields the identical result
  - `readPreviewedGames` / `writePreviewedGames`: round-trip; malformed JSON → empty set, no throw
- `apps/creator-web/src/lib/__tests__/templateLabels.test.ts`
  - every `TEMPLATES` key resolves to a non-empty name and description in **both** dictionaries
  - an unknown key returns the defined fallback rather than `undefined`
  - `describeGameSettings` is total over every `GameMode` × `ScoringPreset` pair
  - `quickCardTarget`: the builder card never returns the dashboard route; with no games it returns
    the create path
- `apps/creator-web/src/lib/__tests__/creatorNav.test.ts`
  - `buildNavDestinations` never includes `/live`, in either payments state (**this is the RED test
    for the nav requirement**)
  - with `paymentsEnabled: false` the wallet destination is absent; with `true` it is present
  - the destination list is identical for the desktop nav and the drawer, because both call the same
    function with the same input
  - every destination's `to` is a route the app registers (guards against a nav entry pointing at an
    unrouted path)
  - `liveRunForGame`: returns the run whose `gameId` matches; returns nothing for a game with no
    live run; never returns another game's run; an empty run list does not throw
- `apps/creator-web/src/hooks/__tests__/liveRunsPolling.test.ts` (extend the existing lane)
  - `shouldShowBar` is false on the featured run's console **and** on a non-featured run's console
  - still false on `/live` and `/live/…`; still true on the dashboard, gallery, wallet and builder
  - `barMode` unchanged

**Lane 2 — i18n (hard gate, and a primary goal of this change).** All template names/descriptions and
all reworded copy live in **both** `he` and `en` in `apps/creator-web/src/i18n.ts` and are read via
`t.*`. `npm run i18n:check` PART A (key parity + Hebrew-is-Hebrew / English-is-English) must be clean.
`npm run i18n:check:strict` must add **zero** new PART B findings, and the seven hardcoded Hebrew
literals in `templates.ts` must be **gone** — this change is expected to reduce the PART B count, not
merely hold it. `scripts/test-no-dashes.ts` (inside `npm test`) enforces INSTRUCTIONS.md §3.C on the
new copy.

**Lane 3 — render smoke.** `npm run test:ui` confirms the dashboard, the template picker and the run
console still mount without a crash.

**Lane 4 — manual preview.** With a fresh (gameless) creator account: the dashboard shows the
checklist and no six-card skeleton; switching the interface to English shows English template names;
the picker states the play mode and scoring style and lets the scoring style be changed; creating a
game ticks step 1; adding a task ticks step 2. With two live runs: opening either run's console
hides the floating bar. Confirm the run-ending action reads the same in the bar and the console in
both languages, and that the builder quick card lands in a builder. Confirm "Live runs" is gone from
both the desktop nav and the mobile drawer, that navigating directly to `/live` still renders the
overview, that with two live runs the floating bar's "+N more" still lands there, and that a game
with a run in progress offers "open the live run" from its card.

**Explicitly out of the gate set: `npm run e2e`.** This change alters no callable, no callable
payload, no rule and no shared type, so the emulator lifecycle suite has nothing new to assert — and
the emulator is owned by another process. The gate set for this change is: `npm run typecheck`,
`npm run lint`, `npm test`, `npm run creator:build`, `npm run play:build`, `npm run i18n:check`,
`npm run i18n:check:strict`.

## Risks / Trade-offs

- **[A checklist that lies is worse than no checklist]** → four of the five steps are derived from
  the creator's real games and runs with no stored progress; the fifth (preview) is explicitly
  documented in D2 as a local-only optimistic signal, and every derivation rule is a named test.
- **[Removing `label` from `GameTemplate` breaks a consumer]** → `label`/`description` are only read
  by the picker and by `newGame()`; the type change makes any missed consumer a `npm run typecheck`
  failure rather than a runtime blank.
- **[The new game's title changes language mid-account]** → the title is written once at creation
  from the then-current interface language and is freely editable afterwards; it is data, not chrome,
  and is not retranslated later. Stated so it is a decision, not a surprise.
- **[Suppressing the bar on every run console loses a shortcut]** → the console the creator is on
  already owns those controls, and the bar remains everywhere else. The removed case is one where
  the bar's "End run" pointed at a different run than the screen.
- **[Reworded copy leaks English into the Hebrew console]** → the recurring bug INSTRUCTIONS.md §3.D
  exists for; both dictionaries change together and `npm run i18n:check` PART A is a hard gate on the
  final task.
- **[Plain-language rewording drifts into behavior change]** → the pass is confined to string values
  in `i18n.ts`; no field, validation, default or callable payload is touched, and `npm run typecheck`
  plus the existing pure-logic suites hold that line.
- **[Removing `/live` from the nav strands the overview]** → the route stays registered, the floating
  bar's "+N more" still navigates into it, bookmarks still resolve, and a game's live run gains a
  closer entry point on its own card. A test asserts the route is still reachable while the nav rule
  omits it, so "removed from the menu" can never quietly become "removed from the app".
- **[A creator who relied on the Live Runs tab cannot find their runs]** → the floating bar is
  present on every screen that is not a console or `/live`, and the game card now points at the run
  directly. The overview was the least direct of the three paths, and it is the one being demoted,
  not deleted.
- **[A nav entry points at an unregistered route]** → `buildNavDestinations` is tested against the
  registered route list, so a destination and its `<Route>` cannot drift apart.
- **[`localStorage` unavailable]** → the dismissal flag and previewed-game set are read through pure
  parsers that return defaults on malformed or missing data, so the checklist degrades to "visible,
  preview not done" rather than throwing.

## Migration Plan

None required. This is a client-side presentation and copy change with no persisted schema, no
callable and no rule change. Existing games keep their `mode` and `scoringPreset`; nothing is
backfilled. Rollback is a revert of the creator-web commit; the only residue is two inert
`localStorage` keys.

## Open Questions

- Should the checklist also appear for a creator who has games but has never launched a run
  (a stalled account), or strictly for accounts with zero games? The spec's "established account"
  scenario currently retires it once a real run exists, which implies the stalled account keeps
  seeing it. Confirm that is wanted before implementing the visibility rule.
- Should the run-ending action settle on "End run" (shorter, matches the Hebrew `סיום ריצה`) or
  "Finalize run" (matches the callable name)? The spec requires one; the choice is a copy call.
- Should the live-runs overview also be linked from somewhere static (a small "all runs in progress"
  link at the foot of the game library), or is the floating bar's "+N more" plus the per-game card
  action enough? The spec requires only that the route stays reachable, so either satisfies it.
- Whether "Est. min" should become an estimated-duration phrase or be dropped from the card entirely.
  Dropping it removes information; rewording it lengthens a dense chip. Deferred to the copy pass.
