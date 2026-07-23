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
