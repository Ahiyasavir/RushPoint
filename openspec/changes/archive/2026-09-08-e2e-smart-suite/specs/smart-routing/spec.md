# smart-routing Specification (delta)

## ADDED Requirements

### Requirement: Station capacity is enforced atomically
Task assignment SHALL check a station's current occupancy and increment its counter inside a
single Firestore transaction, so that concurrent assignments can never push
`run.taskCounts[taskId]` above the task's `maxConcurrentTeams`. Releasing a slot SHALL likewise
read-and-decrement transactionally and never drive a counter below zero.

#### Scenario: Simultaneous assignment respects the cap
- **WHEN** multiple teams are assigned tasks concurrently and a candidate station is at capacity
  in the transaction's consistent view
- **THEN** that station is excluded for the losing caller(s), which receive the next-best
  candidate or no task — the counter never exceeds the cap

#### Scenario: Release never underflows
- **WHEN** `releaseTask` runs concurrently for the same task
- **THEN** the counter never becomes negative
