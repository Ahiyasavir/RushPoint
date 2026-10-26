## Why

The 23.10 deploy check proved, in production, that a team can complete and score a mission it was
never handed. In a run of the deploy test game a station capped at one team was held by team C;
team A, whose `requestNextTask` had just answered `stationsFull` and so held nothing, called
`completeTask({ taskId: 'dt-station-wait', code })` and the server answered `{ ok: true }` and stored
the task `completed` with 100 points. That defeats the station cap and the routing at once. The app
never does this (it only shows the assigned mission), but anyone sending raw requests can. The hole
predates the 22.10 and 23.10 deploys.

`completeTaskForTeam` accepted a record in status `unassigned` on purpose (its `heldSlot` flag only
stopped such a completion from draining another team's slot), and none of the five participant doors
checked that the mission was the team's own.

## What Changes

- Every participant completion door refuses a mission the team does not hold:
  `completeTask`, `submitTaskAnswer`, `submitSequenceStep`, `verifyStationCode`,
  `submitStationPhoto` (pending or auto-approved), and the test-drive photo approval in
  `revealTaskAnswer`. Refusal is `failed-precondition`, message
  "This mission is not the one your team is on", `details.reason: 'not-held'`.
- The check runs BEFORE grading, so an unheld mission is not an answer oracle and records no
  attempt, step progress or submission.
- `completeTaskForTeam` re-checks the same rule inside its transaction and refuses by default; only
  a staff decision opts out (`allowUnheld`, used by `reviewStationSubmission`).
- `completeTask` now runs the same stage check as the other doors before the holding check.

## Capabilities

### Modified Capabilities
- `answer-submission`: a team may only complete the mission it holds.

## Impact

- `functions/src/runs/index.ts`, `functions/src/index.ts`. No client change: play-web only ever
  submits the mission on screen. No schema change, no new reads.
- `scripts/e2e-verify.mjs`: a new scenario, plus existing scenarios that completed missions routing
  never handed them now hand the mission over first (`handTo`, via `forceAssignTask`).
