# Design — skip-single-task

## 0. Current behaviour (what we are adding to)

| Path | Scope | Effect |
|---|---|---|
| `skipStage` (`functions/src/runs/index.ts:1131`) | one TEAM, whole active STAGE | every non completed task → `skipped` with `skipAward`, stage completed, next stage unlocked, held slots released, leaderboard force refreshed |
| `setRunTaskStatus` (`functions/src/index.ts:1426`) | whole RUN, one TASK | `run.taskStatusOverrides[taskId]`, read by routing filters only; a team already holding the task keeps it |
| `applyStageCompletion` (`functions/src/runs/helpers.ts:20`) | one team, one stage | THE single definition of "this stage just ended": `requiredTaskCount`, leftover auto skip, unreachable task retirement, final stage detection, gated next stage unlock |

Nothing sits at "one team, one task". That is the whole change.

## 1. Files to touch

- `packages/shared/src/taskSkip.ts` — **new, pure**: `planTaskSkip()`, the whole decision.
- `packages/shared/src/index.ts` — export the new module from the barrel.
- `functions/src/auth.ts` — `assertStaffOrOwner` moves here from `functions/src/index.ts` so the runs
  domain can reach it without importing the root module (see D5).
- `functions/src/index.ts` — drop the local `assertStaffOrOwner` definition, import it, re export
  `skipTaskForTeam` from `./runs/index`.
- `functions/src/runs/index.ts` — the `skipTaskForTeam` callable.
- `apps/creator-web/src/services/calls.ts` — typed wrapper.
- `apps/creator-web/src/lib/runConsoleActions.ts` — classify the new control (`skipTask`).
- `apps/creator-web/src/pages/RunConsolePage.tsx` — one button on the team row.
- `apps/creator-web/src/i18n.ts` — HE + EN copy.
- `scripts/lib/callableHardening.mjs` — declare `skipTaskForTeam` as privileged.
- `scripts/e2e-verify.mjs` — new scenario + denial matrix rows.
- `scripts/test-skip-single-task.ts` — the pure lane (new).

## 2. The pure decision — `planTaskSkip()`

Everything the callable has to decide, except "who is allowed to call it", is a function of three
values it can read from state it already loads:

1. the **game stage** (task ids + `exclusiveGroups`) — the authoring shape `ExclusionStage` already
   consumed by `maxCompletableTasks`,
2. the team's **per task statuses** in that stage record,
3. the team's stored **`requiredTaskCount`** for that stage record.

```ts
planTaskSkip({ stage, statusByTaskId, requiredTaskCount }, taskId) -> SkipTaskPlan
```

```ts
interface SkipTaskPlan {
  ok: boolean;
  reason?: 'taskNotInStage' | 'taskAlreadyTerminal';
  taskId: string;
  heldSlot: boolean;            // the record was 'assigned' → release a station slot
  completedCount: number;       // completions ALREADY banked in this stage
  attainableAfter: number;      // the ceiling on completions once this task is gone
  requiredTaskCount: number;    // the team's requirement AFTER the skip (always a number)
  requirementLowered: boolean;  // true when the skip forced the requirement down
  stageCompletes: boolean;      // the skip alone ends the stage
  remainingTaskIds: string[];   // still playable tasks in this stage, stage order
}
```

**D1 — the requirement is lowered, never left unreachable.** `applyStageCompletion` ends a stage on
`completedCount >= required || allTerminal`. Skipping one task of a "3 of 3" stage satisfies neither:
the team plays the other two and then sits in a stage that can never end, for the rest of the event.
The plan therefore recomputes the ceiling **after** the skip and lowers the stored requirement to it:

```
attainableAfter = maxCompletableTasks(stage, { isAvailable: id => statusAfter[id] !== 'skipped' })
requiredTaskCount = min(currentRequired ?? stage.tasks.length, attainableAfter)
```

`maxCompletableTasks` is the one definition of that ceiling in the repo (Builder control, launch
readiness, server save/import validation, live pause guard), so a skip cannot disagree with any of
them. A completed task stays "available" for this purpose, so a group that already yielded its one
completion still contributes exactly 1, and an ungrouped completed task still counts itself.

Worked cases:

| Stage | Required | Skip | attainableAfter | New required | Stage ends? |
|---|---|---|---|---|---|
| A B C ungrouped | 3 | A | 2 | 2 | no, B and C still to play |
| A B C ungrouped | 2 | A | 2 | 2 | no |
| A B C, 1 done | 2 | B | 2 | 2 | no, C left |
| A B C, 2 done | 2 | C | 3 | 2 | yes, already at the requirement |
| {A,B} group + C | 2 | A | 2 (group via B, plus C) | 2 | no |
| {A,B} group + C | 2 | A then B | 1 (C only) | 1 | when C is done |
| A only | unset (=1) | A | 0 | 0 | yes, nothing left |

**D2 — the requirement is written on the TEAM's stage record, never on the template.**
`RunStageRecord.requiredTaskCount` (`packages/shared/src/types/index.ts:838`) is copied per run per
team at build time precisely so the run is self contained. Lowering it there affects that one team.
Writing it on `Game.stages[].requiredTaskCount` would leak into every later run, every duplicate,
every export, and would be clobbered by the next Builder save. Same rule as `Run.taskStatusOverrides`
in the live pause change.

**D3 — zero award, deliberately.** `skipStage` pays `skipAward(preset, task)` because it is
compensating a team for a whole stage the organiser took away. A single mission skip is not that: the
task is removed from the team's route and pays nothing (`earnedScore: 0`). It matches the leftover
auto skip in `applyStageCompletion` and the exclusive group losers, both of which score nothing. An
organiser who wants to compensate has `adjustTeamScore`, which is audited on its own.

**D4 — no clock is touched.** The record keeps its `startedAt`; `completedAt` is stamped so the
console can say when the skip happened, `excludedMs` is never written (only a completion stamps it,
and `buildRankings` sums the stamps). Nothing in `buildRankings` reads a `skipped` record other than
its `earnedScore`, and `completedStages` counts stage records, not task records. So the live board and
the final board see the same stored facts, which is the parity rule.

## 3. The callable

```
skipTaskForTeam({ ownerUid?, gameId, runId, teamId, taskId?, reason? })
  -> { ok, taskId, stageCompleted, requiredTaskCount, requirementLowered, nextTaskId, nextReason }
```

Order of operations:

1. `assertStaffOrOwner(context, ownerUid ?? context.auth.uid, runId)` — owner, platform admin, or
   staff whose token is scoped to THIS run. No emulator bypass (there is none in this repo).
2. Validate the ids; read the run and the game. A **finished** run is refused
   (`failed-precondition`), same as every other post finalize grading path.
3. **One transaction on the team document**:
   - the team's active stage record, else `failed-precondition: no active stage`;
   - resolve the target: the given `taskId`, else `team.activeTaskId`, else the single `assigned`
     record in the active stage; none of those ⇒ `failed-precondition: no task in flight`;
   - `planTaskSkip(...)`; a not ok plan ⇒ `failed-precondition` / `not-found` with the reason;
   - stamp the record `skipped`, `earnedScore: 0`, `completedAt: now`;
   - write `stages[idx].requiredTaskCount = plan.requiredTaskCount`;
   - call `applyStageCompletion(stages, idx, game, launchedAt, now)` — the SAME helper the completion
     path uses, so the stage ends by exactly one rule, leftovers auto skip by exactly one rule, and
     the next stage unlocks (or stays release gated) by exactly one rule;
   - whole array rewrite of `stages` (never a dotted update into an array), plus
     `activeTaskId: null`, `status/finishedAt` when everything is done, `updatedAt`.
4. After the commit: `releaseTask` for the skipped task if it held a slot, and for every leftover
   `applyStageCompletion` auto skipped while assigned. Guarded at zero inside `releaseTask`, so a
   double call cannot drive the counter negative.
5. `assignNextInActiveStage(...)` to hand the team its next mission immediately, with a `{lat:0,lng:0}`
   team location (the console has no GPS for the team; routing degrades to load only, and the very
   next participant poll re routes with real coordinates). Best effort: a routing failure must not
   fail a skip that already committed.
6. `writeAuditLog({ actionType: 'task_skipped', ... })` and a forced
   `maybeRefreshLeaderboardSnapshot`, exactly like `adjustTeamScore` / `skipStage`.

**D5 — `assertStaffOrOwner` moves to `functions/src/auth.ts`.** It is currently a private function in
`functions/src/index.ts`, and `runs/index.ts` cannot import it from there (`index.ts` imports
`runs/index.ts`, so that is a cycle). The alternatives were: duplicate it in the runs module, which is
precisely what `auth.ts` was created to stop (its own header says the entry point must not drift), or
put the callable in the root module, which would leave the run domain's logic outside the run domain.
Moving the definition and importing it from both places keeps ONE gate. The static hardening guard
already accepts `assertStaffOrOwner` as an auth marker, so the move is invisible to it.

**D6 — `taskId` is optional.** The console's team row does not carry `activeTaskId` (it is not in
`RunTeamRow`), and widening that projection would collide with the Run Console restructure landing in
parallel. An absent `taskId` means "the mission this team is on right now", resolved server side from
`activeTaskId`, with the in flight record as a fallback for a team whose `activeTaskId` is stale. A
future console that knows the task id can pass it explicitly and skip a queued task too.

## 4. Test strategy (proof, up front)

**Pure lane, first and failing** — `scripts/test-skip-single-task.ts`, run with
`npx tsx scripts/test-skip-single-task.ts`, auto discovered by `scripts/run-unit-tests.mjs`:

- every row of the D1 table, value by value;
- an unknown task id ⇒ `taskNotInStage`; an already completed or already skipped record ⇒
  `taskAlreadyTerminal`; both with `ok:false` and no mutation of the input;
- `heldSlot` true only for an `assigned` record;
- an unset `requiredTaskCount` behaves as "all tasks" and still lowers correctly;
- exclusive groups: skipping one alternative keeps the group's contribution at 1, skipping all of
  them drops it to 0;
- `remainingTaskIds` excludes completed, skipped and the just skipped task, and keeps stage order;
- garbage in (no tasks array, null groups, a `requiredTaskCount` of `NaN` / negative / above the task
  count) never yields `NaN`, never a negative requirement, never throws;
- the plan is a total function: it never mutates `statusByTaskId` or the stage.

**Callable lane** — `scripts/e2e-verify.mjs`, new scenario
`single task skip (one mission, same stage, no stage jump)` plus denial matrix rows. The exact
assertions are listed in `tasks.md` task 8, and they include the negative that motivates the change:
after skipping one task of a multi task stage the team's stage is still `active` and its remaining
tasks are still playable, which is precisely what `skipStage` would have destroyed.

**UI** — one button, both languages, verified by `npx tsx scripts/check-i18n.ts --strict` (zero new
PART B findings) and the preview tools.

## 5. Risks

- **Concurrency**: a participant completing the same task at the same moment. The skip reads and
  writes the team document inside one transaction, so one of the two wins; if the completion wins, the
  record is `completed` and the plan refuses (`taskAlreadyTerminal`) instead of overwriting a scored
  completion. The station slot is released once, by whichever path committed.
- **Slot leak** if `releaseTask` is called for a task that never held a slot: impossible, the plan
  reports `heldSlot` only for an `assigned` record, and `releaseTask` is itself guarded at zero.
- **Requirement lowering is one way**: nothing raises it back. Acceptable, the alternative is a team
  stranded in a stage that can no longer end.
