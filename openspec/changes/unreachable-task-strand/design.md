## Context

`validateUnlockGraph` proves reachability in the TEMPLATE. That proof is sound and stays. What it
cannot prove is reachability in a RUN, because a prerequisite can become permanently unattainable for
one team after the template was validated: the losing member of an exclusive group is marked
`skipped` (`functions/src/runs/index.ts:1036`), and an expired in flight task is marked `skipped`
(`:2809`). `isUnlocked` requires a prerequisite to be **completed**, so a `skipped` prerequisite locks
its dependents forever.

That is the whole bug: reachability is a fact about the run, and it was only ever computed about the
template.

## (a) or (b): the decision

**Both, with (b) as the fix and (a) as the notice.**

(b) alone is correct and sufficient for safety. (a) alone cannot help a single already saved game,
and a save time rule is the wrong instrument here anyway.

The reason (a) does not reject is that this authoring shape is legitimate. "Task `b` unlocks after
`a1`, and `a1` is one of two alternatives" is a branch: teams that chose `a1` get the follow up, teams
that chose `a2` do not. That is a design a creator may want, and with (b) in place it plays exactly
that way. Rejecting it would forbid working content, and the `stage-winnability` lane's own test for
a good Builder time rule ("a creator can look at the panel and reproduce the number") is not the test
that matters here; the creator can reproduce this one, they simply may not have thought about it. So
the Builder warns, naming the task and the prerequisite, and nothing blocks.

This keeps the severity ordering already established in the code: `validateUnlockGraph` errors are
save blocking corruption, `requiredTaskCountProblem` is a promise the game cannot keep, and this is
an advisory. Deliberately NOT added to `validateUnlockGraph().warnings`, because
`apps/creator-web/src/lib/gameReadiness.ts:15` states that unlock graph WARNINGS block a launch
exactly as errors do; folding it in there would refuse to launch every branching game.

## (b) Where the retirement runs

Inside `applyStageCompletion` (`functions/src/runs/helpers.ts`), before it counts anything.

That function is already the documented single source of truth for "a team's active stage just
completed", and both production callers, `completeTaskForTeam` (`runs/index.ts:1044`) and
`sweepExpiredInFlight` (`:2816`), delegate to it. Putting the rule there means the exclusive group
case and the expiry case are both covered by one edit, and no third caller can be added later that
forgets it.

One gap that placement leaves, and the reason for a second call site: a team that is ALREADY stranded
never completes anything again, so `completeTaskForTeam` never runs for it and the helper is never
reached. The retirement therefore also runs in `requestNextTaskInternal`, which is the one thing a
stranded team still does, on the same pattern as the expiry sweep immediately above it: compute the
pure predicate first, and only read the run doc and write the team doc when something is actually
dead. A healthy team pays nothing, and the write self clears (a retired task is no longer
`unassigned`, so the next poll finds nothing). It is skipped entirely while a task is in flight,
because a team holding a task is playing, not stranded.

## Termination and no false skips

`unreachableTaskIds` is a LEAST fixpoint over "can still be completed", seeded with the tasks that
are `completed` (already done) or `assigned` (in the team's hands, so they may still complete), then
growing over `unassigned` tasks whose every prerequisite is already in the set.

- **Termination**: each pass either adds at least one id to a set bounded by the task count, or ends
  the loop. A cycle or a self reference simply never enters the set, so it terminates and reports
  those tasks as dead rather than looping. This does not RELY on `validateUnlockGraph` having
  rejected cycles; it is independently total. `validateUnlockGraph` does reject self references,
  unknown or cross stage ids and cycles as save blocking errors (`gating.ts:115-156`), so in a game
  the server accepted, those arms are unreachable belt and braces.
- **No false skip**: the result contains only tasks that are `unassigned` AND outside the alive set,
  and a task leaves the alive set only when some prerequisite is provably unattainable. A task the
  team completed or is holding is never in the result at all, which is what satisfies "never
  retroactively skip a task a team has already started or completed". Seeding `assigned` as alive is
  the load bearing half of that: it also keeps every DEPENDENT of an in flight task alive, so a task
  is never retired on the assumption that the task above it will fail.
- **Idempotent**: applying the result makes a second call return nothing, so a retry or a replay
  cannot cascade.

## Scoring: exactly the existing automatic skip

A retired task is marked `skipped` and given no award, no `completedAt`, no `bonusPenalty` and no new
field. That matches, character for character, the two automatic skips already in the code: the
exclusive group retire loop (`runs/index.ts:1032-1037`) and the leftover auto skip inside
`applyStageCompletion` (`helpers.ts:43`), both of which set only `status`.

`skipAward` (`packages/shared/src/scoringPresets.ts:215`) is deliberately NOT used. Its only caller is
`skipStage` (`runs/index.ts:1169`), the OWNER's compensating action, where paying for work the team
was told to abandon is the point. An automatic retirement that paid out would hand points to whichever
team happened to author a branch it never played.

Leaderboard parity holds by construction: no scoring input changes, the stage total is still
`Σ tasks[].earnedScore` over the same records, and the retirement is written to the team doc inside
the same server path that already writes it. `buildRankings` is a pure function of the stored team
documents, so `refreshLeaderboard` and `finalizeRun` read the identical state, live and final.

## Test Strategy

RED first, no emulator, two layers.

- **New pure unit lane**: `packages/shared/src/gating.unreachable.test.ts` (vitest). For
  `unreachableTaskIds`: no gates; an empty stage; a gate on a normal task; a gate on the group member
  that WON; a gate on the member that LOST; a chain a to b to c; a diamond where one branch dies and
  the live one survives; a cycle; a self reference; an unknown or cross stage id; a task already
  completed and one in flight (never returned); a dependent of an assigned task; an already skipped
  task; a missing progress entry; independence from `requiredTaskCount`; stage ordering and
  idempotence. For `exclusiveUnlockRisks`: no groups; groups but no gate; the reported shape; a
  transitive chain; an inert one member group; a cycle and a self reference (terminates); a task
  gated on its own alternative.
- **Extended**: `functions/src/runs/helpers.test.ts` — the strand reproduced on
  `applyStageCompletion` and then fixed: the stage ends, the retired task scores 0 and the stage total
  is unchanged, an assigned dependent is NOT retired and does not end the stage, a still playable
  gated task is untouched (byte identical, no mutation), transitive propagation, and
  `requiredTaskCount` already met behaving exactly as before.
- **UI**: covered by the gates (`creator:build`, `lint`, `i18n:check:strict`, `test-no-dashes`). The
  warning renders one line from the same pure function the unit tests pin.
- **Owed to the e2e lane** (reported, not written, that lane owns `scripts/e2e-verify.mjs`):
  a scenario building a stage of `a1`/`a2` in one exclusive group plus `b` gated on `a1` with NO
  `requiredTaskCount`; complete `a2`; assert the team's stage reaches `completed`, that `b`'s record
  is `skipped` with `earnedScore` 0 or absent, that the team advances to the next stage, and that
  `requestNextTask` does not answer `allLocked` forever. Plus the same shape where the team is
  stranded BEFORE the fix path is exercised by a completion, healed by a bare `requestNextTask` poll,
  and a check that the run's live leaderboard and its finalized leaderboard agree on that team's
  score.
