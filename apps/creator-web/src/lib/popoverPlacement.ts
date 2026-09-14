// Keeping a popover inside the viewport (change: popover-stays-on-screen).
//
// THE DEFECT THIS EXISTS FOR, measured rather than reasoned about. The Builder's
// launch-readiness popover mounts, on a phone, against a ZERO-WIDTH slot — the
// component's own comment says "anchored to this zero-width slot" — and `end-0` then
// places it relative to whatever x that slot happened to land on. Probed in a real
// browser at 375x812, RTL:
//
//   anchor slot   left 204, width 0
//   panel         left 204 -> right 555, width 351
//   viewport      375     =>  180px off screen, 49% of the panel visible
//   scrollWidth   375     =>  the overflow is CLIPPED, not scrollable
//   max-width     351px   =>  the cap APPLIED and changed nothing
//
// That last line is the lesson worth keeping: `max-width` bounds how WIDE a box is,
// never WHERE it sits. And the document is RTL, so the half that fell off the screen
// is the half every Hebrew line BEGINS on — the organizer saw the tail of each
// sentence and could not read why their game would not launch. On a phone the launch
// button IS this popover's trigger, so the one control that starts a game opened an
// unreadable explanation of why it would not.
//
// WHY PIXELS AND NOT CSS. Three CSS-only fixes were considered and each fails on a
// property the measurement already disproved: the max-width cap (bounds width, not
// position), swapping the anchored edge (moves the overflow to the other side for an
// anchor in the other half), and fixed positioning below a breakpoint (loses the
// vertical anchoring, so it needs a magic top offset tied to the header height).
// Working in measured pixels also makes this direction-agnostic by construction: RTL
// and LTR differ only in which edge is preferred, and the clamp is the same
// arithmetic either way.
//
// TOTAL BY REQUIREMENT. A layout-effect measurement legitimately runs before layout
// settles, so this is called with zeros and occasionally with NaN. Returning NaN
// would set `left: NaN`, remove the element from the page, and reproduce the original
// bug with new code — so every degenerate input resolves to something drawable, on
// screen. The fail-safe direction is "at the gutter, at the width that fits".
//
// Pure: no React, no DOM, no clock. scripts/test-popover-placement.ts.

/** Breathing room kept between the popover and each edge of the viewport. */
export const POPOVER_GUTTER_PX = 12;

export interface PopoverPlacementInput {
  /** The anchor's left edge in viewport pixels. */
  anchorLeft: number;
  /** The anchor's width. Legitimately 0 — that is the case that caused this. */
  anchorWidth: number;
  /** How wide the popover would like to be. */
  preferredWidth: number;
  /** `document.documentElement.clientWidth`. */
  viewportWidth: number;
  /** Is the document right to left? Decides which edge is preferred, nothing else. */
  rtl?: boolean;
  /** Override the gutter. Defaults to POPOVER_GUTTER_PX. */
  gutter?: number;
}

export interface PopoverPlacement {
  /** Left edge in viewport pixels. Apply as an inline style. */
  left: number;
  /** Width in pixels. May be narrower than preferred — see `clamped`. */
  width: number;
  /** Did the viewport force a move or a narrowing? Useful for tests and debugging. */
  clamped: boolean;
}

/** A finite number, or the fallback. Never propagates NaN or Infinity. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Where to draw a popover so that all of it is on screen.
 *
 * The preferred position matches what the CSS used to express: in RTL the popover's
 * logical start grows from the anchor's left edge; in LTR it ends at the anchor's
 * right edge. The clamp then moves it only as far as it must.
 *
 * NARROWS BEFORE IT OVERFLOWS: where the space between the gutters is smaller than
 * the preferred width, the popover comes back narrower. A 276px panel that can be
 * read beats a 351px panel that cannot.
 */
export function popoverPlacement(input: PopoverPlacementInput): PopoverPlacement {
  const safe = (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : ({} as PopoverPlacementInput);

  const viewportWidth = Math.max(0, num(safe.viewportWidth, 0));
  const gutter = Math.max(0, num(safe.gutter, POPOVER_GUTTER_PX));
  const anchorLeft = num(safe.anchorLeft, 0);
  const anchorWidth = Math.max(0, num(safe.anchorWidth, 0));
  const preferredWidth = Math.max(0, num(safe.preferredWidth, 0));

  // A viewport that cannot hold two gutters still has to draw something. Give the
  // whole viewport rather than a negative width, which would collapse the popover
  // and hide the content exactly as the original defect did.
  const available = viewportWidth - 2 * gutter;
  const usableGutter = available > 0 ? gutter : 0;
  const maxWidth = available > 0 ? available : viewportWidth;

  const width = Math.min(preferredWidth, maxWidth);

  // The preferred x, matching what the CSS expressed before the clamp existed.
  const preferredLeft = safe.rtl === false
    ? anchorLeft + anchorWidth - width   // LTR: aligned to the anchor's right edge
    : anchorLeft;                        // RTL: aligned to the anchor's left edge

  const minLeft = usableGutter;
  const maxLeft = Math.max(minLeft, viewportWidth - usableGutter - width);
  const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);

  return {
    left,
    width,
    clamped: left !== preferredLeft || width !== preferredWidth,
  };
}
