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

export interface RunSummaryComment {
  teamName: string;
  text: string;
}

export interface RunSummaryFeedbackDigest {
  responseCount: number;
  participantCount: number;
  responseRate: number;           // 0..1
  recommendScore: number;         // 0..1
  commentCount: number;
  topIssues: { issue: string; count: number }[]; // desc by count, max 3
  comments: RunSummaryComment[];  // raw player comments, max 5, input order
}

/**
 * Who built and ran the game (change: run-email-scope-and-digest). Both fields are
 * optional and independently so: a creator may never have set a display name, and
 * a legacy `users/{uid}` doc may carry neither. The formatter renders whatever is
 * present and omits the block entirely when nothing is — a header with no value is
 * worse than no header.
 *
 * There is deliberately no participant equivalent. Players authenticate
 * anonymously and `FieldType` has no `email` variant, so a participant address
 * does not exist to report; player identity travels as `standings[].teamName`.
 */
export interface RunSummaryOrganizer {
  displayName?: string;
  email?: string;
}

export interface RunSummary {
  title: string;
  runStatus: string;
  finishedAt?: string;
  isTestDrive: boolean;
  organizer?: RunSummaryOrganizer;
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
  // Raw player comments (not part of the digest aggregator — passed separately
  // since computeFeedbackSummary only counts them). Capped to 5, input order.
  comments?: RunSummaryComment[];
}

const MAX_SUMMARY_COMMENTS = 5;

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
      comments: (input.comments ?? []).slice(0, MAX_SUMMARY_COMMENTS),
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

// Team names, comments, and titles are creator/player-authored text — escape
// before embedding in HTML so a comment like `<script>` or `"onmouseover=` can
// never inject markup/attributes into the organizer's inbox.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RANK_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ACCENT = '#F97316'; // RushPoint brand orange (matches the app's default accent)

/**
 * Compose a deterministic, finite-safe run-summary email for the organizer: a
 * subject line, a plain-text fallback body, and a designed HTML version — all
 * covering final standings, completion stats, and the feedback digest (response
 * rate, recommend %, top issues, a few player comments). Pure — no dates-of-send
 * or randomness — so the same summary always yields the same output. All
 * user-authored text (team names, comments) is HTML-escaped before embedding.
 */
export function formatRunSummaryEmail(summary: RunSummary): { subject: string; text: string; html: string } {
  const subject = `RushPoint: ${summary.title} run summary`;
  const c = summary.completion;
  const f = summary.feedback;

  // Who ran it. Built once and reused by both renderings so the two can't drift.
  // Every branch yields a non-empty string or null — never "undefined", never an
  // empty "Name <>" — so an absent/partial profile degrades instead of leaking a
  // placeholder into the organizer's inbox.
  const org = summary.organizer;
  const orgName = org?.displayName?.trim() || '';
  const orgEmail = org?.email?.trim() || '';
  const orgLine = orgName && orgEmail ? `${orgName} <${orgEmail}>` : (orgName || orgEmail || null);

  // ── Plain-text fallback (unchanged shape, now with a Comments section) ──────
  const lines: string[] = [subject, ''];

  if (orgLine) {
    lines.push(`Created by: ${orgLine}`);
    lines.push('');
  }

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

  lines.push('Completion');
  if (c.winnerName) lines.push(`  Winner: ${c.winnerName}`);
  lines.push(`  Teams: ${finite(c.teamCount)}`);
  lines.push(`  Overall completion: ${pct(c.overallCompletionRate)}%`);
  lines.push(`  Tasks tracked: ${finite(c.tasksTracked)}`);
  lines.push(`  Photos: ${finite(c.photoCount)}`);
  lines.push('');

  lines.push('Player feedback');
  lines.push(`  Responses: ${finite(f.responseCount)} of ${finite(f.participantCount)} (${pct(f.responseRate)}%)`);
  lines.push(`  Would recommend: ${pct(f.recommendScore)}%`);
  lines.push(`  Comments: ${finite(f.commentCount)}`);
  if (f.topIssues.length > 0) {
    lines.push('  Top issues:');
    for (const it of f.topIssues) lines.push(`    - ${it.issue}: ${finite(it.count)}`);
  }
  if (f.comments.length > 0) {
    lines.push('');
    lines.push('  What players said:');
    for (const cm of f.comments) lines.push(`    "${cm.text}" — ${cm.teamName}`);
  }

  const text = lines.join('\n');

  // ── HTML (inline-styled for broad email-client compatibility) ───────────────
  const statTile = (label: string, value: string) => `
    <td style="padding:14px 10px;text-align:center;background:#1a2130;border-radius:12px;">
      <div style="font-size:20px;font-weight:700;color:#f3f4f6;">${esc(value)}</div>
      <div style="font-size:11px;color:#9aa4b2;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">${esc(label)}</div>
    </td>`;

  const standingsRows = summary.standings.length === 0
    ? `<tr><td style="padding:14px;color:#9aa4b2;">No teams played this run.</td></tr>`
    : summary.standings.map((s) => {
        const rankLabel = RANK_MEDAL[s.rank] ?? `#${finite(s.rank)}`;
        const time = s.totalSeconds != null ? `<span style="color:#9aa4b2;font-size:12px;"> · ${esc(mmss(s.totalSeconds))}</span>` : '';
        return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #232c3d;font-size:15px;width:36px;">${rankLabel}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #232c3d;font-size:15px;color:#f3f4f6;">${esc(s.teamName)}${time}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #232c3d;font-size:15px;color:${ACCENT};font-weight:700;text-align:right;">${finite(s.score)} pts</td>
    </tr>`;
      }).join('');

  const issueChips = f.topIssues.length === 0 ? '' : `
    <div style="margin-top:10px;">
      ${f.topIssues.map((it) => `<span style="display:inline-block;background:#2a1810;color:#fca27a;border:1px solid #4a2a1a;border-radius:999px;padding:4px 12px;font-size:12px;margin:0 6px 6px 0;">${esc(it.issue)} · ${finite(it.count)}</span>`).join('')}
    </div>`;

  const commentBlocks = f.comments.length === 0 ? '' : `
    <div style="margin-top:16px;">
      ${f.comments.map((cm) => `
      <div style="background:#1a2130;border-inline-start:3px solid ${ACCENT};border-radius:8px;padding:10px 14px;margin-bottom:8px;">
        <div style="color:#e5e7eb;font-size:14px;font-style:italic;">"${esc(cm.text)}"</div>
        <div style="color:#9aa4b2;font-size:12px;margin-top:4px;">— ${esc(cm.teamName)}</div>
      </div>`).join('')}
    </div>`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0b0f17;padding:24px 12px;">
  <div style="max-width:600px;margin:0 auto;background:#141a24;border-radius:16px;overflow:hidden;border:1px solid #232c3d;">
    <div style="background:${ACCENT};padding:24px 28px;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fff7ed;opacity:.85;">RushPoint · Run Summary</div>
      <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px;">${esc(summary.title)}</div>
      ${c.winnerName ? `<div style="font-size:13px;color:#fff7ed;margin-top:6px;">🏆 Winner: ${esc(c.winnerName)}</div>` : ''}
      ${orgLine ? `<div style="font-size:13px;color:#fff7ed;margin-top:6px;">Created by: ${esc(orgLine)}</div>` : ''}
    </div>

    <div style="padding:24px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:20px;">
        <tr>
          ${statTile('Teams', String(finite(c.teamCount)))}
          ${statTile('Completion', `${pct(c.overallCompletionRate)}%`)}
          ${statTile('Tasks', String(finite(c.tasksTracked)))}
          ${statTile('Photos', String(finite(c.photoCount)))}
        </tr>
      </table>

      <div style="font-size:13px;font-weight:700;color:#9aa4b2;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Final Standings</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        ${standingsRows}
      </table>

      <div style="font-size:13px;font-weight:700;color:#9aa4b2;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Player Feedback</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;color:#e5e7eb;font-size:14px;">Responses</td>
          <td style="padding:6px 0;color:#f3f4f6;font-size:14px;text-align:right;font-weight:600;">${finite(f.responseCount)} / ${finite(f.participantCount)} (${pct(f.responseRate)}%)</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#e5e7eb;font-size:14px;">Would recommend</td>
          <td style="padding:6px 0;color:#f3f4f6;font-size:14px;text-align:right;font-weight:600;">${pct(f.recommendScore)}%</td>
        </tr>
      </table>
      ${issueChips}
      ${commentBlocks}
    </div>

    <div style="padding:16px 28px;background:#0f141d;color:#6b7280;font-size:12px;text-align:center;">
      Sent automatically by RushPoint when this run finished.
    </div>
  </div>
</div>`.trim();

  return { subject, text, html };
}
