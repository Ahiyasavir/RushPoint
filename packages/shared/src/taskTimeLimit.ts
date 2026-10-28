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

import { arrivalGateApplies } from './missionArrival';

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

/**
 * The stamp a mission's countdown runs from (change: composer-v2-phase0).
 *
 * A mission sealed until arrival counts from the team's ARRIVAL (`arrivedAt`): counting from the
 * moment it was given let the walk to the pin eat the clock. Before arrival it returns null, which
 * `timeLimitRemainingMs` / `isTimeLimitUp` already read as "no countdown, never up". Every other
 * mission (no pin, hidden, a run without the gate) counts from `startedAt`, as before.
 *
 * `gate` is the run's `arrivalGate`. A caller without the run passes undefined, and the gate is
 * inferred from the arrival latch: a gated mission cannot be submitted before arrival, and an
 * ungated run never latches `arrivedAt` on a located mission, so the inference is exact wherever a
 * submission is judged. Pure and total.
 */
export function timeLimitClockStart(
  task: Parameters<typeof arrivalGateApplies>[0] | unknown,
  rec: { startedAt?: unknown; arrivedAt?: unknown } | null | undefined,
  gate: boolean | undefined,
): string | null {
  const r = rec && typeof rec === 'object' ? rec : {};
  const started = typeof r.startedAt === 'string' ? r.startedAt : null;
  const arrivedAt = typeof r.arrivedAt === 'string' ? r.arrivedAt : null;
  const t = task && typeof task === 'object' ? task as Parameters<typeof arrivalGateApplies>[0] : null;
  const gated = arrivalGateApplies(t, { arrivalGate: gate ?? arrivedAt !== null });
  if (!gated) return started;
  // An arrival from an EARLIER hold of this mission (it was routed away and handed back) is not this
  // hold's arrival: counting from it made the countdown expire on the spot (bug hunt 27.10). The
  // clock then starts no earlier than the hand-over.
  if (arrivedAt !== null && started !== null && Date.parse(arrivedAt) < Date.parse(started)) return started;
  return arrivedAt;
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
