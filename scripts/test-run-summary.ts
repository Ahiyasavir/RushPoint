// Pure-logic tests for run-summary-report (composeRunSummary + formatRunSummaryEmail).
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator: the composer folds
// synthetic recap/analytics/feedback objects, and the formatter is checked for a
// non-empty, finite-safe email body.
import {
  composeRunSummary,
  formatRunSummaryEmail,
  type RunRecap,
  type RunAnalytics,
  type RunFeedbackSummary,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── Synthetic aggregator outputs ─────────────────────────────────────────────
const recap: RunRecap = {
  standings: [
    { rank: 1, teamId: 'A', teamName: 'Alpha', score: 100, totalSeconds: 600 },
    { rank: 2, teamId: 'B', teamName: 'Bravo', score: 80, totalSeconds: 720 },
  ],
  photos: [],
  stats: { teamCount: 2, photoCount: 3, winnerName: 'Alpha' },
};
const analytics: RunAnalytics = {
  teamCount: 2,
  overallCompletionRate: 0.75,
  tasks: [
    { taskId: 't1', type: 'field', attempts: 2, completions: 2, skips: 0, completionRate: 1, medianMs: 1000, p90Ms: 1200, hintCount: 0 },
    { taskId: 't2', type: 'quiz', attempts: 2, completions: 1, skips: 1, completionRate: 0.5, medianMs: 2000, p90Ms: 2400, hintCount: 1 },
  ],
};
const feedback: RunFeedbackSummary = {
  responseCount: 3,
  participantCount: 4,
  responseRate: 0.75,
  ratings: {},
  recommendScore: 0.66,
  issueCounts: { too_hard: 4, confusing: 2, too_long: 1, buggy: 3 },
  commentCount: 2,
};

const comments = [
  { teamName: 'Alpha', text: 'Loved the hunt! <script>alert(1)</script> would play again & again.' },
  { teamName: 'Bravo', text: 'Too hard near the fountain "hint".' },
  { teamName: 'Charlie', text: 'C1' }, { teamName: 'Delta', text: 'C2' },
  { teamName: 'Echo', text: 'C3' }, { teamName: 'Foxtrot', text: 'dropped (past cap of 5)' },
];

const summary = composeRunSummary({
  title: 'Old City Hunt', runStatus: 'finished', finishedAt: '2026-07-11T20:00:00.000Z',
  recap, analytics, feedback, comments,
});

// (1) Standings pass through in input order with score + totalSeconds intact.
ok(summary.standings.length === 2, 'standings length preserved');
ok(summary.standings[0].teamId === 'A' && summary.standings[1].teamId === 'B', 'standings order preserved');
ok(summary.standings[0].score === 100 && summary.standings[0].totalSeconds === 600, 'score + totalSeconds intact');

// (2) Completion reuses analytics/recap fields verbatim.
ok(summary.completion.overallCompletionRate === 0.75, 'overallCompletionRate reused verbatim');
ok(summary.completion.tasksTracked === 2, 'tasksTracked === analytics.tasks.length');
ok(summary.completion.teamCount === 2 && summary.completion.photoCount === 3 && summary.completion.winnerName === 'Alpha',
  'completion reuses recap.stats verbatim');

// (3) topIssues sorted descending, capped at 3.
ok(summary.feedback.topIssues.length === 3, 'topIssues capped at 3 (4 issues in)');
ok(summary.feedback.topIssues[0].issue === 'too_hard' && summary.feedback.topIssues[0].count === 4, 'top issue is the highest count');
ok(summary.feedback.topIssues[1].issue === 'buggy' && summary.feedback.topIssues[2].issue === 'confusing',
  'topIssues in descending count order');
ok(!summary.feedback.topIssues.some((i) => i.issue === 'too_long'), 'lowest issue dropped past cap');

// (4) Empty feedback → zeroed digest, no NaN.
const emptyFb: RunFeedbackSummary = {
  responseCount: 0, participantCount: 0, responseRate: 0, ratings: {},
  recommendScore: 0, issueCounts: {}, commentCount: 0,
};
const emptySummary = composeRunSummary({ title: 'Empty', runStatus: 'finished', recap, analytics, feedback: emptyFb });
ok(emptySummary.feedback.responseCount === 0 && emptySummary.feedback.responseRate === 0, 'empty feedback → zeros');
ok(emptySummary.feedback.topIssues.length === 0, 'empty feedback → no topIssues');
ok(!/NaN/.test(JSON.stringify(emptySummary)), 'no NaN anywhere in empty summary');
ok(!/Infinity/.test(JSON.stringify(emptySummary)), 'no Infinity anywhere in empty summary');

// (5) JSON.stringify does not throw.
let stringified = '';
let threw = false;
try { stringified = JSON.stringify(summary); } catch { threw = true; }
ok(!threw && stringified.length > 0, 'composeRunSummary result JSON.stringifies');

// (6) comments: capped at 5, in input order, past-cap entry dropped.
ok(summary.feedback.comments.length === 5, 'comments capped at 5 (6 fed in)');
ok(summary.feedback.comments[0].teamName === 'Alpha', 'comments preserve input order');
ok(!summary.feedback.comments.some((c) => c.text.includes('dropped (past cap')), 'the 6th comment is dropped');
// no comments fed in → empty array, never undefined/throws.
const noCommentsSummary = composeRunSummary({ title: 'NoComments', runStatus: 'finished', recap, analytics, feedback });
ok(Array.isArray(noCommentsSummary.feedback.comments) && noCommentsSummary.feedback.comments.length === 0,
  'comments defaults to [] when none supplied');

// ── formatRunSummaryEmail ────────────────────────────────────────────────────
const email = formatRunSummaryEmail(summary);
ok(email.subject.length > 0, 'email subject non-empty');
ok(email.text.length > 0, 'email text non-empty');
ok(email.text.includes('Alpha') && email.text.includes('Bravo'), 'email includes standings team names');
ok(email.text.includes('Alpha'), 'email includes the winner');
ok(/Would recommend/.test(email.text), 'email includes feedback digest');
ok(email.text.includes('too_hard'), 'email includes top issue');
ok(!/NaN/.test(email.subject) && !/NaN/.test(email.text), 'email never contains NaN');
ok(!/Infinity/.test(email.subject) && !/Infinity/.test(email.text), 'email never contains Infinity');

// (7) HTML email: designed, includes the new details, and safely escapes user content.
ok(typeof email.html === 'string' && email.html.length > 0, 'email.html is a non-empty string');
ok(email.html.includes('<table') || email.html.includes('<div'), 'html has real markup, not plain text dumped in');
ok(email.html.includes('Alpha') && email.html.includes('Bravo'), 'html includes standings team names');
ok(email.html.includes('too_hard'), 'html includes top issues');
// XSS guard: a raw <script> from a player comment must never appear unescaped in the HTML.
ok(!email.html.includes('<script>alert(1)</script>'), 'a raw <script> tag in a comment is escaped, not injected');
ok(email.html.includes('&lt;script&gt;'), 'the escaped form of the malicious comment is present (content preserved, just safe)');
// A comment with an unescaped double-quote must not break out of an HTML attribute.
ok(!email.html.includes('fountain "hint"'), 'a raw double-quote in a comment is escaped');
ok(!/NaN|Infinity/.test(email.html), 'html never contains NaN/Infinity');

// Finite-safety: feed non-finite / negative numbers and confirm the email + summary stay clean.
const nastyRecap: RunRecap = {
  standings: [{ rank: 1, teamId: 'X', teamName: 'X', score: NaN, totalSeconds: Infinity }],
  photos: [],
  stats: { teamCount: NaN, photoCount: -Infinity, winnerName: 'X' },
};
const nastyAnalytics: RunAnalytics = { teamCount: 1, overallCompletionRate: NaN, tasks: [] };
const nastySummary = composeRunSummary({ title: 'Nasty', runStatus: 'finished', recap: nastyRecap, analytics: nastyAnalytics, feedback: emptyFb });
const nastyEmail = formatRunSummaryEmail(nastySummary);
ok(!/NaN/.test(JSON.stringify(nastySummary)) && !/Infinity/.test(JSON.stringify(nastySummary)), 'non-finite inputs sanitized in summary');
ok(!/NaN/.test(nastyEmail.text) && !/Infinity/.test(nastyEmail.text), 'non-finite inputs never reach the email');

console.log(failed === 0
  ? `\n✅ ALL RUN-SUMMARY TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
