# scoring-v2 — scores that survive a wrong time estimate, and bonuses that scale

## Why

Two complaints from the organizer, both confirmed in `packages/shared/src/scoringPresets.ts`:

1. **A mission time the creator filled in wrong produces a completely wrong score.**
   - `smart_weighted` pays `100 × difficulty/10 × sigmoid(actual / estimate)`, where the sigmoid
     ranges 0.2 … 1.5. That is a **7.5× swing** decided by the author's guess.
   - An estimate of 2 minutes on a mission that really takes 15 (walking included, because
     `startedAt` is stamped at assignment) puts every team at x ≈ 7.5. Every team then gets the
     0.2 floor, so the mission is worth a fifth of its difficulty and nobody is told why.
   - The reverse case, a 60-minute guess on a 5-minute mission, pays everyone almost 1.5×.
   - `fixed_points_speed` pays `10 points × minutes under the expected route total`, capped at 200.
     When the expected minutes are off, either every team gets the full +200 or nobody gets
     anything.
   - The expected route total also sums SKIPPED records: missions that were closed, expired,
     unreachable, lost to an exclusive group, or left over in a satisfied stage. A team that played
     less was therefore measured against a longer route and handed a bigger speed bonus for it.
2. **The flat bonuses make the score jump by abnormal amounts.** There is no explicit
   1st/2nd/3rd prize; what jumps the top of the board is three FLAT amounts added on top of mission
   points, whatever the game's point scale:
   - a +500 completion bonus;
   - the speed bonus of up to +200;
   - the final "speed vs the field" Z-score of ±200 points per standard deviation.
   In a game whose missions are worth 10 points each, +500 for finishing outweighs every mission
   in the game together.

## What changes

Inspiration comes from how comparable games score (research notes in `design.md`):
- **Kahoot**: a correct answer is never worth less than half; speed only scales it.
- **Orienteering**: reference times come from the FIELD (median or winner), so they are robust to
  a badly set course estimate.
- **Rogaining / Score-O**: fixed control values, with time handled separately and boundedly.

The changes:
- **Bounded per-mission speed (smart).** The multiplier becomes 0.7 … 1.3 instead of 0.2 … 1.5, and
  on-target pays exactly the difficulty value (×1.0). A wrong estimate can now move a mission's
  value by at most ±30%, never 5×. Speed still matters, it just cannot dominate what the mission
  is worth.
- **Speed measured against the field, not against the author (both point presets).** A finished
  team's pace is its adjusted duration divided by the expected minutes of the missions it actually
  COMPLETED. That pace is compared to the median pace of all finished teams.
  - A systematically wrong estimate multiplies every team's pace by the same factor, so it cancels
    out exactly.
  - The estimates only weight missions relative to one another, which keeps teams that played
    different subsets comparable.
  - With a single finisher there is no field. The author's estimate is used only if the team's
    actual time is within 3× of it in either direction; otherwise the estimate is judged unreliable
    and no pace term is applied.
- **All bonuses are percentages of the points the team earned on missions.**
  - Completion: **+10%**.
  - Pace: half the relative pace difference, capped at **+15%** fast and **−10%** slow (finishing never hurts).
  - These replace the +500 flat completion bonus, the +200 speed bonus and the ±200/σ Z-score.
  - Penalties and flat bonuses (hints, staff adjustments, discovery, zone capture) still ride
    `bonusPenalty` and are applied last, so a 20-point fine is still exactly 20 points.
- **The expected route counts completed missions only** (bug fix).
- `time_only` is unchanged.

## Impact

- `packages/shared/src/scoringPresets.ts`: new curve and the pace + percentage helpers. The
  `speedBonus` / `applyZScoreBonus` / flat `COMPLETION_BONUS` path is retired.
- `functions/src/runs/index.ts` `buildRankings`: the single ranking site shared by
  `refreshLeaderboard` and `finalizeRun`, so live/final parity holds by construction. Every input
  is still a stored stamp; nothing is re-read from the template or from `now`.
- Mission points already stamped on a record (`earnedScore`) are never rewritten, so
  Σ earnedScore == `team.score` still holds. A finalized run's stored leaderboard is frozen and does
  not move.
- The creator copy that says "up to +200 pts" is updated in Hebrew and English.
