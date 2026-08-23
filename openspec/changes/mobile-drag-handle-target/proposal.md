# Proposal — mobile-drag-handle-target

## Why

The Builder's stage and task reordering both hinge on dragging a `⠿` glyph
(`TaskCard.tsx:105-112`, `StageRail.tsx:100-111`). The glyph carries dnd-kit's
`handleProps`/`attributes`+`listeners` directly with no padding or explicit
sizing, so the actual tappable/draggable hit area is only the glyph's own
font-box — measured live at **12×24px** on a 375px-wide phone. Building a game
*is* arranging stages and tasks, so this is the single highest-friction control
in the mobile Builder: a creator has to land a finger inside a ~12px column to
even start a reorder drag, and TouchSensor's own 8px movement tolerance
(`BuilderPage.tsx:2132-2140`) offers no help if the initial touch missed the
handle entirely.

Note this is scoped to the **desktop-style drag handle's touch target**, not
to dnd-kit's touch mechanics — `TaskCard.tsx`'s prior investigation already
found `PointerSensor`/`TouchSensor`/`KeyboardSensor` correctly configured
(press-and-hold delay + tolerance, so a plain swipe still scrolls). The
handle's hit box is the only thing broken here.

## What Changes

- The `⠿` handle in `TaskCard.tsx` and the `⠿` handle in `StageRail.tsx` each
  get a real touch-target wrapper (min 44×44px) around the glyph, with the
  glyph itself staying visually small (unchanged font-size) so the row's
  density is unaffected. `handleProps` / `{...attributes} {...listeners}` move
  onto the enlarged wrapper, not the bare glyph span.
- No change to drag *behavior*, sensors, activation delay, or the surrounding
  card/row layout — only the size of the element that starts the drag.

## Non-goals

- Does not change `DndContext` sensors, activation constraints, or collision
  detection (`railAwareCollisionDetection`, `isValidDropTarget`) — those are
  already correct.
- Does not change the card/row's own tap-to-open behavior.
- Does not touch the "move to stage" non-drag fallback — that is a separate,
  already-identified issue ([[mobile-move-task-visibility]]).

## Surfaces touched

`apps/creator-web` only (`TaskCard.tsx`, `StageRail.tsx`). No callable, no
shared type, no backend.
