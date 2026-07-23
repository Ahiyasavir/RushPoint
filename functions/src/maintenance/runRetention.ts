// Which runs may have their participant PII destroyed (change: run-retention-completeness).
//
// WHY THIS EXISTS AS A PURE MODULE:
//
// The Privacy Policy promises participants that raw GPS data and uploaded photos
// are "auto-deleted 90 days after run completion" (LegalPage.tsx:384-385). The
// sweep that kept that promise selected runs by `status === 'finished'` — and
// that status is written in exactly ONE place, `finalizeRun`, i.e. it is a record
// of a CREATOR CLICKING A BUTTON, not a fact about the world. A run that is simply
// abandoned (the group goes home, the tab gets closed) was therefore retained
// FOREVER: GPS pings, photos, audio, chat, SOS coordinates, guardian names.
//
// This module is the fix, and it is pure/total on purpose, because it decides
// whether data is destroyed and it can be wrong in two directions:
//   • too narrow  → the promise above is broken (the original defect);
//   • too broad   → a game that is STILL BEING PLAYED is wiped mid-run, which is
//                   catastrophic and unrecoverable.
// So every ambiguity biases toward KEEP, and the Firestore queries in the sweep
// are only a candidate filter — this predicate is the authority.
//
// THE SAFETY INVARIANT, in one line: for a run that was never finalized the anchor
// is the MAXIMUM of every timestamp it carries, so a single recent timestamp
// vetoes the prune no matter how ancient the others are.

import { RUN_DATA_RETENTION_DAYS } from '@rushpoint/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Non-finished run statuses: the ones an abandoned run can be sitting in. */
export const ABANDONABLE_RUN_STATUSES = ['draft', 'live'] as const;

/** The only fields of a run document this decision may look at. */
export interface RunRetentionFacts {
  status?: string;
  finishedAt?: string | null;
  launchedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Tombstone written by pruneRunPII; makes the whole operation idempotent. */
  piiPrunedAt?: string | null;
}

/** Closed set of outcomes. Every input maps to exactly one of these. */
export const RUN_PRUNE_REASONS = [
  'already_pruned',
  'no_usable_timestamp',
  'future_timestamp',
  'within_retention',
  'finished_retention_elapsed',
  'abandoned_retention_elapsed',
] as const;
export type RunPruneReason = (typeof RUN_PRUNE_REASONS)[number];

export interface RunPruneDecision {
  prune: boolean;
  reason: RunPruneReason;
  /** The instant the decision was anchored on, or null when none was usable. */
  anchorMs: number | null;
  /** anchorMs + the retention window, or null. */
  eligibleAtMs: number | null;
}

/** Parse an ISO timestamp; null for anything absent, blank, non-string or unparseable. */
function isoMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * May this run's participant PII be destroyed now?
 *
 * PURE and TOTAL — no I/O, no implicit clock read, never throws for any input.
 * `now` and `days` are injected so the boundary is testable to the millisecond.
 *
 * Anchoring (see design D1):
 *   • finalized run with a usable `finishedAt` → anchor on `finishedAt`. That is
 *     literally the policy's clock ("90 days after run completion") and preserves
 *     the pre-existing behavior exactly; a post-finalize touch must not push a
 *     participant's photos past the promised window.
 *   • anything else → anchor on the MAXIMUM of every parseable timestamp, i.e.
 *     the newest evidence that anything happened here at all.
 *
 * Fail-closed: already pruned, no usable timestamp, or an anchor in the future
 * (clock skew / a bad string) all mean "do not destroy".
 * Boundary is inclusive at `anchor + days`, matching `isPurgeDue` for game trash.
 */
export function evaluateRunPrune(
  facts: RunRetentionFacts | null | undefined,
  now: Date,
  days: number = RUN_DATA_RETENTION_DAYS,
): RunPruneDecision {
  const run = (facts ?? {}) as RunRetentionFacts;

  // Idempotence tombstone first — never re-destroy, never re-read timestamps.
  // A BLANK string is not a tombstone (it must not block a real prune).
  if (typeof run.piiPrunedAt === 'string' && run.piiPrunedAt.trim() !== '') {
    return { prune: false, reason: 'already_pruned', anchorMs: null, eligibleAtMs: null };
  }

  const finishedMs = isoMs(run.finishedAt);
  const activity = [isoMs(run.finishedAt), isoMs(run.updatedAt), isoMs(run.launchedAt), isoMs(run.createdAt)]
    .filter((ms): ms is number => ms !== null);

  const finalized = run.status === 'finished' && finishedMs !== null;
  const anchorMs = finalized ? finishedMs : (activity.length > 0 ? Math.max(...activity) : null);

  if (anchorMs === null) {
    return { prune: false, reason: 'no_usable_timestamp', anchorMs: null, eligibleAtMs: null };
  }

  const nowMs = now.getTime();
  // Clock skew: an anchor in the future would otherwise read as a negative age.
  // Refuse rather than guess. (Equal to `now` is fine — that is just "brand new".)
  if (anchorMs > nowMs) {
    return { prune: false, reason: 'future_timestamp', anchorMs, eligibleAtMs: null };
  }

  const eligibleAtMs = anchorMs + days * DAY_MS;
  if (nowMs < eligibleAtMs) {
    return { prune: false, reason: 'within_retention', anchorMs, eligibleAtMs };
  }
  return {
    prune: true,
    reason: finalized ? 'finished_retention_elapsed' : 'abandoned_retention_elapsed',
    anchorMs,
    eligibleAtMs,
  };
}

/**
 * Split `users/{ownerUid}/games/{gameId}/runs/{runId}` into its ids, or null when
 * the path is not exactly that shape or any id is blank.
 *
 * This guard is not paranoia: `runId` is handed to `runPhotoPrefix`, and a blank
 * id there means the prefix `runs/` — a bucket-wide delete of every run's
 * participant uploads. `runPhotoPrefix` throws on a blank id by design, but a
 * throw in the middle of a sweep is a bad way to find out; skip and log instead.
 */
export function parseRunPath(
  path: string,
): { ownerUid: string; gameId: string; runId: string } | null {
  if (typeof path !== 'string') return null;
  const parts = path.split('/');
  if (parts.length !== 6) return null;
  if (parts[0] !== 'users' || parts[2] !== 'games' || parts[4] !== 'runs') return null;
  const [, ownerUid, , gameId, , runId] = parts;
  if (!ownerUid?.trim() || !gameId?.trim() || !runId?.trim()) return null;
  return { ownerUid, gameId, runId };
}
