// Ordering contract for the top overlay stack (change: play-top-overlay-stack).
//
// The overlays pinned to the top of the participant screen are owned by
// unrelated React trees — ConnectionBanner is mounted by App, the reconnect pill
// and the power-up toast by PlayScreen — and they reach the shared stack by
// portal. Portals append in MOUNT order, which is whatever sequence React happens
// to commit in, so DOM order cannot express "the offline banner goes above the
// reconnect pill". Flexbox `order` can, and it is honoured no matter how the
// children got there. These are the values.
//
// Kept in a pure module (no React, no DOM) so the severity ordering is a fact the
// unit lane can assert, rather than three magic numbers scattered across three
// components — which is exactly the shape the previous bug had.

/** Lower renders higher on screen. Gaps left between values so a future overlay
 *  can slot in without renumbering the existing ones. */
export const TOP_OVERLAY_ORDER = {
  /** Device is offline. Most severe: it explains every other failure on screen. */
  offline: 10,
  /** Online, but the poll is failing. Subordinate to `offline`, which supersedes it. */
  reconnecting: 20,
  /** Transient celebration. Never outranks a problem. */
  powerUp: 30,
} as const;

export type TopOverlayKind = keyof typeof TOP_OVERLAY_ORDER;

/** Which slot an overlay belongs in.
 *
 *  `banner` reserves layout space: the stack's measured height is fed back into
 *  `--rp-top-stack-h` and `Screen` pads by it, so a persistent full-width banner
 *  makes room for itself instead of covering the header underneath.
 *
 *  `toast` floats over the page. A two-second award notice must not shove the
 *  whole run down and then back up again.
 */
export function slotFor(kind: TopOverlayKind): 'banner' | 'toast' {
  return kind === 'offline' ? 'banner' : 'toast';
}
