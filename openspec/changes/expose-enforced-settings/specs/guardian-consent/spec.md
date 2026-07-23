## ADDED Requirements

### Requirement: A consent hold is reported, never silently subtracted

When teams are started on a run whose game requires guardian consent, the system SHALL report how
many teams were held for consent alongside how many were launched. A team that did not start because
consent is missing SHALL NOT be indistinguishable from a team that was not selected.

The organizer-facing surface SHALL NOT report unqualified success when one or more teams were held.

The launched set and the held count SHALL be derived from a single decision over (teams, game
config), so the number reported and the teams actually started can never disagree.

#### Scenario: Held teams are counted in the result

- **WHEN** teams are started on a run that requires guardian consent and no consent has been recorded
- **THEN** the result reports zero launched and the number of teams held for consent

#### Scenario: A partially consented cohort reports both numbers

- **WHEN** some teams have recorded consent and others have not
- **THEN** the result reports the consented teams as launched and the remainder as held

#### Scenario: The organizer is not told it worked

- **WHEN** the organizer starts teams and at least one team was held for consent
- **THEN** the console reports the held count instead of an unqualified success message

#### Scenario: A run without the requirement is unaffected

- **WHEN** teams are started on a run that does not require guardian consent
- **THEN** every selected team launches and the held count is zero

### Requirement: Consent configuration is validated server-side

The system SHALL validate the guardian-consent flag and the minimum age on the way in, and SHALL
refuse a malformed value rather than persisting it. An absent value SHALL mean "unchanged" and MUST
NOT be treated as an error.

The consent flag SHALL be accepted only as a boolean, so a non-boolean value can never arm the gate.

#### Scenario: A non-boolean consent flag is refused

- **WHEN** a game update supplies the guardian-consent flag as a string or a number
- **THEN** the update is refused and nothing is persisted

#### Scenario: A malformed minimum age is refused

- **WHEN** a game update supplies a minimum age that is fractional, negative, not a number, or absurdly large
- **THEN** the update is refused and nothing is persisted

#### Scenario: Omitting the fields changes nothing

- **WHEN** a game update omits both fields
- **THEN** the stored values are left exactly as they were
