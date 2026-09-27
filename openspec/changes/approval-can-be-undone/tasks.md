## 1. Establish the three layers from the code

- [x] 1.1 Confirmed `taskShorthands.ts` builds every bank photo mission with
  `smart.autoApprove: true`, and the bank's own rule 14 says why: "nothing adjudicates
  it mid-play". Its feedback rule counts **61 of 103** missions as auto-approved uploads.
- [x] 1.2 Confirmed the alternative BLOCKS the team — `photoReviewQueue.ts`: "the task is
  not scored, the station slot is not released, and routing has nothing to hand the
  team. They are standing still until an organizer taps a button."
- [x] 1.3 Confirmed `canReject` returned false once approved, and that the transition
  table named the exact blocker: no score clawback path on the server.

## 2. The pure plan — RED

- [x] 2.1 `scripts/test-approval-reversal.ts`: an approved submission reverses and the
  award comes back in full. Run; confirmed RED because the module did not exist.
- [x] 2.2 **Never guess**: every shape of unreadable award reverses NOTHING, and a
  NEGATIVE stored award is refused rather than treated as an instruction to ADD points.
- [x] 2.3 A ZERO award is reversible and is not "unknown" — `time_only` scores every
  task zero, and knowing it was worth nothing is a fact.
- [x] 2.4 Idempotence from every starting status; the zero clamp; an unusable team
  score; totality.
- [x] 2.5 A 5000-case seeded sweep asserting a reversal only ever removes points, never
  below zero, that the delta and next score always agree, and that only an approved row
  can move a score at all.

## 3. The pure plan — GREEN

- [x] 3.1 `packages/shared/src/approvalReversal.ts` + barrel export. 61 assertions green.
- [x] 3.2 `nextStatus` and `canReject` updated in `packages/shared/src/photoQueue.ts`,
  with the old refusal's reasoning REPLACED by what actually changed rather than deleted.

## 4. The three suites that asserted the OLD refusal

Updated with the reason written down, never silently flipped — each of these was a
correct test of a correct decision, and the decision changed.

- [x] 4.1 `scripts/test-photo-approval-queue.ts` — `nextStatus` and `canReject`.
- [x] 4.2 `apps/creator-web/src/lib/__tests__/photoReviewQueue.test.ts` — `decideReview`.
- [x] 4.3 `apps/creator-web/src/lib/photoReviewQueue.ts` — `decideReview` now SENDS a
  reject on an approved row, while approve-after-approve stays a refused no op.

## 5. The server clawback

- [x] 5.1 `findTaskRecordScore` — what the task record was stamped with, returning
  `undefined` when it cannot be found so the planner refuses rather than guesses.
- [x] 5.2 `reviewStationSubmission` reverses inside a TRANSACTION, so a concurrent
  completion cannot interleave between the read and the write.
- [x] 5.3 The award is removed from BOTH `team.score` and the task record's
  `earnedScore` — the live board reads the first and `buildRankings` sums the second,
  and updating one alone would make live and final standings disagree at finalize.
- [x] 5.4 The stages array is rewritten WHOLE, never a dotted update into an array.
- [x] 5.5 The callable reports the outcome and the delta, so the console can say what
  happened instead of the organizer inferring it.

## 6. Gates

- [x] 6.1 `npm run verify` — **301/301 pure-logic unit files green**, i18n PART A and
  PART B clean, every build green. The only red gate is the pre-existing
  `check-marketing-output` failure on the untracked `_kit-b83f9d2e` kit.
- [x] 6.2 `npm run e2e` — **ALL PASS**, exit 0, 121/121 callables covered. No existing
  scenario regressed, which is the claim that mattered: the reversal path only fires on
  an input the suite previously never sent (`approved + reject`), and everything the
  suite DOES send is byte-for-byte unchanged.

## 7. Still to do

- [x] 7.1 **e2e assertions for the reversal itself** (the `newpaths` scenario): the
  team's total falls by exactly the award, the task record is zeroed so live and final
  agree, the submission reads `rejected`, and a second reversal returns
  `alreadyRejected` and moves nothing. NOT asserted, and not claimed: that the team is
  not re-routed, and that `rejected + approve` re-scores - both are older paths this
  change did not touch.
- [x] 7.2 **The audit record.** `reviewStationSubmission` wrote NO record at all, and it
  decides whether a team keeps points, so all three verdicts are now recorded:
  `submission_approved` / `submission_rejected` / `submission_approval_reversed`,
  the last carrying `pointsRemoved` as a positive number plus
  `previousValue: 'approved'`. Written with `auditBestEffort`, AFTER the score movement
  commits - so the record can only ever be missing, never wrong, and a failed audit
  write can never abort the organizer's review.
  The callable also MOVED into `PRIVILEGED_CALLABLES`
  (`scripts/lib/callableHardening.mjs`), out of the deliberately-absent list whose
  reason ("reviewedBy/reviewedAt already answer it") was never quite true - the next
  review overwrites those fields, so a reversal erased its own only evidence. The guard
  now ENFORCES the audit write instead of excusing its absence.
- [x] 7.3 **Console wiring — and this was the finding that mattered.** The reviewed-rows
  button was hardcoded `disabled`, with a comment still asserting "an APPROVED row has no
  server-side score clawback". That was true when written and false since the server
  change: the feature was server-complete and **UI-dead**, delivering nothing. The button
  is now live on an approved row, confirms first (it moves a score), and the toast names
  the points that came off. An already-REJECTED row stays disabled, because re-rejecting
  really is a no op. `TAP_INLINE` was NOT used: it is a fixed 44x44 square, right for a
  glyph and wrong for a text label it would clip.
- [x] 7.4 i18n for the reversal copy, both languages. Also corrected
  `photoReviewRejectDisabled`, whose old text advised "to undo, use a manual score
  adjustment" - obsolete now that the undo exists.

## 8. Follow-ups filed, not built

- [ ] 8.1 Should a reversal offer to re-assign the mission in the same gesture
  (design Open Question 1)?
- [ ] 8.2 Should the bank stop defaulting to auto-approve (design Open Question 2)?
