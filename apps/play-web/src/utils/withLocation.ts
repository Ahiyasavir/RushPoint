// One-shot geolocation helper (change: prelaunch-critical-fixes, C1/C2).
//
// Extracted from TaskRunner so it imports with no React and can be unit-tested
// (scripts/test-gps-error-ux.ts). On GPS denial/unavailability it invokes the
// optional `onDenied` callback instead of silently calling `cb(0, 0)` — the old
// behavior silently submitted corrupted (0, 0) coordinates.
//
// @param cb        called with (lat, lng) on a successful fix.
// @param onDenied  called once when geolocation is absent or returns an error;
//                  the success callback `cb` is never called in that case.
export function withLocation(
  cb: (lat: number, lng: number) => void,
  onDenied?: () => void,
): void {
  if (!navigator.geolocation) {
    onDenied?.();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => cb(p.coords.latitude, p.coords.longitude),
    () => onDenied?.(),
    // maximumAge: reuse a fix up to 10 s old so a manual check-in feels instant
    // instead of stalling on a cold high-accuracy acquisition (matches the
    // PlayScreen watcher's maximumAge). No safety verdict is fed by this helper.
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 },
  );
}
