// Pure-logic test for email attribution (change: run-email-scope-and-digest).
//
//   npx tsx scripts/test-run-summary-attribution.ts
//
// The organizer asked to see WHO did the interaction on every email. Half of that
// is real data and half of it does not exist, and this file pins both halves:
//
//  - THE CREATOR is fully identifiable. `users/{ownerUid}` carries `displayName`
//    and `email`, and the finalize path already reads that doc to resolve the
//    recipient — so attribution costs no extra read.
//  - THE PLAYER has a display name and NO email address, structurally: play-web
//    uses anonymous auth (`RunTeam.id` is an anonymous uid) and `FieldType` has
//    no `email` variant, so a game cannot even collect one. The tests below
//    therefore assert an email field is NEVER emitted for a participant. A line
//    reading "email: unknown" would imply a gap that is really an absence.
//
// The degradation cases matter more than the happy path: a creator may have set
// no display name, and a legacy `users` doc may lack either field. Rendering the
// literal "undefined" into an email is the classic version of this bug.
import { formatRunSummaryEmail, type RunSummary } from '../packages/shared/src/runSummary';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const base: RunSummary = {
  title: 'Old City Hunt',
  runStatus: 'finished',
  finishedAt: '2026-07-29T18:00:00.000Z',
  isTestDrive: false,
  standings: [
    { rank: 1, teamId: 't1', teamName: 'Team Aleph', score: 120, totalSeconds: 1800 },
  ],
  completion: {
    teamCount: 1, photoCount: 2, tasksTracked: 5,
    overallCompletionRate: 0.8, winnerName: 'Team Aleph',
  },
  feedback: {
    responseCount: 1, participantCount: 1, responseRate: 1, recommendScore: 1,
    commentCount: 0, topIssues: [], comments: [],
  },
};

const withOrg = (organizer: RunSummary['organizer']): RunSummary => ({ ...base, organizer });

// ── both fields present ──────────────────────────────────────────────────────
console.log('\n── organizer attribution: both fields ──');
const both = formatRunSummaryEmail(withOrg({ displayName: 'Ahiya Savir', email: 'creator@example.com' }));
check('the plain text names the creator', both.text.includes('Ahiya Savir'));
check('the plain text carries the creator email', both.text.includes('creator@example.com'));
check('the HTML names the creator', both.html.includes('Ahiya Savir'));
check('the HTML carries the creator email', both.html.includes('creator@example.com'));

// ── degradation ──────────────────────────────────────────────────────────────
// Each of these is a real shape: a creator who never set a display name, a
// legacy users doc with only a name, and a doc with neither.
console.log('\n── organizer attribution: degradation ──');

const emailOnly = formatRunSummaryEmail(withOrg({ email: 'creator@example.com' }));
check('email-only still attributes', emailOnly.text.includes('creator@example.com'));
check('email-only renders no "undefined"', !emailOnly.text.includes('undefined'));
check('email-only HTML renders no "undefined"', !emailOnly.html.includes('undefined'));

const nameOnly = formatRunSummaryEmail(withOrg({ displayName: 'Ahiya Savir' }));
check('name-only still attributes', nameOnly.text.includes('Ahiya Savir'));
check('name-only renders no "undefined"', !nameOnly.text.includes('undefined'));
check('name-only renders no empty angle brackets', !nameOnly.text.includes('<>'));

const emptyOrg = formatRunSummaryEmail(withOrg({}));
check('an empty organizer object renders no "undefined"', !emptyOrg.text.includes('undefined'));
check('an empty organizer object omits the block entirely',
  !/created by/i.test(emptyOrg.text), 'a header with no value is worse than no header');

const noOrg = formatRunSummaryEmail(base);
check('an absent organizer renders no "undefined"', !noOrg.text.includes('undefined'));
check('an absent organizer omits the block entirely', !/created by/i.test(noOrg.text));
check('an absent organizer still renders the rest of the email',
  noOrg.text.includes('Team Aleph') && noOrg.text.includes('Final standings'));

// ── participant privacy ──────────────────────────────────────────────────────
// The email must never claim to know a participant's address, and must never
// carry registrationData answers (phone numbers, custom per-game questions) —
// participant PII, possibly a minor's, outliving the 90-day retention prune in
// an inbox.
console.log('\n── participant privacy ──');
const withComments = formatRunSummaryEmail({
  ...withOrg({ displayName: 'Ahiya Savir', email: 'creator@example.com' }),
  feedback: {
    ...base.feedback,
    commentCount: 1,
    comments: [{ teamName: 'Team Aleph', text: 'Great game!' }],
  },
});
// The ONLY address in the payload is the creator's own.
const addresses = (withComments.text.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []);
check('the only email address in the body is the creator\'s',
  addresses.every((a) => a === 'creator@example.com'), addresses.join(','));
check('player display names still appear (that is the requested attribution)',
  withComments.text.includes('Team Aleph'));

// Determinism: pure formatter, same input ⇒ byte-identical output. Guards against
// someone reaching for a timestamp or Math.random in the template later.
console.log('\n── purity ──');
const a = formatRunSummaryEmail(withOrg({ displayName: 'A', email: 'a@b.co' }));
const b = formatRunSummaryEmail(withOrg({ displayName: 'A', email: 'a@b.co' }));
check('the formatter is deterministic', a.text === b.text && a.html === b.html);

console.log(`\n${failures === 0 ? 'ALL ATTRIBUTION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
