# station-slot-assignment-integrity Specification (delta)

## ADDED Requirements

### Requirement: Same-team concurrent assignment never leaks a station slot
When two task assignments run concurrently for the same team on a multi-task stage, the server SHALL
commit the team assignment under a transaction that re-reads the team, so at most one assignment takes
effect. Any assignment that loses the race MUST release the station slot it reserved
(`run.taskCounts[taskId]`) rather than leaving it counted with no team present. The total of all
station reservations MUST never exceed the number of teams actually holding an assigned/active task.

#### Scenario: Double assignment keeps counters honest
- **WHEN** two assignment requests for the same team on a multi-task stage are issued concurrently
- **THEN** the team ends up with exactly one task in flight AND the sum of `run.taskCounts` reflects
  only that one reservation (the other reserved slot is released)

#### Scenario: Counters drain to zero
- **WHEN** a run in which same-team assignment races occurred reaches completion
- **THEN** every `run.taskCounts[taskId]` returns to 0
