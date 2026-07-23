// ─── Photo review triage (change: photo-review-throughput) ────────────────────
//
// A photo task is the only task type whose completion depends on a human being
// free. `submitStationPhoto` writes status 'pending' and stops: the task is not
// scored, the station slot is not released, and routing has nothing to hand the
// team. They are standing still until an organizer taps a button. At 10 to 20
// teams that queue is the steady state, not an edge case.
//
// The ORDER was already right — `@rushpoint/shared/photoQueue` sorts oldest
// first, totally and stably, and both consoles use it. What the panel could not
// say was URGENCY: it printed `submitted at 20:41` and left the organizer to
// read their own watch and subtract, per row, on a phone, while walking. A queue
// that is sorted correctly and reads flat gets triaged as though it were flat.
//
// This module is the triage verdict: how long each team has been blocked, who is
// actually blocked (a finished team is not), which decisions are legal, and
// which rows have a review that FAILED and must not be mistaken for one nobody
// has touched.
//
// Pure and total: no clock read (nowMs is injected), no I/O, no throw for any
// input. It renders inside the organizer's only live view of the field mid
// event, where a throw blanks the console.
//
// The bias on missing evidence is SILENCE, for the same reason as teamAttention:
// if one malformed document can render as the most urgent thing on screen, it
// owns the top of the queue forever and the organizer stops reading the queue.
import { normalizeStatus, submissionKey, type ReviewAction, type SubmissionStatus } from '@rushpoint/shared';

// ── Thresholds (design.md D2) ────────────────────────────────────────────────
// Set against the game's physics, not a service-desk SLA. A photo is submitted
// from a stop the team walked to and the next leg cannot start until the review
// lands, so ~one leg of walking is the point where the team starts losing time.

const MINUTE = 60_000;

/** Below this the team has not actually lost anything yet. */
export const WAIT_WARN_MS = 4 * MINUTE;
/** Long enough that the team is visibly standing around. The original complaint. */
export const WAIT_OVERDUE_MS = 10 * MINUTE;

export type WaitTier = 'fresh' | 'waiting' | 'overdue';

/** The structural subset of a submission this module needs. Deliberately narrow:
 *  it is generic over the caller's row, so consuming `SubmissionRow` from shared
 *  does not couple triage to the media fields it does not care about. */
export interface ReviewQueueRow {
  teamId: string;
  taskId: string;
  submittedAt?: string | null;
  status?: string | null;
}

export interface ReviewQueueItem<R extends ReviewQueueRow = ReviewQueueRow> {
  /** `teamId:taskId` — the same key the panel's in-flight guard is keyed on. */
  key: string;
  row: R;
  /** Elapsed wait in ms, clamped at zero. `null` when there is no usable evidence. */
  waitMs: number | null;
  /** Whole minutes waited, floored. `null` alongside a null `waitMs`. */
  waitMinutes: number | null;
  tier: WaitTier;
  /** The submitting team has crossed the finish line, so nobody is blocked on this. */
  teamFinished: boolean;
  /** A review of THIS row that failed and has not since succeeded. '' when clean. */
  failure: string;
}

export interface ReviewQueueOptions {
  nowMs: number;
  finishedTeamIds?: readonly string[] | ReadonlySet<string>;
  failures?: Readonly<Record<string, string>>;
}

// ── Total helpers ────────────────────────────────────────────────────────────

/** The single gate every timestamp passes through. Anything unusable is null. */
function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Elapsed wait, clamped at zero. The clamp is what makes clock skew a non-event:
 * a browser clock behind the server yields 0 (the least urgent answer) instead
 * of a negative that would sort to the very top of the queue.
 */
function waitOf(submittedAt: unknown, nowMs: number): number | null {
  if (!Number.isFinite(nowMs)) return null;
  const at = instant(submittedAt);
  if (at === null) return null;
  return Math.max(0, nowMs - at);
}

/** An unknown wait is `fresh`, never `overdue`: absence of evidence is not urgency. */
export function waitTier(waitMs: number | null): WaitTier {
  if (waitMs === null) return 'fresh';
  if (waitMs >= WAIT_OVERDUE_MS) return 'overdue';
  if (waitMs >= WAIT_WARN_MS) return 'waiting';
  return 'fresh';
}

function asSet(ids: readonly string[] | ReadonlySet<string> | undefined): ReadonlySet<string> {
  if (!ids) return new Set();
  return ids instanceof Set ? ids : new Set(ids as readonly string[]);
}

// ── The comparator (design.md D3) ────────────────────────────────────────────
//
// Precedence: still playing before finished, longer wait first, known wait
// before unknown, then key ascending. The last two steps are what make it TOTAL
// — for any two distinct items exactly one order holds, independent of the order
// they arrived in. An unstable comparator here is not cosmetic: rows re-order
// under the organizer's finger between tap-down and tap-up and they approve the
// wrong photograph.
function byPriority(a: ReviewQueueItem, b: ReviewQueueItem): number {
  if (a.teamFinished !== b.teamFinished) return a.teamFinished ? 1 : -1;
  if (a.waitMs === null || b.waitMs === null) {
    if (a.waitMs === b.waitMs) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    return a.waitMs === null ? 1 : -1;
  }
  if (a.waitMs !== b.waitMs) return b.waitMs - a.waitMs;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The actionable queue, ordered for triage.
 *
 * De-duplicates by key (first wins) and drops anything that is no longer
 * pending. Both are snapshot realities, not defensive noise: a Firestore
 * snapshot is a projection of a document being written concurrently, and the
 * render path keys its per-row in-flight guard on exactly this key, so two items
 * sharing a key would share one guard and one of them would be silently dead.
 */
export function buildReviewQueueView<R extends ReviewQueueRow>(
  rows: readonly R[],
  opts: ReviewQueueOptions,
): ReviewQueueItem<R>[] {
  if (!Array.isArray(rows)) return [];
  const nowMs = opts?.nowMs ?? Number.NaN;
  const finished = asSet(opts?.finishedTeamIds);
  const failures = opts?.failures ?? {};

  const seen = new Set<string>();
  const items: ReviewQueueItem<R>[] = [];
  for (const row of rows) {
    if (!row || typeof row.teamId !== 'string' || typeof row.taskId !== 'string') continue;
    if (!row.teamId || !row.taskId) continue;
    // An unrecognised status normalizes to 'pending' — a submission whose status
    // we cannot read is still work waiting for a human, and hiding it would
    // block that team for the rest of the run.
    if (normalizeStatus(row.status ?? undefined) !== 'pending') continue;
    const key = submissionKey(row);
    if (seen.has(key)) continue;
    seen.add(key);

    const waitMs = waitOf(row.submittedAt, nowMs);
    items.push({
      key,
      row,
      waitMs,
      waitMinutes: waitMs === null ? null : Math.floor(waitMs / MINUTE),
      tier: waitTier(waitMs),
      teamFinished: finished.has(row.teamId),
      failure: typeof failures[key] === 'string' ? failures[key] : '',
    });
  }
  return items.sort(byPriority);
}

// ── Decision legality ────────────────────────────────────────────────────────

export type ReviewRefusal = 'ok' | 'alreadyApproved' | 'alreadyRejected';

export interface ReviewDecision {
  /** Whether the callable should actually be fired. */
  send: boolean;
  nextStatus: SubmissionStatus;
  reason: ReviewRefusal;
}

/**
 * The gate every review passes through, layered on the shared transition table.
 *
 * Idempotence falls out of it: applying the same action twice equals applying it
 * once, from every starting status, and the second application never sends.
 *
 * Reject-after-approve is refused rather than sent because the server has no
 * score clawback path (see `canReject` in shared/photoQueue): it would flip a
 * status string while the points silently stayed. The manual score adjustment is
 * the honest tool for that.
 */
export function decideReview(status: string | null | undefined, action: ReviewAction): ReviewDecision {
  const current = normalizeStatus(status ?? undefined);
  if (current === 'approved') {
    return { send: false, nextStatus: 'approved', reason: 'alreadyApproved' };
  }
  if (action === 'approve') {
    return { send: true, nextStatus: 'approved', reason: 'ok' };
  }
  if (current === 'rejected') {
    return { send: false, nextStatus: 'rejected', reason: 'alreadyRejected' };
  }
  return { send: true, nextStatus: 'rejected', reason: 'ok' };
}

// ── Roving keyboard focus (design.md D6) ─────────────────────────────────────

/**
 * Move the roving focus by one step. Total by construction, because the queue
 * MUTATES under the focus: the item you just approved leaves the list, so the
 * "current" key is routinely stale by the time the next keystroke arrives.
 * A stale or absent key resolves to the front rather than to nothing.
 */
export function moveFocus(
  items: readonly { key: string }[],
  currentKey: string | null | undefined,
  delta: number,
): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = typeof currentKey === 'string' ? items.findIndex((i) => i.key === currentKey) : -1;
  if (index < 0) return items[0].key;
  const step = Number.isFinite(delta) ? Math.sign(delta) : 0;
  const next = Math.min(items.length - 1, Math.max(0, index + step));
  return items[next].key;
}

// ── The per-row failure map ──────────────────────────────────────────────────
//
// A review that failed used to leave a single generic toast that named neither
// the team nor the task and then vanished. The row correctly stayed in the queue
// but looked exactly like one nobody had touched, so the organizer both believed
// they had handled it and had no way to find which one had not stuck.

export type ReviewFailures = Readonly<Record<string, string>>;

export function recordFailure(failures: ReviewFailures, key: string, message: string): ReviewFailures {
  return { ...failures, [key]: message };
}

/** Returns the SAME object when there is nothing to clear, so React can skip the render. */
export function clearFailure(failures: ReviewFailures, key: string): ReviewFailures {
  if (!(key in failures)) return failures;
  const next = { ...failures };
  delete next[key];
  return next;
}
