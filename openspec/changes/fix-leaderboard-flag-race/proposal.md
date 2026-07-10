# Proposal: fix-leaderboard-flag-race

## Why

The live-leaderboard auto-refresh (`maybeRefreshLeaderboardSnapshot`, `functions/src/runs/index.ts`)
reads the run doc, then spends tens of milliseconds reading the game and every team doc to
recompute rankings, then does a plain non-transactional `runRef.update({ leaderboard: { … } })`
that re-writes the organizer-controlled `published` and `frozen` flags from the value it read at
the *start*.

If an organizer publishes (`refreshLeaderboard` with `publish: true`, or `finalizeRun`) or freezes
the board during that read window, the auto-refresh's write lands last and silently reverts
`published` back to `false` (or `frozen` back to `false`) — un-publishing the public leaderboard at
the exact moment of the reveal, or breaking a freeze. Because a later throttled refresh re-reads the
now-clobbered `false`, the board can stay un-published until the organizer clicks publish again.

Two independent code-review passes flagged this same function.

## What Changes

- The auto-refresh now writes only `leaderboard.rankings` + the timestamps via **dotted Firestore
  field paths** (`leaderboardRefreshFields`), so it is structurally incapable of touching
  `leaderboard.published` / `leaderboard.frozen`.
- The write is committed inside a **short single-doc transaction** that re-reads the run doc and
  re-checks `frozen`, so a freeze that landed during the game/teams read is respected (not
  overwritten with fresh rankings).
- No behavior change on the happy path: a normal auto-refresh still updates the rankings snapshot,
  still throttled to ~20 s, still best-effort (a failure never fails the completion that triggered it).

## Non-goals

- No change to `buildRankings`, scoring, Z-score, or the throttle interval — live/final parity is
  untouched.
- No change to the `published` privacy gate, or to who may publish/freeze.
- No new realtime push; polling surfaces are unchanged.
- Does not add a transaction around the expensive game/teams reads (kept as plain reads); only the
  final commit is transactional.

## Capabilities

### New Capabilities
- `leaderboard-flag-integrity`: an automatic leaderboard refresh can never overwrite the
  organizer-controlled `published`/`frozen` flags, even when it races a publish or freeze.

## Impact

- **Surfaces touched:** functions (runs domain: `maybeRefreshLeaderboardSnapshot`,
  `leaderboardThrottle.ts` gains a pure `leaderboardRefreshFields` helper). No client change.
- **Callables affected (behavior, not signature):** every path that triggers an auto-refresh
  (completeTask / submitTaskAnswer / submitSequenceStep / verifyStationCode /
  reviewStationSubmission / adjustTeamScore / skipStage) now commits the refresh transactionally
  and never writes the flags.
- **Tests:** pure-logic vitest asserting `leaderboardRefreshFields` emits only rankings + timestamps
  and never `leaderboard.published` / `leaderboard.frozen`.
- **Perf:** one extra single-doc transactional read on the ~once-per-20s refresh write; negligible.
