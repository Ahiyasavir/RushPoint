// Which liftoff step the <LaunchLiftoff> overlay shows at rotation tick N, for a
// set of `count` steps (change: creator-launch-liftoff).
//
// The launch wait is a single opaque `launchRun` round-trip, so these steps are
// REASSURANCE, not measured progress: the overlay sweeps an indeterminate bar and
// rotates through the steps, it never claims a precise percentage or that a step
// "finished". This is the pure, testable rotation seam.
//
// A single or empty step set never rotates (always index 0). Otherwise the tick
// wraps: `((tick % count) + count) % count` keeps a negative or very large tick
// inside [0, count). Total — never throws for any tick or count. Deliberately
// identical in contract to play-web's `workingMessageIndex` so the two twins
// cannot drift.
export function liftoffStepIndex(tick: number, count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  const n = Math.floor(count);
  const t = Number.isFinite(tick) ? Math.floor(tick) : 0;
  return ((t % n) + n) % n;
}
