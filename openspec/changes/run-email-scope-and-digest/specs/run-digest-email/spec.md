## ADDED Requirements

### Requirement: Only real organizer runs earn an immediate summary email

The system SHALL send the per-run organizer summary email only for runs that are neither test-drive
runs nor self-guided runs. A run whose `isTestDrive` is true, or whose `selfGuided` is true, MUST NOT
produce a per-run email. Absent flags MUST be treated as a normal run so that legacy runs continue to
email.

#### Scenario: A normal organizer-launched run finishes

- **WHEN** a run with neither `isTestDrive` nor `selfGuided` set is finalized
- **THEN** the summary email is sent to the organizer recipient

#### Scenario: A test-drive rehearsal finishes

- **WHEN** a run launched with `testDrive: true` is finalized
- **THEN** no summary email is sent
- **AND** the reason is recorded as an eligibility breadcrumb in the log

#### Scenario: A self-guided demo run finishes

- **WHEN** a run created by instant play (`selfGuided: true`) is finalized
- **THEN** no summary email is sent

#### Scenario: A legacy run with no flags at all

- **WHEN** a run document carries neither field
- **THEN** it is treated as a real run and the summary email is sent

### Requirement: Synthetic runs do not email

A run SHALL produce a per-run email only when its owner is an identifiable creator — one whose
profile carries an email address. A run owned by an anonymous account MUST NOT email, regardless of
its other flags. This is what excludes simulation and test-harness runs, which create their creator
anonymously.

#### Scenario: A simulation is run against the production backend

- **WHEN** a load-simulation script creates its creator anonymously, then launches and finalizes runs
  against a backend that has a working email provider credential
- **THEN** no summary emails are produced by those runs

#### Scenario: A simulation must not be crippled to achieve this

- **WHEN** a load simulation runs many teams through a single run
- **THEN** the exclusion mechanism does not constrain that run's participant capacity

#### Scenario: A real creator's run is unaffected

- **WHEN** a run is owned by a creator who signed in with email or Google
- **THEN** the run is eligible and the summary email is sent

### Requirement: A daily digest reports demo volume and real runs finished

The system SHALL send, at most once per day, a digest email covering the previous complete local
calendar day. The digest MUST report the number of demo (self-guided) runs that finished that day and
a one-line entry for each real run that finished.

#### Scenario: A day with demo runs and real runs

- **WHEN** the digest job runs after a day containing three demo runs and one real run
- **THEN** the digest reports a demo count of three
- **AND** lists the one real run

#### Scenario: A day with demo runs only

- **WHEN** the digest job runs after a day containing demo runs but no real runs
- **THEN** the digest is still sent, reporting the demo count with an empty real-run list

### Requirement: The digest is silent on a quiet day

When the covered day contains no demo runs and no real runs, the system SHALL send nothing at all.
Absence of a digest MUST mean "nothing happened" rather than "the job failed".

#### Scenario: A completely quiet day

- **WHEN** the digest job runs after a day in which no run finished
- **THEN** no email is sent
- **AND** the job exits successfully

### Requirement: The digest day boundary comes from an explicit timezone

The digest SHALL compute its day boundary from an explicitly configured IANA timezone rather than
inheriting the host or container local time, so that a container running in UTC cannot shift the
reported day.

#### Scenario: The container clock is UTC but the configured zone is not

- **WHEN** the job runs in a container whose local time is UTC with the digest timezone configured as
  `Asia/Jerusalem`
- **THEN** the day boundary matches the configured zone, not UTC

#### Scenario: The job fires in the small hours

- **WHEN** the job fires at 03:30 local time
- **THEN** the digest covers the previous complete local day, not the few hours elapsed since
  midnight

### Requirement: Each email attributes the interaction to a person

The per-run summary email SHALL identify the creator who built and ran the game by display name and
email address. The digest SHALL identify the player behind each demo run by display name.

#### Scenario: A real run finishes

- **WHEN** the per-run summary email is composed for a finished run
- **THEN** it includes the creator's display name and email address

#### Scenario: The creator has no display name set

- **WHEN** the creator's profile has an email but no display name
- **THEN** the attribution renders with the email alone and no placeholder or `undefined` text

#### Scenario: The creator profile is missing both fields

- **WHEN** neither a display name nor an email can be resolved for the creator
- **THEN** the attribution block is omitted entirely rather than rendered empty

#### Scenario: A demo run appears in the digest

- **WHEN** the digest lists the demo runs for the covered day
- **THEN** each demo run is accompanied by the display name of the player who played it

### Requirement: Participant email addresses and registration answers are not reported

The system SHALL NOT report participant email addresses, and SHALL NOT include participants'
`registrationData` answers in any email — participants authenticate anonymously and no email
registration field type exists, so no such address is available. Participant identity in emails MUST
be limited to display names.

#### Scenario: A demo player's identity is reported

- **WHEN** a demo run is attributed in the digest
- **THEN** the player's display name is included
- **AND** no email address field is emitted for that player, not even an empty or "unknown" one

#### Scenario: A game collected phone numbers at registration

- **WHEN** a run's teams have `registrationData` containing phone numbers or custom answers
- **THEN** none of those values appear in the per-run email or the digest

### Requirement: The digest does not leak one tenant's data to another

The digest SHALL itemize only runs belonging to the configured operator. Runs owned by any other
creator MUST be represented as a count only, with no title or identifier.

#### Scenario: Another creator's run finished the same day

- **WHEN** the covered day includes a real run owned by a creator other than the configured operator
- **THEN** that run contributes to a bare count of other creators' runs
- **AND** its title and owner identifier do not appear in the digest
