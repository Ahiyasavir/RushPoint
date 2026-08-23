## ADDED Requirements

### Requirement: A safe-zone boundary is validated before it is stored

The system SHALL validate a safe-zone boundary before persisting it, so the enforcement path can
never read a boundary the system would not have accepted. A boundary SHALL be accepted only with a
finite centre latitude within the valid latitude range, a finite centre longitude within the valid
longitude range, and a finite radius that is strictly positive and no larger than a documented
maximum.

An absent boundary SHALL mean "unchanged". An explicit clear SHALL remove the boundary. A present but
malformed boundary SHALL be refused rather than stored.

An accepted boundary SHALL be stored as centre and radius only, so no additional client-supplied
keys ride into a field the safety path reads.

#### Scenario: A well-formed boundary is accepted

- **WHEN** a game update supplies a centre in range and a positive radius within the maximum
- **THEN** the boundary is stored as centre and radius

#### Scenario: Non-finite coordinates are refused

- **WHEN** a boundary's latitude or longitude is not a finite number
- **THEN** the update is refused and no boundary is stored

#### Scenario: Out-of-range coordinates are refused

- **WHEN** a boundary's latitude is outside the valid latitude range, or its longitude is outside the valid longitude range
- **THEN** the update is refused

#### Scenario: A non-positive radius is refused

- **WHEN** a boundary's radius is zero or negative
- **THEN** the update is refused, because a zero radius is a boundary every team is outside of rather than an absent boundary

#### Scenario: An absurd radius is refused

- **WHEN** a boundary's radius exceeds the documented maximum
- **THEN** the update is refused

#### Scenario: Clearing the boundary is allowed

- **WHEN** a game update explicitly clears the safe zone
- **THEN** the boundary is removed and location handling returns to unbounded behavior

#### Scenario: Omitting the boundary changes nothing

- **WHEN** a game update omits the safe zone
- **THEN** the stored boundary is left exactly as it was

### Requirement: The creator can author the safe-zone boundary

A creator SHALL be able to turn a safe-zone boundary on, adjust it, and remove it from the game
builder. The setting the server enforces SHALL NOT be reachable only by hand-editing a game file.

The builder SHALL offer a boundary derived from the stops the creator has already placed, so a
creator sets a play area without composing coordinates by hand. The derivation SHALL be a pure
function of the game's stages: it SHALL ignore stops that carry no usable location, SHALL contain
every stop that does, and SHALL report when the stops are spread too wide to be contained.

Clearing the boundary SHALL be sent as an explicit clear and SHALL remove the stored boundary. An
omitted boundary SHALL leave the stored value untouched.

#### Scenario: A boundary is fitted to the game's stops

- **WHEN** the creator turns the play area on for a game with at least one placed stop
- **THEN** the game receives a boundary centred on the extent of those stops, with a radius that
  contains all of them plus walking room

#### Scenario: A game with no placed stop cannot fit an area

- **WHEN** no stop of the game carries a usable location
- **THEN** no boundary is offered, and the creator is told why

#### Scenario: Stops spread too wide are reported

- **WHEN** the game's stops are spread further apart than the maximum permitted radius
- **THEN** the suggested boundary is capped at the maximum and the creator is warned that some stops
  fall outside it

#### Scenario: Removing the boundary actually removes it

- **WHEN** the creator removes the play area and the game is saved
- **THEN** the stored boundary is deleted and location handling returns to unbounded behavior

#### Scenario: The boundary is part of the builder's saved payload

- **WHEN** the creator changes or clears the play area
- **THEN** the game is marked unsaved and the change is included in the update sent to the server

### Requirement: The file-import door validates the boundary on the same terms

A game restored from a file SHALL have its safe-zone boundary validated on exactly the same terms as
one authored in the builder, and SHALL be stored as centre and radius only. A file MUST NOT be able
to write a boundary that an authored game would have been refused.

#### Scenario: A malformed boundary in a file is refused

- **WHEN** a game file supplies a boundary with a non-finite coordinate, a non-positive radius, or a
  radius beyond the maximum
- **THEN** the import is refused and no game is created

#### Scenario: Extra keys in a file boundary are dropped

- **WHEN** a game file supplies a valid boundary carrying additional keys
- **THEN** only the centre and radius are stored
