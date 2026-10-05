## Why

Run pCADVITcbzIZMEPjVqcV (2026-10-05, two test teams): the organizer's final board read 800 and
350, the players' phones read 100 and 50. Ahiya: "אין לי מושג איך קבוצה אחת קיבלה 800 והשנייה 350,
זה הזוי לחלוטין". The final ranking added two things nobody could see:

- **+500 completion bonus** to every team that completed all stages;
- **±200 Z-score time bonus**, which with two finishers is always exactly +200 and −200, however
  small the gap. Here a team whose whole game sat on a clock-pausing task had a duration of 0
  minutes and the other 2.7, so 2.7 minutes became 400 points.

`fixed_points_speed` also adds up to +200 route bonus at ranking time, which never reaches
`team.score` either.

His decision (2026-10-05): no hidden 500; a small, fair speed bonus, proportional to the real
time; it may appear only when the results are published, "so as not to reveal".

## What Changes

- **Points** on every board = what the team earned (mission points, consolations, manual
  adjustments), the same number its phone shows. No completion bonus, no Z-score, no
  `fixed_points_speed` route bonus at ranking time.
- **Speed bonus**: at most +10% of the team's own points, linear from the fastest finisher (+10%)
  to the slowest (0), on clock-adjusted time (paused tasks and holds already excluded). Only when
  at least 4 teams have finished, so a handful of teams never produces an extreme gap.
- **Revealed at publish**: an unpublished board (the organizer's live view) carries points only;
  a published board and the final board add the speed bonus. Every entry carries `points` and
  `speedBonus` beside `score`, so the console, the phone and the public board can show the line.
- `time_only` is unchanged (ranked by time, no points).

## Impact

- `packages/shared/src/scoringPresets.ts`: `speedBonus`, `SPEED_BONUS_MAX_FRACTION`,
  `SPEED_BONUS_MIN_FINISHERS`; `applyCompletionBonus`, `COMPLETION_BONUS`, `applyZScoreBonus`
  removed. `LeaderboardEntry` gains `points`, `speedBonus`.
- `functions/src/runs/index.ts`: `buildRankings(game, teams, now, { speedBonus })`;
  `refreshLeaderboard` (published), `finalizeRun` (always), the auto refresh (when published).
- UI: the console board and the player's final screen show "points + speed".
- Tests: `scripts/test-scoring-presets.ts`, `packages/shared/src/scoringPresets.test.ts`,
  `scripts/e2e-verify.mjs` (the two-team case of this run: no ±200, no 500).
