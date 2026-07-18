// GPS route helper for the browser-level run simulation (change: browser-fidelity-simulation).
//
// Turns a team's "walk to my current task" intent into a stream of realistic
// geolocation fixes for Playwright `context.setGeolocation`. Pure + deterministic
// (a seeded LCG matching scripts/simulate-run.mjs), so failures reproduce.
//
// Exports:
//   makeRng(seed)                       → () => float in [0,1)  (LCG, reproducible)
//   haversineMeters(a, b)               → great-circle distance in metres
//   walkPath(from, to, t)               → linear interpolation, t clamped to [0,1]
//   stepToward(from, to, maxStepMeters) → next point stepping ≤ maxStepMeters toward `to`
//   jitterFix(p, rng, accuracyM)        → { lat, lng, accuracy } within accuracyM of p
//
// Unit-tested by scripts/test-gps-route.ts (pure-logic lane, no emulator).

const EARTH_M = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Seeded LCG — identical constants to simulate-run.mjs so the two sims share a
// jitter model. Returns a float in [0,1).
export function makeRng(seed = 424242) {
  let s = seed & 0x7fffffff;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function haversineMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Linear interpolation between two coords. t is clamped to [0,1] so callers can
// pass an unbounded progress ratio without overshooting the endpoints.
export function walkPath(from, to, t) {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (c === 0) return { lat: from.lat, lng: from.lng };
  if (c === 1) return { lat: to.lat, lng: to.lng };
  return { lat: from.lat + (to.lat - from.lat) * c, lng: from.lng + (to.lng - from.lng) * c };
}

// One tick of walking: move from `from` toward `to` by at most maxStepMeters.
// Returns `to` exactly once within range (no overshoot), so a loop converges and
// never moves away from the target. Steps in a local equirectangular *metres*
// frame (not degree-linear) so the distance actually moved equals maxStepMeters
// to within centimetres, regardless of the leg's lat/lng mix.
export function stepToward(from, to, maxStepMeters) {
  const dNorth = rad(to.lat - from.lat) * EARTH_M;
  const dEast = rad(to.lng - from.lng) * EARTH_M * Math.cos(rad(from.lat));
  const d = Math.hypot(dNorth, dEast);
  if (d <= maxStepMeters || d === 0) return { lat: to.lat, lng: to.lng };
  const scale = maxStepMeters / d;
  const lat = from.lat + deg((dNorth * scale) / EARTH_M);
  const lng = from.lng + deg((dEast * scale) / (EARTH_M * Math.cos(rad(from.lat))));
  return { lat, lng };
}

// Offset a fix by a uniformly-random point inside a disc of radius accuracyM
// (metres). Distance from `p` is therefore ≤ accuracyM. sqrt(u) keeps the draw
// area-uniform (not clustered at the centre). Reports the accuracy so the UI's
// enableHighAccuracy consumers see a plausible value.
export function jitterFix(p, rng, accuracyM = 8) {
  const r = accuracyM * Math.sqrt(rng());
  const theta = 2 * Math.PI * rng();
  const dNorth = r * Math.cos(theta);
  const dEast = r * Math.sin(theta);
  const lat = p.lat + deg(dNorth / EARTH_M);
  const lng = p.lng + deg(dEast / (EARTH_M * Math.cos(rad(p.lat))));
  return { lat, lng, accuracy: accuracyM };
}
