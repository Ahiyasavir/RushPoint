# Tasks: fix-live-board-elapsed-time

## 1. RED
- [x] Add `scripts/test-board-time.ts` asserting `isFinalTime` is false for an in-progress entry that
      has `durationSeconds` but no `finishedAt`, true when finished; plus `boardTimeSeconds` /
      `formatDuration`. Confirm it fails (helpers do not exist).

## 2. GREEN
- [x] Add `apps/play-web/src/lib/boardTime.ts` with `isFinalTime` / `boardTimeSeconds` / `formatDuration`.
- [x] Add `board.elapsed` + `board.finalTime` to HE and EN maps in `apps/play-web/src/i18n.ts`.
- [x] Update `PublicLeaderboardScreen.tsx` to render finished vs still-playing times distinctly.
- [x] Confirm the test passes.

## 3. REFACTOR / verify
- [x] `npm run typecheck` green.
- [x] `npm run i18n:check` clean.
- [x] `npm run play:build` green.
