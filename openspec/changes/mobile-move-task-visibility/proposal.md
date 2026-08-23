# Proposal — mobile-move-task-visibility

## Why

`TaskCard.tsx:135-163` renders a native `<select>` as the non-drag fallback
for moving a task to another stage — the documented purpose is exactly
"screen readers / keyboard / **tablets**" (`:132-134`). But it is styled
`opacity-0 transition-opacity group-hover/card:opacity-100 focus:opacity-100`
(`:154-156`): fully invisible until the card is hovered or the select itself
is focused. A touch device has no persistent `:hover` state, and a user
cannot focus an element they don't know exists — so on a phone or tablet this
control is present in the DOM but **practically undiscoverable**, leaving
drag as the only way to move a task between stages. That is exactly the
interaction [[mobile-drag-handle-target]] identifies as hardest to do
precisely on a touchscreen — the fallback for the hard case is hidden behind
the hard case.

The element already reserves its `w-8` layout width even while invisible
(`shrink-0 w-8` is unconditional), so the `opacity-0` default buys nothing
layout-wise — only a cosmetic "calm at rest" look on desktop, at the cost of
making the control unreachable on touch.

## What Changes

- The move-to-stage `<select>` gets a visible-at-rest baseline opacity
  (dim, e.g. `opacity-60`) instead of `opacity-0`, rising to full opacity on
  hover/focus as before. It is discoverable by sight (and by touch) on every
  input method, while still visually deferring to the row's primary content
  at rest.

## Non-goals

- Does not change the control's markup, behavior, or its native-`<select>`
  choice (already the right call for tablet — see the file's own comment on
  why it's a real `<select>` and not a custom dropdown).
- Does not add a second/alternate touch-specific control (e.g. no new "⋯"
  menu) — same element, just no longer invisible by default.
- Does not touch drag-based reordering ([[mobile-drag-handle-target]]).

## Surfaces touched

`apps/creator-web` only (`TaskCard.tsx`). No callable, no shared type.
