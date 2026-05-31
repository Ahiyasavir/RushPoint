export interface Fix {
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in metres (lower = better). */
  accuracy?: number;
}

// Fixes worse than this (metres) are dropped when we already hold a good one —
// a 500 m wifi-triangulation fix shouldn't yank the heatmap marker across town.
const MAX_ACCURACY_M = 100;
// Discard fixes implying movement faster than this (m/s ≈ 110 km/h) — a teleport
// that big between foreground pings is GPS error, not a team on foot.
const MAX_SPEED_MS = 30;

function haversineMeters(a: Fix, b: Fix): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Stateful GPS jitter filter. Raw `getCurrentPosition` fixes wobble several
 * metres even when stationary and occasionally spike to a wildly wrong fix; fed
 * straight to the heatmap that reads as a team flickering around / jumping.
 *
 * Strategy per fix:
 *   1. First fix is accepted as-is.
 *   2. Reject implausible jumps (speed gate) and low-confidence fixes once we
 *      already have a recent good position.
 *   3. Otherwise blend toward the new fix with an accuracy-weighted factor — a
 *      tight fix moves the marker most of the way, a loose one barely nudges it.
 *
 * Returns the smoothed fix to report (or null only if there's nothing yet).
 */
export function createGeoSmoother() {
  let last: Fix | null = null;
  let lastAt = 0;

  return function smooth(fix: Fix, nowMs: number): Fix {
    const acc = fix.accuracy ?? MAX_ACCURACY_M;

    if (!last) {
      last = fix;
      lastAt = nowMs;
      return fix;
    }

    const dist = haversineMeters(last, fix);
    const dtSec = Math.max(1, (nowMs - lastAt) / 1000);

    // Speed gate: reject teleports, but only when the new fix isn't clearly
    // more accurate than what we hold (a better fix is allowed to correct us).
    const tooFast = dist / dtSec > MAX_SPEED_MS;
    const lowConfidence = acc > MAX_ACCURACY_M && acc > (last.accuracy ?? MAX_ACCURACY_M);
    if ((tooFast || lowConfidence) && dist > acc) {
      return last; // keep the previous good position
    }

    // Accuracy-weighted blend: trust the tighter of the two fixes more.
    const lastAcc = last.accuracy ?? MAX_ACCURACY_M;
    const w = lastAcc / (lastAcc + acc); // weight toward the NEW fix
    const blended: Fix = {
      lat: last.lat + (fix.lat - last.lat) * w,
      lng: last.lng + (fix.lng - last.lng) * w,
      accuracy: Math.min(acc, lastAcc),
    };
    last = blended;
    lastAt = nowMs;
    return blended;
  };
}
