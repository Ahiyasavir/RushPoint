// Pure backoff / quick-failure logic for the resilient playtest tunnel
// (change: playtest-tunnel-auto-restart). No Date.now(), no I/O, no spawn —
// uptimes and failure counts are passed in so this is fully unit-testable.

/**
 * Capped exponential backoff before the next tunnel restart:
 * `min(maxMs, baseMs * 2 ** consecutiveQuickFailures)`. First restart is quick
 * (~baseMs); grows only while the tunnel keeps failing immediately.
 */
export function restartDelayMs(consecutiveQuickFailures, { baseMs = 1000, maxMs = 30000 } = {}) {
  const n = Math.max(0, consecutiveQuickFailures | 0);
  return Math.min(maxMs, baseMs * 2 ** n);
}

/**
 * Whether a tunnel exit counts as a "quick" failure (rapid back-to-back drop)
 * vs a healthy-then-dropped run. A run that stayed up at least `thresholdMs`
 * resets the backoff so a single late drop reconnects immediately.
 */
export function isQuickFailure(uptimeMs, thresholdMs = 10000) {
  return uptimeMs < thresholdMs;
}
