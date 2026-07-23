## ADDED Requirements

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
