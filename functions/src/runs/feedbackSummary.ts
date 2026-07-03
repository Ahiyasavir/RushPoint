import * as functions from 'firebase-functions';
import {
  FEEDBACK_RATINGS, FEEDBACK_RATING_KEYS, FEEDBACK_ISSUES, FEEDBACK_COMMENT_MAX,
  type FeedbackRatingKey, type FeedbackIssue, type RunFeedback, type RunFeedbackSummary,
} from '@rushpoint/shared';

// ─── Post-game feedback (change: post-game-feedback) ──────────────────────────
// Pure validation + aggregation. No Firestore: the callable is a thin shell over
// these so the whole shape is unit-tested (vitest lane) with no emulator.

function bad(msg: string): never {
  throw new functions.https.HttpsError('invalid-argument', msg);
}

export interface ValidatedFeedback {
  ratings: Partial<Record<FeedbackRatingKey, number>>;
  issues: FeedbackIssue[];
  comment?: string;
  lang: string;
}

/** Validate a raw client payload; returns the normalized, storable subset. */
export function validateFeedbackPayload(raw: unknown): ValidatedFeedback {
  const data = (raw ?? {}) as Record<string, unknown>;

  const rawRatings = (data.ratings ?? {}) as Record<string, unknown>;
  if (typeof rawRatings !== 'object' || Array.isArray(rawRatings)) bad('ratings must be an object');
  const ratings: Partial<Record<FeedbackRatingKey, number>> = {};
  for (const [key, value] of Object.entries(rawRatings)) {
    if (!(FEEDBACK_RATING_KEYS as string[]).includes(key)) bad(`unknown rating key: ${key}`);
    const { min, max } = FEEDBACK_RATINGS[key as FeedbackRatingKey];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      bad(`rating ${key} out of range`);
    }
    ratings[key as FeedbackRatingKey] = value as number;
  }

  const rawIssues = data.issues ?? [];
  if (!Array.isArray(rawIssues)) bad('issues must be an array');
  const issues: FeedbackIssue[] = [];
  for (const issue of rawIssues) {
    if (!(FEEDBACK_ISSUES as readonly string[]).includes(issue as string)) bad(`unknown issue: ${issue}`);
    if (!issues.includes(issue as FeedbackIssue)) issues.push(issue as FeedbackIssue);
  }

  let comment: string | undefined;
  if (data.comment != null) {
    if (typeof data.comment !== 'string') bad('comment must be a string');
    if (data.comment.length > FEEDBACK_COMMENT_MAX) bad('comment too long');
    const trimmed = data.comment.trim();
    comment = trimmed.length > 0 ? trimmed : undefined;
  }

  // Reject a wholly empty submission — nothing to store.
  if (Object.keys(ratings).length === 0 && issues.length === 0 && !comment) {
    bad('empty feedback');
  }

  const lang = data.lang === 'en' ? 'en' : 'he';
  return { ratings, issues, comment, lang };
}

/** Roll individual responses up into the creator's summary. Never returns NaN. */
export function computeFeedbackSummary(
  responses: RunFeedback[],
  participantCount: number,
): RunFeedbackSummary {
  const responseCount = responses.length;
  const responseRate = participantCount > 0
    ? Math.min(1, responseCount / participantCount)
    : 0;

  const ratings: RunFeedbackSummary['ratings'] = {};
  for (const key of FEEDBACK_RATING_KEYS) {
    const { min, max } = FEEDBACK_RATINGS[key];
    const distribution = new Array(max - min + 1).fill(0);
    let sum = 0;
    let count = 0;
    for (const r of responses) {
      const v = r.ratings?.[key];
      if (typeof v === 'number' && v >= min && v <= max) {
        sum += v;
        count += 1;
        distribution[v - min] += 1;
      }
    }
    if (count > 0) ratings[key] = { avg: sum / count, count, distribution };
  }

  // Promoter share among those who answered "recommend" (guarded against ÷0).
  let recAnswered = 0;
  let recPromoters = 0;
  for (const r of responses) {
    const v = r.ratings?.recommend;
    if (typeof v === 'number') {
      recAnswered += 1;
      if (v >= 4) recPromoters += 1;
    }
  }
  const recommendScore = recAnswered > 0 ? recPromoters / recAnswered : 0;

  const issueCounts: RunFeedbackSummary['issueCounts'] = {};
  let commentCount = 0;
  for (const r of responses) {
    for (const issue of r.issues ?? []) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    }
    if (r.comment && r.comment.trim().length > 0) commentCount += 1;
  }

  return {
    responseCount,
    participantCount,
    responseRate,
    ratings,
    recommendScore,
    issueCounts,
    commentCount,
  };
}
