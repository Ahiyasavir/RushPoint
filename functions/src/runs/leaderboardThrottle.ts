// Pure throttle decision for the live-leaderboard auto-refresh (change:
// live-leaderboard-auto-refresh). Kept transport-free so it runs in the
// no-emulator vitest lane.

export const LEADERBOARD_REFRESH_MIN_MS = 20_000;

// True when the snapshot should be recomputed: no previous timestamp, an
// unparsable one, or one at least `minIntervalMs` old. A FUTURE timestamp
// (clock skew) also refreshes — otherwise a skewed write could wedge the
// board until the skew elapses.
export function shouldRefreshLeaderboard(
  lastUpdatedAt: string | undefined,
  nowMs: number,
  minIntervalMs: number = LEADERBOARD_REFRESH_MIN_MS,
): boolean {
  if (!lastUpdatedAt) return true;
  const last = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(last)) return true;
  if (last > nowMs) return true;
  return nowMs - last >= minIntervalMs;
}

// Firestore field-path update payload for an auto-refresh write. Uses dotted FIELD
// PATHS so it rewrites ONLY leaderboard.rankings + the timestamps and NEVER the
// organizer-controlled leaderboard.published / leaderboard.frozen flags. A plain
// full-object `{ leaderboard: {...} }` write re-reads those flags from a stale
// snapshot and, under a concurrent publish/freeze, clobbers them (last-write-wins).
// Writing only these field paths makes that clobber structurally impossible.
// (leaderboard.rankings is set as a whole array value, not indexed INTO — safe; the
// "never dotted-update an array element" footgun is about `arr.0.field` paths.)
export function leaderboardRefreshFields<T>(
  rankings: T[],
  nowIso: string,
): Record<string, unknown> {
  return {
    'leaderboard.rankings': rankings,
    'leaderboard.updatedAt': nowIso,
    updatedAt: nowIso,
  };
}
