# Wave B — Task 5: mutually exclusive task groups (stage level)

Status: pure logic + Builder UI DONE. Backend enforcement = PATCH SPEC ONLY (see §5),
because `functions/src/runs/index.ts` is owned by another agent this wave.

## 1. Proposal (what & why)

A creator often authors several *variants of the same challenge* inside one stage
("photo at the fountain" / "quiz about the fountain" / "code at the fountain").
Today nothing stops a team from farming every variant and banking three scores for
one real-world action. `Stage.exclusiveGroups` lets the creator declare
"at most ONE of these" sets. Completing any member of a group locks the rest **for
that team** — they become `skipped` (not failed, no penalty), exactly like the
leftovers of a partial stage.

Schema (already committed by the orchestrator, `packages/shared/src/types/index.ts`
L428-442):

```ts
Stage.exclusiveGroups?: ExclusiveTaskGroup[];
interface ExclusiveTaskGroup { id: string; taskIds: string[] }
```

Semantics fixed by the doc comment on the schema:
- scoped to ONE stage; ids not present in `stage.tasks` are **ignored** (inert);
- a group of `< 2` effective ids is **inert**;
- a task may appear in **at most one** group;
- completing a member ⇒ the other members are **skipped**, not failed.

## 2. Design

### 2.1 Pure module — `packages/shared/src/mutualExclusion.ts`

Single source of truth shared by (a) the Builder validator/UI, (b) the future
routing candidate filter, and (c) the `completeTaskForTeam` enforcement patch, so
the three can never drift (the same pattern as `gating.ts` for unlockable tasks).

| export | contract |
|---|---|
| `effectiveExclusiveGroups(stage)` | normalized `string[][]`: per group keep only ids present in `stage.tasks`, dedupe, drop an id already claimed by an EARLIER group (first group wins), then drop groups with `< 2` ids. Every other helper is defined on top of this, so "inert" is expressed once. |
| `exclusiveGroupOf(stage, taskId)` | the normalized group containing `taskId`, or `null`. |
| `resolveExclusions(stage, completedTaskId)` | sibling ids to auto-skip when `completedTaskId` is completed (group members minus itself), in stage task order. `[]` when ungrouped. |
| `blockedTaskIds(stage, completedTaskIds)` | ids locked for a team given what it already completed: every sibling of every completed grouped task, minus anything in `completedTaskIds` itself. Stage order, deduped. |
| `maxAttainableCompletions(stage)` | ungrouped tasks + 1 per group — the ceiling on how many tasks ONE team can ever complete in this stage. |
| `validateExclusiveGroups(stage)` | `{ errors, warnings }`, same shape/severity convention as `validateUnlockGraph`. |

Severity convention (deliberately mirrors `validateUnlockGraph`):
- **errors** (structural corruption a creator must fix): a task id listed in two
  different groups; a duplicated `group.id`; a group listing the same task twice.
- **warnings** (inert / advisory, never block a save): unknown (out of stage) ids;
  a group left with `< 2` effective ids; `requiredTaskCount > maxAttainableCompletions`.

`blockedTaskIds` is intentionally **stateless about ordering**: it derives the lock
set from the completed set, so it is idempotent and replay safe — a team that
somehow has two members of a group completed (only reachable via a pre existing
run authored before the groups) still gets a deterministic answer.

### 2.2 Interaction with `Stage.requiredTaskCount` (the dangerous part)

`requiredTaskCount = N` means "complete N of M tasks". Exclusive groups lower the
ceiling on completable tasks to

```
maxAttainable = (tasks not in any effective group) + (number of effective groups)
```

If `N > maxAttainable` the creator's intent is unsatisfiable: the team can never
reach N completions. Concretely, 4 tasks in 2 groups of 2 with `requiredTaskCount = 3`
⇒ ceiling 2.

What actually happens in the run today (`functions/src/runs/helpers.ts`
`applyStageCompletion` L28-34): stage completion is
`completedCount >= required || allTerminal`. Once the exclusivity skip marks every
locked sibling `skipped`, **`allTerminal` becomes true and the stage completes
anyway** — so the team is *not* hard stranded, but it silently finishes the stage
with fewer completions (and less score) than the creator asked for. That makes it a
**warning, not an error**:

- it is safe *only because* the enforcement patch marks siblings `skipped` in the
  SAME transaction as the completion (§5). An implementation that merely refused
  the sibling completion without skipping it WOULD strand the team: `completedCount`
  stuck at 2 < 3 and `allTerminal` false forever. This is the single most important
  constraint on the backend patch;
- the Builder therefore warns (`b.exclusiveUnwinnableWarn`) so the creator fixes the
  count instead of shipping a stage that ends early.

`maxAttainableCompletions` is also the right ceiling to feed a future
`validateUnlockGraph`-style server check; it composes with `unlockAfterTaskIds`
reachability by intersection (out of scope here, noted for the orchestrator).

### 2.3 Builder UI

`BuilderPage` stage header, immediately after the compact stage-rules strip
(wave-a task 6 layout idiom kept: one bordered `--surface-2/40` row, `text-xs`,
`gap-x/gap-y`, logical spacing only so RTL stays correct). Rendered only when the
stage has more than one task. Per group: a label, a chip per stage task that
toggles membership (a chip already claimed by another group is disabled with a
tooltip), and an ✕ to delete the group. Plus the amber unwinnable warning line,
next to the two existing amber warnings.

## 3. Tests (TDD)

`scripts/test-mutual-exclusion.ts` (tsx assertion script, auto-discovered by
`scripts/run-unit-tests.mjs`), importing `../packages/shared/src/mutualExclusion`
**source** (never the shared `dist`, which concurrent agents share).

RED first: the script was written and run before the module existed and failed with
`Cannot find module .../mutualExclusion` — see §6 for the transcript. GREEN after
the module landed: 34/34 assertions pass.

## 4. Files

- NEW `packages/shared/src/mutualExclusion.ts`
- `packages/shared/src/index.ts` — one `export * from './mutualExclusion';` line
- NEW `scripts/test-mutual-exclusion.ts`
- `apps/creator-web/src/pages/BuilderPage.tsx` — group editor + warning
- `apps/creator-web/src/i18n.ts` — `b.exclusive*` keys (HE + EN)

## 5. PATCH SPEC for `functions/src/runs/index.ts` (orchestrator to apply — NOT applied here)

Everything below lands **inside the existing `withLockRetry(db.runTransaction(...))`
body of `completeTaskForTeam`**, so exclusivity is enforced under the same lock and
the same idempotency guard as duplicate completion. No new transaction, no new read
(the game doc, run doc, `counts` and the cloned `stages` are all already in hand).

### 5.1 Import

Anchor (L66 area, the existing shared import list already pulls `isUnlocked`):

```ts
  isUnlocked,
```
→
```ts
  isUnlocked,
  resolveExclusions,
```
(from the same `@rushpoint/shared` import group.)

### 5.2 Guard: refuse a completion already locked by a group

Insert **immediately after** the existing unlockable-tasks guard, i.e. after this
exact block (L791-802):

```ts
    if (gameTask) {
      const completedTaskIds = stages
        .flatMap((s) => s.tasks)
        .filter((t) => t.status === 'completed')
        .map((t) => t.taskId);
      if (!isUnlocked(gameTask, completedTaskIds)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'This task is locked — complete its prerequisite tasks first',
        );
      }
    }
```

append:

```ts
    // Mutually exclusive groups (change: mutually-exclusive-tasks). At most ONE
    // task per group may be completed. The check reads the stage records cloned
    // INSIDE this transaction, so two devices of the same team racing two members
    // of one group serialize on the team doc: the loser retries, re-reads a stage
    // where its sibling is now 'skipped', and folds into the EXISTING terminal
    // no-op guard above (status !== 'unassigned' && !== 'assigned') — it never
    // reaches this throw and never double-scores.
    const gameStage = game.stages.find((s) => s.id === stages[stageIdx].stageId);
    if (gameStage) {
      const siblings = resolveExclusions(gameStage, taskId);
      if (siblings.some((sid) =>
        stages[stageIdx].tasks.some((t) => t.taskId === sid && t.status === 'completed'))) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Another task in this group is already completed',
        );
      }
    }
```

Placement rationale: it must be AFTER the `taskRec.status !== 'unassigned' && !== 'assigned'`
idempotency short-circuit (L748) — otherwise a duplicate submission of an already
completed member would start throwing `failed-precondition` instead of staying a
silent no-op and would crash the play loop.

### 5.3 Skip the siblings + RELEASE their station slots (the leak-critical half)

Insert **immediately before** the existing `applyStageCompletion` call (L903), i.e.
before:

```ts
    const { heldAssignedTaskIds } = applyStageCompletion(stages, stageIdx, game, launchedAt, now);
```

insert:

```ts
    // Lock the losing members of this task's exclusive group for this team:
    // 'skipped', never 'failed' (no penalty, and 'skipped' is already terminal for
    // applyStageCompletion's allTerminal test, so a stage whose requiredTaskCount
    // exceeds the exclusion ceiling still completes instead of stranding the team).
    // A sibling that was ASSIGNED holds a station-occupancy slot (assignTask
    // incremented run.taskCounts) — it MUST be pushed onto skippedHeldTaskIds so the
    // decrement below runs in THIS commit. Skipping without releasing is exactly the
    // past station-slot leak (submitStationPhoto autoApprove / reviewStationSubmission).
    if (gameStage) {
      for (const sid of resolveExclusions(gameStage, taskId)) {
        const rec = stages[stageIdx].tasks.find((t) => t.taskId === sid);
        if (!rec) continue;
        if (rec.status !== 'unassigned' && rec.status !== 'assigned') continue; // already terminal
        if (rec.status === 'assigned') skippedHeldTaskIds.push(rec.taskId);
        rec.status = 'skipped';
      }
    }
```

Notes for whoever applies it:
- `gameStage` is already computed in §5.2 — keep ONE `const gameStage` declaration
  in the transaction scope (declare it at §5.2 and reuse it here);
- `skippedHeldTaskIds` is reset as the first statement of the txn body (L708), so a
  transaction retry never double-decrements; pushing here is retry safe;
- the existing release loop (L939-943) already decrements every id in
  `skippedHeldTaskIds` under the `(counts[id] ?? 0) > 0` guard, in the same commit —
  no post-commit `releaseTask` may be added (it would double-decrement);
- `applyStageCompletion` runs AFTER this block on purpose: the freshly skipped
  siblings then count towards `allTerminal`, so a group-only stage completes on the
  same commit as its single completion;
- if the just-skipped sibling is the team's `activeTaskId`, the update already sets
  `activeTaskId: null` (L926) — nothing extra needed.

### 5.4 Routing (optional, same wave or later)

`routing/assignNextTask.ts` candidate filter should also drop
`blockedTaskIds(gameStage, completedIds)` so a locked sibling is never handed out in
the first place (§5.2 is then only the anti cheat backstop for a hand crafted call).
Not specced further here — `assignNextTask.ts` is outside this agent's ownership.

### 5.5 e2e coverage the orchestrator should add

Scenario: stage with 3 tasks, `exclusiveGroups: [{ id: 'g1', taskIds: [t1, t2] }]`,
`requiredTaskCount` unset. Complete `t1` ⇒ assert `t2.status === 'skipped'`,
`run.taskCounts[t2]` back to its pre value, and a subsequent `completeTask(t2)`
returns a graceful no-op (not an error), because §5.2 sits after the terminal guard.

## 6. RED transcript

```
$ npx tsx scripts/test-mutual-exclusion.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  'C:\Users\savir\Projects\Rushpoint\packages\shared\src\mutualExclusion'
  imported from C:\Users\savir\Projects\Rushpoint\scripts\test-mutual-exclusion.ts
```
