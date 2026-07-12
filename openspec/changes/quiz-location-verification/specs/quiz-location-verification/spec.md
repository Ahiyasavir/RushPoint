# quiz-location-verification Specification (delta)

## ADDED Requirements

### Requirement: Answer tasks may optionally require physical presence
An answer-graded task (`quiz`, `numeric`, or `survey`) SHALL support an optional `requirePresence`
flag that defaults to OFF. When the flag is unset, the task grades exactly as before with no proximity
check, so existing games are unaffected. When the flag is set AND the task has valid `coordinates`,
`submitTaskAnswer` MUST verify the submitted GPS is within a lenient radius before grading the answer.

#### Scenario: Presence is not enforced when the flag is off
- **WHEN** a participant submits an answer to a `quiz`/`numeric`/`survey` task that has no
  `requirePresence` flag
- **THEN** the answer is graded normally regardless of the submitted location (no behavior change)

#### Scenario: An in-range answer is graded when presence is required
- **WHEN** a task has `requirePresence` set with `coordinates`, and a participant submits a correct
  answer with GPS within the lenient radius of those coordinates
- **THEN** the answer is graded and, if correct, the task completes as usual

#### Scenario: A locationless presence-flagged task never locks the team out
- **WHEN** `requirePresence` is set on a task that has no valid `coordinates`
- **THEN** the presence gate passes and the answer is graded normally (the flag is a no-op, not a lockout)

### Requirement: An out-of-range or GPS-less answer is refused before grading
`submitTaskAnswer` MUST refuse the submission before grading when `requirePresence` is active and the
submitted GPS is outside the lenient radius, or is missing or invalid, and MUST NOT record it as a
wrong attempt or consume an attempt-limit slot. The refusal message MUST NOT contain the distance
figure or any answer-key data, so it leaks nothing even for a hidden-location task.

#### Scenario: An answer submitted from far away is refused
- **WHEN** a participant submits the correct answer to a `requirePresence` task from GPS well outside
  the lenient radius
- **THEN** the call fails with a `failed-precondition` "move closer" error, the answer is not graded,
  and no wrong-attempt is recorded

#### Scenario: An answer with missing GPS is refused, not waved through
- **WHEN** a participant submits an answer to a `requirePresence` task with no/invalid `lat`/`lng`
- **THEN** the call is refused with a friendly location-required error (disabling location cannot
  bypass the gate)

### Requirement: The presence radius is lenient and creator-tunable
The presence check SHALL use a generous default radius so noisy urban GPS does not block a team that is
genuinely at the spot, and MUST honor a creator-set `geofenceRadiusMeters` override when it is a finite
positive value.

#### Scenario: The generous default admits a nearby team
- **WHEN** a `requirePresence` task has no explicit `geofenceRadiusMeters` and a team answers from a
  point a few tens of metres from the coordinates
- **THEN** the default lenient radius (150m) admits the submission and it is graded

#### Scenario: A creator-set radius overrides the default
- **WHEN** a `requirePresence` task sets `geofenceRadiusMeters` to a finite positive value
- **THEN** the presence check uses that radius instead of the 150m default

### Requirement: The presence flag is exposed without weakening secrecy
The sanitized participant task payload SHALL include `requirePresence` so the client knows it must
attach GPS to an answer submission, while continuing to strip every answer key (`answers`,
`numericAnswer`, `steps[].answer`, `hint`, `smart.secretCode`). Exposing the flag MUST NOT expose any
answer-key data.

#### Scenario: The client sees the flag but not the answer key
- **WHEN** a participant fetches a `requirePresence` quiz task via `getMyTeamState`
- **THEN** the payload carries `requirePresence` (so the client sends GPS) and still carries no
  `answers`/`numericAnswer` or other server-secret answer key
