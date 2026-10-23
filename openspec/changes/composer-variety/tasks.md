# Tasks: composer-variety

## 1. RED
- [x] 1.1 `scripts/test-composer-variety.ts`: `choiceExtras`; over 216 composed games, extras only
      with several teams, never in the opener or finale, never past six, never raising what a team
      must do, every stage winnable; the hidden mission is single, central, placed, with a required
      clue; none without prep or without a clue prompt.

## 2. GREEN
- [x] 2.1 `composeGame`: the fill and the emit become functions; extras and the hidden mission run
      after naming; `usedBankKeys` in reading order; `extraTaskIds`; per-team time.
- [x] 2.2 `hiddenCluePrompt` in the copy (HE/EN) and the dashboard.
- [x] 2.3 Preview and shape tests read one team's game.

## 3. Verify
- [ ] 3.1 `npm run verify`.
- [ ] 3.2 A composed game with 12 players in the browser: a choice stage on the plan, the hidden
      mission's clue card, and the run console routing two teams to different missions.

## 4. Time by difficulty
- [x] 4.1 RED `scripts/test-mission-time.ts`: scaling arithmetic, text and timer together, a
      mismatched text left alone, content lengths untouched, every bank countdown scalable, composed
      games carry the scaled value, and no-location games hold no located mission.
- [x] 4.2 GREEN `lib/missionTime.ts` + one call in `composeGame`'s emit.
