## 1. RED

- [x] 1.1 Add the e2e scenario "completion requires holding the mission (every participant door)" to
  `scripts/e2e-verify.mjs`. Run it; confirm all five doors accept the unheld mission (they did:
  the intruder scored 500).

## 2. GREEN

- [x] 2.1 `teamHoldsTask` / `assertTeamHoldsTask` in `functions/src/runs/index.ts`; call it right after
  the stage check in `completeTask` (which gains that stage check), `submitTaskAnswer`,
  `submitSequenceStep`, `verifyStationCode`, `submitStationPhoto`, and before the test-drive photo
  approval in `revealTaskAnswer`.
- [x] 2.2 Re-check inside `completeTaskForTeam`'s transaction, after the terminal no-op; opt out
  only in `reviewStationSubmission` (`allowUnheld`).
- [x] 2.3 Pure test `functions/src/runs/teamHoldsTask.test.ts`.

## 3. Existing scenarios

- [x] 3.1 Add `handTo` to the e2e (hands a mission over through `forceAssignTask`) and use it where a
  scenario acted on a mission routing never handed it. Invert the two assertions that encoded the
  old behaviour (cross-team completion, hand-crafted non-assigned answer) and let guard tests whose
  mission can never be held accept the holding refusal too.

## 4. Gates

- [x] 4.1 `npm run e2e` (full, offset lane) green.
- [x] 4.2 `npm run verify`: every gate green; three slow unit files (composer/preview, untouched here) timed out at 120 s under the full parallel load and pass alone and at `RUSHPOINT_UNIT_CONCURRENCY=4` (428/428).
