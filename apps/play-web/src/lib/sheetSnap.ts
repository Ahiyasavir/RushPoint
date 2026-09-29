// The mission sheet's snap points (change: play-screen-no-scroll).
//
// A full-screen map with the mission in a sheet at three heights, the pattern every map app uses:
// peek (name, distance, main action), half (the mission), full (the mission plus the locked list).
// The PAGE never scrolls; only a full sheet's content scrolls inside itself. Pure, so the snapping
// is testable without a component runner.

export type SnapPoint = 'peek' | 'half' | 'full';
export interface SnapHeights { peek: number; half: number; full: number }

const ORDER: SnapPoint[] = ['peek', 'half', 'full'];
const PEEK = 132;
const FLICK = 0.5; // px per ms

export function snapHeights(viewportH: number, headerH: number): SnapHeights {
  const H = Number.isFinite(viewportH) && viewportH > 200 ? viewportH : 667;
  const head = Number.isFinite(headerH) && headerH >= 0 ? headerH : 56;
  const full = Math.max(H - head - 12, 160);
  const half = Math.min(Math.round(H / 2), full - 40);
  const peek = Math.min(PEEK, Math.round(H * 0.4), half - 40);
  return { peek, half, full };
}

/**
 * Where a drag of `dragDeltaY` px (positive = down) ending at `velocityY` px/ms lands, starting from
 * `current`. A fast flick moves exactly one step in its direction; otherwise the nearest height wins.
 */
export function nextSnap(current: SnapPoint, dragDeltaY: number, velocityY: number, h: SnapHeights): SnapPoint {
  const idx = ORDER.indexOf(current);
  if (idx < 0 || !Number.isFinite(dragDeltaY)) return current;
  if (Number.isFinite(velocityY) && Math.abs(velocityY) > FLICK) {
    const step = velocityY < 0 ? 1 : -1; // up = taller
    return ORDER[Math.min(ORDER.length - 1, Math.max(0, idx + step))];
  }
  const target = h[current] - dragDeltaY;
  let best: SnapPoint = current;
  let bestDist = Infinity;
  for (const p of ORDER) {
    const d = Math.abs(h[p] - target);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

/** The handle row above the sheet's content, in px (MissionSheet: min-h-[28px]). */
export const SHEET_HANDLE_PX = 28;

/**
 * The height a NEW mission opens at (overnight 2026-09-29): half when its content fits there, full
 * when it does not. Played on 375x667 and 390x844: at half, a photo mission's "צלמו תמונה" sat below
 * the sheet's visible area, so the player read the mission and could not see what to press. A
 * content height that is unknown (0, junk) keeps the default half. Never opens at peek.
 */
export function fitSnap(contentH: number, h: SnapHeights, opts?: { mapFirst?: boolean }): SnapPoint {
  // A sealed "walk to the point" mission: the map IS the instruction and arrival is detected by
  // itself, so the map keeps its half of the screen however long the card is.
  if (opts?.mapFirst === true) return 'half';
  if (!Number.isFinite(contentH) || contentH <= 0) return 'half';
  return contentH <= h.half - SHEET_HANDLE_PX ? 'half' : 'full';
}

/**
 * Snap heights from the sheet's own CONTAINER (the map area under the game header), overnight
 * 2026-09-29. `snapHeights(window.innerHeight, 56)` assumed the header was 56px and the container the
 * whole window; measured on 375x667 the container starts at y=118, so "full" (599px) rose over the
 * header and covered the SOS button. Full now never exceeds the container. Unknown box ⇒ null, and
 * the caller falls back to the window estimate.
 */
export function boxSnapHeights(boxH: number): SnapHeights | null {
  if (!Number.isFinite(boxH) || boxH <= 0) return null;
  if (boxH > 200) return snapHeights(boxH, 0);
  // A tiny box (a phone held sideways with the keyboard up): every height fits inside it.
  const full = Math.round(boxH);
  return { peek: Math.round(full * 0.4), half: Math.round(full * 0.7), full };
}
