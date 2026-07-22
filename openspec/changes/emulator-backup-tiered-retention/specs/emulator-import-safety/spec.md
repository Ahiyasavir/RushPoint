## ADDED Requirements

### Requirement: Like-for-like freshness comparison

When choosing which dataset to boot the emulator from, the system SHALL compare candidates using
timestamps that measure the same event for every candidate — the write time of each candidate's own
export metadata — rather than comparing one candidate's file modification time against another
candidate's encoded folder name.

A candidate's folder-name timestamp MAY be used only as a fallback when its metadata write time is
unavailable, and the fallback SHALL be reported in the decision so it can be surfaced.

#### Scenario: Both candidates compared by metadata write time

- **WHEN** both the primary export and the newest backup carry export metadata
- **THEN** the selection compares their metadata write times and returns the newer as the source

#### Scenario: Fallback comparison is reported

- **WHEN** a candidate's metadata write time is unavailable and only its folder-name timestamp is known
- **THEN** the selection still returns a decision and marks that the comparison used a fallback timestamp

### Requirement: Invalid or empty candidates never win

The system SHALL disqualify any import candidate that is absent, lacks valid export metadata, or
contains no data. A disqualified candidate SHALL NEVER be selected, regardless of how recent it is.

When every candidate is disqualified the system SHALL select nothing and start from an empty
database rather than importing a broken dataset.

#### Scenario: A newer but invalid candidate loses

- **WHEN** the freshest candidate has no valid export metadata and an older valid candidate exists
- **THEN** the older valid candidate is selected

#### Scenario: A newer but empty candidate loses

- **WHEN** the freshest candidate contains no data and an older non-empty candidate exists
- **THEN** the older non-empty candidate is selected

#### Scenario: No usable candidate

- **WHEN** no candidate is valid
- **THEN** the selection returns nothing and the emulator starts fresh

### Requirement: Substance guard against dataset replacement

The system SHALL compare the size of the freshest valid candidate against the other valid candidate.
When the freshest candidate is dramatically smaller than the alternative — below a configurable
ratio of its size — the system SHALL NOT silently adopt it. Instead the system SHALL select the
substantial dataset, SHALL report the discrepancy loudly with both sizes named, and SHALL state how
to override the guard.

The system SHALL provide an explicit override that, when set, honours the freshest candidate anyway,
for the case where the shrink is a real and intended deletion.

The guard SHALL NOT engage when the two candidates are of comparable size, so ordinary operation is
never affected.

#### Scenario: A drastically smaller fresh dataset does not win

- **WHEN** the freshest valid candidate is far smaller than the other valid candidate
- **THEN** the substantial candidate is selected instead
- **AND** the decision reports that the substance guard engaged, naming both sizes

#### Scenario: Comparable sizes are unaffected

- **WHEN** the freshest candidate is of comparable size to the alternative
- **THEN** the freshest candidate is selected and the substance guard does not engage

#### Scenario: Override honours the smaller dataset

- **WHEN** the substance guard would engage but the override is set
- **THEN** the freshest candidate is selected and the decision records that the guard was overridden

#### Scenario: Guard cannot engage without an alternative

- **WHEN** only one valid candidate exists
- **THEN** it is selected and the substance guard does not engage

#### Scenario: A shrinking import is announced before it happens

- **WHEN** the selected dataset is materially smaller than a rejected alternative
- **THEN** the discrepancy is announced prominently at emulator start, before the import is performed
