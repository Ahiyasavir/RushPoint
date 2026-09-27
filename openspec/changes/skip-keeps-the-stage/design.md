## Context

| Reader of "is this prerequisite satisfied?" | Today reads | File |
|---|---|---|
| Routing candidates | `completedTaskIds` for BOTH "already done" and `isUnlocked` | `functions/src/routing/assignNextTask.ts:205,214,325,387,455` |
| Completion path refusal | `completedTaskIds` | `functions/src/runs/index.ts:1191-1195` |
| `forceAssignTask` | `completedTaskIds` | `runs/index.ts:2106` |
| getMyTeamState `lockedTaskIds` | `completedTaskIds` | `runs/index.ts:5956` |
| Stranded-team sweep | `unreachableTaskIds` | `runs/index.ts:4536` |
| Stage completion | `unreachableTaskIds` | `runs/helpers.ts:59` |
| Participant locked list | `completed` records | `apps/play-web/src/screens/PlayScreen.tsx:1252-1259` |

Writers of `status = 'skipped'` (all five must stamp a cause):

| Writer | Meaning | `skipCause` |
|---|---|---|
| `skipTaskForTeam` (`runs/index.ts:1745`) | organizer/staff removed ONE obstacle | `operator` |
| `skipStage` (`runs/index.ts:1567`) | organizer ended the stage | `operatorStage` |
| exclusive-group retire (`runs/index.ts:1407`) | the team chose another alternative | `exclusive` |
| expiry (`runs/index.ts:4359`) | the task's time window closed mid-work | `expired` |
| `applyStageCompletion` retirement (`helpers.ts:63`) | unreachable | `unreachable` |
| `applyStageCompletion` leftover (`helpers.ts:87`) | stage already satisfied | `stageSatisfied` |

## Decisions

### D1: the rule, stated once

```ts
// packages/shared/src/gating.ts
export function satisfiesGate(rec: { status?: unknown; skipCause?: unknown }): boolean {
  return rec?.status === 'completed' || (rec?.status === 'skipped' && rec?.skipCause === 'operator');
}
export function gateSatisfiedTaskIds(stages: readonly { tasks?: readonly RecLike[] }[]): string[]
```

Only an operator skip of a single mission opens its dependents. Rationale per cause:
- `operator`: the organizer's intent is "let them past this". This is the reported case.
- `exclusive`: an author who writes "B after A1" in an either/or group means "B only on the A1
  path". Opening B would change the authored game. (This is exactly the case `unreachable-task-strand`
  was built for, and it keeps working.)
- `expired`: a time window on a stop is a rule of that stop; a chain behind it ("find the key in 10
  minutes, then open the chest") is authored intent. Unchanged.
- `operatorStage`, `stageSatisfied`, `unreachable`: the stage is over or the task is already dead;
  the question never arises.
- **Legacy `skipped` with no cause: NOT satisfied** (today's behaviour). Records written before
  deploy keep their meaning; a team hurt before deploy is repaired with `send-team-back`.

Alternative considered: "every skipped prerequisite opens its dependents". Rejected, it silently
re-authors every exclusive-group game.

### D2: the two lists are separate

Routing keeps `completedTaskIds` for "already done, do not hand out" and gets
`gateSatisfiedTaskIds` for `isUnlocked`. Widening the single list would have made a skipped task
look "done" to the exclusion at `assignNextTask.ts:205`; harmless today (skipped records are not
candidates) but a coupling that should not exist. `isUnlocked`'s parameter is renamed
`satisfiedTaskIds` so the next caller cannot pass the wrong list by habit.

### D3: `unreachableTaskIds` seeds `alive` from `satisfiesGate`

`alive` starts as `assigned ∪ {records where satisfiesGate}`. The fixpoint is unchanged. With the
reported chain, skipping `f13163ca` (cause `operator`) leaves it alive for gating, so `2b83fd50`
and `c42b88d4` are reachable and are not retired.

### D4: `planTaskSkip` reports what opens

`planTaskSkip` gains `dependentsOpened: string[]` (tasks whose every prerequisite becomes satisfied
by this skip and that are still unassigned) and its `stageCompletes` is computed AFTER applying D3,
so the preview and the write agree. `attainableAfter` already ignores gates; unchanged.

### D5: `dryRun` on `skipTaskForTeam`

`dryRun: true` runs the same transaction body up to the plan and returns
`{ taskId, taskTitle, dependentsOpened (titles), stageCompletes, requirementLowered, consolation }`
without writing, auditing or rate-limit charging beyond the normal read. Both consoles call it
when the operator opens the confirm, and the dialog says, in words, what will happen. If the dry
run fails (network), the dialog falls back to today's generic copy: a preview must never block the
action.

### D6: participant locked list

`LockedTasksList` uses `gateSatisfiedTaskIds` so a mission opened by a skip does not keep saying
"after completing X". `skipCause` is added to the participant sanitizer's per-record allow-list
(not secret: it is an operational fact about their own team). **Update `ALLOWED_*` in
`scripts/e2e-verify.mjs` if the record allow-list is asserted there.**

## Risks

- A deployed server with an old client: the client's locked list lags one release; the server is
  the authority. Acceptable.
- Mid-run deploy: in-flight teams keep legacy skips (D1). Stated in the release note.

## Test strategy

- Pure (`scripts/test-gate-satisfaction.ts`): `satisfiesGate` per cause and for garbage;
  `unreachableTaskIds` on the production chain (skip head → nothing retired; exclusive loss of the
  head → dependents retired, as today); legacy skipped without cause → retired, as today.
- `scripts/test-skip-single-task.ts`: new rows for `dependentsOpened` and the corrected
  `stageCompletes` on a chain.
- Vitest on `applyStageCompletion` (`functions/src/runs/helpers.test.ts` or a new file): the
  2026-09-22 chain, skip the head → stage still active, the two dependents `unassigned`.
- e2e (`scripts/e2e-verify.mjs`, new scenario "skip keeps a chained stage"): build the exact
  three-task chain, assign the head, `skipTaskForTeam` → stage active; `requestNextTask` hands out
  `2b83fd50`; `dryRun` returns `stageCompletes: false` and `dependentsOpened` of length 1 and writes
  nothing (read the team doc before/after). Plus the regression that already exists for the
  exclusive-group strand must stay green.
- UI via preview: the confirm dialog in the creator console names the opened mission.
