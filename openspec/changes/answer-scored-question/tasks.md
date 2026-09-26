# Tasks: answer-scored-question

## 1. RED

- [ ] 1.1 `scripts/test-answer-outcomes.ts` against the not-yet-existing matcher/validator. Confirm RED.
- [ ] 1.2 Add the new fields to `Task` and run `scripts/test-shared-game-view.ts`; confirm it fails until
      they are declared withheld (proves the guard sees them).
- [ ] 1.3 e2e scenario "points by answer", headline station-code case first (design, test strategy). Confirm RED.

## 2. GREEN

- [ ] 2.1 Types, `matchAnswerOutcome`, validation in `validation.ts` and `gameFile.ts`. 1.1 → green.
- [ ] 2.2 `sharedGameView.ts` withheld declaration; public task projection strips the fields. 1.2 → green.
- [ ] 2.3 Participant sanitizer: derive `choices` from labels; points only when revealed.
- [ ] 2.4 `verifyStationCode`, `submitTaskAnswer` (+ `checkChallengeAnswer`) grade outcomes; `completeTaskForTeam` `awardOverride`
      per design D3; answer log `outcomeId`. 1.3 → green.
- [ ] 2.5 `updateGame`/`importGameFile` validation wired.
- [ ] 2.6 Builder editors (design D5): station "several codes" and question "points by answer", including the
      time_only rule; station QR sheet prints one QR per code. Clearing the mode sends the fields ABSENT.
- [ ] 2.7 Console, post-run report and Excel export show the outcome. i18n he/en.

## 3. REFACTOR

- [ ] 3.1 `matchesTaskAnswer` and `matchAnswerOutcome` share one normaliser.

## 4. Verify

- [ ] 4.1 Preview: author, play, review in the report.
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
