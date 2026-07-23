// ─── Teams that need attention (change: run-console-attention) ────────────────
//
// The run console answered "what is everyone's score?" and never "is anyone in
// trouble right now?". A team whose GPS watch died 40 minutes ago, a team sitting
// out a long answer lockout, and a team deep in a legitimate 20-minute photo task
// all rendered as the same row.
//
// This module is the whole verdict: a PURE, TOTAL function over the projection
// `listRunTeams` already returns. It reads no clock (nowMs is injected), performs
// no I/O, and never throws — it renders inside a live console mid-event, where a
// throw would blank the organizer's only view of the field.
//
// The design bias is SILENCE. The failure mode of an attention badge is not a
// missed team, it is a flagged table: an organizer who sees everything flagged
// stops reading the flags. So every unknown (missing timestamp, NaN, absent GPS,
// clock skew, an older backend that does not send a field) resolves to `ok`, and
// the idle thresholds are relative to the FIELD's own median pace, because "how
// long is a normal gap" is a property of the game, not of the platform.

export type AttentionLevel = 'ok' | 'watch' | 'stuck';

/**
 * Emitted in this fixed severity order, so rendering is deterministic and the
 * tests can assert on the array rather than on a set.
 */
export const ATTENTION_REASONS = [
  'outOfBounds',
  'answerLockout',
  'gpsSilent',
  'idle',
  'awaitingReview',
] as const;
export type AttentionReason = typeof ATTENTION_REASONS[number];

export interface TeamAttention {
  level: AttentionLevel;
  /** Empty if and only if `level === 'ok'`. */
  reasons: AttentionReason[];
}

/**
 * A structural subset of `RunTeamRow`. Everything past `id` is optional on
 * purpose: a console build talking to a backend that predates the projection
 * addition must degrade to fewer reasons, never to a wrong one.
 */
export interface AttentionTeam {
  id: string;
  finished?: boolean;
  launched?: boolean;
  startedAt?: string | null;
  /** `RunTeam.updatedAt` — the last server write for this team. The idle clock. */
  updatedAt?: string | null;
  /** `teamLocations/{teamId}.updatedAt` — freshness of the GPS stream, not a position. */
  lastLocationAt?: string | null;
  /** Epoch ms the answer-retry lockout expires; null/absent when not locked out. */
  answerLockoutUntil?: number | null;
  /** The safe-zone latch: assignment is blocked until a human or a good fix clears it. */
  outOfBounds?: boolean;
  /** Photo/audio submissions waiting on staff. Explains an idle team; never accuses one. */
  pendingReviews?: number;
}

export interface AttentionContext {
  /** Median idle time across the ACTIVE teams, or null when too few to be meaningful. */
  medianIdleMs: number | null;
}

// ── Thresholds (justified line by line in the change's design.md, D3) ─────────

const MINUTE = 60_000;

/** A team that just joined has a join-write timestamp and no activity yet. */
export const START_GRACE_MS = 10 * MINUTE;
/** Below this a normal task (walk + solve + submit) is routinely still in flight. */
export const IDLE_WATCH_FLOOR_MS = 12 * MINUTE;
export const IDLE_WATCH_MEDIAN_FACTOR = 2.5;
/** The number in the original complaint: 25 minutes of nothing is a problem. */
export const IDLE_STUCK_FLOOR_MS = 25 * MINUTE;
export const IDLE_STUCK_MEDIAN_FACTOR = 4;
/** Ceiling so a slow field cannot push the stuck threshold arbitrarily high. */
export const IDLE_HARD_STUCK_MS = 60 * MINUTE;
/** watchPosition emits far more often than this; silence means the stream died. */
export const GPS_WATCH_MS = 15 * MINUTE;
/** Escalates only in combination with an idle team (see D3). */
export const GPS_STUCK_MS = 35 * MINUTE;
/** Retry lockouts are ordinary gameplay; only one with real time left matters. */
export const LOCKOUT_MIN_REMAINING_MS = 2 * MINUTE;
export const LOCKOUT_STUCK_REMAINING_MS = 10 * MINUTE;
/** With one or two active teams a "median" is noise. */
export const MIN_TEAMS_FOR_MEDIAN = 3;

// ── Total helpers ─────────────────────────────────────────────────────────────

/** The single gate every timestamp passes through. Anything unusable is null. */
function instant(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Age of a timestamp at `nowMs`, clamped at zero. The clamp is what makes clock
 * skew a non-event: a browser clock behind the server yields 0, which is under
 * every threshold, instead of a negative that could wrap into one.
 */
function ageMs(value: unknown, nowMs: number): number | null {
  const at = instant(value);
  if (at === null) return null;
  return Math.max(0, nowMs - at);
}

function finiteMedian(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

const RANK: Record<AttentionLevel, number> = { ok: 0, watch: 1, stuck: 2 };
function raise(current: AttentionLevel, next: AttentionLevel): AttentionLevel {
  return RANK[next] > RANK[current] ? next : current;
}

const OK: TeamAttention = { level: 'ok', reasons: [] };

// ── The classifier ────────────────────────────────────────────────────────────

export function classifyTeamAttention(
  team: AttentionTeam,
  ctx: AttentionContext,
  nowMs: number,
): TeamAttention {
  // Without a usable clock there is no verdict to give. Silence, not a guess.
  if (!Number.isFinite(nowMs)) return OK;

  // 1. Suppression gates. A team in any of these states cannot be "stuck in the
  //    field", so no later signal is allowed to speak for it.
  if (team?.finished) return OK;
  if (!team?.launched) return OK;
  const sinceStart = ageMs(team.startedAt, nowMs);
  if (sinceStart !== null && sinceStart < START_GRACE_MS) return OK;

  const median = finiteMedian(ctx?.medianIdleMs);
  const idle = ageMs(team.updatedAt, nowMs);
  const gpsGap = ageMs(team.lastLocationAt, nowMs);

  // Idle thresholds: the larger of an absolute floor and a multiple of the
  // field's own pace, so a game of long legs does not flag its whole table.
  const watchAt = Math.max(
    IDLE_WATCH_FLOOR_MS,
    median === null ? 0 : median * IDLE_WATCH_MEDIAN_FACTOR,
  );
  const stuckFromField = Math.max(
    IDLE_STUCK_FLOOR_MS,
    median === null ? 0 : median * IDLE_STUCK_MEDIAN_FACTOR,
  );
  // The hard ceiling is suppressed when the FIELD median is already past it: if
  // everyone has been quiet for an hour that is the run, not one team.
  const stuckAt = median !== null && median >= IDLE_HARD_STUCK_MS
    ? stuckFromField
    : Math.min(stuckFromField, IDLE_HARD_STUCK_MS);

  const idleBeyondWatch = idle !== null && idle > watchAt;

  let level: AttentionLevel = 'ok';
  const reasons: AttentionReason[] = [];

  // 2. Reason collection, in fixed severity order.

  // The safe-zone latch hard-blocks task assignment and has a one-tap rescue
  // sitting on the same row, so it is the one single-signal `stuck`.
  if (team.outOfBounds === true) {
    reasons.push('outOfBounds');
    level = raise(level, 'stuck');
  }

  const lockoutUntil = instant(team.answerLockoutUntil);
  const lockoutLeft = lockoutUntil === null ? null : lockoutUntil - nowMs;
  if (lockoutLeft !== null && lockoutLeft > LOCKOUT_MIN_REMAINING_MS) {
    reasons.push('answerLockout');
    level = raise(level, lockoutLeft > LOCKOUT_STUCK_REMAINING_MS ? 'stuck' : 'watch');
  }

  // A team completing tasks with a dead GPS stream is inconvenienced; a team
  // that is BOTH silent and not progressing is the dead-watch case.
  if (gpsGap !== null && gpsGap > GPS_WATCH_MS) {
    reasons.push('gpsSilent');
    level = raise(level, gpsGap > GPS_STUCK_MS && idleBeyondWatch ? 'stuck' : 'watch');
  }

  if (idle !== null && idle > watchAt) {
    reasons.push('idle');
    level = raise(level, idle > stuckAt ? 'stuck' : 'watch');
  }

  // 3. A pending staff review EXPLAINS an already-flagged team ("they are idle
  //    because you have not reviewed their photo") and never flags one by
  //    itself — the console already counts the review queue in its own panel.
  if (level !== 'ok' && typeof team.pendingReviews === 'number' && team.pendingReviews > 0) {
    reasons.push('awaitingReview');
  }

  return level === 'ok' ? OK : { level, reasons };
}

/**
 * The field's own pace, computed over the teams that could actually be stuck.
 * Finished, unlaunched and unreadable rows are excluded so a run winding down
 * cannot drag the median up and silence the teams still playing.
 */
export function buildAttentionContext(
  teams: readonly AttentionTeam[],
  nowMs: number,
): AttentionContext {
  if (!Array.isArray(teams) || !Number.isFinite(nowMs)) return { medianIdleMs: null };

  const idles: number[] = [];
  for (const t of teams) {
    if (!t || t.finished || !t.launched) continue;
    const idle = ageMs(t.updatedAt, nowMs);
    if (idle !== null) idles.push(idle);
  }
  if (idles.length < MIN_TEAMS_FOR_MEDIAN) return { medianIdleMs: null };

  idles.sort((a, b) => a - b);
  const mid = idles.length >> 1;
  const medianIdleMs = idles.length % 2 === 1
    ? idles[mid]
    : (idles[mid - 1] + idles[mid]) / 2;
  return { medianIdleMs };
}

/** How many teams the organizer should look at. Built from the same verdict the rows render. */
export function countTeamsNeedingAttention(
  teams: readonly AttentionTeam[],
  nowMs: number,
): number {
  if (!Array.isArray(teams)) return 0;
  const ctx = buildAttentionContext(teams, nowMs);
  let n = 0;
  for (const t of teams) if (classifyTeamAttention(t, ctx, nowMs).level !== 'ok') n += 1;
  return n;
}
