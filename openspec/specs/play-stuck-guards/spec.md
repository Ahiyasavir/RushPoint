# play-stuck-guards Specification

## Purpose
TBD - created by archiving change blocked-player-guidance. Update Purpose after archive.
## Requirements
### Requirement: A blocked participant is told what is blocking them and how to reach a human

When the participant app blocks progress on a server decision, it SHALL present the server's stated
reason as guidance the participant can act on, and SHALL offer a route to a human from the blocking
card itself.

The app SHALL distinguish, at minimum:

- that the participant is outside the play area, in which case it SHALL state approximately how far
  back the boundary is when the server supplied that distance;
- that the participant's location could not be established with confidence, in which case the copy
  SHALL NOT attribute the block to anything the participant did, and SHALL NOT state a distance;
- that staff have already released the participant, or that the server reports nothing blocking
  them, in which case it SHALL invite them to re-check rather than tell them to move.

The mapping from the server's reason to the guidance SHALL be a pure, total function: any reason
value, including a missing, empty, unrecognized or malformed one, SHALL produce guidance rather than
an error, and SHALL NOT assert a boundary violation that the reason does not state.

Every such blocking card SHALL offer the existing host-help affordance and a re-check that asks the
SERVER again. The app SHALL NOT clear a server-set block on its own determination, and SHALL NOT
offer a completion path that skips server validation.

#### Scenario: Outside the play area

- **WHEN** the server reports that the team is outside the boundary and supplies the distance beyond
  it
- **THEN** the card says they are outside, states approximately how many metres back it is, and
  offers both the host-help affordance and a re-check

#### Scenario: The location cannot be established

- **WHEN** the server reports that the last fix was too imprecise, too old, absent, malformed or
  otherwise unverifiable
- **THEN** the card says that WE could not place the team, does not blame them, shows no distance,
  and offers both the host-help affordance and a re-check

#### Scenario: Staff already released the team

- **WHEN** the server reports a staff override, a position inside the zone, or no boundary at all
- **THEN** the card says nothing is blocking them and invites a re-check, instead of telling them to
  head back

#### Scenario: An unknown reason

- **WHEN** the server sends no reason, an empty reason, or a value this app version does not know
- **THEN** the card still renders, claims no violation, shows no distance, and still offers the
  host-help affordance and a re-check

#### Scenario: A distance is never shown from a fix the server distrusts

- **WHEN** a distance accompanies a reason other than "outside"
- **THEN** no distance is shown to the participant

### Requirement: A geofence task that never obtains a fix still reaches a human

When the automatic geofence check-in has not succeeded after its stuck threshold, the app SHALL
offer the host-help affordance whether the participant is known to be outside the radius OR no
position fix has been obtained at all.

#### Scenario: No fix ever arrives and no error is reported

- **WHEN** the position watcher produces neither a fix nor an error and the stuck threshold elapses
- **THEN** the geofence card offers the host-help affordance instead of remaining a motionless
  "finding your location" state

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

