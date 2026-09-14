// Undoing an approval, and taking the points back with it
// (change: approval-can-be-undone).
//
// THE REPORTED DEFECT, which is three layers rather than one. "Participants could upload
// a meaningless photo — a picture of their hand — and carry on through the game."
//
//   1. Bank photo missions default to `smart.autoApprove: true` — 61 of the bank's 103
//      missions — because rule 14 of the bank is honest that "nothing adjudicates it
//      mid-play".
//   2. The alternative BLOCKS the team. `photoReviewQueue.ts` states it plainly: a
//      pending submission means "the task is not scored, the station slot is not
//      released, and routing has nothing to hand the team. They are standing still
//      until an organizer taps a button." With one organizer and five teams that
//      setting is unusable, which is why everything is auto-approve.
//   3. And an approval was PERMANENT. `canReject` returned false once approved, because
//      "the server has no score clawback path, so rejecting an approved task would flip
//      a status string while the points silently stay."
//
// Layers 1 and 2 are a real product trade-off between "nobody is blocked" and "somebody
// checks". Layer 3 is what turned that trade-off into a trap: it made auto-approve mean
// UNREVIEWABLE when it should only mean UNBLOCKING. This module is the clawback that
// removes the objection, so `approved + reject` can become a real edge.
//
// THE ONE RULE: NEVER GUESS AT AN AMOUNT. A reversal whose award cannot be determined
// removes NOTHING and says so. Subtracting a plausible-looking number from a live
// scoreboard is worse than declining to act, because the organizer would have no way to
// discover it happened.
//
// Dependency-free — scripts/test-approval-reversal.ts.

/** What a reversal attempt concluded. */
export const REVERSAL_OUTCOME = {
  /** The approval was undone and the award removed. */
  reversed: 'reversed',
  /** Already rejected. Nothing to do; reversing twice equals reversing once. */
  alreadyRejected: 'alreadyRejected',
  /** Never approved, so nothing was ever scored to take back. */
  notApproved: 'notApproved',
  /** Approved, but what it awarded cannot be read. Nothing is touched. */
  unknownAward: 'unknownAward',
} as const;

export type ReversalOutcome = (typeof REVERSAL_OUTCOME)[keyof typeof REVERSAL_OUTCOME];

export interface ApprovalReversalInput {
  /** The submission's stored status. */
  submissionStatus?: string | null;
  /** What the task record was stamped with when it was approved. */
  earnedScore?: number | null;
  /** The team's current total. */
  teamScore?: number | null;
}

export interface ApprovalReversalPlan {
  outcome: ReversalOutcome;
  /** Always <= 0. What to add to the team's score. */
  scoreDelta: number;
  /** The team's score after applying `scoreDelta`. Never negative, always finite. */
  nextTeamScore: number;
  /** What the submission's status becomes. Unchanged unless reversed. */
  nextSubmissionStatus: 'approved' | 'rejected' | 'pending';
}

/** A finite number, or null. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What reversing this approval should do.
 *
 * Total, and biased hard toward doing nothing: only a submission that is genuinely
 * `approved` AND carries a readable, non-negative award may move a score at all.
 *
 * A ZERO award is reversible and is NOT "unknown" — a `time_only` game scores every
 * task zero, and "I know it was worth nothing" is a fact, not a gap. A NEGATIVE stored
 * award is corrupt data rather than an instruction to ADD points, so it is refused.
 *
 * The resulting score is clamped at zero. A team whose award exceeds their current
 * total means the score already moved for some other reason, and driving a leaderboard
 * negative would turn one bad submission into a nonsensical scoreboard.
 */
export function planApprovalReversal(input: ApprovalReversalInput): ApprovalReversalPlan {
  const safe = (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : ({} as ApprovalReversalInput);

  const teamScore = Math.max(0, finite(safe.teamScore) ?? 0);
  const status = typeof safe.submissionStatus === 'string' ? safe.submissionStatus : '';

  const idle = (outcome: ReversalOutcome): ApprovalReversalPlan => ({
    outcome,
    scoreDelta: 0,
    nextTeamScore: teamScore,
    nextSubmissionStatus: status === 'approved' ? 'approved'
      : status === 'rejected' ? 'rejected' : 'pending',
  });

  if (status === 'rejected') return idle(REVERSAL_OUTCOME.alreadyRejected);
  if (status !== 'approved') return idle(REVERSAL_OUTCOME.notApproved);

  const earned = finite(safe.earnedScore);
  // Never guess. An unreadable or negative award reverses nothing at all.
  if (earned === null || earned < 0) return idle(REVERSAL_OUTCOME.unknownAward);

  // Clamped so a reversal cannot drive the board negative, and the delta is derived
  // FROM the clamp so the two can never disagree.
  const nextTeamScore = Math.max(0, teamScore - earned);
  return {
    outcome: REVERSAL_OUTCOME.reversed,
    scoreDelta: nextTeamScore - teamScore,
    nextTeamScore,
    nextSubmissionStatus: 'rejected',
  };
}
