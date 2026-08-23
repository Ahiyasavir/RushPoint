// Photo/audio submission review queue — pure logic (wave-e, task 13).
//
// Where the data comes from: `submitStationPhoto` writes the submission as a MAP
// FIELD on the TEAM doc — `teams/{teamId}.taskSubmissions[taskId] = { photoUrl,
// submittedAt, status, mediaKind }` (functions/src/index.ts). There is no
// submissions collection, so a live review queue is built by listening to the
// run's `teams` collection and FLATTENING every team's map client side. This
// module is that flattening, plus the status transition table the review UIs
// must agree on.
//
// It lives in @rushpoint/shared (not in one app) because there are TWO review
// consoles — the play-web StaffConsole and the creator RunConsole — and two
// approval UIs that disagree about ordering, keying or which actions are legal
// is a support nightmare. Sharing the PURE part (and only the pure part) is what
// stops them drifting; the markup and the dictionaries stay per app.
//
// No React, no Firestore, no I/O — unit tested by scripts/test-photo-approval-queue.ts.
import type { MediaKind } from './mediaKinds';

/** The lifecycle of one team×task submission, exactly as the server writes it. */
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

/** What a reviewer can do to a row. */
export type ReviewAction = 'approve' | 'reject';

/** The raw map value stored under `taskSubmissions[taskId]`. All fields optional:
 *  older docs predate `mediaKind`, and a doc mid write can be missing anything. */
export interface RawSubmission {
  photoUrl?: string;
  submittedAt?: string;
  status?: string;
  mediaKind?: MediaKind;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

/** The shape a team doc needs to have for the queue (a structural subset of Team). */
export interface SubmissionTeamDoc {
  id: string;
  displayName?: string;
  taskSubmissions?: Record<string, RawSubmission> | null;
}

/** One flattened, render ready queue row. */
export interface SubmissionRow {
  teamId: string;
  displayName: string;
  taskId: string;
  photoUrl: string;
  /** ISO string, or '' when the server never wrote one (legacy/partial doc). */
  submittedAt: string;
  mediaKind: MediaKind;
  status: SubmissionStatus;
  reviewedAt: string;
  reviewNote: string;
}

/** The stable identity of a row. MUST match the key the consoles already use for
 *  their per row in flight guard (`useAsyncAction` keyOf) — see StaffConsole. */
export function submissionKey(row: { teamId: string; taskId: string }): string {
  return `${row.teamId}:${row.taskId}`;
}

/** Normalize an arbitrary stored status. Anything unrecognised (including
 *  undefined) is treated as 'pending': a submission the server wrote but whose
 *  status we cannot read is still work waiting for a human, and silently hiding
 *  it would block the team forever. */
export function normalizeStatus(status: string | undefined | null): SubmissionStatus {
  return status === 'approved' || status === 'rejected' ? status : 'pending';
}

/**
 * The transition table both consoles obey.
 *
 * pending  + approve  → approved   (scores the task via completeTaskForTeam)
 * pending  + reject   → rejected   (no score; the team may resubmit)
 * rejected + approve  → approved   (scores: completeTaskForTeam never ran)
 * rejected + reject   → rejected   (no op)
 * approved + approve  → approved   (NO OP — the server returns completed:false,
 *                                   so no second score, no duplicate feed item)
 * approved + reject   → approved   (REFUSED, see canReject: the server has no
 *                                   score clawback path, so "rejecting" an
 *                                   approved task would flip a status string
 *                                   while the points silently stay. Use the
 *                                   manual adjustTeamScore instead.)
 *
 * Idempotence is a property of this table: applying the same action twice equals
 * applying it once, for every starting status.
 */
export function nextStatus(current: SubmissionStatus, action: ReviewAction): SubmissionStatus {
  if (action === 'approve') return 'approved';
  return current === 'approved' ? 'approved' : 'rejected';
}

/** Whether a reviewer may still reject this row. False once approved — the UI
 *  must DISABLE the button and say why rather than no op silently. */
export function canReject(status: SubmissionStatus): boolean {
  return status !== 'approved';
}

/** Whether a reviewer may still approve this row (an approve is a harmless no op
 *  on an already approved row, but the button is pointless, so hide the work). */
export function canApprove(status: SubmissionStatus): boolean {
  return status !== 'approved';
}

/** True for rows that still need a human. */
export function isPending(row: SubmissionRow): boolean {
  return row.status === 'pending';
}

// ── Flattening ───────────────────────────────────────────────────────────────

function toRow(team: SubmissionTeamDoc, taskId: string, sub: RawSubmission): SubmissionRow {
  return {
    teamId: team.id,
    // Fall back to the doc id so a team that joined without a name is still
    // identifiable and the row never renders "undefined".
    displayName: team.displayName?.trim() ? team.displayName : team.id,
    taskId,
    photoUrl: typeof sub.photoUrl === 'string' ? sub.photoUrl : '',
    submittedAt: typeof sub.submittedAt === 'string' ? sub.submittedAt : '',
    // Server derived. Absent ⇒ photo (every submission that predates audio).
    // Every non-photo kind must be listed explicitly: collapsing an unknown kind
    // to 'photo' is what sent a VIDEO submission to the reviewer's <img> tag,
    // where it rendered as nothing but its link (change: video-submission-task).
    mediaKind: sub.mediaKind === 'audio' ? 'audio' : sub.mediaKind === 'video' ? 'video' : 'photo',
    status: normalizeStatus(sub.status),
    reviewedAt: typeof sub.reviewedAt === 'string' ? sub.reviewedAt : '',
    reviewNote: typeof sub.reviewNote === 'string' ? sub.reviewNote : '',
  };
}

/** Every submission across every team, unfiltered and unsorted. */
export function flattenSubmissions(teams: readonly SubmissionTeamDoc[]): SubmissionRow[] {
  const rows: SubmissionRow[] = [];
  for (const team of teams) {
    if (!team || typeof team.id !== 'string' || !team.id) continue;
    const subs = team.taskSubmissions;
    if (!subs || typeof subs !== 'object') continue;
    for (const [taskId, sub] of Object.entries(subs)) {
      if (!taskId || !sub || typeof sub !== 'object') continue;
      rows.push(toRow(team, taskId, sub));
    }
  }
  return rows;
}

/** Oldest first (FIFO): the team that has been blocked longest gets unblocked
 *  first. A missing timestamp sorts LAST (it cannot claim priority it did not
 *  earn) and ties break on the row key so the order is total and stable — an
 *  unstable comparator would make rows jump between snapshots mid tap. */
function byOldestFirst(a: SubmissionRow, b: SubmissionRow): number {
  if (a.submittedAt !== b.submittedAt) {
    if (!a.submittedAt) return 1;
    if (!b.submittedAt) return -1;
    return a.submittedAt < b.submittedAt ? -1 : 1;
  }
  return submissionKey(a) < submissionKey(b) ? -1 : submissionKey(a) > submissionKey(b) ? 1 : 0;
}

/** Most recently reviewed first, for the "recently reviewed" strip. Falls back
 *  to submittedAt when the server never wrote a reviewedAt (autoApprove writes
 *  status:'approved' with NO reviewedAt — it was never human reviewed). */
function byNewestReviewFirst(a: SubmissionRow, b: SubmissionRow): number {
  const ka = a.reviewedAt || a.submittedAt;
  const kb = b.reviewedAt || b.submittedAt;
  if (ka !== kb) {
    if (!ka) return 1;
    if (!kb) return -1;
    return ka > kb ? -1 : 1;
  }
  return submissionKey(a) < submissionKey(b) ? -1 : submissionKey(a) > submissionKey(b) ? 1 : 0;
}

/** How many reviewed rows the confirmation strip keeps. */
export const DEFAULT_REVIEWED_LIMIT = 8;

/** The actionable queue: pending rows only, FIFO. */
export function buildPendingQueue(teams: readonly SubmissionTeamDoc[]): SubmissionRow[] {
  return flattenSubmissions(teams).filter(isPending).sort(byOldestFirst);
}

/** The confirmation strip: already reviewed rows, newest first, capped. Lets a
 *  creator see what they just did without building a full audit view. */
export function buildReviewedQueue(
  teams: readonly SubmissionTeamDoc[],
  limit = DEFAULT_REVIEWED_LIMIT,
): SubmissionRow[] {
  const rows = flattenSubmissions(teams).filter((r) => r.status !== 'pending').sort(byNewestReviewFirst);
  return limit >= 0 ? rows.slice(0, limit) : rows;
}

/** One pass over the teams for both lists (the consoles render both from a
 *  single snapshot, so do not flatten twice). */
export function buildSubmissionQueues(
  teams: readonly SubmissionTeamDoc[],
  reviewedLimit = DEFAULT_REVIEWED_LIMIT,
): { pending: SubmissionRow[]; reviewed: SubmissionRow[]; pendingCount: number } {
  const all = flattenSubmissions(teams);
  const pending = all.filter(isPending).sort(byOldestFirst);
  const reviewed = all.filter((r) => r.status !== 'pending').sort(byNewestReviewFirst);
  return {
    pending,
    reviewed: reviewedLimit >= 0 ? reviewed.slice(0, reviewedLimit) : reviewed,
    pendingCount: pending.length,
  };
}

/** Renderable media: the URL must look like a real http(s) URL before it is fed
 *  to <img>/<audio>/<video>. Anything else falls back to plain text in the UI. */
export function isRenderableMedia(photoUrl: string): boolean {
  return /^https?:\/\//.test(photoUrl);
}
