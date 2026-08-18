// Pure-logic tests for the Run Console media gallery (change:
// run-media-gallery-and-video-feed). Run by scripts/run-unit-tests.mjs via
// `npm test`. No emulator.
//
// The gallery's whole point is "show media the review queue's pending/reviewed
// split does not" (an autoApproved photo, an already-rejected one) — so most of
// these assertions are the exact inverse of the review-queue tests.
import { buildRunMediaGallery } from '../apps/creator-web/src/lib/runMediaGallery';
import type { RawSubmission, SubmissionTeamDoc } from '../packages/shared/src/photoQueue';

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

// ── 1. Every review status is included, not just pending ────────────────────
{
  const teams = [
    team('t1', { taskA: sub({ status: 'approved' }) }),
    team('t2', { taskB: sub({ status: 'pending' }) }),
    team('t3', { taskC: sub({ status: 'rejected' }) }),
  ];
  const rows = buildRunMediaGallery(teams);
  ok(rows.length === 3, `all three statuses are included, got ${rows.length}`);
  ok(rows.some((r) => r.status === 'approved'), 'approved row present');
  ok(rows.some((r) => r.status === 'pending'), 'pending row present');
  ok(rows.some((r) => r.status === 'rejected'), 'rejected row present');
}

// ── 2. An autoApproved submission (never touched the review queue) is included
{
  const teams = [team('t1', { taskA: sub({ status: 'approved', reviewedAt: undefined }) })];
  const rows = buildRunMediaGallery(teams);
  ok(rows.length === 1 && rows[0].status === 'approved', 'autoApproved-style row (no reviewedAt) still included');
}

// ── 3. A submission with no usable URL is omitted ────────────────────────────
{
  const teams = [
    team('t1', { good: sub() }),
    team('t2', { bad: sub({ photoUrl: 'not-a-url' }) }),
    team('t3', { missing: sub({ photoUrl: undefined }) }),
  ];
  const rows = buildRunMediaGallery(teams);
  ok(rows.length === 1 && rows[0].taskId === 'good', `only the renderable row survives, got ${JSON.stringify(rows.map((r) => r.taskId))}`);
}

// ── 4. mediaKind passes through so callers can branch <img>/<video>/<audio> ──
{
  const teams = [
    team('t1', {
      p: sub({ mediaKind: undefined }),
      v: sub({ mediaKind: 'video' }),
      a: sub({ mediaKind: 'audio' }),
    }),
  ];
  const rows = buildRunMediaGallery(teams);
  const byTask = Object.fromEntries(rows.map((r) => [r.taskId, r.mediaKind]));
  ok(byTask.p === 'photo', `absent mediaKind normalizes to photo, got ${byTask.p}`);
  ok(byTask.v === 'video', `video mediaKind passes through, got ${byTask.v}`);
  ok(byTask.a === 'audio', `audio mediaKind passes through, got ${byTask.a}`);
}

// ── 5. Sorted newest-submitted first, stable/total for equal or missing times ─
{
  const teams = [
    team('t1', { old: sub({ submittedAt: '2026-07-21T09:00:00.000Z' }) }),
    team('t2', { newer: sub({ submittedAt: '2026-07-21T11:00:00.000Z' }) }),
    team('t3', { none: sub({ submittedAt: undefined }) }),
  ];
  const rows = buildRunMediaGallery(teams);
  ok(rows.map((r) => r.taskId).join(',') === 'newer,old,none',
    `newest-first, missing timestamp sorts last, got ${rows.map((r) => r.taskId).join(',')}`);
}

// ── 6. Total: never throws on malformed input ────────────────────────────────
{
  // @ts-expect-error deliberately malformed input for the total-function check
  ok(Array.isArray(buildRunMediaGallery(null)), 'null teams array does not throw');
  // @ts-expect-error deliberately malformed input for the total-function check
  ok(Array.isArray(buildRunMediaGallery([null, undefined, { id: 't1' }])), 'malformed team entries do not throw');
}

console.log(`\nrun-media-gallery: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
