# Proposal: fix-live-board-elapsed-time

## Why

On the public leaderboard (`apps/play-web/src/screens/PublicLeaderboardScreen.tsx`) every row now
shows a time under the score. The backend stamps `durationSeconds = now − startedAt` for teams that
have not finished, so a still-playing team renders an ever-growing "elapsed" value styled
**identically** to a finished team's real completion time — and it jumps upward on every ~8 s poll. A
viewer watching a live board cannot tell "still playing" from "final time" (e.g. an in-progress team
started early shows `42:00` next to a finisher's `18:30`).

## What Changes

- A row shows a **completion time** (solid mono style) only for teams that have actually finished
  (`finishedAt` set).
- A still-playing team's time is shown **distinctly** — dimmer, italic, with a ⏱ prefix and an
  `Elapsed (still playing)` label (via `t.*`) — so it can't be read as a final time. (Rows on a
  finished/frozen board are all finishers, so they render normally.)
- The row-time decision is extracted into pure helpers (`apps/play-web/src/lib/boardTime.ts`) so it is
  unit-testable.

## Non-goals

- No backend change (the board data is correct; only its presentation was ambiguous).
- No change to ranking order or to which teams appear.
- No change to the TV/ceremony/recap boards (they render finished teams).

## Capabilities

### New Capabilities
- `public-board-time-clarity`: a public leaderboard visually distinguishes a finished team's
  completion time from a still-playing team's elapsed time.

## Impact

- **Surfaces touched:** play-web only — `screens/PublicLeaderboardScreen.tsx`, new
  `lib/boardTime.ts`, two new `i18n.ts` keys (`board.elapsed`, `board.finalTime`) in HE + EN.
- **Callables affected:** none.
- **Tests:** pure-logic `scripts/test-board-time.ts` (auto-run by `npm test`) for
  `isFinalTime` / `boardTimeSeconds` / `formatDuration`; plus `npm run i18n:check` and
  `npm run play:build`.
