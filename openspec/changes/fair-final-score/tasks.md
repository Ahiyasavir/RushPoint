## 1. RED

- [x] 1.1 `scripts/test-scoring-presets.ts`: `finalSpeedBonus` (10% cap, 4 finishers minimum, linear,
  proportional to own points, total on non-finite input); the completion bonus and Z-score exports
  are gone. `packages/shared/src/scoringPresets.test.ts` rewritten for the new guard.
- [x] 1.2 `functions/src/runs/buildRankings.test.ts`: the 2026-10-05 two-team case reads 100 and 50
  published or not; four finishers get the bonus only with `speedBonus: true`; score = points +
  speedBonus. Drift tests updated to task points.

## 2. GREEN

- [x] 2.1 shared: `finalSpeedBonus`, constants; `LeaderboardEntry.points`, `.speedBonus`.
- [x] 2.2 `buildRankings(…, { speedBonus })`: no completion bonus, no Z-score, no route bonus at
  ranking. Callers: auto refresh (when published), `refreshLeaderboard` (when published),
  `finalizeRun` (always).
- [x] 2.3 UI: "N נקודות + M מהירות" beside a score that carries a bonus (console boards, player final
  screen, public board, TV, ceremony). Preset description and duration help no longer promise a
  route bonus. CLAUDE.md's scoring section rewritten.

## 3. Verify

- [x] 3.1 Gates: `npm run verify`, `npm run e2e` (ALL PASS, 2026-10-05 22:55).
- [x] 3.2 Post-deploy check (4+ finishing teams show the bonus line only after publishing) moved to the next deploy checklist, docs/deploy-checks.
