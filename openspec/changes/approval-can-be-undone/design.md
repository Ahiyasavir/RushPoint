## Context

Three code sites compose into the reported behaviour:

- `apps/creator-web/src/taskShorthands.ts` builds every bank photo mission with
  `smart: { autoApprove: true }`.
- `functions/src/index.ts` `submitStationPhoto` scores an auto-approved submission
  immediately via `completeTaskForTeam`.
- `packages/shared/src/photoQueue.ts` `canReject` returned `false` once approved, and
  the transition table explained why: *"the server has no score clawback path, so
  'rejecting' an approved task would flip a status string while the points silently
  stay. Use the manual adjustTeamScore instead."*

The refusal was correct given the premise. This change removes the premise.

## Goals / Non-Goals

**Goals:** an approved submission can be rejected; the award comes back with it; it is
audited; the team is not sent backwards.

**Non-Goals:** judging photo quality, changing what the bank defaults to, automatic
image checking, reversing non-media submissions, un-finishing a run. See `proposal.md`.

## Decisions

### D1 — Never guess at an amount

`planApprovalReversal` refuses to act when the award cannot be read: an absent,
non-finite or **negative** stored `earnedScore` yields `unknownAward` and moves nothing.

Subtracting a plausible-looking number from a live scoreboard is worse than declining,
because the organizer would have no way to discover it happened. A negative stored value
is corrupt data, not an instruction to ADD points.

**A zero award is reversible and is NOT "unknown".** A `time_only` game scores every
task zero, and "I know it was worth nothing" is a fact rather than a gap.

### D2 — Remove it from BOTH places, or the boards diverge

The reversal zeroes `earnedScore` on the task record **and** lowers `team.score`.

CLAUDE.md's live/final parity rule is why: the live board reads `team.score`, while
`buildRankings` sums the stored `RunTaskRecord`s. Updating one and not the other would
produce a run whose live standings and final standings disagree — a harder bug than the
one being fixed, and one that would only surface at finalize.

The delta is derived FROM the clamped result (`nextTeamScore - teamScore`) rather than
computed separately, so the two can never disagree even at the zero clamp.

### D3 — Clamp at zero

A team whose award exceeds their current total means the score already moved for some
other reason. Driving a leaderboard negative turns one bad submission into a nonsensical
scoreboard.

### D4 — A transaction, because this moves a score

The clawback reads the team, decides, and writes inside `db.runTransaction`, so a
concurrent completion cannot interleave between the read and the write. The stages array
is rewritten whole — never a dotted update into an array, per CLAUDE.md.

### D5 — The team is not sent backwards

The mission stays completed. The team is not re-routed and a finished run is not
reopened. Putting a team back onto a mission they have walked away from is a separate,
riskier act with its own failure modes, and `forceAssignTask` already exists for an
organizer who genuinely wants it.

### D6 — `canReject` stays a function

It now returns `true` for every status, which makes it look deletable. It is kept
because it is the ONE place this policy is stated: a future status (expired, withdrawn)
should answer here rather than at four call sites.

`approve`-after-approve remains refused — it is a genuine no op (the server returns
`completed: false`, so no second score and no duplicate feed item) and sending it would
be a round trip that changes nothing.

## Test Strategy

**Pure — `npm test`:**

- `scripts/test-approval-reversal.ts` (61 assertions): the motivating case; every shape
  of unreadable award reversing NOTHING; a negative award refused rather than added; a
  zero award reversible; idempotence from every starting status; the zero clamp; an
  unusable team score; totality; the transition table's new edge; and a 5000-case sweep
  asserting **a reversal only ever removes points, never below zero, the delta and the
  next score always agree, and only an approved row may move a score at all**.
- Three EXISTING suites asserted the old refusal and were updated with the reason
  written down, not silently flipped: `scripts/test-photo-approval-queue.ts` and
  `apps/creator-web/src/lib/__tests__/photoReviewQueue.test.ts`.

**e2e — `npm run e2e`:** this moves a score, so the whole suite must stay green, and the
reversal needs its own assertions: the team's total falls by exactly the award, the task
record is zeroed, a second reversal takes nothing further, and the team is not
re-routed.

## Risks / Trade-offs

- **[An organizer reverses the wrong row]** → it is audited and the award is recoverable
  by approving again, which the table still allows (`rejected + approve` → `approved`,
  which re-scores because `completeTaskForTeam` never ran for it). Worth verifying in
  e2e rather than assuming.
- **[A finished run's standings change]** → possible, and intended: that is what
  "reverse a wrong approval" means. `finalizeRun` stamps its own rankings, so a run
  already finalized is unaffected; one merely *finished* is not.
- **[Two reviewers racing]** → the transaction plus the `alreadyRejected` outcome make
  the second a no op.
- **[The consoles ship before the server]** → safe. The control simply sends a reject
  the old server still refuses, exactly as today.

## Migration Plan

Land, `npm run verify` and `npm run e2e` green. Ship the server by VPS rebuild and the
consoles by `deploy:hosting`; consoles-first is safe per the last risk.

**Rollback:** revert. Nothing stored changes shape; a reversal that already happened
stays applied, which is correct — it was a deliberate organizer action.

## Open Questions

1. **Should a reversal offer to re-assign the mission?** Sometimes "that photo does not
   count" should mean "go and do it properly". `forceAssignTask` exists; whether the
   reversal should offer it in the same gesture is a console question.
2. **Should the bank stop defaulting to auto-approve?** A content decision across 61
   missions, and it interacts with the run-wide toggle from `late-joiner-autostart`.
   Named in the non-goals for a reason.
