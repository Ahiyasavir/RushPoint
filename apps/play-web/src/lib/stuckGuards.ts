// "Can the participant still act?" decisions, extracted from TaskRunner so they
// can be tested (change: stuck-player-guards). play-web has no component test
// runner, so anything left inside a .tsx can only be eyeballed — these three pure
// functions are covered by scripts/test-stuck-player-guards.ts.
//
// ONE RULE governs this file. A participant must NEVER be stuck by CLIENT state
// alone: the server is the only authority on whether an action is allowed, and it
// re-validates every submission. So every gate here FAILS OPEN — when in doubt,
// let the player reach the server and let the server refuse.
//
// Corollary, learned the hard way (the wrong-answer retry lockout shipped an
// absolute server instant and TaskRunner counted it down against the DEVICE
// clock, freezing a slow-clocked phone's answer controls for hours): nothing here
// takes a clock. These decisions are made from DURATIONS, counters and identities
// only, and none of them is persisted — so neither a skewed clock nor a reload can
// resurrect a blocking state.

// ─── 1. Geofence location watch — never give up ───────────────────────────────
export const GPS_RETRY_BASE_MS = 3_000;
export const GPS_RETRY_MAX_MS = 30_000;

/**
 * How long to wait before restarting `watchPosition` after its error callback.
 *
 * `GeofenceAuto` used to `clearWatch` on ANY error and never restart, so a single
 * transient POSITION_UNAVAILABLE (routine indoors, in a courtyard, in a tunnel)
 * permanently killed auto check-in for a task type that has no manual submit —
 * the player could not complete that task for the rest of the run.
 *
 * The delay grows so a genuinely denied permission is not re-prompted in a tight
 * loop, and is CAPPED so a long outage still recovers within half a minute of the
 * signal returning. The return value is always finite and positive: there is no
 * input for which the app stops trying to find the player.
 */
export function gpsRetryDelayMs(consecutiveErrors: number): number {
  const n = typeof consecutiveErrors === 'number' && Number.isFinite(consecutiveErrors)
    ? Math.floor(consecutiveErrors)
    : 0;
  if (n < 1) return GPS_RETRY_BASE_MS;
  // 2^(n-1) overflows to Infinity around n = 1075; Math.min would then return the
  // cap anyway, but clamp the exponent first so the arithmetic stays finite.
  const steps = Math.min(n - 1, 20);
  return Math.min(GPS_RETRY_BASE_MS * 2 ** steps, GPS_RETRY_MAX_MS);
}

// ─── 2. Offline submit gate — warn once, then defer to the network ────────────
export interface OfflineGateInput {
  /** `navigator.onLine`, or undefined when there is no navigator at all. */
  online: boolean | undefined;
  /** The task id we already nudged about, or null if we never nudged. */
  nudgedForTaskId: string | null;
  /** The task the participant is acting on ('' when unknown). */
  taskId: string;
}

export interface OfflineGateResult {
  blocked: boolean;
  reason: 'offline' | null;
  /** The memory to carry forward (unchanged unless this call nudged). */
  nudgedForTaskId: string | null;
}

/**
 * `navigator.onLine` is a browser heuristic, not a fact: it reads `false` on some
 * working connections (virtual/VPN adapters, some Android and captive-portal
 * states), and when it is wrong it is cleared only by an `online` event that never
 * fires — because the browser never thought it went offline. Blocking on it
 * unconditionally meant a live button that did nothing, forever, for a submission
 * the server would have accepted.
 *
 * So: the FIRST attempt on a task while the browser claims offline shows the
 * localized nudge (the honest, common case). A repeat attempt on the same task is
 * sent, and the network + server decide. Per-task, so a genuinely offline player
 * still gets told once per task instead of collecting silent failures.
 */
export function offlineSubmitGate(input: OfflineGateInput): OfflineGateResult {
  const { online, nudgedForTaskId, taskId } = input;
  // Only an explicit `false` is a signal. Online, or no information at all, opens.
  if (online !== false) return { blocked: false, reason: null, nudgedForTaskId };
  // Already warned about THIS task → let them through (fail open).
  if (nudgedForTaskId !== null && nudgedForTaskId === taskId) {
    return { blocked: false, reason: null, nudgedForTaskId };
  }
  return { blocked: true, reason: 'offline', nudgedForTaskId: taskId };
}

// ─── 3. Host-help affordance — re-arms on a new task ──────────────────────────
/**
 * Whether the "ask the host for help" affordance should read as already sent.
 *
 * This used to be a run-wide boolean that nothing ever reset, so a team that
 * raised the alarm once saw "Sent, the host has been alerted" on every later task
 * and could never call for help again — on the ONLY escape hatch a stuck geofence
 * player has. Scoping it to the task id re-arms it whenever the task changes.
 *
 * A FAILED request records nothing (`sentForTaskId` stays null), so a network
 * failure can never latch the affordance off.
 */
export function helpAlreadySent(sentForTaskId: string | null, taskId: string | null): boolean {
  if (sentForTaskId === null || taskId === null) return false;
  return sentForTaskId === taskId;
}
