// Per team mission time limit (change: mission-time-limit).
//
// `Task.timeLimitMinutes`: from the moment a team is GIVEN the mission (its record's `startedAt`,
// stamped by the server in the claim transaction), that team has this long to finish it. When it
// runs out the server skips the mission for that team with no points and routes it on (the poll
// and requestNextTask sweeps), and every completion path refuses it.
//
// Computed on the SERVER's clock and shipped to the phone as a remaining DURATION, never as an
// instant: a phone whose clock runs slow would otherwise freeze or skip the countdown (the
// "never ship an absolute deadline" rule). Pure and total.

/** A submission in flight when the countdown hits zero still counts. */
export const TIME_LIMIT_GRACE_MS = 5_000;
/** Ten hours: longer than any event, short enough to catch a typo like 6000. */
export const TIME_LIMIT_MAX_MINUTES = 600;

export interface TimeLimitGate { timeLimitMinutes?: number }

function limitMs(task: TimeLimitGate | null | undefined): number | null {
  const m = task?.timeLimitMinutes;
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m * 60_000 : null;
}

function startMs(startedAt: unknown): number | null {
  if (typeof startedAt !== 'string') return null;
  const ms = Date.parse(startedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** Milliseconds this team has left, ≥ 0; null when the mission has no limit or no start stamp. */
export function timeLimitRemainingMs(task: TimeLimitGate | null | undefined, startedAt: unknown, nowMs: number): number | null {
  const limit = limitMs(task);
  const start = startMs(startedAt);
  if (limit === null || start === null) return null;
  return Math.max(0, start + limit - nowMs);
}

/** The team's time is up (after `graceMs`). No limit or no start stamp is never up. */
export function isTimeLimitUp(task: TimeLimitGate | null | undefined, startedAt: unknown, nowMs: number, graceMs = TIME_LIMIT_GRACE_MS): boolean {
  const limit = limitMs(task);
  const start = startMs(startedAt);
  if (limit === null || start === null) return false;
  return nowMs > start + limit + Math.max(0, graceMs);
}

/** Save-time check. Absent is fine; anything else must be a number in (0, 600]. */
export function timeLimitProblem(task: { timeLimitMinutes?: unknown } | null | undefined): string | null {
  const m = task?.timeLimitMinutes;
  if (m === undefined) return null;
  if (typeof m !== 'number' || !Number.isFinite(m) || m <= 0 || m > TIME_LIMIT_MAX_MINUTES) {
    return `timeLimitMinutes must be a number of minutes between 0 and ${TIME_LIMIT_MAX_MINUTES}`;
  }
  return null;
}
