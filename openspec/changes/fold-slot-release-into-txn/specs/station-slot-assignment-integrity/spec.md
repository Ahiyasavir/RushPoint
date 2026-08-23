# station-slot-assignment-integrity Specification (delta)

## ADDED Requirements

### Requirement: Every callable that vacates a station slot releases it atomically with the team change
A server callable that stops a team from holding a task — checking a task out, skipping a stage, or skipping a single task — SHALL decrement that task's station reservation (`run.taskCounts[taskId]`) inside the same Firestore transaction that rewrites the team's task records, guarded so a zero/stale counter never goes negative.
The release SHALL NOT be performed by a separate transaction that runs after the team-change
transaction has committed, so there is no window in which the team is reverted/skipped while its slot
stays reserved. This mirrors the completion path, which already folds its slot release into its
scoring transaction.

Consequently, if the run doc is under sustained lock contention, a slot release SHALL NOT be able to
fail after the team has already been reverted/skipped: either the whole transaction (team change +
release) commits together, or neither part does.

#### Scenario: Checkout releases the slot atomically with the team revert
- **WHEN** a team holding an in-flight task checks that task out
- **THEN** the team's record for that task becomes unassigned AND `run.taskCounts[taskId]` is
  decremented in the same commit
- **AND** there is no committed state in which the task is unassigned but the slot is still reserved

#### Scenario: Skipping a stage releases every held slot atomically
- **WHEN** a stage is skipped while the team holds one or more assigned tasks in it
- **THEN** every assigned-held task's `run.taskCounts` entry is decremented in the same commit that
  marks the stage skipped/completed
- **AND** no held slot from that stage remains reserved after the commit

#### Scenario: Skipping a single task releases the skipped and auto-skipped slots atomically
- **WHEN** a single task is skipped and that skip auto-skips sibling tasks the team also held
- **THEN** the skipped task's slot and each auto-skipped sibling's slot are decremented in the same
  commit that skips them, each counted at most once (deduped)
- **AND** no window exists in which those tasks are skipped but their slots stay reserved

### Requirement: Slot releases preserve the existing success-path release set
The change SHALL NOT alter which slots each callable releases on the success path: checkout releases exactly the one slot the calling team held; a stage skip releases every assigned-held slot in the active stage; a single-task skip releases the skipped task's held slot plus any auto-skipped siblings' held slots, deduped.
No additional slot SHALL be released and none SHALL be dropped, and no team's score or gameplay
outcome SHALL change — only the moment and mechanism of the counter decrement move from post-commit to
in-commit.

#### Scenario: Station counters return to zero after checkout and skip paths run
- **WHEN** a run in which teams checked tasks out, skipped stages, and skipped single tasks reaches
  completion
- **THEN** every `run.taskCounts[taskId]` returns to 0, with no leaked reservation from any of those
  paths

#### Scenario: A refused or no-op call touches no counter
- **WHEN** a checkout or skip is refused (the team holds nothing, or the task is already
  completed/skipped)
- **THEN** no `run.taskCounts` entry is changed
