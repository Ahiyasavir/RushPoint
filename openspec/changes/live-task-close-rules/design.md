# Design: live-task-close-rules

- `planTaskStatusChange` (shared) follows the unlock graph: a mission is reachable when active and
  every prerequisite is reachable or CLOSED. Reports `dependentsLocked` (pause) and
  `dependentsOpened` (close: missions that wait for nothing else now). Only a pause is ever
  `stageUnwinnable`; a stage already shrunk by a closure is judged against the shrunk requirement.
- `applyTaskClosure` (functions/runs): per team, the record becomes `skipped`, `skipCause:
  'operator'` (satisfies gates, like an organizer skip), `closedByOrganizer: true`, `earnedScore:
  0`; requirement via `planTaskSkip`; `applyStageCompletion` when the stage is active.
- `closeTaskForAllTeams`: one transaction per team; a holder gets `activeTaskId: null` +
  `closedTaskNotice {taskId, title, at}`, its slot back and its next mission.
- `joinRun` applies every closure already on the run to a late joiner's fresh stages.
- The team sanitizer passes `closedByOrganizer` and `closedTaskNotice`. play-web shows the notice
  (`lib/closedTaskNotice.ts`: fresh 30 min, once, dismissal per closure). Console: closeTask is
  destructive + confirmed, with accurate copy.

## Test strategy

- vitest `liveTaskStatus.test.ts`: chains, closed opens, mixed prerequisites, close never
  unwinnable, shrunk requirement, malformed gates.
- e2e "closing a mission mid-run": holder moved + notice + no points, requirement 3, C still waits
  for D, closed mission cannot be completed, stage completes, late joiner, pause counts dependents.
- `scripts/test-closed-task-notice.ts`; `runConsole.test.ts` classification.
- Browser (batched): console confirm + player notice.
