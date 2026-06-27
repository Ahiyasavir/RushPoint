# guardian-consent Specification

## Purpose
TBD - created by archiving change guardian-consent-qr. Update Purpose after archive.
## Requirements
### Requirement: Runs can require guardian consent before a minor plays
A creator SHALL be able to mark a game/run as requiring guardian consent (with a minimum age). When a
minor joins such a run they MUST enter a consent-required state and cannot start playing until consent
is recorded.

#### Scenario: Consent-required run blocks play until approved
- **WHEN** a minor joins a run that requires guardian consent
- **THEN** the team is held in a pending-consent state and cannot start

#### Scenario: Consent satisfaction is correctly evaluated
- **WHEN** `isConsentSatisfied` is evaluated for a run that requires consent with no record
- **THEN** it returns false
- **WHEN** a consent record is present (or the run does not require consent)
- **THEN** it returns true

### Requirement: Guardian consent is granted server-side via a single-use token
`requestGuardianConsent` SHALL mint a single-use consent token and link, and `grantGuardianConsent`
SHALL record the consent server-side. Consent MUST NOT be self-approvable by the child; an invalid or
already-used token MUST be refused.

#### Scenario: Guardian approves and the child can play
- **WHEN** the guardian opens the consent link and approves with their name
- **THEN** `grantGuardianConsent` records the consent and the child's team may start

#### Scenario: Used or invalid token is refused
- **WHEN** `grantGuardianConsent` is called with an already-used or invalid token
- **THEN** the call is refused and no consent is recorded

### Requirement: Consent records follow PII retention
Consent records SHALL be subject to the existing 90-day PII prune after a run finishes.

#### Scenario: Consent record is pruned with run PII
- **WHEN** a finished run's PII is pruned
- **THEN** the guardian consent records are cleared along with the other team PII

