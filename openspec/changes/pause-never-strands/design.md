## Context

`planTaskStatusChange` computes `stageUnwinnable` for a pause. `setRunTaskStatus` refused on it
unless `force`. A closure already has the per team arithmetic (`applyTaskClosure` → `planTaskSkip`
→ `applyStageCompletion`). `assignNextInActiveStage` is the single choke point every assignment
(requestNextTask, completeTask's reassign, startTeams, the poll sweep) goes through.

## Decisions

**D1. Heal lazily, at the moment a team is actually stuck.** Not at pause time: a team that still
has other missions in the stage may get the paused one back if it is resumed, and setting it aside
early would take that away. The trigger is: `assignTask` returned nothing, the reason is not
`stationsFull` (that team waits for a slot), nothing is in flight, and the run has a paused
override. Then every UNASSIGNED mission of the active stage that is paused right now is set aside
for this team, and routing runs once more. Cost: one run read, only on the no-assignment path.

**D2. Reuse the closure arithmetic, mark it differently.** `applyTaskClosure(…, 'paused')` writes
`skipped`, `skipCause: 'operator'` (so dependents open), 0 points and `setAsideWhilePaused: true`
instead of `closedByOrganizer`. One rule for "this mission is gone for this team".

**D3. The pause itself is never refused.** With D1 there is nothing left to protect the organizer
from. `stageUnwinnable` is reported, and the console says what will happen.

**D4. Known edge.** A team whose only other remaining mission is waiting on a scheduled release
(`allLocked` by time) will set the paused one aside while it waits. Accepted: rare, and it errs
toward the team moving.

## Test strategy

e2e, live task pause scenario block C, the 14.10 shape: head → mid → end all required, then a final
stage. Team A holds mid, team B is on head. Pause mid: accepted. B finishes head and is routed past
mid to end, mid is set aside for B with 0 points, B reaches the final stage. A keeps mid, scores it,
and reaches the final stage too. Against the old server the first assertion fails (the pause was
refused).
