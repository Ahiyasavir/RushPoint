# Tasks: pause-never-strands

## 1. RED
- [x] 1.1 e2e block C rewritten to the 14.10 shape (design, test strategy). The old server refuses
      the pause, so the scenario fails at "pause is ACCEPTED".

## 2. GREEN
- [x] 2.1 `setRunTaskStatus`: no refusal, no `force`; `stageUnwinnable` reported and audited.
- [x] 2.2 `applyTaskClosure(kind)`, `setAsidePausedTasks`, the heal in `assignNextInActiveStage`.
- [x] 2.3 `RunTaskRecord.setAsideWhilePaused`.
- [x] 2.4 Console: the "pause anyway" dialog removed, a note after such a pause. HE + EN.

## 3. Verify
- [x] 3.1 `npm run verify` and the full `npm run e2e`.
- [ ] 3.2 Archive into `openspec/specs/live-task-availability` once green.
