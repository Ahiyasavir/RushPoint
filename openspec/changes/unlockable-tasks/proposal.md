## Why

Within a stage, every task is immediately routable — there is no way to author a
puzzle chain ("solve the cipher, THEN the vault opens"), a story dependency, or a
station that only makes sense after another. Creators fake it today with extra
stages, which forces the whole team through a full stage boundary for what is
really an intra-stage dependency. Prerequisites are a standard scavenger-hunt
mechanic (Goosechase "locked missions") and a clean additive extension of the
existing Stage → Task model.

## What Changes

- A **Task** may carry an optional `unlockAfterTaskIds?: string[]` — ids of OTHER
  tasks **in the same stage** that must all be completed first (AND semantics).
- A task with unmet prerequisites is **not routed or assigned**: the candidate
  filters in `buildRecommendations` and the `assignTask` transaction drop it, so
  `requestNextTask` / `getRecommendedTasks` never hand it out.
- It also **cannot be completed by a direct call** (anti-cheat): the single
  completion choke point `completeTaskForTeam` refuses with `failed-precondition`
  — covering `completeTask`, `submitTaskAnswer`, `submitSequenceStep`,
  `verifyStationCode` and photo-review approval alike.
- The decision is a **pure predicate** `isUnlocked(task, completedTaskIds)` in
  `packages/shared` shared by routing, the completion guard, and the play-web
  locked rendering so they can't drift.
- **Not a secret:** prerequisite ids pass through `sanitizeTaskForParticipant`
  unchanged. play-web shows a locked task's title with a lock icon and a
  "complete X first" line (it names the prerequisite tasks — that's the point).
- The **Builder** task editor gains a multi-select of the other tasks in the same
  stage. Validation (shared pure validator + Builder guard + `updateGame`)
  rejects self-reference, cross-stage/unknown ids, and cycles; a cycle-free graph
  always has at least one prerequisite-free task, so a stage stays routable.
- **Partial-completion stages** (`Stage.requiredTaskCount`) stay satisfiable:
  locked candidates are merely excluded from routing until they open (they still
  count toward the stage's task total and auto-skip on early completion exactly
  as today); the validator warns when `requiredTaskCount` exceeds the number of
  reachable tasks.

## Capabilities

### New Capabilities
- `unlockable-tasks`: optional same-stage prerequisites on Task; the pure
  `isUnlocked` predicate + `validateUnlockGraph` validator; server enforcement in
  both routing candidate filters and the `completeTaskForTeam` choke point;
  sanitizer passthrough; the Builder prerequisite multi-select and the play-web
  locked-task rendering.

## Non-goals

- No **cross-stage** prerequisites — stages already sequence globally; the field
  only accepts same-stage ids.
- No OR semantics ("any one of") — all listed prerequisites must be complete.
- No push notification when a task unlocks — the next poll/assignment sees it.
- No per-team overrides (staff can still `skipStage`; no per-task manual unlock).

## Surfaces touched

- **shared:** new `packages/shared/src/gating.ts` (`isUnlocked`,
  `validateUnlockGraph`); `Task` gains `unlockAfterTaskIds?`.
- **functions:** candidate filters in `routing/assignNextTask.ts`
  (`buildRecommendations` + `assignTask`); the completion guard in
  `runs/index.ts` `completeTaskForTeam`; save-time validation in
  `games/index.ts` `updateGame`. No new callable. Sanitizer passthrough.
- **creator-web:** `TaskWizard.tsx` prerequisite multi-select + i18n.
- **play-web:** `PlayScreen` stage task list locked rendering + i18n.
- **Tests:** `scripts/test-gating.ts` (pure); an `unlockable tasks` e2e scenario +
  `ALLOWED_TASK_KEYS` allowlist entry (`unlockAfterTaskIds`).
- No Firestore index, rules, or env change.
