## Why

On a phone, the Builder's launch-readiness panel renders half off the screen, and the
half that is missing is the half that says what to fix. The organizer of run
`ijI9JMITSf8C9heN1Cwp` reported it as *"an error indicator appeared top right but the
message itself was not shown, and it blocked starting the game."*

Measured in a real browser at 375x812, RTL, on a game with 2 readiness issues:

| | |
|---|---|
| anchor slot | `left: 204`, **`width: 0`** |
| panel | `left: 204` → `right: 555`, width 351 |
| off screen | **180px — 49% of the panel is visible** |
| `document.scrollWidth` | 375 — the overflow is **clipped, not scrollable** |
| computed `max-width` | 351px — the cap **was applied and did nothing** |

Three facts make this worse than a cosmetic clip:

1. **The launch button IS the panel trigger on a phone.** `BuilderPage` renders the
   readiness pill only at desktop widths; below that, when there is anything to fix,
   the "הפעל ריצה" button opens this panel instead of launching. So the one control
   that starts a game opens an unreadable explanation of why it will not.
2. **The layout is RTL**, so every Hebrew line BEGINS at the panel's right edge —
   which is the edge that is off screen. The user sees the tail of each sentence.
3. **`max-width` cannot fix this and never could.** It bounds how WIDE a box is, not
   WHERE it sits. A 351px box whose left edge is at x=204 on a 375px viewport still
   runs 180px past the edge. The existing `max-w-[calc(100vw-1.5rem)]` computed to
   exactly 351px and changed nothing.

The root cause is stated in the code's own comment: the popover *"mounts here,
anchored to this zero-width slot"*. An absolutely positioned box anchored to a
zero-width element inherits that element's arbitrary x position, and nothing in the
current CSS relates the result to the viewport at all.

## What Changes

- **A popover in the creator console stays on screen.** Its horizontal position is
  clamped into the viewport with a gutter, whatever its anchor's position or width,
  in either text direction, at any viewport size.
- Where the clamp cannot fit the preferred width, the popover narrows to what does
  fit rather than overflowing.
- The Builder's readiness panel uses this, so the list of what is blocking a launch is
  fully readable on the device the organizer is holding.

**BREAKING**: none. At widths where the popover already fitted, the clamp is the
identity and the rendered geometry is unchanged.

## Capabilities

### New Capabilities
- `popover-viewport-containment`: where a popover is allowed to be drawn relative to
  the viewport it is drawn in.

### Modified Capabilities
- `builder-launch-readiness`: the readiness panel's content is required to be readable
  on a phone, not merely rendered.

## Impact

- **Surfaces**: `apps/creator-web` only — a new pure placement module, its test, and
  the readiness popover in `pages/BuilderPage.tsx`.
- **No callable, no Firestore shape, no rule, no env var, no i18n string.**
- **Test lanes**: a new `scripts/test-*.ts` for the pure clamp, plus a measured
  before/after in a real browser at 375px, because CLAUDE.md records repeatedly that
  a source scan cannot know a rendered geometry.
- **Deployment**: `deploy:hosting`.

## Non-goals

- **Vertical containment.** The panel already caps its list height and scrolls it; a
  popover taller than the viewport is a different problem and is not what was reported.
- **Turning the popover into a sheet or a modal on phones.** That is a redesign; this
  change makes the existing component correct.
- **Auditing every other popover in the app.** The module is reusable and the readiness
  panel is the one that blocked a launch; a sweep is a follow-up.
- **Anything about WHY a game is not launch ready** — the readiness rules are unchanged.
