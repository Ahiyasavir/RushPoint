# Proposal — dashboard-card-actions-overflow

## Why

Every game card on the creator Dashboard (`DashboardPage.tsx:473-519`) renders **six** action
controls: a primary row of Edit + Launch (`:473-488`), then a second `flex-wrap` row of four more
buttons separated only by a hairline — Test run (`:491`), Publish/Unpublish (`:499`), Share (`:506`)
and Delete (`:512`). Across a grid of cards this is a wall of six buttons per card. Two problems
compound:

- The destructive **Delete** sits at the same visual weight as Test run, one hairline away from the
  primary actions.
- The four button `flex-wrap` row reflows awkwardly at `min-w-[calc(50%-0.25rem)]`, so cards jump
  between one and two rows of secondary buttons depending on width.

The card is doing the job of a context menu inline. The Run Console already solved exactly this shape
for its team rows: a small inline set plus a "⋯" overflow menu, with the split decided by a pure
function (`teamRowActions`, `lib/runConsoleActions.ts:217`) and rendered by an `OverflowMenu`
(`RunConsolePage.tsx:1199`).

## What Changes

**The card keeps Edit + Launch primary and collapses the other four actions into a single "⋯"
overflow menu**, reusing the Run Console's inline-vs-overflow pattern.

- A new pure helper, `apps/creator-web/src/lib/dashboardCardActions.ts`, decides the split: Edit and
  Launch are inline; Test run, Publish/Unpublish, Share and Delete are overflow, in that order, with
  Delete last as the destructive action. Publish versus Unpublish is resolved from the game's
  visibility. This mirrors `teamRowActions` so the two surfaces share one mental model and the
  decision is unit testable.
- The `OverflowMenu` shell currently local to `RunConsolePage.tsx:1199` is promoted to a shared
  `apps/creator-web/src/components/OverflowMenu.tsx` (same markup, same `aria-haspopup="menu"` /
  `role="menu"` / click-away behavior) and consumed by both the Run Console and the Dashboard card,
  so there is one menu primitive rather than two.
- The live "Open run" button (`:463-471`) stays inline and above the action row, unchanged.

## What does not change

- **All six actions stay available.** Edit and Launch stay inline; Test run, Publish/Unpublish,
  Share and Delete each stay one click away inside the card's overflow menu, wired to the exact same
  `launchAction` (with `{ testDrive: true }`), `publishAction`, `setSharing` and `setDeleting`
  handlers they use today.
- **Delete keeps its confirmation dialog.** `setDeleting(g)` still opens the existing confirm dialog
  (`:715`); nothing is deleted from the menu directly.
- **The Run Console's team row behavior is unchanged.** Promoting `OverflowMenu` to a shared file is
  a pure move with identical markup and props; `teamRowActions` and `lib/runConsoleLayout.ts`
  semantics are untouched.
- **No backend, no callable, no savePayload, no layout data.**

## Non-goals

- No change to which actions exist or what any of them does.
- No change to the primary Edit + Launch affordances or the live "Open run" button.
- No change to `functions/`, `packages/shared`, `firestore.rules`, or play-web.

## Impact

- Affected specs: `creator-dashboard` (new)
- Affected code: `apps/creator-web/src/pages/DashboardPage.tsx` (collapse the secondary row),
  `apps/creator-web/src/lib/dashboardCardActions.ts` (new pure helper),
  `apps/creator-web/src/components/OverflowMenu.tsx` (new; extracted from `RunConsolePage.tsx`),
  `apps/creator-web/src/pages/RunConsolePage.tsx` (import the shared `OverflowMenu`, delete the local
  copy), `apps/creator-web/src/i18n.ts` (additive: an `aria-label` for the card menu trigger, HE and
  EN; existing `d.card*` labels reused), `scripts/test-dashboard-card-actions.ts` (new)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules.
