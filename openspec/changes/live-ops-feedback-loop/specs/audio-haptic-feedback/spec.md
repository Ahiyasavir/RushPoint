## ADDED Requirements

### Requirement: A submission arriving for review plays a cue

The creator Run Console and the staff console SHALL play the alert cue when a team's
submission enters the pending review queue, so an organizer learns a team is blocked
without watching the screen.

The cue SHALL be baselined on the first snapshot: opening a console over an existing
queue, or refreshing it, SHALL play nothing however many items are pending. Only a
submission that was not present in the previous snapshot cues. A submission LEAVING
the queue SHALL never cue.

A defect in the cue SHALL never prevent the queue from rendering — the decision is a
total function whose failure mode is silence.

#### Scenario: A new submission cues

- **WHEN** a team submits a photo or video and the console is open
- **THEN** the alert cue plays once

#### Scenario: Opening the console over a queue is silent

- **WHEN** an organizer opens the Run Console and the pending queue already holds items
- **THEN** no cue plays

#### Scenario: A refresh is silent

- **WHEN** the console re-subscribes to its listener, including after switching runs
- **THEN** the first snapshot after re-subscribing plays no cue

#### Scenario: Reviewing an item does not cue

- **WHEN** a pending submission is approved or rejected and leaves the queue
- **THEN** no cue plays

#### Scenario: The staff console cues too

- **WHEN** a submission enters the pending queue while a staff member has the staff
  console open
- **THEN** the same alert cue plays
