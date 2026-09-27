# Tasks: answer-scored-question

## 1. RED

- [x] 1.1 `scripts/test-answer-outcomes.ts` against the not-yet-existing matcher/validator. Confirm RED.
- [x] 1.2 Add the new fields to `Task` and run `scripts/test-shared-game-view.ts`; confirm it fails until
      they are declared withheld (proves the guard sees them).
- [x] 1.3 e2e scenario "points by answer", headline station-code case first (design, test strategy). Confirm RED.

## 2. GREEN

- [x] 2.1 Types, `matchAnswerOutcome`, validation in `validation.ts` and `gameFile.ts`. 1.1 → green.
- [x] 2.2 `sharedGameView.ts` withheld declaration; public task projection strips the fields. 1.2 → green.
- [x] 2.3 (`choicePoints` beside `choices` only when `revealOutcomePoints === true`; Builder checkbox; play-web shows "50 נק׳" on each button) Participant sanitizer: derive `choices` from labels; points only when revealed.
- [x] 2.4 (`outcomeId` is stamped on the task record, which the report and team page read; `checkChallengeAnswer` goes through `challengeVerdict`, scripts/test-challenge.ts) `verifyStationCode`, `submitTaskAnswer` (+ `checkChallengeAnswer`) grade outcomes; `completeTaskForTeam` `awardOverride`
      per design D3; answer log `outcomeId`. 1.3 → green.
- [x] 2.5 `updateGame`/`importGameFile` validation wired.
- [x] 2.6 (QR sheet: `lib/stationQrSheet.ts`, scripts/test-station-qr-sheet.ts) Builder editors (design D5): station "several codes" and question "points by answer", including the
      time_only rule; station QR sheet prints one QR per code. Clearing the mode sends the fields ABSENT.
- [x] 2.7 (report `outcomeId`/`outcomeLabel` + the key as "זעתר 50 · מרווה 100 · * 5"; Excel "answer given" column; report chip; team page "ענו: …") Console, post-run report and Excel export show the outcome. i18n he/en.

## 3. REFACTOR

- [ ] 3.1 NOT DONE, deliberately: sharing the normaliser would make ordinary quizzes also strip niqqud and collapse spaces, silently re-grading live games (design D2 keeps their exact comparison). Revisit only as its own change. `matchesTaskAnswer` and `matchAnswerOutcome` share one normaliser.

## 4. Verify

- [x] 4.1 (browser, 2026-09-26: points on buttons, quiz 20 + station code 100 = 120, team page names both answers, QR sheet printed a card per code with its points) Preview: author, play, review in the report.
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
