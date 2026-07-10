# Proposal: live-leaderboard-auto-refresh

## Why

During a live run every scoreboard surface (RunConsole standings panel, TV projection, public
board, participant final screen) renders the `run.leaderboard` snapshot — but that snapshot is
only recomputed when the organizer manually clicks "Refresh standings" or finalizes the run.
In a real playtest all teams appeared stuck at 0 points the entire run, and a staff score
adjustment (−50) was invisible everywhere: it lands in `team.bonusPenalty`, which only the
(stale) leaderboard applies and which the console teams table doesn't show at all.

## What Changes

- **Leaderboard auto-refresh (server-side):** after a successful task completion
  (`completeTaskForTeam` post-transaction) the run's `leaderboard` snapshot is recomputed via
  the existing `buildRankings` and written to the run doc — throttled per run (skipped when the
  snapshot is fresher than ~20 s) so large runs don't recompute on every completion.
  `published`/`frozen` flags are preserved exactly.
- **Score adjustments become visible immediately:** `adjustTeamScore` triggers an immediate
  (unthrottled) leaderboard refresh, and `listRunTeams` now returns each team's `bonusPenalty`
  so the console teams table can display the effective score (`score − bonusPenalty`).
- **TV/public link publishes the board:** the RunConsole "TV screen" / "public leaderboard"
  copy actions first call `refreshLeaderboard` with `publish: true`, so a shared projection
  screen is never stuck on "standings not yet available".
- No new callables; no client writes; `buildRankings` itself is untouched (live/final parity
  preserved).

## Non-goals

- No realtime push (Firestore listeners on team docs / onSnapshot fan-out) — polling surfaces
  (TV screen every 15 s, console teams every 5 s) stay as they are; only the snapshot they read
  becomes fresh.
- No change to scoring math, Z-score normalization, completion bonus, or `buildRankings`.
- No change to the `published` privacy gate itself — an unpublished board still returns the
  "not available" state to public/TV viewers; we only make the organizer's share action publish.
- No auto-publish on launch — publishing remains an explicit organizer action (share/toggle).

## Capabilities

### New Capabilities
- `live-leaderboard-refresh`: the run leaderboard snapshot stays fresh during a live run
  without organizer intervention (auto-refresh on scoring events, throttled), and staff score
  adjustments are immediately visible on the leaderboard and in the console teams list.

### Modified Capabilities
- `tv-leaderboard`: the RunConsole "TV Screen" action now also publishes the leaderboard
  (refresh with `publish: true`) before copying/opening the URL, so the projection screen shows
  standings immediately.

## Impact

- **Surfaces touched:** functions (runs domain: `completeTaskForTeam` epilogue,
  `adjustTeamScore`, `listRunTeams`), shared (a pure throttle-decision helper), creator-web
  (RunConsole teams table + share actions). No play-web code change (its surfaces already poll).
- **Callables changed (behavior, not signatures):** `completeTask`/`submitTaskAnswer`/
  `verifyStationCode`/`submitSequenceStep`/`reviewStationSubmission` (all funnel through
  `completeTaskForTeam`) now refresh the leaderboard as a side effect; `adjustTeamScore`
  refreshes immediately; `listRunTeams` response rows gain `bonusPenalty`.
- **Tests:** pure-logic vitest for the throttle decision; e2e scenario assertions that a task
  completion updates `run.leaderboard` without an explicit refresh, and that `adjustTeamScore`
  is reflected in both the leaderboard and `listRunTeams`.
- **Perf:** one extra transaction-free run-doc write per scoring event, amortized by the
  throttle; leaderboard reads all teams — same cost as the existing manual refresh.
