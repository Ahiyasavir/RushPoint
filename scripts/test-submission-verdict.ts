// Pure-logic tests — what is a player told about their own submission?
// (change: rejection-tells-the-player)
//
// The organizer pressed reject and the team's screen did not change by one pixel. The
// verdict and the reason were ALREADY on the phone (the server writes them to
// `taskSubmissions` and the participant sanitizer allow-lists it); no screen read them.
// These pin the decision that fixes it, including the two silences that are deliberate.
import { submissionVerdict } from '../apps/play-web/src/lib/submissionVerdict';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const team = (rec: unknown) => ({ taskSubmissions: { t1: rec } } as never);

console.log('\n— a rejection is announced, with the reason —');
eq('a rejection with a reason carries it',
  submissionVerdict(team({ status: 'rejected', reviewNote: 'a photo of a hand' }), 't1'),
  { rejected: true, reason: 'a photo of a hand' });

// THE CASE THE ORGANIZER ASKED FOR. Mid-run, rejecting a bad photo must not require
// composing a sentence, so an empty note is the common case - and it must still read
// as a decision rather than as a glitch.
eq('a rejection with NO reason is still announced',
  submissionVerdict(team({ status: 'rejected' }), 't1'),
  { rejected: true, reason: '' });
eq('a whitespace-only reason counts as no reason',
  submissionVerdict(team({ status: 'rejected', reviewNote: '   \n  ' }), 't1'),
  { rejected: true, reason: '' });
eq('the reason is trimmed before it reaches a screen',
  submissionVerdict(team({ status: 'rejected', reviewNote: '  too dark  ' }), 't1').reason,
  'too dark');

console.log('\n— the two deliberate silences —');
// A permanent "waiting for review" banner would sit there for the whole wait and train
// the player to ignore the exact spot a rejection is going to appear.
eq('a PENDING submission says nothing',
  submissionVerdict(team({ status: 'pending' }), 't1'), { rejected: false, reason: '' });
// An approval completes the task and routes the team onward; a notice about a mission
// they have already left would arrive attached to the wrong screen.
eq('an APPROVED submission says nothing',
  submissionVerdict(team({ status: 'approved', reviewNote: 'nice' }), 't1'),
  { rejected: false, reason: '' });

console.log('\n— it is about THIS mission, never a neighbour —');
const two = { taskSubmissions: { t1: { status: 'rejected', reviewNote: 'no' }, t2: { status: 'pending' } } } as never;
eq('the rejected task reports rejected', submissionVerdict(two, 't1').rejected, true);
eq('the pending sibling does not', submissionVerdict(two, 't2').rejected, false);
eq('a task with no submission at all does not', submissionVerdict(two, 't3').rejected, false);

console.log('\n— total: a malformed document must never throw, and never shout —');
const junk: [string, unknown, unknown][] = [
  ['null team', null, 't1'],
  ['undefined team', undefined, 't1'],
  ['a string team', 'nope', 't1'],
  ['an array team', [], 't1'],
  ['no taskSubmissions', {}, 't1'],
  ['taskSubmissions is a string', { taskSubmissions: 'x' }, 't1'],
  ['taskSubmissions is an array', { taskSubmissions: [] }, 't1'],
  ['the record is null', { taskSubmissions: { t1: null } }, 't1'],
  ['the record is a string', { taskSubmissions: { t1: 'rejected' } }, 't1'],
  ['status is a number', { taskSubmissions: { t1: { status: 3 } } }, 't1'],
  ['status is REJECTED in caps', { taskSubmissions: { t1: { status: 'REJECTED' } } }, 't1'],
  ['a null taskId', { taskSubmissions: { t1: { status: 'rejected' } } }, null],
  ['an empty taskId', { taskSubmissions: { t1: { status: 'rejected' } } }, ''],
  ['a numeric taskId', { taskSubmissions: { t1: { status: 'rejected' } } }, 7],
];
for (const [label, t, id] of junk) {
  let threw = false;
  let out: unknown = null;
  try { out = submissionVerdict(t as never, id as never); } catch { threw = true; }
  ok(`${label} is silent and does not throw`,
    !threw && JSON.stringify(out) === JSON.stringify({ rejected: false, reason: '' }),
    threw ? 'THREW' : JSON.stringify(out));
}

console.log('\n— a note cannot grow without bound on a small screen —');
const long = submissionVerdict(team({ status: 'rejected', reviewNote: 'x'.repeat(5000) }), 't1');
ok(`an oversized note is capped :: ${long.reason.length} chars`,
  long.rejected && long.reason.length > 0 && long.reason.length <= 300, String(long.reason.length));

// A non-string note must not become the string "null" on a player's screen.
eq('a non-string note degrades to no reason',
  submissionVerdict(team({ status: 'rejected', reviewNote: 42 }), 't1'),
  { rejected: true, reason: '' });

console.log('');
if (failures > 0) {
  console.error(`✗ submission-verdict: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ submission-verdict: all assertions passed\n');
