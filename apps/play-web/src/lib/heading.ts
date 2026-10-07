// Which way is the player facing? (issue 54, Ahiya 7.10: "a walking direction like Google Maps",
// the blue beam on your own dot that is strong near it and fades outward.)
//
// Two sources, in order: the phone's COMPASS (where the screen points, also when standing still)
// and the GPS COURSE (which way you are walking, only while you really move). Neither is trusted
// when stale, and "no heading" draws no beam: a wrong arrow is worse than none, because people walk
// by it. Pure and total; the browser plumbing is in useDeviceHeading.ts.

/** A compass reading older than this is not used (the event stream stops when the page hides). */
export const COMPASS_FRESH_MS = 3000;
/** Below this the GPS course is noise (a slow walk is ~1 m/s). */
export const MIN_WALK_SPEED_MPS = 0.6;

export function normalizeDeg(d: number): number {
  const v = d % 360;
  return v < 0 ? v + 360 : v === 0 ? 0 : v;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Compass heading (degrees clockwise from north) from a device-orientation event, corrected for
 * how the screen is turned (`screenAngle`, from `screen.orientation.angle`).
 * - iOS Safari: `webkitCompassHeading` is already a heading.
 * - Android Chrome: `deviceorientationabsolute` gives `alpha` counter-clockwise from north.
 * A RELATIVE alpha (an ordinary `deviceorientation` on Android) is measured from wherever the phone
 * was at page load, so it is not a compass and is refused.
 */
export function compassHeadingFromEvent(
  e: { webkitCompassHeading?: number | null; alpha?: number | null; absolute?: boolean } | null | undefined,
  screenAngle: number,
): number | null {
  if (!e) return null;
  const turn = finite(screenAngle) ? screenAngle : 0;
  if (finite(e.webkitCompassHeading)) return normalizeDeg(e.webkitCompassHeading + turn);
  if (e.absolute === true && finite(e.alpha)) return normalizeDeg(360 - e.alpha + turn);
  return null;
}

/** The GPS course while walking; null when standing still or unknown. */
export function gpsCourse(c: { heading?: number | null; speed?: number | null } | null | undefined): number | null {
  if (!c || !finite(c.heading) || !finite(c.speed) || c.speed < MIN_WALK_SPEED_MPS) return null;
  return normalizeDeg(c.heading);
}

/** A fresh compass wins (it is where you FACE, also standing still); else the walking course. */
export function pickHeading(input: {
  compass: number | null; compassAtMs: number; course: number | null; nowMs: number;
}): number | null {
  if (!input) return null;
  if (finite(input.compass) && finite(input.compassAtMs) && input.nowMs - input.compassAtMs <= COMPASS_FRESH_MS) {
    return normalizeDeg(input.compass);
  }
  return finite(input.course) ? normalizeDeg(input.course) : null;
}

/** Move `prev` toward `next` by `k` (0..1) along the SHORT arc, so 350 → 10 passes through north. */
export function smoothHeading(prev: number | null, next: number | null, k: number): number | null {
  if (!finite(next)) return null;
  if (!finite(prev)) return normalizeDeg(next);
  const diff = ((next - prev + 540) % 360) - 180;
  return normalizeDeg(prev + diff * Math.min(1, Math.max(0, k)));
}

/** The beam's on-screen rotation on a map turned by `mapBearing`. */
export function beamRotation(heading: number, mapBearing: number): number {
  return normalizeDeg(heading - (finite(mapBearing) ? mapBearing : 0));
}
