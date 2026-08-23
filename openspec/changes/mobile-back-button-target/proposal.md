# Proposal — mobile-back-button-target

## Why

The Builder header's back-to-games button (`BuilderPage.tsx:998-1000`) hides
its text label below `sm` (`hidden sm:inline`) and keeps desktop padding
(`px-2 py-1`) at every width — leaving only the `←` glyph inside a **30×24px**
box on a phone, measured live. This is the exit from the Builder back to the
game list — one of the most frequent navigation actions during a mobile
build session — and it is the smallest target found in the entire header.

## What Changes

- Below `sm`, the button gets a real touch-target floor (`min-h-11 min-w-11`,
  44px) while staying icon-only (the label stays hidden — restoring it would
  compete with `EditableTitle` for width in an already-tight `flex-wrap`
  header). At `sm` and up, the existing padding + visible label are
  unchanged.

## Non-goals

- Does not change where the button navigates to, or add a confirm/unsaved-
  changes prompt — `leaveToGames()` is unchanged.
- Does not change the header's overall layout, wrapping behavior, or the
  `EditableTitle` next to it.
- Does not restore the visible label on mobile — an icon-only 44px target is
  the fix; a labelled button would need header width this row does not have
  at 375px.

## Surfaces touched

`apps/creator-web` only (`BuilderPage.tsx`). No callable, no shared type.
