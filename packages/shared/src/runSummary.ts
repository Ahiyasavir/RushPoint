// Run summary report (change: run-summary-report). Pure aggregation that folds the
// outputs of the three existing post-run aggregators (buildRunRecap,
// computeRunAnalytics, computeFeedbackSummary) into ONE organizer-facing summary,
// plus a deterministic plain-text email formatter. It recomputes nothing:
// standings/scores/timing/completion/feedback are passed through verbatim, only
// reshaped and digested. No Firestore, no DOM, no non-finite numbers.
import type { RunRecap } from './runRecap';
import type { RunAnalytics } from './runAnalytics';
import type { RunFeedbackSummary } from './types';

export interface RunSummaryStanding {
  rank: number;
  teamId: string;
  teamName: string;
  score: number;
  totalSeconds?: number;
}

export interface RunSummaryCompletion {
  teamCount: number;              // recap.stats.teamCount
  photoCount: number;             // recap.stats.photoCount
  tasksTracked: number;           // analytics.tasks.length
  overallCompletionRate: number;  // analytics.overallCompletionRate (0..1, never NaN)
  winnerName?: string;            // recap.stats.winnerName
}

export interface RunSummaryFeedbackDigest {
  responseCount: number;
  participantCount: number;
  responseRate: number;           // 0..1
  recommendScore: number;         // 0..1
  commentCount: number;
  topIssues: { issue: string; count: number }[]; // desc by count, max 3
}

export interface RunSummary {
  title: string;
  runStatus: string;
  finishedAt?: string;
  isTestDrive: boolean;
  standings: RunSummaryStanding[];
  completion: RunSummaryCompletion;
  feedback: RunSummaryFeedbackDigest;
}

export interface ComposeRunSummaryInput {
  title: string;
  runStatus: string;
  finishedAt?: string;
  isTestDrive?: boolean;
  recap: RunRecap;
  analytics: RunAnalytics;
  feedback: RunFeedbackSummary;
}

/** Coerce any non-finite number (NaN/±Infinity) to 0 so a summary is always safe. */
function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fold the three post-run aggregator results into a single RunSummary. Pure:
 * standings pass through in input order, completion reuses the analytics/recap
 * fields verbatim, feedback issues are digested into the top 3 by count. All
 * numbers are finite-guarded (an upstream ÷0 can never leak a NaN).
 */
export function composeRunSummary(input: ComposeRunSummaryInput): RunSummary {
  const { recap, analytics, feedback } = input;
  const topIssues = Object.entries(feedback.issueCounts ?? {})
    .map(([issue, count]) => ({ issue, count: finite(Number(count)) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return {
    title: input.title,
    runStatus: input.runStatus,
    finishedAt: input.finishedAt,
    isTestDrive: input.isTestDrive ?? false,
    standings: recap.standings.map((s) => ({
      rank: s.rank,
      teamId: s.teamId,
      teamName: s.teamName,
      score: finite(s.score),
      totalSeconds: s.totalSeconds != null ? finite(s.totalSeconds) : undefined,
    })),
    completion: {
      teamCount: finite(recap.stats.teamCount),
      photoCount: finite(recap.stats.photoCount),
      tasksTracked: analytics.tasks.length,
      overallCompletionRate: finite(analytics.overallCompletionRate),
      winnerName: recap.stats.winnerName,
    },
    feedback: {
      responseCount: finite(feedback.responseCount),
      participantCount: finite(feedback.participantCount),
      responseRate: finite(feedback.responseRate),
      recommendScore: finite(feedback.recommendScore),
      commentCount: finite(feedback.commentCount),
      topIssues,
    },
  };
}

/** Whole-percent from a 0..1 rate (finite-guarded). */
function pct(rate: number): number {
  return Math.round(finite(rate) * 100);
}

/** Format m:ss from a seconds count (finite-guarded, never negative). */
function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(finite(totalSeconds)));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/**
 * Compose a deterministic, finite-safe plain-text summary email for the organizer:
 * subject line + a body covering final standings, completion stats, and the
 * feedback digest (response rate, recommend %, top issues, comment count). Pure —
 * no dates-of-send or randomness — so the same summary always yields the same text.
 */
export function formatRunSummaryEmail(summary: RunSummary): { subject: string; text: string } {
  const subject = `RushPoint: ${summary.title} run summary`;

  const lines: string[] = [];
  lines.push(subject);
  lines.push('');

  // Standings.
  lines.push('Final standings');
  if (summary.standings.length === 0) {
    lines.push('  (no teams)');
  } else {
    for (const s of summary.standings) {
      const time = s.totalSeconds != null ? ` (${mmss(s.totalSeconds)})` : '';
      lines.push(`  ${finite(s.rank)}. ${s.teamName}: ${finite(s.score)} pts${time}`);
    }
  }
  lines.push('');

  // Completion stats.
  const c = summary.completion;
  lines.push('Completion');
  if (c.winnerName) lines.push(`  Winner: ${c.winnerName}`);
  lines.push(`  Teams: ${finite(c.teamCount)}`);
  lines.push(`  Overall completion: ${pct(c.overallCompletionRate)}%`);
  lines.push(`  Tasks tracked: ${finite(c.tasksTracked)}`);
  lines.push(`  Photos: ${finite(c.photoCount)}`);
  lines.push('');

  // Feedback digest.
  const f = summary.feedback;
  lines.push('Player feedback');
  lines.push(`  Responses: ${finite(f.responseCount)} of ${finite(f.participantCount)} (${pct(f.responseRate)}%)`);
  lines.push(`  Would recommend: ${pct(f.recommendScore)}%`);
  lines.push(`  Comments: ${finite(f.commentCount)}`);
  if (f.topIssues.length > 0) {
    lines.push('  Top issues:');
    for (const it of f.topIssues) {
      lines.push(`    - ${it.issue}: ${finite(it.count)}`);
    }
  }

  return { subject, text: lines.join('\n') };
}
