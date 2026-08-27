// How often the run console re-reads WHEN each team was last seen.
// (change: hot-path-read-cost)
//
// THE PROBLEM THIS SOLVES. `listRunTeams` reads the `teamLocations` collection to supply
// `lastLocationAt` per row — a FRESHNESS signal, used to tell a dead GPS watch apart from a
// team that is simply taking its time. It reads through `cachedGetCollection`, so it only
// re-reads documents that changed. But every location ping writes one of those documents, so
// during a live run essentially all of them are dirty on every poll: at 120 teams pinging and
// a 5-second board poll, this single read accounted for ~10,800 of the run's reads.
//
// The signal is a minutes-scale judgement being refreshed every five seconds. Nobody looks at
// a board and concludes "that team's GPS died" from a value four seconds old that was fresh
// five seconds ago.
//
// WHY A SEPARATE INTERVAL RATHER THAN A SLOWER BOARD POLL. The board itself must stay
// responsive: a photo-review queue or a stuck team surfacing 20 seconds late is a real
// operational regression, which is exactly the argument `runConsolePolling.ts` already makes on
// the client. So the board keeps its cadence and only this one input slows down.
//
// ⚠️ THIS VALUE NEVER GATES A SAFETY DECISION. The safe-zone verdict is made in
// `updateLocation`, where the fix actually arrives, and an out-of-bounds team raises its alert
// there regardless of what this cache holds. Nothing here can delay a breach; it can only make
// the console's "last seen" column up to REFRESH_MS old.
//
// SINGLE-PROCESS PRECONDITION. Like `docCache.ts`, `rateLimitStore.ts` and `lastFixStore.ts`,
// this is per-process memory and is correct because the VPS runs the API as ONE Node process.
// Under multiple processes each would keep its own copy, which for this value is merely
// redundant rather than wrong — a stale freshness reading is the same class of imprecision the
// interval already introduces. It is still listed here so the constraint stays discoverable.

/**
 * How long a freshness snapshot is reused before the collection is read again.
 *
 * 60s, matched to the participant client's own maximum silence floor
 * (`PING_MAX_SILENCE_MS` in apps/play-web/src/lib/pingGate.ts). This is not a coincidence and
 * not a tuning choice: a team reports at most once per 60s, so "when did we last hear from
 * this team" CANNOT be more precise than 60s no matter how often it is read. Refreshing at 30s
 * sampled twice per underlying datum and bought nothing but reads — ~4,500 of them per run at
 * 120 teams.
 *
 * If the ping floor ever changes, this should follow it, for that reason and no other.
 */
export const LOCATION_FRESHNESS_REFRESH_MS = 60_000;

interface Entry {
  /** teamId → the `updatedAt` of its last location write. */
  byTeam: Map<string, string>;
  readAtMs: number;
}

const store = new Map<string, Entry>();

/** Drop snapshots nobody has asked for in a long while, so a finished run stops costing memory. */
const IDLE_EVICT_MS = 30 * 60_000;

function evictIdle(nowMs: number): void {
  for (const [key, entry] of store) {
    if (nowMs - entry.readAtMs > IDLE_EVICT_MS) store.delete(key);
  }
}

/**
 * The freshness map for one run, re-reading at most once per {@link LOCATION_FRESHNESS_REFRESH_MS}.
 *
 * `read` is invoked only when the snapshot is missing or stale. A throwing `read` is NOT
 * cached and NOT propagated as an empty result: the previous snapshot is returned if there is
 * one, and an empty map otherwise — the same best-effort bias the call site already had, where
 * a failed read degrades to "no evidence" rather than failing the organizer's only view of the
 * field.
 */
export async function getLocationFreshness(
  runKey: string,
  read: () => Promise<Map<string, string>>,
  nowMs: number = Date.now(),
): Promise<Map<string, string>> {
  const cached = store.get(runKey);
  if (cached && nowMs - cached.readAtMs < LOCATION_FRESHNESS_REFRESH_MS) return cached.byTeam;

  try {
    const byTeam = await read();
    store.set(runKey, { byTeam, readAtMs: nowMs });
    evictIdle(nowMs);
    return byTeam;
  } catch {
    // Keep serving the last good snapshot rather than blanking every row's "last seen".
    return cached?.byTeam ?? new Map();
  }
}

/** Test seam: forget everything. */
export function resetLocationFreshness(): void {
  store.clear();
}
