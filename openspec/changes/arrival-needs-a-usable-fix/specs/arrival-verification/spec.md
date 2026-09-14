## ADDED Requirements

### Requirement: A location fix must be good enough to prove arrival

A check-in at a located mission SHALL be judged against the fix's own reported error,
not against its coordinates alone. A fix whose error is larger than the radius it is
being measured against carries no information about whether the player is inside that
radius, and SHALL NOT by itself count as proof of arrival.

A check-in that reports no accuracy at all SHALL behave exactly as it did before this
requirement existed, so that a participant app which has not been updated is never
stranded.

#### Scenario: An ordinary outdoor fix is unaffected

- **WHEN** a player checks in from inside the radius with a fix whose error is small
  relative to that radius
- **THEN** the check-in is accepted exactly as before
- **AND** the arrival is recorded as proven

#### Scenario: A fix too imprecise to locate the player is not immediate proof

- **WHEN** a player checks in with a fix whose reported error exceeds the radius being
  measured against
- **THEN** the check-in is not immediately accepted as arrival

#### Scenario: An imprecise fix is recoverable, not fatal

- **WHEN** a check-in is refused because the fix was too imprecise
- **THEN** the player is told to wait for a better fix and can try again
- **AND** the route to ask a human for help is still offered
- **AND** no wrong attempt is recorded against the team

#### Scenario: A retry with a better fix succeeds

- **WHEN** the player retries from the same place once the device reports a better fix
- **THEN** the check-in is accepted as a proven arrival

#### Scenario: A client that sends no accuracy is not punished

- **WHEN** a check-in arrives with coordinates but no accuracy
- **THEN** the decision is exactly the distance-versus-radius one made before this
  requirement existed

#### Scenario: A mission with no location is unaffected

- **WHEN** the mission is locationless or self-reported
- **THEN** no accuracy is required and nothing about the check-in changes

### Requirement: An arrival gate must never make a mission unwinnable

Accuracy SHALL delay a check-in, and SHALL NEVER permanently prevent one. A player
standing in the correct place must always have a route through, because ending
someone's game is a worse outcome than accepting a weak fix.

Two bounds SHALL enforce this, and neither is optional.

The radius enforced SHALL be at least a documented floor representing what consumer
satellite positioning can actually resolve. An authored radius below that floor
describes a mission no device can complete, so the floor SHALL be applied instead.
The floor SHALL only ever widen a radius, never narrow one, so no mission becomes
harder than it was authored.

After a bounded grace period measured from the team's FIRST refusal at that mission,
a check-in from inside the radius SHALL be accepted even though the fix cannot prove
it. The grace period SHALL be measured per team and per mission, and repeated
attempts within it SHALL NOT extend it.

#### Scenario: A tightly authored radius is still winnable

- **WHEN** a mission is authored with a radius smaller than the floor
- **AND** a player checks in from the spot with an ordinary handset fix
- **THEN** the check-in is accepted
- **AND** it is judged against the floor, not against the authored radius

#### Scenario: Persistently poor reception does not end the game

- **WHEN** a player is refused for an imprecise fix
- **AND** the grace period passes
- **AND** they check in again from inside the radius with a fix that still cannot
  prove it
- **THEN** the check-in is accepted

#### Scenario: Pressing repeatedly does not push the window away

- **WHEN** a player presses again before the grace period has passed
- **THEN** the check-in is refused in the same recoverable way
- **AND** the grace period continues to be measured from the FIRST refusal

#### Scenario: The grace period forgives imprecision, never distance

- **WHEN** the grace period has passed
- **AND** the player checks in from outside the radius
- **THEN** the check-in is refused as too far

### Requirement: An unproven arrival is recorded for the organizer only

An arrival accepted without the fix proving it SHALL be recorded against that mission
for the team, and the organizer SHALL be able to see how many such arrivals a run has
produced.

That record SHALL NOT be disclosed to the participant in any payload. Telling a player
that waiting got them through would publish a reliable way past the gate, which is the
behaviour the record exists to detect.

The organizer-facing presentation SHALL be informational rather than accusatory: the
ordinary cause is poor reception, and the system accepted the check-in deliberately.

#### Scenario: A proven arrival is not marked

- **WHEN** a check-in is accepted on a fix that could prove it
- **THEN** no unverified-arrival record is written

#### Scenario: An unproven arrival is visible to the organizer

- **WHEN** a check-in is accepted only because the grace period had passed
- **THEN** the mission record for that team is marked unverified
- **AND** the organizer's run view reports a count of such arrivals

#### Scenario: The participant is never told

- **WHEN** a participant reads their own team state after such an arrival
- **THEN** the payload contains no indication that the arrival was unverified
