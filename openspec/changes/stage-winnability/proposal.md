## Why

A product owner reported a stage they could not finish. The stage held 6 tasks arranged as three
exclusive groups of 2 ("choose one of these two"), and the Builder's task-completion control
(`Stage.requiredTaskCount`) let them require **6 of 6**. A team can only ever complete **3** of those
tasks: completing one member of a group retires the other
(`packages/shared/src/mutualExclusion.ts:72` `resolveExclusions`, enforced at
`functions/src/runs/index.ts:1006`). The control offered a value the game can never satisfy.

The rule that catches this already exists and is already correct:
`maxAttainableCompletions(stage)` (`packages/shared/src/mutualExclusion.ts:100`) returns
`ungrouped tasks + one per effective group`. What is missing is that **nothing enforces it**. It is
read by exactly two places, both purely decorative:

- `apps/creator-web/src/pages/BuilderPage.tsx:1534` — an amber warning line;
- `apps/creator-web/src/components/ExclusiveGroupsModal.tsx:202` — the same warning inside the modal.

Everything that could actually stop the value ignores exclusive groups entirely:

| Site | file:line | What it does today |
|---|---|---|
| The Builder control itself | `BuilderPage.tsx:1816` | offers `1..stage.tasks.length` — it OFFERS 6 |
| Launch readiness / `stageUnwinnable` | `apps/creator-web/src/lib/gameReadiness.ts:76` | derives the code from `validateUnlockGraph` only; groups never consulted, so the game launches |
| Server save validation | `functions/src/games/index.ts:150` `stagesProblems` | `validateUnlockGraph(stage).errors` only. Shared by `updateGame` (`:260`) and `importGameFile` (`:1022`), so BOTH accept it |
| Game-file parse layer | `packages/shared/src/gameFile.ts:691` | unlock graph only |
| Drag/drop re-clamp | `apps/creator-web/src/lib/reorder.ts:137` `clampRequiredTaskCount` | clamps against `taskCount`, not the ceiling |
| Mid-run pause guard | `packages/shared/src/liveTaskStatus.ts:140-151` `planTaskStatusChange` | `requiredCount = min(req, tasks.length)` and `availableAfter` = a raw count of active tasks; a grouped pair counts as 2 |
| Run-time stage completion | `functions/src/runs/helpers.ts:29` `applyStageCompletion` | same clamp, groups not consulted |

`validateExclusiveGroups` (`mutualExclusion.ts:124`) — which already emits exactly the right warning
— has **zero callers** anywhere in the repo.

### One correction to the reported severity, established from the code

With exclusive groups **alone** the team is not permanently stranded. Losing siblings are marked
`skipped` in the same transaction as the winning completion (`functions/src/runs/index.ts:1006-1011`),
so all 6 records reach a terminal state and `applyStageCompletion`'s `allTerminal` arm
(`functions/src/runs/helpers.ts:33`) ends the stage. The damage is that the stage **ends early and
scores far less than the creator designed** — a 6-task stage silently becomes a 3-task stage — and
the creator was shown a control that promised otherwise.

The **permanent** strand is real in the neighbouring case the same rule governs: a `paused`/`closed`
task is filtered out of routing (`assignNextTask.ts:191/308/365`) but its team record stays `pending`
forever, so `allTerminal` never becomes true. `planTaskStatusChange` exists to prevent exactly that,
and it is computing the ceiling with the wrong rule.

## What Changes

**One pure function, `maxCompletableTasks(stage, opts?)`, in `packages/shared/src/mutualExclusion.ts`,
used by every site.** Duplicating this rule is the failure mode; the current bug IS a duplication
failure (two views render the rule, six enforcement points re-derive a weaker one).

- Static form (no `opts`): `ungrouped tasks + number of effective groups`. Identical to today's
  `maxAttainableCompletions`, which becomes a thin alias so no existing caller or test moves.
- Runtime form (`opts.isAvailable`): a group contributes 1 only if at least one member is available;
  an ungrouped task contributes 1 if available. This is what the mid-run pause guard needs.

**Enforced at every site:**

1. **Builder control** (`BuilderPage.tsx`) caps its options at `maxCompletableTasks(stage)` and says
   why it stops there. A game that already holds an impossible value is not silently clamped: the
   existing warning grows an explicit "set it to N" action, so the creator decides.
2. **Launch readiness** (`gameReadiness.ts`) reports `stageUnwinnable` for the group ceiling too, so
   the game cannot be launched from either the Builder panel or the Dashboard.
3. **Server** (`stagesProblems`) rejects `requiredTaskCount > maxCompletableTasks(stage)` — covering
   `updateGame` and `importGameFile` in one place, as that function was built to do.
4. **Drag/drop clamp** (`reorder.ts`) clamps against the ceiling, not the raw task count.
5. **Mid-run pause guard** (`liveTaskStatus.ts`) computes `availableAfter` and `requiredCount`
   through the same function.

**Existing saved games are detectable.** Rule 2 makes every already-broken game surface its stage by
name in the readiness panel the next time the creator opens the Builder, and blocks the launch — so
the creator finds out before an event, not during one.

## Impact

- Affected specs: `stage-winnability` (new capability, ADDED requirements).
- Affected code: `packages/shared/src/mutualExclusion.ts` (+ `mutualExclusion.winnability.test.ts`),
  `packages/shared/src/liveTaskStatus.ts`, `functions/src/games/index.ts` (`stagesProblems`),
  `apps/creator-web/src/lib/gameReadiness.ts`, `apps/creator-web/src/lib/reorder.ts`,
  `apps/creator-web/src/pages/BuilderPage.tsx`, `apps/creator-web/src/i18n.ts` (HE+EN).
- NOT touched: routing (`assignNextTask.ts`), the completion path, the participant sanitizer, any
  authorization rule, `Task.status` semantics, and `scripts/e2e-verify.mjs` (owned by another lane;
  the assertions owed are reported instead).
- No new Builder-editable FIELD: `requiredTaskCount` lives inside `stages`, already declared in
  `BUILDER_EDITABLE_FIELDS` (`apps/creator-web/src/lib/savePayload.ts:29`), so the save-payload
  completeness guard needs no extension.
