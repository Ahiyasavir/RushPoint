// What should this player be told about their own last submission?
// (change: rejection-tells-the-player)
//
// THE GAP. `reviewStationSubmission` has always written the verdict onto the team
// document — `taskSubmissions[taskId].status` plus the organizer's `reviewNote` — and
// `sanitizeTeamForParticipant` has always allow-listed `taskSubmissions`, so the phone
// has been holding "you were rejected, and here is why" the entire time. Nothing in
// play-web ever read it.
//
// So the organizer pressed reject, the team's screen did not change by one pixel, and
// the players stood there waiting for an approval that was never coming. Reported from
// the first real run after the review queue went in: "when I reject a team's video it
// does not alert them or tell them anything."
//
// WHY A PENDING SUBMISSION SAYS NOTHING. "Waiting for review" is already announced at
// submit time by the progress toast, and a permanent banner repeating it would sit on
// screen for the whole wait and train players to ignore the one place a REJECTION is
// going to appear. Silence here is what buys the rejection its attention.
//
// WHY AN APPROVAL SAYS NOTHING EITHER. An approved submission completes the task, and
// the team is routed onward with the ordinary celebration; a notice about a mission
// they have already left would arrive after the fact and attached to the wrong screen.
//
// THE REASON IS OPTIONAL, BY DESIGN. An organizer mid-run should not have to compose a
// sentence to reject a photo of somebody's hand, so `reviewNote` is very often empty.
// A verdict with no reason still has to read as a decision rather than as a glitch,
// which is why `reason` being absent is a first-class case here and not an error.
//
// Dependency-free and total — scripts/test-submission-verdict.ts.

export interface SubmissionRecord {
  status?: string | null;
  reviewNote?: string | null;
}

export interface VerdictTeam {
  taskSubmissions?: Record<string, SubmissionRecord | null | undefined> | null;
}

export interface SubmissionVerdict {
  /** Should the mission screen show a rejection notice at all? */
  rejected: boolean;
  /** The organizer's words, trimmed. Empty when they gave none. */
  reason: string;
}

const NONE: SubmissionVerdict = { rejected: false, reason: '' };

/**
 * Bounds the organizer's note before it reaches a player's screen.
 *
 * The server already length-bounds `note` on the way in (MAX_MESSAGE_LEN), so this is
 * not the primary guard — it is the one that holds for a record written before that
 * bound existed, or by any future path that forgets it. A notice is a fixed piece of
 * chrome on a small screen; it must not be able to grow without limit.
 */
const MAX_REASON_CHARS = 300;

/**
 * What to show for `taskId`, given the team document the participant already holds.
 *
 * Takes `unknown` rather than a declared team type on purpose: `taskSubmissions` is
 * written by the server and is not on the shared `RunTeam` interface, so every reader
 * in play-web was casting inline to reach it. The narrowing belongs in ONE total
 * function, not repeated at each call site where a wrong cast would go unnoticed.
 *
 * Total by construction: any malformed team, missing map, absent record or non-string
 * status yields "say nothing". A notice is an interruption, so the failure direction is
 * silence — the opposite of the arrival gate, where the failure direction is to let the
 * player through. Both follow the same rule: fail toward the outcome that cannot strand
 * or mislead someone.
 */
export function submissionVerdict(team: unknown, taskId: unknown): SubmissionVerdict {
  if (!team || typeof team !== 'object') return NONE;
  if (typeof taskId !== 'string' || taskId === '') return NONE;

  const map = (team as VerdictTeam).taskSubmissions;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return NONE;

  const rec = map[taskId];
  if (!rec || typeof rec !== 'object') return NONE;
  if (rec.status !== 'rejected') return NONE;

  const note = typeof rec.reviewNote === 'string' ? rec.reviewNote.trim() : '';
  return { rejected: true, reason: note.slice(0, MAX_REASON_CHARS) };
}
