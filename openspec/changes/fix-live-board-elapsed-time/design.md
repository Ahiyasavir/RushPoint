# Design: fix-live-board-elapsed-time

## Files touched

- `apps/play-web/src/lib/boardTime.ts` (new, no React) — pure helpers:
  - `isFinalTime(e)` → `!!e.finishedAt` (a real completion time only once the team finished).
  - `boardTimeSeconds(e)` → `durationSeconds ?? totalMinutes*60 ?? null`.
  - `formatDuration(seconds)` → `m:ss` / `h:mm:ss` (matches the other public boards).
- `apps/play-web/src/screens/PublicLeaderboardScreen.tsx` — replace the local `fmtTime` with the
  helpers; render a finished team's time in the existing mono style and a still-playing team's time in
  a dimmer italic `⏱ …` style with a `title`/`aria-label` from `t.board.elapsed` vs `t.board.finalTime`.
- `apps/play-web/src/i18n.ts` — add `board.elapsed` and `board.finalTime` to the HE and EN maps
  (HE real Hebrew).

## Test strategy

- **Pure logic (`scripts/test-board-time.ts`, tsx, no emulator, auto-run by `npm test`):**
  `isFinalTime` true only with `finishedAt` (false when only `durationSeconds` is present — the crux);
  `boardTimeSeconds` precedence + null; `formatDuration` m:ss, h:mm:ss, negative→`0:00`.
- **UI:** `npm run i18n:check` (HE/EN parity + purity for the two new keys) and `npm run play:build`.
  Visual check via preview if available: a live board renders a running team's time dimmed with ⏱ and
  a finisher's time solid.

## Gates

`npm run typecheck` · `npm test` · `npm run i18n:check` · `npm run play:build`.
