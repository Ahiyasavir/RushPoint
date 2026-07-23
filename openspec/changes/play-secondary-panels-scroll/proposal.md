# Proposal — play-secondary-panels-scroll

## Why

The `fix-play-screen-hierarchy` change had two halves: (1) promote the current task above the
secondary status panels, and (2) put those secondary panels (LiveOps standings peek, photo feed,
chat, trackables, zones, devices) in "their own bounded, independently scrolling region
(`overflow-y-auto` with a max height)".

Half (1) shipped and solved the reported complaint — the family playtest found the task buried under
status panels; it now sits at the top (`PlayScreen.tsx:509-537`). Half (2) did **not** ship: the
secondary wrapper is a plain `<div className="mt-1 -mx-1 px-1">` (`PlayScreen.tsx:542`) with no
`overflow-y-auto` and no max height. The change is booked at 0/13 in its `tasks.md`, so this is
genuinely un-landed rather than a regression.

Two things are now out of sync and should be reconciled:

- The **code comment** at `PlayScreen.tsx:539-541` already claims the secondary content "scrolls
  within its own bounded region so it never pushes the task off-screen" — which the markup does not
  do. The comment describes half (2) as if it shipped.
- The **spec** still asks for a nested bounded scroll region.

On reflection, a nested `overflow-y-auto` region on a phone is the wrong fix: a second scroll
container inside the page scroll traps momentum and hides content below a fold that has no visible
affordance, which on mobile is worse than the natural full page scroll the app already has. The
reorder alone addressed the actual "the task is buried" complaint. The smaller, correct move is to
formally scope the hierarchy work to **reorder only** and make the comment tell the truth, rather
than add a mobile nested scroll nobody has shown is needed.

## What Changes

**The play active screen's secondary panels are formally specified as reorder only: promoted task on
top, all secondary panels below in the natural page scroll. No nested bounded scroll region is
added.**

- The misleading comment at `PlayScreen.tsx:539-541` is corrected to describe the shipped behavior:
  the secondary content sits below the task and scrolls with the page, and each panel self hides when
  its feature is unused.
- No `overflow-y-auto` / `max-h` container is introduced. The `<div className="mt-1 -mx-1 px-1">`
  wrapper is left as is (aside from the corrected comment).
- This change supersedes half (2) of `fix-play-screen-hierarchy`; that half is closed as
  deliberately not done, with the reason recorded here.

## What does not change

- **Every secondary panel still renders in full**: the standings peek (LiveOps), the photo feed,
  team chat, trackables, territory (zones) and team devices. None is removed, collapsed into a tab, or
  hidden behind a fold. Each remains reachable by the existing natural page scroll.
- The panels that already self hide when their feature is unused keep doing so (`TrackablesPanel`
  returns null, `ZonesPanel` returns null, chat is collapsible, feed and devices are gated), so a
  simple game already shows little below the task.
- The promoted task and map ordering (half 1) is unchanged.
- No i18n, no callable, no shared type, no styling class change beyond leaving the wrapper as is.

## Non-goals

- No nested scroll container on the play screen.
- No collapsing the secondary panels into a tab bar (that would bury the standings peek players want,
  and was already rejected as ability removing).
- No change to task ordering, to any panel's internal behavior, or to play-web routing.

## Impact

- Affected specs: `play-active-screen` (new)
- Affected code: `apps/play-web/src/screens/PlayScreen.tsx` (comment correction at `:539-541` only)
- Surfaces touched: **play-web only**. No i18n, no callable, no shared types, no rules.
