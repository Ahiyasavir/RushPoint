## ADDED Requirements

### Requirement: Stage-completion logic has a single source of truth
Stage-completion logic SHALL have exactly ONE source of truth: the required-task-count check,
leftover auto-skip, final-stage detection, and scheduled-release next-stage unlock that run when a
team's active stage completes SHALL be implemented in one shared helper (`applyStageCompletion` in
`functions/src/runs/helpers.ts`). Every code path
that completes a stage — the task-completion path (`completeTaskForTeam`) and the expiry-sweep
path (`sweepExpiredInFlight`) — SHALL call that shared helper rather than carry its own copy of
the logic. The observable stage-completion behavior (which tasks become `skipped`, when a stage
is marked `completed`, its summed `earnedScore`, whether the next stage unlocks) SHALL be
identical to the behavior before the consolidation.

#### Scenario: The two completion paths cannot drift
- **WHEN** the stage-completion rule is read across the codebase
- **THEN** there is exactly one implementation of it, and both `completeTaskForTeam` and
  `sweepExpiredInFlight` delegate to that single implementation with no duplicated copy

#### Scenario: A partial stage completes and auto-skips leftovers unchanged
- **WHEN** a team completes enough tasks to satisfy a stage's `requiredTaskCount` (or every task
  in the stage reaches a terminal `completed`/`skipped` state)
- **THEN** the shared helper marks the stage `completed`, auto-skips the remaining non-completed
  tasks, sums the stage `earnedScore`, and reports the previously-`assigned` skipped tasks so the
  caller can release their station-occupancy slots — matching the pre-refactor behavior exactly

#### Scenario: Next-stage unlock respects the scheduled-release gate
- **WHEN** a non-final stage completes and the following stage has a scheduled-release gate that
  has not yet opened
- **THEN** the following stage remains `locked` (unlocked later by the existing lazy poll), and
  when its gate is open the shared helper unlocks it — identical to the pre-refactor rule

### Requirement: Authentication guard has a single definition
The "reject an unauthenticated caller and return the caller's uid" guard (`requireAuth`) SHALL
be defined once, in a shared module (`functions/src/auth.ts`), and imported by every module that
needs it. No Cloud Functions module SHALL carry its own private copy of `requireAuth`.

#### Scenario: One requireAuth, imported everywhere
- **WHEN** the Cloud Functions source is searched for a `requireAuth` definition
- **THEN** exactly one definition exists (in `functions/src/auth.ts`), and the run, payments,
  games, users, and root index modules import it rather than redefining it

#### Scenario: Auth behavior is unchanged
- **WHEN** an unauthenticated call reaches any callable that uses the shared `requireAuth`
- **THEN** it is rejected with the same `unauthenticated` error as before, and an authenticated
  call returns the same caller uid — no authz decision changes

### Requirement: The runs barrel preserves the public callable surface
`functions/src/runs/index.ts` SHALL be a thin barrel that re-exports the run-domain callables
and internal helpers from focused submodules. The set of Cloud Function callables discoverable
through `functions/src/index.ts` SHALL be identical before and after the module split, and the
internal helpers consumed by other modules (`completeTaskForTeam`, `resolveCallerTeam`,
`maybeRefreshLeaderboardSnapshot`, `buildRankings`) SHALL remain importable from the barrel under
their existing names. Internal helpers SHALL NOT be re-exported as Cloud Function triggers.

#### Scenario: No consumer import path changes
- **WHEN** `functions/src/index.ts` imports internal helpers and re-exports run callables from
  `./runs/index`, and the property test imports `buildRankings` from `../runs/index`
- **THEN** all of those imports resolve against the barrel without any edit to the consumers

#### Scenario: The callable surface is unchanged
- **WHEN** the emulator introspects the callables it serves (the `npm run e2e` coverage guard)
- **THEN** the same set of callables is present and covered (66/66) as before the split, with no
  callable added, removed, or renamed by the refactor

#### Scenario: Internal helpers stay internal
- **WHEN** `completeTaskForTeam` and the routing helpers are re-exported from the barrel for
  intra-`functions` use
- **THEN** they are still NOT listed in the enumerated callable re-export of
  `functions/src/index.ts`, so they are never deployed as Cloud Function triggers
