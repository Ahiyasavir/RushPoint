// One-shot geolocation helper (change: prelaunch-critical-fixes, C1/C2).
//
// Extracted from TaskRunner so it imports with no React and can be unit-tested
// (scripts/test-gps-error-ux.ts). On GPS denial/unavailability it invokes the
// optional `onDenied` callback instead of silently calling `cb(0, 0)` — the old
// behavior silently submitted corrupted (0, 0) coordinates.
//
// @param cb        called with (lat, lng, accuracyMeters) on a successful fix.
//                  `accuracyMeters` is the browser's own reported horizontal error.
//                  It is OPTIONAL on the callback so existing two-argument callers
//                  keep compiling and keep behaving exactly as before.
// @param onDenied  called once when geolocation is absent or returns an error;
//                  the success callback `cb` is never called in that case.
/** Longer than the 5 s fix timeout below, so a real slow fix still wins. */
export const LOCATION_WATCHDOG_MS = 7000;

export function withLocation(
  cb: (lat: number, lng: number, accuracyMeters?: number) => void,
  onDenied?: () => void,
): void {
  if (!navigator.geolocation) {
    onDenied?.();
    return;
  }
  // A hard watchdog (7.10, QA on production): the `timeout` option does not run while the browser's
  // permission prompt is open, and some browsers never answer at all, so the request for the next
  // mission waited forever and "try again" waited again. Whichever answer comes first wins, once.
  let settled = false;
  const watchdog = setTimeout(() => { if (!settled) { settled = true; onDenied?.(); } }, LOCATION_WATCHDOG_MS);
  const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(watchdog); fn(); };
  navigator.geolocation.getCurrentPosition(
    // Pass the accuracy through (change: arrival-needs-a-usable-fix). The browser
    // hands it over on every fix and it used to be dropped on the floor, which is how
    // a 200m indoor fix could satisfy a 40m arrival radius.
    (p) => settle(() => cb(p.coords.latitude, p.coords.longitude,
      typeof p.coords.accuracy === 'number' && Number.isFinite(p.coords.accuracy)
        ? p.coords.accuracy : undefined)),
    () => settle(() => onDenied?.()),
    // maximumAge: reuse a fix up to 10 s old so a manual check-in feels instant
    // instead of stalling on a cold high-accuracy acquisition (matches the
    // PlayScreen watcher's maximumAge).
    //
    // NOTE, formerly "no safety verdict is fed by this helper" and no longer true:
    // since arrival-needs-a-usable-fix the server judges whether this fix is precise
    // enough to PROVE arrival, so the accuracy above is load-bearing. A stale fix is
    // still fine - the 10 s window is about latency, and the accuracy travels with
    // whichever fix is used.
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 },
  );
}
