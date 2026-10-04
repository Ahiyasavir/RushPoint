## Why

A run nobody ended stays `live` forever. The creator console's floating "ריצה חיה" bar
(`ActiveRunBar`) features the newest live run and counts the rest ("עוד 5 ריצות"), so a
test run from August keeps a bar over the content of every creator screen, offering
"חזרה לריצה" and "סיום ריצה" for an event that ended weeks ago. Found in the overnight pass of
2026-10-03 (`docs/OVERNIGHT-2026-10-03.md`, proposal 4), approved by Ahiya on 2026-10-04.

## What Changes

- One rule for "playing now": a live run launched within the last day (`isPlayingNow`). The
  run history badge (fix 29) and the floating bar both read it, so they can never disagree.
- The floating bar features and counts only runs that are playing now. Older open runs stay
  one tap away in `/live` and in the run history, which already says "עדיין פתוחה".
- A live run with no readable launch time still counts as playing (the old behaviour), so a
  missing field never hides a real event.

## Capabilities

### New Capabilities
- `active-run-bar-recent`: which live runs the floating bar is about.

## Impact

- `apps/creator-web/src/lib/runHistoryBadge.ts` (exports `isPlayingNow`),
  `hooks/liveRunsPolling.ts` (`recentLiveRuns`), `components/ActiveRunBar.tsx`.
- Tests: `hooks/__tests__/liveRunsPolling.test.ts`, `scripts/test-run-history-badge.ts`.
- No server or data change.
