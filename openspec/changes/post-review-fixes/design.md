# Design — post-review-fixes

Six independent defects, one change. Each section states the decision, the alternative that was
rejected, and the test that pins it.

## A. Per uid established signal

**Decision.** Make the check per account rather than fixing the comment. The record it sits beside
(`tourStorageKey(uid)`) is already per uid, and the requirement the signal serves is "a creator who
has used the console before is not interrupted" — a property of the ACCOUNT, not of the browser.
Judging creator B by creator A's history is not a conservative approximation, it is a wrong answer
for the only population the tour exists for.

**Shape.** `knownGameCountKey(uid)` = `` `rp-known-game-count:${uid || 'anon'}` ``, mirroring
`tourStorageKey`. `KNOWN_GAME_COUNT_KEY` keeps its name and value and becomes the prefix, so the
collision assertion in the existing test still means something. The decision itself is a pure
predicate, `isEstablishedCreator(raw)`, so `shouldAutoStartTour` and the thing that computes its
argument are both assertable without a DOM.

**No legacy fallback.** Reading the old global key when the per uid key is missing would reinstate
exactly the bug. The one time cost is that an existing established creator who has never seen the
tour is offered it once; that is the correct outcome, not a regression. `DashboardPage` removes the
legacy global key when it writes the per uid one, so the stale value cannot outlive the fix.

**Skeleton too.** `DashboardSkeleton` reads the same signal to size its placeholder grid, so it
takes the uid as well. One key, one meaning.

## B. `publishesOnShare` consults the current publish state

**Decision.** Add `published?: boolean` to `ShareArtifactInput`;
`publishesOnShare = requiresPublish && !finished && !published`.

**Optional, defaulting to false.** A caller that does not know the publish state gets the warning.
The failure directions are asymmetric: a missing warning silently reveals live standings to every
player, a spurious warning is noise. So absence fails loud, and `RunConsolePage` — which already
renders the publish toggle from `activeRun.leaderboard.published` — supplies the real value.

**Not derived from `status`.** `finished` and `published` are different facts:
`manual-leaderboard-reveal` deliberately leaves a finished run unpublished, and a live run can be
published. Both conditions stay in this one function so the warning and `ensureBoardPublished`
(which already no-ops when published) cannot drift.

## C. The attention verdict decides the inline control

**Decision.** Implement the intent; do not delete the parameter. The change that introduced the
split exists because urgent things were buried, and the console already computes the verdict.

**Rule.** At most one inline control, never a destructive one, every control in exactly one list:

| Row state | inline | overflow |
|---|---|---|
| held by the safe zone latch | `clearTeamOutOfBounds` | `skipTask`, `skipStage`, `adjustTeamScore` |
| `stuck`, not held | `skipTask` | `skipStage`, `adjustTeamScore` |
| otherwise (`ok`, `watch`) | none | all three |

`skipTask` is the remedial action for a team stuck on one mission: it is `cautionary`, not
destructive, it is confirmed, and it is the narrowest of the three. The safety release still wins
the single slot, because a held team cannot be routed anywhere at all until it is cleared.

`watch` deliberately does not promote anything. `watch` means "keep an eye on this", and a console
that promotes a button for every amber row is the flagged table the attention module was written to
avoid.

No rendering change: `RunConsolePage` already renders `inline` and `overflow` generically.

## D. The survey panel names the survey

A panel that reports another panel's failure teaches the operator to distrust the error text. New
`runConsole.surveyError` in both dictionaries; the analytics panels keep `analyticsError`.

## E. `gallery.detailOpen` is wired, not deleted

**Decision.** Wire it. The gallery mission card is a pressable `role="button"` div whose only cue
is the cursor, which is invisible on touch and to anyone reading the card rather than hovering it.
A visible "View details" line is the affordance the string was written for, and the alternative
(deleting the key) would leave the card with no cue at all.

The card keeps its `role="button"` div (it contains the interactive like control, and nested
interactive content inside a `<button>` is invalid HTML). The test stops asserting that the key
exists in the dictionary and starts asserting that the page USES it, which is the property that was
actually missing.

## F. A committed action is never failed by its own audit log

**Decision.** Every audit write at a callable call site is `auditBestEffort`. The record is still
written; a storage failure is logged through `logBestEffort` instead of being thrown at an operator
whose action already committed. For `skipTaskForTeam` that is not a cosmetic difference: the
transaction has committed, so the operator's retry is refused with `That mission is already
completed or skipped` and they are left believing a skip failed that in fact succeeded.

**All three call sites, not two.** `writeAuditLog` has exactly three callers outside its own module
— `skipTaskForTeam`, `adjustTeamScore` and `setRunTaskStatus` — and all three are post commit. A
fix that left one behind would leave the same defect live and no rule to catch the fourth.

**Pinned structurally.** `scripts/lib/callableHardening.mjs` gains `findDirectAuditWrites(text)` and
`AUDIT_WRITER_MODULE`; the guard (C6) fails if any module other than `functions/src/obs/audit.ts`
calls `writeAuditLog` directly. `writeAuditLog` stays exported: it is what `auditBestEffort` wraps,
and a future caller that genuinely must fail loud can be added to the guard as a declared exemption
rather than by accident.

**Not changed:** ordering. The audit write stays after the commit. Writing it inside the
transaction would either need a transactional write to `auditLogs` (coupling the operator's action
to a second collection's availability, which is the failure this fixes) or would log skips that
never happened when the transaction retries.
