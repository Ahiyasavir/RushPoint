## ADDED Requirements

### Requirement: A team may only complete the mission it holds
Every participant completion door (`completeTask`, `submitTaskAnswer`, `submitSequenceStep`,
`verifyStationCode`, `submitStationPhoto`, and the test-drive photo approval in `revealTaskAnswer`)
SHALL refuse a mission the calling team does not hold, with `failed-precondition` and
`details.reason: 'not-held'`. A mission is held when the team's record for it is `assigned` or it
is the team's `activeTaskId`. The refusal SHALL happen before any grading, so it records no attempt,
step progress or submission. `completeTaskForTeam` SHALL apply the same rule inside its transaction
unless a staff caller opts out. A completed or skipped record SHALL keep returning the idempotent
no-op.

#### Scenario: A team completes a capped station another team holds
- **WHEN** a station capped at one team is held by team C and team A, which holds nothing, calls
  `completeTask` on it
- **THEN** the call fails with `failed-precondition`
- **AND** team A's record stays `unassigned` with no score, and the station still counts one holder

#### Scenario: Every door refuses an unheld mission before grading
- **WHEN** a team submits a correct answer, sequence step, station code or photo for a mission it
  does not hold
- **THEN** each call fails with `failed-precondition` and nothing is written to the team

#### Scenario: The holder is unaffected
- **WHEN** the team that holds the mission completes it
- **THEN** it completes and scores as before

#### Scenario: A staff review may still complete it
- **WHEN** an organizer approves a photo the team submitted while holding the mission, after the team
  was routed elsewhere
- **THEN** the approval completes the mission
