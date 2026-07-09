# Proposal — Streak & momentum counter

## Why

Completing tasks back-to-back is the most engaging state in the run — teams are in flow. Today the
app is silent about it. A streak counter (Duolingo-style) makes that flow visible, creates a
social brag moment ("we're on a 5-streak!"), and subtly pressures teams to keep moving. It is a
pure engagement mechanic with zero scoring impact.

## What Changes

> Observable behavior. Client-side visual only; no change to scoring or server state.

- A **streak counter** appears on the play screen once a team completes 2+ consecutive tasks
  without a skip or timeout between them.
- The counter shows the current streak number with a **fire emoji animation** that escalates at
  milestones (3, 5, 10).
- Streaks **reset** on a skip, a timeout (configurable — default: the time since the last task
  completion exceeds 2× the median task time for this run), or a stage change.
- The streak count is **client-side only** — derived from the team's `TaskState` completion
  timestamps already available in the app state. No server write, no Firestore change.

## Capabilities

### New Capabilities
- `streak-momentum`: a client-side consecutive-task streak counter with milestone animations,
  computed from existing `TaskState` data.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **play-web** only: new pure helper `computeStreak(taskStates, now, medianMs)` in
  `packages/shared/src/`, play screen UI (`PlayScreen.tsx` or `TaskRunner.tsx`) shows the counter.
- **Tests:** new `scripts/test-streak.ts` (pure logic, no DOM).
- No callable, no Firestore change.

## Non-goals

- No streak bonuses or scoring impact — engagement only.
- No persisted streak across page reloads (derives from existing state on mount).
- No streak leaderboard or comparisons with other teams.
