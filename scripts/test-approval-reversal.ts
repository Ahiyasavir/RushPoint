// Pure-logic tests — undoing an approval, and taking the points back with it
// (change: approval-can-be-undone).
//
// THE REPORTED DEFECT, which is three layers rather than one. "Participants could upload
// a meaningless photo - a picture of their hand - and carry on through the game."
//
//   1. Bank photo missions default to `smart.autoApprove: true` (61 of the bank's 103
//      missions), because rule 14 of the bank is honest that "nothing adjudicates it
//      mid-play".
//   2. The alternative BLOCKS the team: photoReviewQueue.ts says a pending submission
//      means "the task is not scored, the station slot is not released, and routing has
//      nothing to hand the team. They are standing still until an organizer taps a
//      button." With one organizer and five teams that setting is unusable.
//   3. And an approval was PERMANENT. `canReject` returned false once approved, because
//      "the server has no score clawback path, so rejecting an approved task would flip
//      a status string while the points silently stay."
//
// Layers 1 and 2 are a real product trade-off. Layer 3 is what turned it into a trap:
// it made auto-approve mean UNREVIEWABLE when it should only mean UNBLOCKING. This
// module is the clawback that removes the objection in layer 3.
//
// THE ONE RULE: never guess at an amount. A reversal whose award cannot be determined
// removes NOTHING and says so. Subtracting a plausible-looking number from a live
// scoreboard is worse than declining to act, because the organizer would have no way to
// know it happened.
import {
  planApprovalReversal, REVERSAL_OUTCOME, type ApprovalReversalPlan,
} from '../packages/shared/src/approvalReversal';
import { nextStatus, canReject } from '../packages/shared/src/photoQueue';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

const plan = (
  submissionStatus: string, earnedScore: unknown, teamScore: unknown,
): ApprovalReversalPlan => planApprovalReversal({
  submissionStatus, earnedScore: earnedScore as number, teamScore: teamScore as number,
});

console.log('\napproval-reversal — planApprovalReversal');

// ── 1. The motivating case: a hand photo that auto-approved for 100 points ──
{
  const p = plan('approved', 100, 450);
  eq('an approved submission can be reversed', p.outcome, REVERSAL_OUTCOME.reversed);
  eq('and the award is taken back in full', p.scoreDelta, -100);
  eq('and the resulting team score is stated, not left to the caller', p.nextTeamScore, 350);
  eq('and the submission becomes rejected', p.nextSubmissionStatus, 'rejected');
}

// ── 2. Never guess at an amount ────────────────────────────────────────────
// Subtracting a plausible number from a live scoreboard is worse than declining.
{
  for (const unknown of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 'x', {}]) {
    const p = plan('approved', unknown, 450);
    eq(`an ${JSON.stringify(unknown)} award reverses NOTHING`, p.outcome, REVERSAL_OUTCOME.unknownAward);
    eq(`and moves the score by zero`, p.scoreDelta, 0);
    eq(`and leaves the team score exactly where it was`, p.nextTeamScore, 450);
  }
  // A negative stored award is corrupt data, not an instruction to ADD points.
  const neg = plan('approved', -50, 450);
  eq('a negative stored award reverses nothing rather than adding points',
    neg.outcome, REVERSAL_OUTCOME.unknownAward);
  eq('and the score is untouched', neg.nextTeamScore, 450);
}

// ── 3. A zero-award approval is reversible and is not "unknown" ────────────
// time_only games score every task 0. "I know it was worth nothing" is a fact.
{
  const p = plan('approved', 0, 450);
  eq('a zero award still reverses the status', p.outcome, REVERSAL_OUTCOME.reversed);
  eq('and moves no score, correctly', p.scoreDelta, 0);
  eq('and the submission becomes rejected', p.nextSubmissionStatus, 'rejected');
}

// ── 4. Idempotence: reversing twice equals reversing once ─────────────────
{
  const p = plan('rejected', 100, 350);
  eq('an already-rejected submission is a no op', p.outcome, REVERSAL_OUTCOME.alreadyRejected);
  eq('and takes nothing further', p.scoreDelta, 0);
  eq('and the score stays where the first reversal left it', p.nextTeamScore, 350);

  const pending = plan('pending', 100, 450);
  eq('a PENDING submission was never scored, so there is nothing to claw back',
    pending.outcome, REVERSAL_OUTCOME.notApproved);
  eq('and no score moves', pending.scoreDelta, 0);
}

// ── 5. The score never goes below zero from a reversal ────────────────────
// A team whose award exceeds their current total means the score already moved for
// another reason. Driving it negative would make the leaderboard nonsense.
{
  const p = plan('approved', 100, 40);
  eq('a reversal never drives the team score negative', p.nextTeamScore, 0);
  ok(`and the delta is clamped to match :: ${p.scoreDelta}`, p.nextTeamScore === 40 + p.scoreDelta);
  eq('and it still counts as reversed', p.outcome, REVERSAL_OUTCOME.reversed);
}

// ── 6. An unusable team score is not a licence to invent one ──────────────
{
  for (const bad of [undefined, null, Number.NaN, 'x']) {
    const p = plan('approved', 100, bad);
    ok(`an ${JSON.stringify(bad)} team score yields a finite next score :: ${p.nextTeamScore}`,
      Number.isFinite(p.nextTeamScore) && p.nextTeamScore >= 0);
  }
}

// ── 7. Totality — this runs inside a scoring transaction ──────────────────
{
  for (const b of [null, undefined, 42, 'x', [], true]) {
    let threw = false;
    let p: ApprovalReversalPlan | null = null;
    try { p = planApprovalReversal(b as never); } catch { threw = true; }
    ok(`a ${String(typeof b)} input does not throw and yields an outcome`,
      !threw && !!p && typeof p.outcome === 'string' && Number.isFinite(p.scoreDelta),
      JSON.stringify(p));
  }
  // The safety property: nothing but a genuine reversal may ever move a score.
  for (const status of ['pending', 'rejected', 'weird', '']) {
    eq(`status "${status}" never moves the score`, plan(status, 100, 450).scoreDelta, 0);
  }
}

// ── 8. The transition table now admits the edge it documented as impossible ─
{
  eq('approved + reject now yields rejected', nextStatus('approved', 'reject'), 'rejected');
  ok('and the reviewer is allowed to press it', canReject('approved') === true);
  // Everything else about the table is unchanged, including its idempotence.
  eq('approve is still idempotent', nextStatus('approved', 'approve'), 'approved');
  eq('reject is still idempotent', nextStatus('rejected', 'reject'), 'rejected');
  eq('a rejected row can still be approved', nextStatus('rejected', 'approve'), 'approved');
  eq('a pending row can still be approved', nextStatus('pending', 'approve'), 'approved');
  eq('a pending row can still be rejected', nextStatus('pending', 'reject'), 'rejected');
  ok('a pending row is still rejectable', canReject('pending') === true);
  ok('a rejected row is still rejectable (no op)', canReject('rejected') === true);
}

// ── 9. The invariant, swept ───────────────────────────────────────────────
{
  let seed = 0x3c9a71d5;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const STATUSES = ['approved', 'pending', 'rejected', 'nonsense'];
  const SWEEPS = 5000;
  let violations = 0;
  const seen: Record<string, number> = {};
  for (let i = 0; i < SWEEPS; i++) {
    const status = STATUSES[rnd(STATUSES.length)];
    const earned = rnd(4) === 0 ? Number.NaN : rnd(500);
    const teamScore = rnd(1000);
    const p = planApprovalReversal({ submissionStatus: status, earnedScore: earned, teamScore });
    seen[p.outcome] = (seen[p.outcome] ?? 0) + 1;
    // A reversal only ever REMOVES points.
    if (p.scoreDelta > 0) violations++;
    // The next score is always finite and never negative.
    if (!Number.isFinite(p.nextTeamScore) || p.nextTeamScore < 0) violations++;
    // The delta and the next score always agree.
    if (Math.abs((teamScore + p.scoreDelta) - p.nextTeamScore) > 0.0001) violations++;
    // Only an approved row may move a score at all.
    if (status !== 'approved' && p.scoreDelta !== 0) violations++;
  }
  ok(`a reversal only ever removes points, and never below zero :: ${SWEEPS} sweeps`,
    violations === 0, `${violations} violation(s)`);
  ok(`the sweep reached every outcome :: ${JSON.stringify(seen)}`, Object.keys(seen).length === 4);
}

console.log('');
if (failures > 0) {
  console.error(`✗ approval-reversal: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ approval-reversal: all assertions passed');
