## Context

`ReadinessPanel` in `apps/creator-web/src/pages/BuilderPage.tsx` renders:

```jsx
<div className="relative shrink-0">
  {showTrigger && <button .../>}          {/* false on a phone */}
  {open && <div className="absolute z-50 end-0 top-full mt-1 w-[22rem]
                           max-w-[calc(100vw-1.5rem)] ..."> ... </div>}
</div>
```

On a phone `showTrigger` is false, so the wrapper is a **zero-width slot** — the mount
comment says exactly that — and the popover's containing block is 0px wide at whatever
x the flex row happened to leave it. `end-0` then places the box relative to that
point, and nothing in the CSS relates the result to the viewport.

Measured at 375x812 RTL: slot at `left 204 width 0`, panel `204 → 555`, 180px off
screen, `document.scrollWidth` still 375 so the overflow is clipped rather than
scrollable.

## Goals / Non-Goals

**Goals:** a popover is always fully inside the viewport, minus a gutter, whatever its
anchor and whatever the text direction; the decision is pure and unit tested.

**Non-Goals:** vertical containment; redesigning the popover into a sheet; a sweep of
every other popover. See `proposal.md`.

## Decisions

### D1 — Clamp in measured pixels, not in logical CSS properties

The placement is computed from four numbers — anchor x, anchor width, desired width,
viewport width — and returns a `left` and a `width` in pixels.

**Why not a CSS-only fix.** Three were considered and each fails on a property the
measurement already disproved:

- **Keep the max-width and hope.** Disproved: the cap computed to 351px and the box
  still ran 180px off. A maximum width bounds width, not position.
- **Swap the end anchor for a start anchor.** Moves the overflow to the other side for
  any anchor sitting in the other half of the screen. It trades one failing case for
  another.
- **Fixed positioning with a symmetric inset below a breakpoint.** Loses the vertical
  anchoring, so it needs a hardcoded top offset tied to the header's height — a magic
  number that breaks the moment the header changes. CLAUDE.md already records a
  near-identical trap: a breakpoint asks about the WINDOW, so a component whose width
  comes from its container must not branch on one.

Pixels also make the fix direction-agnostic by construction: RTL and LTR differ only
in which edge is preferred, and the clamp is the same arithmetic either way.

### D2 — Narrow before you overflow

When the space between the gutters is smaller than the preferred width, the popover is
returned NARROWER rather than clamped-but-overflowing. A 300px-wide phone gets a 276px
panel that is fully readable, instead of a 351px panel that is not.

### D3 — Total, and degenerate inputs resolve to something drawable

A layout-effect measurement can legitimately run before layout settles, so this will be
called with zeros and occasionally with NaN. Every non-finite or absurd input resolves
to a placement that is on screen — never NaN, which would remove the element from the
page entirely and so reproduce the original bug with new code. The fail-safe direction
is "drawn at the gutter, at the full available width".

### D4 — The component measures, the module decides

`ReadinessPanel` gets a ref on the popover and on the slot, measures both in a layout
effect, and applies the result as an inline left and width. Re-measured on open and on
viewport resize.

Tailwind cannot express a runtime-computed pixel value — CLAUDE.md records that a
computed class compiles to no CSS at all — so an inline style is the correct vehicle
here, not a class.

The defeated classes are REMOVED rather than left under the inline style: leaving a
rule in place that no longer does anything is how the next reader concludes the cap is
still protecting them.

## Test Strategy

**Pure — `npm test`, `scripts/test-popover-placement.ts`:**

- the measured production case: anchor `left 204 width 0`, preferred 351, viewport 375
  yields a placement fully inside the gutters ← **RED today**
- an anchor near either edge, in RTL and LTR, at 320 / 375 / 768 / 1440
- a viewport narrower than the preferred width yields a narrowed popover, not an
  overflowing one
- a viewport narrower than twice the gutter is still drawable, never a negative width
- identity: where the preferred placement already fits, the clamp does not move it
- totality: NaN, Infinity, negative and missing inputs never yield NaN
- a seeded sweep asserting the invariant `gutter <= left` and
  `left + width <= viewportWidth - gutter` across thousands of combinations, printing
  the denominator

**Browser — measured, not eyeballed:** re-run the exact `getBoundingClientRect` probe
that produced the evidence above at 375px and assert the panel's right edge is inside
the viewport, plus a desktop width to confirm the identity case did not move.

**Gates:** `npm run verify`. No i18n string changes and no callable, so `npm run e2e`
is unaffected — stated so the omission reads as a decision rather than an oversight.

## Risks / Trade-offs

- **[An inline style silently overriding a future class]** → the defeated classes are
  removed in the same commit, so there is exactly one owner of the geometry.
- **[Measurement running before layout settles]** → D3: total, and the fail-safe
  direction is on-screen.
- **[A resize while the popover is open]** → a resize listener re-measures; a stale
  placement would put us back where we started on an orientation change.
- **[Other popovers still carry the latent bug]** → true, and named as a non-goal. The
  module exists so that fixing them later is a two-line change rather than a redesign.

## Migration Plan

Land, `npm run verify` green, browser-measure at 375px and at a desktop width, ship by
`deploy:hosting`. **Rollback:** revert; nothing stored changes shape.

## Open Questions

1. **Should the other creator popovers adopt this now?** A sweep would need each one
   measured rather than assumed. Deliberately deferred.
2. **Should the phone readiness panel be a sheet instead?** Arguably better UX, but
   that is a redesign, and a broken component should be made correct before it is made
   different.
