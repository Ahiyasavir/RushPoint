// Pause-clock tasks (change: pause-clock-tasks) — the single definition of how
// much of a team's race clock is excluded, and how the remaining elapsed time is
// derived.
//
// WHY THIS IS A SEPARATE, DEPENDENCY-FREE MODULE
// The race clock is SERVER-AUTHORITATIVE. Every value here comes from timestamps
// the server itself wrote onto the team's own RunTaskRecord; nothing a client
// reports may reach it, because a client-supplied duration would be a one-line
// way to fake a fast finish. Keeping the arithmetic pure means the rule can be
// exercised exhaustively with no emulator (see pausedClock.test.ts) and means
// buildRankings — shared by finalizeRun and refreshLeaderboard — can apply it in
// exactly one place, so the live board and the final board cannot drift.
//
// Sign convention: an excluded amount is always >= 0 and can only ever SUBTRACT.
// Nothing in this module can lengthen a team's clock.

/** The only two fields of a run task record this rule reads. Both server-written. */
export interface TaskTimingRecord {
  startedAt?: string;
  completedAt?: string;
}

/** Milliseconds between two ISO instants, or `null` when either is unusable. */
function spanMs(startedAt: unknown, completedAt: unknown): number | null {
  if (typeof startedAt !== 'string' || typeof completedAt !== 'string') return null;
  const a = new Date(startedAt).getTime();
  const b = new Date(completedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

/**
 * How much of the team's clock this ONE task record excludes.
 *
 * Zero unless the task is authored `pausesTimer` AND the team actually COMPLETED
 * it. An in-progress, abandoned, expired, skipped or auto-skipped paused task
 * excludes nothing: from stored state we cannot distinguish "deliberating" from
 * "walked away", and crediting an open span would make walking away the fastest
 * way to finish. A non-monotonic clock (completedAt before startedAt) and any
 * unparsable stamp clamp to 0 — never a negative, never NaN, because this value
 * is subtracted from every time-derived scoring term.
 */
export function taskExcludedMs(rec: TaskTimingRecord, pausesTimer: boolean): number {
  if (!pausesTimer) return 0;
  const ms = spanMs(rec?.startedAt, rec?.completedAt);
  if (ms === null) return 0;
  return Math.max(0, ms);
}

/** Minimal shape of the stored stages this rule sums over. */
export interface ExcludedStageRecord {
  tasks?: { excludedMs?: number }[];
}

/**
 * Total excluded milliseconds for a team, summed from the values the server
 * STAMPED at completion time — never re-derived from the current game template.
 *
 * Reading the stamp rather than the flag is what makes a completed task's
 * contribution immutable: a creator may edit `pausesTimer` while a run is live,
 * and that must not retroactively re-time work a team already finished (which
 * would make the live board jump and break live/final parity).
 *
 * Non-finite and negative stamps are ignored rather than propagated, so one
 * corrupt record cannot NaN a whole leaderboard.
 */
export function teamExcludedMs(stages: ExcludedStageRecord[]): number {
  if (!Array.isArray(stages)) return 0;
  let total = 0;
  for (const stage of stages) {
    const tasks = stage?.tasks;
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      const ms = task?.excludedMs;
      if (Number.isFinite(ms) && (ms as number) > 0) total += ms as number;
    }
  }
  return total;
}

/** The only field of a team document the hold rule reads. Server-written. */
export interface HeldTimingRecord {
  heldMs?: number;
}

/**
 * How much of the team's clock a staff-initiated HOLD excludes — the team-level
 * analogue of `teamExcludedMs` above.
 *
 * A hold is not tied to any one task (a marshal parks a team mid-transit, mid-
 * deliberation, or between stages), so its accumulated total rides the team
 * document instead of a RunTaskRecord. Same immutability argument as the task
 * stamps: the server writes `heldMs` at resume from its OWN clock, and
 * buildRankings reads only that number — never `heldAt` against `now` — so a team
 * released ten minutes ago cannot keep accruing exclusion, and the live board and
 * the final board read the same value.
 *
 * Total and fail-safe by construction: a missing, negative, non-finite or
 * non-numeric stamp yields 0. This value is SUBTRACTED from every time-derived
 * scoring term, so one corrupt team document must never be able to NaN or invert
 * a whole leaderboard.
 */
export function teamHeldExclusionMs(team: HeldTimingRecord): number {
  const ms = team?.heldMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 0;
  return ms;
}

/**
 * The team's adjusted elapsed time: `max(0, raw - excluded)`.
 *
 * A raw `Infinity` (a team with no finish instant) passes straight through, so a
 * team that has not finished keeps its existing "no duration" treatment instead
 * of gaining a fabricated one. A non-finite or negative excluded amount is
 * treated as 0 — this function can only ever subtract.
 */
export function adjustedElapsedMs(rawMs: number, excludedMs: number): number {
  if (!Number.isFinite(rawMs)) return rawMs;
  const exc = Number.isFinite(excludedMs) && excludedMs > 0 ? excludedMs : 0;
  return Math.max(0, rawMs - exc);
}

/**
 * The same rule in the units `buildRankings` works in: raw elapsed SECONDS in,
 * excluded MILLISECONDS in (that is how the stamps are stored), seconds out.
 */
export function adjustedElapsedSeconds(rawSeconds: number, excludedMs: number): number {
  if (!Number.isFinite(rawSeconds)) return rawSeconds;
  const exc = Number.isFinite(excludedMs) && excludedMs > 0 ? excludedMs : 0;
  return Math.max(0, rawSeconds - exc / 1000);
}
