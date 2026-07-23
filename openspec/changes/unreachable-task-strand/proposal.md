## Why

A team can be permanently stranded inside a stage, with no way out except an owner noticing and
skipping the stage for them by hand.

The shape is a task gated on a task the team can never complete. The `stage-winnability` lane found
it and deliberately deferred it (`openspec/changes/stage-winnability/design.md`, the
"OUT entirely" note on `unlockAfterTaskIds`), because deciding it is a search over which alternative
the team picked rather than the arithmetic ceiling that lane was building.

### The mechanism, confirmed end to end

1. A stage holds two alternatives `a1`/`a2` in an exclusive group, and a task `b` carrying
   `unlockAfterTaskIds: ['a1']`.
2. `validateUnlockGraph` (`packages/shared/src/gating.ts:102`) accepts this: `a1` exists, is in the
   same stage, and the graph is acyclic. Its reachability fixpoint proves `b` is reachable in the
   TEMPLATE, which is true.
3. The team completes `a2`. `resolveExclusions` (`packages/shared/src/mutualExclusion.ts:72`) names
   `a1` as the losing sibling, and `functions/src/runs/index.ts:1032-1037` marks it `skipped`.
4. `isUnlocked` (`gating.ts:24`) requires every prerequisite to be **completed**. `a1` is `skipped`,
   never completed, so `b` is locked forever. Routing filters it out
   (`functions/src/routing/assignNextTask.ts`, reason `allLocked`); `completeTaskForTeam` refuses it
   (`runs/index.ts:872`).
5. Nothing else ever touches `b`, so its record stays `unassigned`. `applyStageCompletion`
   (`functions/src/runs/helpers.ts:33`) ends a stage on `completedCount >= required || allTerminal`.
   `b` keeps `allTerminal` false, and no further completion is possible, so `completedCount` is
   frozen too. The stage never ends.

**Skipped does NOT propagate to dependents anywhere.** The only writers of `skipped` are the
exclusive-group retire loop (`runs/index.ts:1036`), the leftover auto-skip inside
`applyStageCompletion` (`helpers.ts:43`), the expiry sweep (`runs/index.ts:2809`) and `skipStage`
(`runs/index.ts:1170`). Not one of them looks at `unlockAfterTaskIds`. The bug is real, and a RED
unit test on `applyStageCompletion` reproduces it with no emulator.

### When it is reachable in practice

The strand needs `completedCount < required` to be frozen while a task stays non terminal. With the
`a1`/`a2`/`b` stage above, a team that picks `a2` reaches exactly one completion:

| `requiredTaskCount` | Outcome |
|---|---|
| unset (means every task, so 3) | **STRANDED** |
| 2 (the ceiling `maxCompletableTasks` allows) | **STRANDED** |
| 1 | masked: the stage ends on the completion itself and `b` is auto skipped as a leftover |

So `requiredTaskCount` masks it only when it is at or below what the chosen branch yields, and the
**default authoring (no explicit count) is the stranding case**. This is not an exotic shape: it is
what a creator writes for "if you chose the museum, then do the museum follow up".

One correction to the reported severity: an owner CAN unstick a team, with `skipStage` from the run
console, which skips every pending task of that team's active stage with a `skipAward`. It requires
the owner to notice a single team frozen mid event, and it pays out points the team did not earn.

## What Changes

**(b) Runtime resolution, the fix that matters.** `applyStageCompletion` retires the tasks a team can
never complete before it counts. It is the single source of truth both `completeTaskForTeam` and
`sweepExpiredInFlight` already delegate to, so both paths inherit the rule for free, and it needs no
creator action, which is the only thing that can help the games already saved.

A stranded team by definition completes nothing more, so `completeTaskForTeam` never runs for it. The
same retirement therefore also runs on the one thing a stranded team still does: its
`requestNextTask` poll. Guarded by the pure check, so a healthy team performs no extra read and no
write, and self clearing.

**(a) Build time warning, advisory only.** The Builder tells the creator, while authoring, that a task
is gated on one alternative of a group and will not be played by teams that pick the other.

**Why (a) warns and does not reject.** The `stage-winnability` lane rejects an unreachable
`requiredTaskCount` because that value is a promise the game can never keep. This shape is different:
it is a branch, and branching content is a design a creator may genuinely want. Once (b) retires the
dead branch cleanly, the game plays correctly, so refusing to save it would forbid a working design.
The creator still needs to KNOW, because a task they expected everyone to play is now reachable by
only part of the field.

**The search, without enumerating choices.** If the transitive prerequisite chain of a task contains
ANY member of an effective exclusive group, then choosing a different member of that group retires
that chain and the task dies. So the "which member did the team pick" search collapses to a
prerequisite closure per task, with no enumeration of choices at all.

## Impact

- Affected specs: `unreachable-task-strand` (new capability, ADDED requirements).
- Affected code: `packages/shared/src/gating.ts` (`unreachableTaskIds`, `exclusiveUnlockRisks`,
  + `gating.unreachable.test.ts`), `functions/src/runs/helpers.ts` (+ `helpers.test.ts`),
  `functions/src/runs/index.ts` (the `requestNextTask` heal only),
  `apps/creator-web/src/pages/BuilderPage.tsx`, `apps/creator-web/src/i18n.ts` (HE + EN, additive).
- NOT touched: scoring (a retired task scores as the existing automatic skip does, which is nothing),
  `buildRankings`, the participant sanitizer, any authorization rule, `stagesProblems`,
  `gameReadiness` (deliberately: this is not a launch blocker), and `scripts/e2e-verify.mjs` (owned by
  another lane, the assertions owed are reported instead).
