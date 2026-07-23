## Context

`Stage.requiredTaskCount` says "complete N of these M tasks". Several independent features shrink how
many of the M a single team can actually reach, and each one was added with its own local clamp
against `M`. This change derives the real ceiling once and makes every site read it.

## Deriving the formula from the code, not from the report

The reported rule ("ungrouped + number of groups") is correct, but it had to be checked against the
schema, because a group could in principle allow more than one pick. It cannot:

- `ExclusiveTaskGroup = { id, taskIds }` (`packages/shared/src/types/index.ts:457`). There is **no
  cardinality field** — no `pick`, no `max`. "At most one" is hard-coded in the type comment
  (`:447-452`) and in the enforcement.
- `effectiveExclusiveGroups` (`mutualExclusion.ts:41`) normalizes the authored groups: ids not in the
  stage are dropped, an id already claimed by an EARLIER group is dropped (first group wins), and a
  group left with fewer than 2 members is **inert** and claims nothing.
- `resolveExclusions` (`:72`) returns "the rest of my group", and `functions/src/runs/index.ts:1006`
  marks every one of them `skipped` in the same transaction as the winning completion. A second
  member is additionally refused up front (`:889-899`).

So each effective group yields exactly 1 completion, and each task outside every effective group
yields 1. Formula:

```
maxCompletableTasks(stage) = (tasks not in any effective group) + (number of effective groups)
```

which is `tasks.length - Σ|group| + groups.length` — exactly today's `maxAttainableCompletions`
(`:100`). The reported example (0 ungrouped + 3 groups of 2) gives **3**, matching the report.

The normalization makes the awkward inputs fall out for free, and each is pinned by a test:

| Input | Result | Why |
|---|---|---|
| no groups | `tasks.length` | no group claims anything |
| a group with 1 task | that task counts as ungrouped | `< 2` members ⇒ inert, claims nothing (`:54`) |
| an empty group | ignored | same arm |
| a task in two groups | counted once, in the FIRST group | `claimed` set (`:51`); `validateExclusiveGroups` also reports it as an ERROR |
| a group naming a task from another stage | that id ignored | `known` set (`:42`) |
| zero tasks | `0` | empty reduce |

## Static (Builder-time) vs runtime — what is in the number and why

The Builder-time rule must be one a creator can look at the panel and reproduce. That is the test
applied to every candidate:

**IN the static ceiling — exclusive groups.** Authored in the same side panel, rendered on the task
cards as coloured letters, visible in the modal, and constant for the life of the template. A creator
counting groups gets the same number the server does.

**OUT of the static ceiling, IN the runtime form (`opts.isAvailable`) — `Task.status` and
`Run.taskStatusOverrides`.** These are run-scoped operator decisions, deliberately kept off the
template (`liveTaskStatus.ts:15-19`); a template-time number that changed because someone paused a
stop yesterday would be unreproducible. But at pause time they are exactly the question being asked,
so `planTaskStatusChange` passes `isAvailable = isTaskAssignable(task, overrides)` into the same
function. **This is the case that can permanently strand a team**: a paused task is skipped by
routing (`assignNextTask.ts:191`) yet its team record stays `pending`, so `allTerminal`
(`helpers.ts:33`) never fires and the stage has no other exit.

**OUT entirely — `unlockAfterTaskIds`.** A task whose prerequisite chain cannot complete is already
an ERROR, not a count adjustment: `validateUnlockGraph` (`gating.ts:102`) rejects self-references,
unknown/cross-stage ids and cycles as save-blocking, and its reachability fixpoint means that in any
game the server will accept, every task is reachable. Folding it into the number would always add
`0`. (One genuine interaction is NOT fixed here and is reported as a follow-up: a task gated behind a
task that sits in an exclusive group can be permanently unreachable if the team picks the other
member. Computing the best case over that is a search, not an arithmetic ceiling, and it fails the
"a creator can reason about it" test. It is also a strictly different authoring shape from the one
reported.)

**OUT entirely — expiry and scheduled release.** Time-dependent. `validateAvailabilityWindow` already
rejects the one static case (an expiry at or before its release). A ceiling that depends on the wall
clock cannot be a save-time rule.

**OUT entirely — `locationless` and hidden-location.** Neither affects availability. `locationless`
changes routing's transit cost to 0 and its map rendering; every such task is fully completable.
`partialStageStarvationWarning` (`gating.ts:73`) already covers the separate risk it does create.

## Reject or clamp, on the server

**Reject**, with `invalid-argument`, from `stagesProblems`.

Clamping is wrong here for one concrete reason: this is the field whose whole job is to tell the
creator how much of their stage counts. Silently lowering 6 to 3 changes the design of the event
without telling anybody, and a creator who sees "6" in their own Builder while the server stores 3
has no way to discover the difference. Rejecting produces a message the Builder surfaces on save, and
the Builder cannot produce the value anyway once its control is capped — so the rejection only ever
fires against a stale tab, a hand-edited game file, or a direct callable call, all of which should be
loud. Consistent with `validateUnlockGraph`, whose graph errors are already save-blocking there.

`stagesProblems` is deliberately the single edit point: `updateGame` (`games/index.ts:260`) and
`importGameFile` (`:1022`) both call it, which is exactly what its docstring promises.

## The Builder, without a silent clamp

The control is capped at the ceiling, so an impossible value can no longer be authored. A game that
already carries one (saved before this change) is not rewritten behind the creator's back. Instead:

- the existing amber warning (`BuilderPage.tsx:1534`) gains an explicit "set it to N" button, so
  correcting is one click and is the creator's decision;
- the `<Select>` additionally renders the saved out-of-range value as a disabled option so the
  control still shows what is stored rather than jumping to a value nobody chose;
- launch is blocked until it is fixed, via readiness.

## Detecting already-broken saved games

`computeGameReadiness` (`gameReadiness.ts:44`) is already the persistent readiness panel AND the
launch guard (`canLaunchGame`, `firstLaunchBlocker`). Adding the group ceiling to its existing
`stageUnwinnable` code means an already-broken game names its offending stage the moment the creator
opens the Builder, and refuses to launch from the Dashboard too. No migration, no scan, no new
surface: the cheapest possible check, in the place the parent brief guessed it would be.

## Test Strategy

RED first, in the no-emulator lane.

- **New**: `packages/shared/src/mutualExclusion.winnability.test.ts` (vitest) — the ceiling table
  above, plus `requiredTaskCount` undefined (= all tasks, never a violation), zero tasks, and the
  runtime `opts.isAvailable` form including the paused-member-of-a-group case.
- **Extended**: `scripts/test-mutual-exclusion.ts` — the reported 3-groups-of-2 case end to end
  through `validateExclusiveGroups`.
- **Extended**: `apps/creator-web/src/lib/__tests__/builderFirstTaskFlow.test.ts` — readiness reports
  `stageUnwinnable` for the group ceiling, and stays silent when `requiredTaskCount` is unset.
- **Extended**: `functions/src/games/*.test.ts` — `stagesProblems` rejects the impossible count.
- **UI**: verified by the gates (`creator:build`, `lint`, `i18n:check:strict`); the Builder control's
  option list is derived by the same pure function the tests pin.
- **Owed to the e2e lane (reported, not written here)**: an `updateGame` with
  `requiredTaskCount: 6` on a 3-group stage must fail `invalid-argument`, and the same shape via
  `importGameFile`.
