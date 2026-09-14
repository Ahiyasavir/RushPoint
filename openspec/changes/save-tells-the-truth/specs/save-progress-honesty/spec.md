## ADDED Requirements

### Requirement: A save that has not landed says so before the request gives up

The Builder SHALL distinguish a save that is proceeding normally from one that has been
in flight long enough to be in trouble, and SHALL say so without waiting for the
underlying request to time out.

The escalation SHALL be based on how long the save has actually been in flight, and
SHALL be total: a missing or unusable clock SHALL read as an ordinary save in progress
rather than raising a false alarm.

#### Scenario: A quick save looks exactly as it does today

- **WHEN** a save completes within the ordinary window
- **THEN** the creator sees the ordinary saving indication and nothing else

#### Scenario: A save still in flight after a few seconds says it is still trying

- **WHEN** a save has been in flight past the slow threshold
- **THEN** the Builder says it is still trying, rather than continuing to say "saving"

#### Scenario: A save in flight far past the threshold names the likely cause

- **WHEN** a save has been in flight past the stalled threshold
- **THEN** the Builder says the connection looks like the problem

#### Scenario: An unusable clock does not cry wolf

- **WHEN** the elapsed time cannot be determined
- **THEN** the save is reported as an ordinary save in progress

### Requirement: Being offline is reported immediately, and never blocks the save

Where the browser reports itself as offline while a save is in flight, the Builder SHALL
say so at once rather than waiting for a timeout.

This report SHALL be informational only. It SHALL NOT prevent, delay, queue or discard
a save, because a browser that reports itself offline may have a working connection, and
refusing to send would turn a wrong guess into lost work.

#### Scenario: An offline report appears without waiting

- **WHEN** a save is in flight and the browser reports it is offline
- **THEN** the creator is told immediately

#### Scenario: The save is still attempted

- **WHEN** the browser reports it is offline
- **THEN** the save is still sent

#### Scenario: A browser that reports nothing is not assumed to be offline

- **WHEN** no connectivity information is available
- **THEN** the save is reported as an ordinary save in progress

### Requirement: The manual save is always available

The Builder's manual save control SHALL remain operable at all times, including while
another save is in flight.

A creator who suspects their work is not being persisted SHALL always be able to act on
that suspicion. The control SHALL NOT be disabled by the very condition it exists to
recover from.

#### Scenario: Manual save is clickable during a slow save

- **WHEN** a save has been in flight for a long time
- **THEN** the manual save control can still be pressed

#### Scenario: Pressing it while a save is in flight is harmless

- **WHEN** the manual save is pressed while another save is already in flight
- **THEN** no work is lost and no stale state is persisted
