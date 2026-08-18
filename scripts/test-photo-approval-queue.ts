// Pure-logic tests for the photo/audio review queue (wave-e task 13).
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator.
//
// Imports the SHARED SOURCE, not the built dist, so the lane never depends on a
// `shared:build` that a concurrent agent may be rewriting in place.
import {
  buildPendingQueue,
  buildReviewedQueue,
  buildSubmissionQueues,
  canApprove,
  canReject,
  flattenSubmissions,
  isPending,
  isRenderableMedia,
  nextStatus,
  normalizeStatus,
  submissionKey,
  DEFAULT_REVIEWED_LIMIT,
  type RawSubmission,
  type SubmissionStatus,
  type SubmissionTeamDoc,
} from '../packages/shared/src/photoQueue';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const sub = (over: RawSubmission = {}): RawSubmission => ({
  photoUrl: 'https://firebasestorage.googleapis.com/v0/b/b/o/x.jpg',
  submittedAt: '2026-07-21T10:00:00.000Z',
  status: 'pending',
  ...over,
});

const team = (id: string, subs: Record<string, RawSubmission>, displayName?: string): SubmissionTeamDoc =>
  ({ id, displayName, taskSubmissions: subs });

// ── 1. Only pending rows enter the actionable queue ──────────────────────────
{
  const teams = [
    team('t1', {
      a: sub({ status: 'pending' }),
      b: sub({ status: 'approved' }),
      c: sub({ status: 'rejected' }),
    }, 'Lions'),
  ];
  const q = buildPendingQueue(teams);
  ok(q.length === 1, 'pending queue holds only pending rows');
  ok(q[0].taskId === 'a', 'pending queue kept the pending task');
  ok(q.every(isPending), 'every queued row reports isPending');
}

// autoApprove writes status 'approved' straight away — it must NEVER show up as
// work waiting for a human (that was the whole point of autoApprove).
{
  const q = buildPendingQueue([team('t1', { auto: sub({ status: 'approved', reviewedAt: undefined }) })]);
  ok(q.length === 0, 'an auto-approved submission never enters the review queue');
}

// ── 2. Flattens across teams AND across tasks ────────────────────────────────
{
  const teams = [
    team('t1', { a: sub(), b: sub() }, 'Lions'),
    team('t2', { a: sub(), c: sub() }, 'Bears'),
  ];
  const q = buildPendingQueue(teams);
  ok(q.length === 4, '2 teams x 2 pending tasks flattens to 4 rows');
  ok(new Set(q.map(submissionKey)).size === 4, 'the 4 rows are distinct');
  ok(q.some((r) => r.teamId === 't2' && r.taskId === 'c'), 'a second team\'s task is present');
}

// ── 3. FIFO ordering, missing timestamps last, stable tiebreak ───────────────
{
  const teams = [
    team('t2', { late: sub({ submittedAt: '2026-07-21T12:00:00.000Z' }) }),
    team('t1', { early: sub({ submittedAt: '2026-07-21T08:00:00.000Z' }) }),
    team('t3', { mid: sub({ submittedAt: '2026-07-21T10:00:00.000Z' }) }),
    team('t4', { unknown: sub({ submittedAt: undefined }) }),
  ];
  const q = buildPendingQueue(teams);
  ok(q.map((r) => r.taskId).join(',') === 'early,mid,late,unknown',
    `FIFO oldest first, timestampless last (got ${q.map((r) => r.taskId).join(',')})`);
}
{
  // Identical timestamps must produce a TOTAL, deterministic order — an unstable
  // comparator makes rows jump between snapshots and a tap lands on the wrong row.
  const ts = '2026-07-21T09:00:00.000Z';
  const forward = buildPendingQueue([
    team('tb', { z: sub({ submittedAt: ts }) }),
    team('ta', { y: sub({ submittedAt: ts }) }),
  ]).map(submissionKey);
  const reversed = buildPendingQueue([
    team('ta', { y: sub({ submittedAt: ts }) }),
    team('tb', { z: sub({ submittedAt: ts }) }),
  ]).map(submissionKey);
  ok(forward.join('|') === reversed.join('|'), 'equal timestamps sort identically regardless of input order');
  ok(forward[0] === 'ta:y', 'equal timestamps break on the row key');
}

// ── 4. Dedupe: one row per teamId x taskId, always ───────────────────────────
{
  const teams: SubmissionTeamDoc[] = [];
  for (let i = 0; i < 12; i++) {
    teams.push(team(`team-${i % 4}-${i}`, { t1: sub(), t2: sub(), t3: sub() }));
  }
  const q = buildPendingQueue(teams);
  ok(new Set(q.map(submissionKey)).size === q.length, 'no duplicate teamId:taskId row can exist');
}

// ── 5. Legacy / partial docs never throw and never render "undefined" ────────
{
  const teams = [
    { id: 't1' } as SubmissionTeamDoc,                               // no taskSubmissions
    { id: 't2', taskSubmissions: null } as SubmissionTeamDoc,        // null map
    { id: 't3', taskSubmissions: {} } as SubmissionTeamDoc,          // empty map
    team('t4', { a: {} }),                                           // empty submission
    team('t5', { b: sub({ mediaKind: undefined }) }),
  ];
  const q = buildPendingQueue(teams);
  ok(q.length === 2, 'partial/legacy team docs contribute only their real submissions');
  ok(q.every((r) => typeof r.displayName === 'string' && r.displayName.length > 0),
    'a nameless team falls back to its doc id');
  ok(q.find((r) => r.teamId === 't4')!.displayName === 't4', 'displayName falls back to the doc id');
  ok(q.every((r) => r.mediaKind === 'photo'), 'an absent mediaKind is treated as photo');
  ok(q.find((r) => r.teamId === 't4')!.submittedAt === '', 'a missing submittedAt normalizes to an empty string');
  ok(q.find((r) => r.teamId === 't4')!.photoUrl === '', 'a missing photoUrl normalizes to an empty string');
}
{
  const q = buildPendingQueue([team('t1', { a: sub({ mediaKind: 'audio' }) })]);
  ok(q[0].mediaKind === 'audio', 'an audio submission keeps its mediaKind (it must not render as an <img>)');
}
{
  // The mapper used to collapse every non-audio kind to 'photo', so a reviewer
  // got a video submission inside an <img> — i.e. a bare link and no picture.
  const q = buildPendingQueue([team('t1', { a: sub({ mediaKind: 'video' }) })]);
  ok(q[0].mediaKind === 'video', 'a video submission keeps its mediaKind (it must not render as an <img>)');
}
{
  // A whitespace-only displayName is as useless as none.
  const q = buildPendingQueue([team('t1', { a: sub() }, '   ')]);
  ok(q[0].displayName === 't1', 'a blank displayName falls back to the doc id');
}

// ── 6. Status normalization + the transition table ───────────────────────────
{
  ok(normalizeStatus('approved') === 'approved', 'approved normalizes to itself');
  ok(normalizeStatus('rejected') === 'rejected', 'rejected normalizes to itself');
  ok(normalizeStatus('pending') === 'pending', 'pending normalizes to itself');
  ok(normalizeStatus(undefined) === 'pending', 'an absent status is treated as pending (never hide real work)');
  ok(normalizeStatus('garbage') === 'pending', 'an unknown status is treated as pending');
}
{
  ok(nextStatus('pending', 'approve') === 'approved', 'pending + approve = approved');
  ok(nextStatus('pending', 'reject') === 'rejected', 'pending + reject = rejected');
  ok(nextStatus('rejected', 'approve') === 'approved', 'rejected + approve = approved (it was never scored)');
  ok(nextStatus('rejected', 'reject') === 'rejected', 'rejected + reject is a no op');
  ok(nextStatus('approved', 'approve') === 'approved', 'approved + approve is a no op (server returns completed:false)');
  ok(nextStatus('approved', 'reject') === 'approved',
    'approved + reject does NOT flip: there is no score clawback path on the server');
}
{
  // Idempotence as an algebraic property over the whole table.
  const statuses: SubmissionStatus[] = ['pending', 'approved', 'rejected'];
  let idempotent = true;
  for (const s of statuses) {
    for (const a of ['approve', 'reject'] as const) {
      const once = nextStatus(s, a);
      if (nextStatus(once, a) !== once) idempotent = false;
    }
  }
  ok(idempotent, 'applying the same review action twice equals applying it once (double click is safe)');
}
{
  ok(canReject('pending') && canReject('rejected'), 'reject stays available while unscored');
  ok(!canReject('approved'), 'reject is refused on an approved row (disable it and say why)');
  ok(canApprove('pending') && canApprove('rejected'), 'approve is available while unscored');
  ok(!canApprove('approved'), 'approve is pointless on an already approved row');
}

// ── 7. The row key matches what the consoles already use for useAsyncAction ──
{
  ok(submissionKey({ teamId: 'abc', taskId: 'xyz' }) === 'abc:xyz',
    'submissionKey is `${teamId}:${taskId}` — the exact per row in flight guard key');
  const q = buildPendingQueue([team('t1', { a: sub() })]);
  ok(submissionKey(q[0]) === 't1:a', 'a queue row keys itself the same way');
}

// ── 8. Recently reviewed strip (newest first, capped) ────────────────────────
{
  const teams = [
    team('t1', {
      r1: sub({ status: 'approved', reviewedAt: '2026-07-21T11:00:00.000Z' }),
      r2: sub({ status: 'rejected', reviewedAt: '2026-07-21T12:00:00.000Z', reviewNote: 'too dark' }),
      p1: sub({ status: 'pending' }),
    }),
  ];
  const reviewed = buildReviewedQueue(teams);
  ok(reviewed.length === 2, 'the reviewed strip excludes pending rows');
  ok(reviewed[0].taskId === 'r2', 'the reviewed strip is newest first');
  ok(reviewed[0].reviewNote === 'too dark', 'the reject note is carried through');
  ok(buildPendingQueue(teams).length === 1, 'the pending queue is unaffected by reviewed rows');
}
{
  const many: Record<string, RawSubmission> = {};
  for (let i = 0; i < DEFAULT_REVIEWED_LIMIT + 5; i++) {
    many[`r${i}`] = sub({ status: 'approved', reviewedAt: `2026-07-21T10:${String(i).padStart(2, '0')}:00.000Z` });
  }
  ok(buildReviewedQueue([team('t1', many)]).length === DEFAULT_REVIEWED_LIMIT,
    'the reviewed strip is capped (it is a confirmation, not an audit view)');
  ok(buildReviewedQueue([team('t1', many)], -1).length === DEFAULT_REVIEWED_LIMIT + 5,
    'a negative limit means uncapped');
}
{
  // autoApprove has no reviewedAt — it must still sort, falling back to submittedAt.
  const reviewed = buildReviewedQueue([team('t1', {
    auto: sub({ status: 'approved', submittedAt: '2026-07-21T09:00:00.000Z' }),
    human: sub({ status: 'approved', submittedAt: '2026-07-21T08:00:00.000Z', reviewedAt: '2026-07-21T08:30:00.000Z' }),
  })]);
  ok(reviewed[0].taskId === 'auto', 'a reviewedAt-less auto approval sorts by submittedAt without throwing');
}

// ── 9. One pass builds both lists identically to the single builders ─────────
{
  const teams = [
    team('t1', { a: sub(), b: sub({ status: 'approved', reviewedAt: '2026-07-21T11:00:00.000Z' }) }),
    team('t2', { a: sub({ submittedAt: '2026-07-21T07:00:00.000Z' }) }),
  ];
  const q = buildSubmissionQueues(teams);
  ok(JSON.stringify(q.pending) === JSON.stringify(buildPendingQueue(teams)),
    'buildSubmissionQueues.pending equals buildPendingQueue');
  ok(JSON.stringify(q.reviewed) === JSON.stringify(buildReviewedQueue(teams)),
    'buildSubmissionQueues.reviewed equals buildReviewedQueue');
  ok(q.pendingCount === q.pending.length, 'pendingCount matches the pending list length');
  ok(flattenSubmissions(teams).length === 3, 'flattenSubmissions returns every submission unfiltered');
}

// ── 10. Renderable media guard ───────────────────────────────────────────────
{
  ok(isRenderableMedia('https://firebasestorage.googleapis.com/v0/b/x/o/y.jpg'), 'an https URL is renderable');
  ok(isRenderableMedia('http://127.0.0.1:9199/v0/b/x/o/y.jpg'), 'an emulator http URL is renderable');
  ok(!isRenderableMedia(''), 'an empty URL is not renderable');
  ok(!isRenderableMedia('javascript:alert(1)'), 'a javascript: URL is never fed to a media tag');
  ok(!isRenderableMedia('gs://bucket/x.jpg'), 'a gs:// path is not renderable');
}

console.log(`\nphoto approval queue: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
