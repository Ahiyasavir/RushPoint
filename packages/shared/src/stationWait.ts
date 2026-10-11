// Waiting for a station stops the team's clock (change: station-wait-clock; Ahiya, 2026-10-10).
//
// A station admits at most `maxConcurrentTeams`. When every station open to a team is full,
// routing answers `stationsFull` and the phone waits and asks again. That wait is the
// organizer's doing, not the team's, so it comes off the race clock exactly like a staff hold.
//
// THE RULE THAT KEEPS IT HONEST: the clock stops only while the phone keeps asking. The server
// stamps the last time it answered "full" (`stationWaitSeenAt`), and a wait is credited up to
// one allowance past that stamp and no further. A phone that asks every few seconds is credited
// to the second; a team that closed the app and went to eat is credited one more minute.
//
// Everything is read from stamps the SERVER wrote on the team document. `buildRankings` reads
// only the settled total, never `now`, so the live board and the final board cannot drift.
// Pure and total: garbage in means zero out, because this value is subtracted from a ranking.

/** The server refreshes `stationWaitSeenAt` at most this often (one write per beat). */
export const STATION_WAIT_HEARTBEAT_MS = 30_000;
/**
 * How long past the last "full" answer a wait still counts: one heartbeat, one retry of the
 * phone (it asks again within 8 s), and slack for a slow network.
 */
export const STATION_WAIT_GAP_MS = 60_000;

/** The fields of a team document this rule reads. All server-written. */
export interface StationWaitRecord {
  /** ISO: when the open wait started. Absent when the team is not waiting. */
  stationWaitSince?: string;
  /** ISO: the last time the phone asked and was answered "every station is full". */
  stationWaitSeenAt?: string;
  /** Milliseconds of finished waits, already settled. */
  stationWaitMs?: number;
}

function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The settled total, sanitised: a corrupt stamp must never NaN or invert a leaderboard. */
export function teamStationWaitMs(team: StationWaitRecord | null | undefined): number {
  const ms = team?.stationWaitMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 0;
  return ms;
}

export function isWaitingForStation(team: StationWaitRecord | null | undefined): boolean {
  return instant(team?.stationWaitSince) !== null;
}

/** What the OPEN wait is worth at `nowMs`. Zero when nothing is open or anything is unreadable. */
export function stationWaitCreditMs(team: StationWaitRecord | null | undefined, nowMs: number): number {
  const since = instant(team?.stationWaitSince);
  if (since === null || !Number.isFinite(nowMs)) return 0;
  const seen = instant(team?.stationWaitSeenAt) ?? since;
  const end = Math.min(nowMs, seen + STATION_WAIT_GAP_MS);
  return Math.max(0, end - since);
}

/**
 * Close the open wait: what it adds and the new settled total. `null` when nothing is open, so
 * the caller writes nothing.
 */
export function settleStationWait(
  team: StationWaitRecord | null | undefined, nowMs: number,
): { addedMs: number; totalMs: number } | null {
  if (!isWaitingForStation(team)) return null;
  const addedMs = stationWaitCreditMs(team, nowMs);
  return { addedMs, totalMs: teamStationWaitMs(team) + addedMs };
}

/**
 * What to write when the server has just answered "every station is full":
 *   'start'   no wait is open: stamp its start.
 *   'beat'    a wait is open and its last stamp is old: refresh it.
 *   'restart' the phone was quiet past the allowance: settle what it earned, start a new wait.
 *   'none'    stamped recently: write nothing (this is what keeps a wait cheap).
 */
export function stationWaitStamp(
  team: StationWaitRecord | null | undefined, nowMs: number,
): 'start' | 'beat' | 'restart' | 'none' {
  const since = instant(team?.stationWaitSince);
  if (since === null) return 'start';
  const seen = instant(team?.stationWaitSeenAt) ?? since;
  if (nowMs - seen > STATION_WAIT_GAP_MS) return 'restart';
  return nowMs - seen >= STATION_WAIT_HEARTBEAT_MS ? 'beat' : 'none';
}
