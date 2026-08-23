## Why

RushPoint asks a first-time creator to build a multi-stage geolocated field game, and then tells
them nothing. A brand-new account with zero games lands on a dashboard whose entire onboarding is an
empty state with one button (`DashboardPage.tsx:216-227`): no tour, no checklist, no progress
stepper, no sample game to open, and no guidance after the first save. The two calls to action on
that screen (`:182` and `:224`) open the same template modal, so the screen offers a choice that
isn't one. Before any of that, `DashboardSkeleton` unconditionally renders **six** game-card
skeletons (`:446-480`) — so a creator with zero games watches the app promise a populated dashboard
and then collapse into an empty state.

The first real decision is made silently on their behalf. `newGame()` (`:101-111`) creates the game
with `mode: tpl.mode` and then immediately calls `updateGame` with `scoringPreset:
tpl.scoringPreset` — two settings that shape the entire game, chosen from a template the creator
picked for its picture, never shown, and never mentioned again.

And for an English-speaking creator, that template picker — **the first screen they ever see** — is
not in English. Every template's `label` and `description` is a hardcoded Hebrew literal:
`templates.ts:41-42` (`בר / בת מצווה`), `:54-55`, `:67-68`, `:89-90`, `:95-96`, `:111-112`,
`:121-122`. `newGame()` then uses that Hebrew literal as the new game's title (`:103`). This is not
only an onboarding failure, it is the exact `i18n:check` PART B violation class INSTRUCTIONS.md §3.D
exists to prevent.

Underneath the onboarding gap sits an information architecture that says the same thing in several
places with different words:

- **Live-run state has three homes.** The app-wide floating `ActiveRunBar` (`App.tsx:166`), the
  `/live` `RunsOverviewPage`, and the run console itself. `shouldShowBar` (`liveRunsPolling.ts:47-55`)
  suppresses the bar only on `/live` and on the **featured** run's own console — so a creator with
  two live runs, sitting in run B's console, still sees a floating bar whose "End run" ends **run A**.
- **One callable, two verbs.** `finalizeRun` is "End run" in the bar (`ActiveRunBar.tsx:99-101`,
  `i18n.ts:885`) and "Finalize run" in the console (`RunConsolePage.tsx:249`, `i18n.ts:1316`). The
  Hebrew is identical in both (`i18n.ts:30` and `:467` are both `סיום ריצה`), which proves the split
  is an English-copy accident rather than a deliberate distinction.
- **Launch has three entry points** — the game card's Launch (`DashboardPage.tsx:283`), the card's
  Test run (`:292`), and the Builder's own launch (`BuilderPage.tsx:412`) — each with its own
  guards.
- **Analytics has two homes** — a Builder tab (`BuilderPage.tsx:421-425`) and the run console's
  post-run panel (`RunConsolePage.tsx:259`).
- **The Gallery is reachable three ways from the dashboard alone** — the chrome nav, the banner CTA
  (`DashboardPage.tsx:357`), and quick card #2 (`:370`).
- **Quick card #1 is a dead end.** `d.quickCards[0]` is "Visual builder → Open builder"
  (`i18n.ts:159-163`, `:1014-1018`) and its target is `'/'` (`DashboardPage.tsx:370`) — the dashboard
  the creator is already standing on. Clicking the app's most prominent "get started" affordance does
  nothing.

Finally, the copy speaks the engine's language rather than the creator's: "How does this task fire?"
(`i18n.ts:1459`), a warning about "Locationless tasks" versus a "located station" (`:1419`), "Self
report" as a task-type name (`:1570`), "Empty availability window" as an error (`:1448`), "± tolerance"
(`:1548`), "Est. min" (`:1557`), a "Geofence" chip on a dashboard game card, and "smart routing",
which is referenced in help copy but defined nowhere in the product.

The primitive for the small fixes already exists and is under-used: `EmptyState`
(`components/ui.tsx:210-221`) is used by the Gallery (`GalleryPage.tsx:122`, `:150`) and by **nothing
else** — not the Dashboard's hand-rolled empty block (`DashboardPage.tsx:216-227`), not the run
console, and not `/live`, which shows a bare `Card` of grey text (`RunsOverviewPage.tsx:49`).

## What Changes

**A first-run guided path.**
- A new creator gets a dismissible "get your first game live" checklist with five steps: create a
  game, add a task, preview it, do a test run, launch for real.
- Each step's done/not-done state is derived from the creator's **real** games and runs, never from a
  flag the app sets optimistically. Completing a step in the product ticks it; there is no separate
  "mark as done".
- The checklist disappears once the path is complete or the creator dismisses it, and it never
  reappears for an established account.
- The loading skeleton stops promising content that may not exist: a creator with no games does not
  watch six card skeletons resolve into an empty state.

**Template labels become translatable.**
- Every template's name and description is read from the translation maps in both Hebrew and English,
  so an English creator's first screen is in English. Template *content* (the seeded Hebrew stages
  and tasks) is out of scope and stays as authored sample data.

**The silently-assigned settings become visible.**
- The play mode and the scoring style a template carries are shown at the moment of creation, in
  creator words, and can be changed there before the game is created. Nothing is assigned invisibly.

**One name per action, one home per concept.**
- `finalizeRun` gets a single verb everywhere it appears.
- The dead "Visual builder" quick card either points at a builder or stops claiming to.
- Live-run chrome stops double-representing a run: the floating bar is suppressed on **any** run
  console, not only the featured run's, so the bar can never offer to end a different run than the
  one on screen.

**Live Runs leaves the top-level menu.**
- `/live` is removed from the primary navigation (`App.tsx:49-56`, whose single `NAV` array feeds
  both the desktop links and the mobile drawer at `:122-141`). It is not a primary destination: it is
  the third chrome layer in the duplication described above, and it is empty for most of a creator's
  life.
- **The route stays registered and reachable.** `RunsOverviewPage` is not deleted. The floating bar's
  "+N more" control navigates into `/live` (`ActiveRunBar.tsx:85-93`), so removing the route would
  break the run bar, and a bookmarked link must not 404.
- The entry point moves to where the creator already is: a game with a run in progress exposes
  "open the live run" from its own card in the game library, and the always-present floating bar
  remains the way back to a run. The "+N more" link keeps pointing at `/live`, which is exactly the
  multi-run case that overview is good at.
- The navigation destination list becomes one shared rule so the desktop nav and the mobile drawer
  cannot diverge — it already has more than one input, since `PAYMENTS_ENABLED` gates the Wallet
  entry (`App.tsx:53`).

**Consistent empty states.**
- The Dashboard, the run console's team list and `/live` use the existing `EmptyState` primitive with
  a title, a body and, where an action makes sense, a CTA.

**A plain-language pass.**
- Engine vocabulary in creator-facing copy is replaced with creator vocabulary: what a task "fires"
  on becomes how a player completes it, "locationless" becomes a task with no map pin, "self report"
  becomes the player confirming they did it, "± tolerance" becomes how close the answer must be,
  "empty availability window" becomes a plain statement of the contradiction, and "smart routing" is
  either defined in place or not named at all. Field *behavior* is unchanged; only the words change.

## Capabilities

### New Capabilities
- `creator-first-run-onboarding`: A creator with no games is guided from an empty account to a live
  run by a dismissible checklist whose steps are derived from their real games and runs, sees a
  loading state that matches what they actually have, gets their first-ever screen in their own
  language, and is shown the play mode and scoring style a template carries before the game is
  created rather than having them assigned silently.
- `creator-plain-language-and-ia`: The creator console names one action one way, gives each concept
  one home, keeps its primary navigation to primary destinations while leaving every route reachable,
  surfaces a game's live run from that game rather than from a top-level menu, offers no affordance
  that leads nowhere, uses one empty-state pattern throughout, and describes the product in the
  creator's vocabulary rather than the engine's.

### Modified Capabilities
<!-- None. `task-creation-wizard`, `task-trigger-modes`, `run-billing`, `run-analytics` and
     `free-mode` own the behavior behind the labels this change rewords; none of their requirements
     change. `ui-text-standards` (INSTRUCTIONS.md §3.C/§3.D) is satisfied by, not modified by, this
     change. -->

## Impact

- **Surfaces touched:** `apps/creator-web` **only**. No callable is added or changed, no Firestore
  rule, no index, no `packages/shared` type, no `play-web` change, no new env var, no new dependency.
- **Files:** `src/App.tsx` (the `NAV` array and the mobile drawer), `src/pages/DashboardPage.tsx`,
  `src/templates.ts`, `src/pages/RunsOverviewPage.tsx`, `src/pages/RunConsolePage.tsx` (empty state +
  the finalize verb), `src/components/ActiveRunBar.tsx`, `src/hooks/liveRunsPolling.ts`
  (`shouldShowBar`), `src/i18n.ts` (both dictionaries), plus new pure-logic modules under `src/lib/`
  for checklist-step derivation, template label resolution and the navigation destination rule.
  `src/components/ui.tsx` is **reused, not modified** — `EmptyState` already does what is needed.
- **No capability is removed.** No template, setting, route or control disappears; the templates keep
  their content, the settings keep their defaults, and every screen stays reachable. `/live` loses a
  menu entry, not its route: `RunsOverviewPage` and its `<Route>` stay, the floating bar still links
  into it, and a bookmark still resolves.
- **Risk:** the checklist must not lie. If its step states were tracked separately from the real data
  they would drift, so derivation is a pure function over the creator's actual games and runs, with
  the drift cases as named tests.
- **Testing:** checklist-step derivation, template label resolution, the dismissal rule and the
  bar-suppression rule all become pure functions in `apps/creator-web/src/lib/` (and
  `hooks/liveRunsPolling.ts`, which is already a pure, node-env-tested module) with co-located vitest
  tests in the existing `npm test` lane. `npm run test:ui` covers render smoke.
  **`npm run e2e` is deliberately not part of this change's gate set** — no callable behavior changes
  and the emulator is owned by another process. `npm run i18n:check` (PART A hard gate) and
  `npm run i18n:check:strict` are, because this change exists partly to remove i18n violations.
