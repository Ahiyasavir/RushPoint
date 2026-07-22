// Live photo feed reports (change: feed-ugc-safety). Pure reducer applied by the
// reportFeedItem callable inside a transaction, and unit-tested without an
// emulator (scripts/test-feed-reports.ts). Mirrors feedReactions.ts's shape: a
// closed constant set, a narrow state interface, a `changed` flag, purity.
//
// DESIGN AMENDMENT (overrides the original spec text): `reportedBy` is keyed by
// **teamId, not uid**. RushPoint supports shared team devices (multiple uids
// attached to one team via `deviceUids`), so per-uid distinctness would let a
// single team with two phones reach FEED_AUTO_HIDE_REPORTS on its own and hide a
// rival team's photo — exactly the griefing the threshold-of-2 exists to
// prevent. The reducer stays pure/caller-agnostic: its second parameter is named
// `reporterKey` (not `uid`); the callable resolves it to the caller's teamId (or
// the sentinel `staff:<uid>` for a staff/owner reporter with no team).

/** The only report reasons a participant may choose — no free text. */
export const FEED_REPORT_REASONS = ['inappropriate', 'harassment', 'privacy', 'other'] as const;
export type FeedReportReason = (typeof FEED_REPORT_REASONS)[number];

/** Distinct reporterKeys (teams) needed before an item auto-hides. */
export const FEED_AUTO_HIDE_REPORTS = 2;

export interface FeedReportState {
  /** reporterKey (teamId, or `staff:<uid>`) → reason. */
  reportedBy?: Record<string, string>;
  reportCount?: number;
  active?: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  /** Set by hideFeedItem({ restore: true }); disarms auto-hide permanently. */
  reportsCleared?: boolean;
}

export interface FeedReportResult {
  reportedBy: Record<string, string>;
  reportCount: number;
  active: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  reportsCleared?: boolean;
  /** False when this reporterKey already reported with the same reason. */
  changed: boolean;
  /** True only when THIS call flipped active → false. */
  hidden: boolean;
}

/**
 * Apply one reporterKey's report to a feed item's report state.
 * - Throws on a reason outside FEED_REPORT_REASONS (server validates first).
 * - Idempotent per reporterKey: same reporterKey + same reason → `changed: false`.
 * - Same reporterKey + different reason: updates the stored reason, does NOT
 *   raise reportCount (recomputed from distinct keys, never incremented blindly).
 * - reportCount === number of distinct reporterKeys (== distinct teams, under the
 *   design amendment above).
 * - Auto-hide: reportCount >= FEED_AUTO_HIDE_REPORTS AND item.active !== false AND
 *   item.reportsCleared !== true → active:false, hiddenBy:'auto:reports',
 *   hiddenAt:now, hidden:true.
 * - An already-inactive item still accepts further reports idempotently
 *   (hidden stays false; it does not re-flip or error).
 * Pure — never mutates its input; `now` is injected for deterministic tests.
 */
export function applyReport(
  item: FeedReportState,
  reporterKey: string,
  reason: string,
  now?: string,
): FeedReportResult {
  if (!(FEED_REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`Invalid feed report reason: ${JSON.stringify(reason)}`);
  }
  const reportedBy: Record<string, string> = { ...(item.reportedBy ?? {}) };
  const previous = reportedBy[reporterKey];
  const changed = previous !== reason;
  reportedBy[reporterKey] = reason;

  const reportCount = Object.keys(reportedBy).length;
  const wasActive = item.active !== false;
  const alreadyCleared = item.reportsCleared === true;

  let active = item.active !== false;
  let hiddenAt = item.hiddenAt;
  let hiddenBy = item.hiddenBy;
  let hidden = false;

  if (wasActive && !alreadyCleared && reportCount >= FEED_AUTO_HIDE_REPORTS) {
    active = false;
    hiddenBy = 'auto:reports';
    hiddenAt = now ?? new Date().toISOString();
    hidden = true;
  }

  return {
    reportedBy,
    reportCount,
    active,
    hiddenAt,
    hiddenBy,
    reportsCleared: item.reportsCleared,
    changed,
    hidden,
  };
}
