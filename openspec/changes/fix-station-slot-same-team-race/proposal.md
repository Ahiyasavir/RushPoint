# Proposal: fix-station-slot-same-team-race

## Why

`assignNextInActiveStage` (`functions/src/runs/index.ts`) reads a team doc, checks "does this team
already have a task in flight?", and — for a multi-task stage — calls `assignTask` (which atomically
reserves a station slot: `run.taskCounts[taskId]++`) and then writes the assignment onto the team
with a plain `teamRef.update({ stages, activeTaskId })`.

The read of the team and that write are **not atomic**, and `assignTask`'s transaction locks only the
run-doc counters, never the team doc. Two concurrent assignments for the **same team** — a controller
double-tap, or `completeTaskForTeam`'s post-completion reassign racing a `requestNextTask` poll —
each pass the in-flight check on their own stale snapshot, each reserve a *different* task's slot, and
the second team write overwrites the first. Net: two `taskCounts` entries were incremented but the
team ends up on only one task; the other reserved slot is never released. Repeated, a station's
`maxConcurrentTeams` capacity wedges toward 0 with no team actually present.

The existing e2e station-contention scenario only races **different** teams (which `assignTask`
already guards on the run doc), so this same-team hole is uncovered.

## What Changes

- After `assignTask` reserves a slot, the team assignment is committed inside a **transaction that
  re-reads the team doc**. If another assignment already put a task in flight for this stage, the
  loser **releases the slot it just reserved** (`releaseTask`) instead of overwriting the winner, and
  returns the task that is actually in flight.
- The cheap pre-read `inFlight` check stays as a fast path; the transaction is the correctness
  boundary. Single-task stages are unaffected (they never call `assignTask` and both racers pick the
  same task idempotently).

## Non-goals

- No change to routing math (`assignTask` priority scoring, `computeSkillRatio`) or station caps.
- No change to single-task-stage assignment.
- Does not serialize all assignment through a global lock; only the per-team claim is made atomic.

## Capabilities

### New Capabilities
- `station-slot-assignment-integrity`: concurrent task assignments for the same team can never leak a
  reserved station slot — total reservations always match teams actually in flight.

## Impact

- **Surfaces touched:** functions (runs domain: `assignNextInActiveStage` multi-task branch). Uses the
  existing `releaseTask` from `routing/assignNextTask.ts`.
- **Callables affected (behavior, not signature):** `requestNextTask` and the internal post-completion
  reassign in `completeTaskForTeam`.
- **Tests:** an e2e scenario firing concurrent same-team assignment requests and asserting the station
  counters never exceed teams actually in flight (and return to 0 when the run drains).
- **Perf:** one extra single-doc transaction per successful multi-task assignment; negligible.
