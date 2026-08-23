# Proposal — mobile-dashboard-runconsole-reflow

## Why

Two grids never step down to a single column on a phone, even though the
rest of both pages correctly reflow at `sm`:

- **Dashboard stat tiles** (`DashboardPage.tsx:681`, and its loading-skeleton
  mirror at `:1037`): `grid grid-cols-2 lg:grid-cols-3` — 2 columns even at
  375px width, while the games grid three lines below it
  (`DashboardPage.tsx:726`, `:1041`) already does the right thing
  (`grid sm:grid-cols-2 lg:grid-cols-3`, single column below `sm`).
- **Run Console's Hot Zone form** (`RunConsolePage.tsx:1749`): `grid
  grid-cols-3 gap-2` for three number inputs (radius / multiplier /
  duration), each with its own `<Label>` above it — three columns with no
  responsive step-down means each input gets roughly ~100px including its
  label on a 375px screen, the tightest numeric-entry row in the whole
  console.

Both are a live-ops/dashboard-glance surface a creator may well be on their
phone for (checking stats between events, adjusting a hot zone mid-run) —
not just the Builder.

## What Changes

- Dashboard stat tiles: `grid grid-cols-2 lg:grid-cols-3` →
  `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, applied identically to
  BOTH the real grid (`:681`) and its loading-skeleton mirror (`:1037`) so
  the skeleton-to-content transition doesn't reflow.
- Hot Zone form: `grid grid-cols-3 gap-2` →
  `grid grid-cols-1 sm:grid-cols-3 gap-2`, stacking the three labelled
  number inputs vertically below `sm` instead of cramming them side by
  side.

## Non-goals

- Does not touch the Run Console's analytics table
  (`RunConsolePage.tsx:2983`, `overflow-x-auto`) — a horizontally-scrolling
  data table is an established, deliberate pattern already used elsewhere in
  this console (`:1317`, the stage rail strip), not a regression to fix
  here; reworking a 6-column table into mobile cards is a materially bigger
  redesign than this change's scope.
- Does not touch the Dashboard's games grid (`:726`, `:1041`) — already
  correctly responsive.
- Does not change any grid's desktop (`lg:grid-cols-3`) geometry.

## Surfaces touched

`apps/creator-web` only (`DashboardPage.tsx`, `RunConsolePage.tsx`). No
callable, no shared type.
