## Why

Field report 2026-09-25: *"skipping a mission skips a whole stage"*.

**Confirmed in production.** Run `oNaUvNrCWRia4Y1b9xOO` (2026-09-22, game "המירוץ לציון (copy)"),
team `zUw7zv…`. The audit trail records ONE single-mission skip from the Run Console:

```
actionType: task_skipped · reason: "staff skip" · taskId: f13163ca… ("קומו ונעלה ציון!")
previousValue: assigned · stageCompleted: true
```

and the team's stage 1 ended with all three missions `skipped`. Stage 1 of that game is a chain:

```
f13163ca  video   "קומו ונעלה ציון!"            unlockAfter: []
2b83fd50  quiz    "צופן המצפן הסודי"            unlockAfter: [f13163ca]
c42b88d4  photo   "סימון הדרך לעולי הרגל"        unlockAfter: [2b83fd50, f13163ca]
```

### The mechanism

1. `skipTaskForTeam` marks `f13163ca` `skipped` and calls `applyStageCompletion`
   (`functions/src/runs/index.ts`, `skipTaskForTeam`).
2. `applyStageCompletion` first retires "unreachable" tasks (`functions/src/runs/helpers.ts:56-67`)
   using `unreachableTaskIds` (`packages/shared/src/gating.ts:261`), whose fixpoint treats ONLY
   `completed | assigned` as alive. A skipped prerequisite is therefore dead, so `2b83fd50` is
   retired, then `c42b88d4`.
3. Every task is now terminal, `allTerminal` is true, and the stage completes.

The retirement was added on 2026-09-08 by `unreachable-task-strand` for a real bug, the losing
alternative of an exclusive group stranding its dependents forever. Its proposal lists the writers
of `skipped` it considered: the exclusive-group retire loop, the leftover auto-skip, the expiry
sweep and `skipStage`. **`skipTaskForTeam` was not among them**, and an organizer's skip carries
the opposite intent: "remove this obstacle for this team", not "this path is closed". The same
`completed`-only reading exists at five unlock checks (four in `functions/`, plus
`LockedTasksList` in `apps/play-web/src/screens/PlayScreen.tsx:1252`), so even without the
retirement a skipped prerequisite would keep its dependents locked forever.

## What Changes

- A mission skipped by an ORGANIZER or STAFF (`skipTaskForTeam`) satisfies the unlock conditions of
  the missions that depend on it, for that team. Its dependents stay playable, and the stage
  continues.
- Every skipped record states why it was skipped (`skipCause`), so the rule can tell an operator
  skip from an exclusive-group loss, an expiry, an automatic leftover or a retirement.
- Exclusive-group losers, expiry and automatic retirement keep today's meaning: they do NOT open
  their dependents.
- The skip confirmation in both consoles states the real consequence before it happens, from a
  dry run of the same plan the server will execute: which mission is skipped, which missions open
  as a result, and whether the stage ends.
- One shared definition of "satisfies a gate", used by routing, the completion path, the
  participant's locked list and the unreachable-task retirement.

## Non-goals

- Reopening teams already hit by this bug (`send-team-back` provides that).
- Changing `skipStage` (whole-stage skip) or the consolation award.
- Changing what expiry or exclusive groups mean.

## Surfaces

- shared: `gating.ts` (new `gateSatisfiedTaskIds`, `unreachableTaskIds` reads it), `types` (`RunTaskRecord.skipCause`), `taskSkip.ts` (`dependentsOpened` in the plan).
- functions: `runs/helpers.ts`, `runs/index.ts` (`skipTaskForTeam` accepts `dryRun`; every `skipped` writer stamps a cause), `routing/assignNextTask.ts`.
- **Changed callable:** `skipTaskForTeam` gains an optional `dryRun: true` that returns the plan without writing. Typed wrappers in both apps' `services/calls.ts`; e2e coverage.
- creator-web `RunConsolePage.tsx` and play-web `StaffConsole.tsx` confirm dialogs; play-web `PlayScreen.tsx` `LockedTasksList`.
