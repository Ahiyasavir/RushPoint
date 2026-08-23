// Run Console media gallery (change: run-media-gallery-and-video-feed).
//
// The photo review queue (photoQueue.ts / PhotoReviewConsole) is a REVIEW-OUTCOME
// view: pending rows needing a decision, plus a capped "recently reviewed" strip.
// Neither is "every photo/video this run has" — an autoApproved submission never
// enters `pending`, and `reviewed` is capped and text-only. This module builds
// that missing third view: everything renderable, any status, sorted so the
// newest submission leads.
//
// Deliberately thin: `flattenSubmissions`/`isRenderableMedia` already do the real
// work (shared with the review queue so the two views can never disagree about
// what counts as "this team's media"); this file only adds the "show all
// statuses, newest first" policy the gallery needs.
import { flattenSubmissions, isRenderableMedia, submissionKey, type SubmissionRow, type SubmissionTeamDoc } from '@rushpoint/shared';

/** Newest submission first. A missing timestamp sorts LAST — it cannot claim
 *  priority it did not earn — and ties break on the row key so the order is
 *  total and stable across re-renders of the same snapshot. */
function byNewestSubmittedFirst(a: SubmissionRow, b: SubmissionRow): number {
  if (a.submittedAt !== b.submittedAt) {
    if (!a.submittedAt) return 1;
    if (!b.submittedAt) return -1;
    return a.submittedAt > b.submittedAt ? -1 : 1;
  }
  return submissionKey(a) < submissionKey(b) ? -1 : submissionKey(a) > submissionKey(b) ? 1 : 0;
}

/**
 * Every task submission across every team that has a renderable photo/video/audio
 * URL, regardless of review status — newest submitted first. Total: never throws
 * on malformed input (`flattenSubmissions` is already total).
 */
export function buildRunMediaGallery(teams: readonly SubmissionTeamDoc[]): SubmissionRow[] {
  if (!Array.isArray(teams)) return [];
  return flattenSubmissions(teams)
    .filter((row) => isRenderableMedia(row.photoUrl))
    .sort(byNewestSubmittedFirst);
}
