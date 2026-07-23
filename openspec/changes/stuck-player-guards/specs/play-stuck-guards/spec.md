## ADDED Requirements

### Requirement: Client state never permanently blocks a participant

No client-side state in the participant app SHALL permanently prevent a participant from attempting
to progress. Every client-side gate that can disable, hide or block a control the participant needs
SHALL either clear itself automatically once its cause is gone, or allow the attempt through so the
server — the only authority on whether an action is permitted — can decide.

Client-side gates SHALL be decided from durations, counters and identities only. A gate SHALL NOT be
decided by comparing a stored absolute instant against the device clock, and SHALL NOT be restored
from persisted state after a reload.

#### Scenario: A gate decision is independent of the device clock

- **WHEN** a blocking decision is evaluated on a device whose clock is hours ahead or hours behind
- **THEN** the decision is identical to the decision on a correct clock

#### Scenario: A reload cannot restore a blocked state

- **WHEN** the participant reloads the app
- **THEN** no client-side gate resumes in a blocking state, because none of them is persisted

### Requirement: Geofence check-in recovers from a transient GPS error

The automatic geofence check-in watcher SHALL treat a geolocation error as transient. After an error
the app SHALL keep observing the participant's position — retrying on a bounded, growing delay — and
SHALL clear the error state as soon as a position fix succeeds, without requiring a reload, a
different task, or staff intervention.

The retry delay SHALL always be a finite, positive, bounded duration, so there is no state in which
the app has stopped trying to obtain a position.

#### Scenario: A transient position error recovers by itself

- **WHEN** the position watcher reports an error and a later fix succeeds
- **THEN** the app resumes reporting the participant's distance and can auto-check-in on arrival

#### Scenario: The app never gives up on location

- **WHEN** the position watcher has failed any number of times in a row
- **THEN** the next retry is still scheduled after a finite, bounded delay

#### Scenario: A permission granted later is picked up

- **WHEN** location permission is denied and the participant grants it afterwards
- **THEN** the next scheduled retry obtains a fix and the error state clears without a reload

### Requirement: The stuck-participant help affordance is scoped to one task

The "ask the host for help" affordance SHALL remember that help was requested only for the task it
was requested on. When the participant is working on a different task, the affordance SHALL be
available again.

A failed help request SHALL NOT record that help was sent.

#### Scenario: Help can be requested again on a later task

- **WHEN** the participant requested help on one task and is later stuck on another
- **THEN** the help affordance is offered again for the new task

#### Scenario: A failed request leaves the affordance available

- **WHEN** the help request fails
- **THEN** the affordance remains available so the participant can try again

### Requirement: The offline gate warns once, then defers to the network

When the browser reports the device as offline, the app SHALL surface a localized offline message
instead of submitting, and SHALL tell the participant that trying again will attempt the submission
anyway. A repeated attempt on the same task SHALL be sent, so a browser offline flag that is wrong
cannot block a participant whose connection actually works.

When the browser reports the device as online, or reports nothing at all, the app SHALL NOT block
the attempt.

#### Scenario: The first attempt while offline is explained

- **WHEN** the browser reports the device offline and the participant submits
- **THEN** a localized offline message is shown, telling them another attempt will try anyway

#### Scenario: A repeated attempt is sent

- **WHEN** the participant attempts the same task again while the browser still reports offline
- **THEN** the submission is sent and the outcome is decided by the network and the server

#### Scenario: Unknown connectivity does not block

- **WHEN** the browser exposes no connectivity information
- **THEN** the attempt is not blocked
