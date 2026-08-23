## Why

The product owner's words: *"the admin game panel still needs some work, some of the things there
are not 100% clear and it's really complicated to navigate there."*

That panel is the creator **Run Console** (`apps/creator-web/src/pages/RunConsolePage.tsx`, ~2.5k
lines, 24 panels, 32 actions, 5 rail sections). A read-only survey of the whole surface found the
complaint decomposes into five concrete, evidence-backed defects.

1. **Urgency is invisible from where the creator stands.** `attentionCount` is computed on every
   render but rendered ONLY inside the teams panel, so the rail can say "6 teams" while three of
   them are stuck. Two rail entries (`shareAndScreens`, `afterTheRun`) are permanently mute because
   `summaryFor` falls through to a bare `panelCount` that `groupMeta` renders as nothing. The photo
   queue is the only queue that BLOCKS players and it is entirely off screen while the creator is
   on another section.
2. **The rail changes shape mid run.** `moderation` exists only while a photo/feed/chat count is
   above zero, so approving the last photo deletes the destination the creator is standing on and
   `resolveSection` silently teleports them to `teamsAndScores`. A FINISHED run opens on a live
   teams table instead of the section that holds every report.
3. **Actions do not state their consequence.** The publish toggle is a raw `<button>` whose label
   IS its current state, with no verb and no confirm, one click from revealing live standings to
   every player. Copying the TV link silently publishes the board. "Start all teams" starts every
   race clock with no confirm while "End run" does confirm. "Acknowledge" is irreversible and reads
   as "seen". Colour does not predict severity: ~12 call sites hardcode a `variant=` instead of
   asking `runActionVariant`, and one control renders `danger` for a `cautionary` action.
4. **Panels have no consistent copy contract.** Seven panels have no help line at all, five render
   a bare grey `<div>` where an empty state belongs (so "empty" and "failed" look identical), and
   panel titles are ad-hoc inline strings with emoji baked into the translation values.
5. **Machine identifiers reach humans.** Raw enum values and raw Firestore uids are rendered in
   five places, which is the exact bug `runConsoleLabels.ts` was created to kill.

Meanwhile the team row has grown past what a phone can hold: name, status, out-of-bounds line,
held-for-consent line, attention badge, "let back in", score and THREE buttons.

## What Changes

**Every decision above becomes DATA produced by a pure module; the page only renders what a module
decided.** That invariant already governs the console's layout and is what makes this fixable at
all.

- **A pinned "what needs you right now" strip.** New pure `lib/runConsoleSignals.ts` turns the run's
  live counters into an ordered, severity-ranked list of signals, each pointing at the panel that
  answers it. Biased to SILENCE: a quiet run produces an empty list and nothing renders. Every
  signal's target panel is provably reachable in the layout plan.
- **Every rail entry states its state.** `GroupSummary` gains attention, paused-task, share-link and
  report counts; `summaryFor` becomes an exhaustive switch over `GroupId` with **no `default:`**, so
  a future section cannot ship mute. A new pure `summaryChips()` guarantees a rail entry is never
  blank.
- **A stable rail and an explained relocation.** The photo queue and the team chat are present for
  the whole live run (with real empty states) instead of appearing and vanishing; the default
  section is derived from the run's status instead of being a constant; and `resolveSectionWithReason`
  reports WHY the console moved so the page can say so instead of teleporting.
- **One consequence table for every control.** `runConsoleActions.ts` gains
  `RunActionConsequence {audience, reversible, confirm, copyKey}` as a `Record<RunActionId, …>` over
  the same closed union that already carries severity. Starting every team, publishing standings and
  acknowledging an SOS now confirm and state what they do. The share surface warns BEFORE a copy
  publishes the board, and a failed auto-publish is reported instead of swallowed.
- **A team row that fits a phone.** New pure `teamRowActions()` splits the row's controls into an
  inline set (the safety release only) and an overflow menu (skip mission, skip stage, adjust score).
- **A panel copy catalogue.** New pure `lib/runConsolePanelMeta.ts` maps every `PanelId` to an icon
  plus a title/help/empty copy contract, rendered by ONE `PanelShell`, so no panel can ship without
  a name and an explanation and no empty state can look like a failure.
- **No raw identifiers.** `resolveEnumLabel()` joins the two existing resolvers in
  `runConsoleLabels.ts` and is applied at every remaining leak.
- **A copy pass**: plain-language section titles, one verb per action end to end, statuses phrased
  as statuses, plural Hebrew imperatives, and the removal of six dead dictionary keys from BOTH
  languages.

## Non-goals

- **No callable changes.** Nothing in `functions/` is touched; no callable's behaviour, payload or
  authorization moves. `packages/shared` is not touched either.
- **No feature removal.** Every panel, every action and every link the console offers today is still
  offered. This change relabels, reorders, explains and confirms; it does not delete capability.
- **No new persisted state.** The only stored value remains the localStorage section preference.
- **Not a visual redesign.** The card/rail chrome, the theme and the grid stay as they are.
- **`apps/play-web` staff console is out of scope**, even though it shares the photo queue module.

## Impact

- Affected specs: `run-console-clarity` (new)
- Affected code (creator-web only):
  `apps/creator-web/src/lib/runConsoleSignals.ts` (new),
  `apps/creator-web/src/lib/runConsolePanelMeta.ts` (new),
  `apps/creator-web/src/lib/runConsoleLayout.ts`,
  `apps/creator-web/src/lib/runConsoleActions.ts`,
  `apps/creator-web/src/lib/runConsoleLabels.ts`,
  `apps/creator-web/src/lib/runShareArtifacts.ts`,
  `apps/creator-web/src/pages/RunConsolePage.tsx`,
  `apps/creator-web/src/i18n.ts`,
  `apps/creator-web/src/lib/__tests__/runConsole.test.ts`
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules, no play-web.
