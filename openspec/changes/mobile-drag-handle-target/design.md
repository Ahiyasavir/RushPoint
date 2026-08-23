# Design — mobile-drag-handle-target

## 1. Current code, audited

`TaskCard.tsx:104-112`:
```tsx
<div className="flex items-center gap-2 min-w-0">
  <span
    {...handleProps}
    title={b.dragTaskHandle}
    aria-label={b.dragTaskHandle}
    onClick={(e) => e.stopPropagation()}
    className="shrink-0 select-none text-[--ink-3] cursor-grab active:cursor-grabbing touch-none
      focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60 rounded"
  >⠿</span>
```
`handleProps` (from `BuilderPage.tsx`'s `useSortable`) carries the activator
`ref` plus dnd-kit's pointer-down listeners directly onto this `<span>`. There
is no width/height/padding class on it — its box is exactly the `⠿`
character's glyph metrics, measured live at 12×24px.

`StageRail.tsx:99-111` is the same shape: `{...attributes} {...listeners}` on
a bare `<span>⠿</span>` with `ref={setActivatorNodeRef}`, inside a `p-2.5`
card that itself is NOT the drag source (the handle is), so the card's
padding does not enlarge the handle's own hit box.

## 2. The fix

Wrap each glyph in a flex-centered box sized to the 44×44px touch-target
guideline, moving the drag props onto the wrapper:

```tsx
<span
  {...handleProps}
  title={b.dragTaskHandle}
  aria-label={b.dragTaskHandle}
  onClick={(e) => e.stopPropagation()}
  className="shrink-0 select-none text-[--ink-3] cursor-grab active:cursor-grabbing touch-none
    flex items-center justify-center w-11 h-11 -m-2.5 rounded
    focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
>⠿</span>
```
`w-11 h-11` = 44px; the negative margin keeps the ENLARGED hit box from
pushing the row's other content (type chip, title, trigger icon) further to
the end — the box grows into the card's own padding rather than the flow.

**The margin is split per axis, and the horizontal value must equal the
row's own `gap`** (measured, not assumed): the box overhangs its layout
slot by exactly the margin, so a margin larger than the gap eats into the
next sibling. A first attempt at a uniform `-m-2.5` (10px) against
`TaskCard`'s `gap-2` (8px) measured a 2px overlap onto the type chip.
Shipped values:

| file | row gap | horizontal | vertical | result |
|---|---|---|---|---|
| `TaskCard.tsx` | `gap-2` (8px) | `-mx-2` | `-my-2.5` | 44×44, 0px overlap, row still 24px |
| `StageRail.tsx` | `gap-1.5` (6px) | `-mx-1.5` | `-my-2.5` | 44×44, 0px overlap |

The vertical value stays `-my-2.5` in both: it absorbs the box into the
card's own vertical padding so neither the task row (24px) nor a rail entry
grows taller.

`StageRail.tsx`'s handle sits in its own `flex items-center gap-1.5 mb-1` row
above the stage title, with room below it — same wrapper pattern applies,
sized to not force the rail's `w-40 sm:w-auto` entries to grow.

## 3. Test strategy

No pure logic changes (a className/wrapper edit only) — no vitest/`test-*.ts`
task. Per CLAUDE.md's UI lane:
- Preview-based verification: open the Builder at a 375px viewport, measure
  the handle's `getBoundingClientRect()` via the browser tool (target ≥40px
  both axes), and confirm a drag started from anywhere in the enlarged box
  still reorders correctly (both a task within a stage and a stage in the
  rail).
- `npm run i18n:check:strict` — no new strings, should be a no-op pass, but
  run it because the file is UI.
