## ADDED Requirements

### Requirement: Disk-based track storage is opt-in and off by default
The system SHALL persist a run's GPS movement track to local disk only when explicitly
configured to do so. When not configured, every code path involved MUST behave exactly as it
did before this capability existed — same Firestore writes, same reads, same retention.

#### Scenario: Unconfigured deployment is unaffected
- **WHEN** the disk track storage configuration is absent
- **THEN** location pings retain track points in Firestore exactly as before this capability
  existed
- **AND** `getRunHeatmap` reads from Firestore exactly as before

#### Scenario: Configured deployment writes to disk instead
- **WHEN** disk track storage is configured
- **THEN** a retained track point is written to the local disk file for that run
- **AND** no corresponding Firestore `locationTrack` document is created

### Requirement: A run's track file is a single append-only sequence
Each run's track SHALL be stored as one append-only local file, keyed unambiguously to its
owner, game and run. Appending SHALL never rewrite or reorder previously stored points.

#### Scenario: Points accumulate in the order they are appended
- **WHEN** several points are appended to the same run's track over time
- **THEN** reading the file back yields exactly those points

#### Scenario: Two different runs never share a file
- **WHEN** points are appended for two different runs
- **THEN** each run's file contains only its own points

### Requirement: Concurrent appends from many teams never corrupt the file
Because many teams ping the same run simultaneously, appends from different callers SHALL be
serialized per run so that no two appends can interleave their writes. A reader of the file
MUST always see a sequence of intact, individually parseable records — never a partial or
merged record.

#### Scenario: Simultaneous appends from many teams all land intact
- **WHEN** many teams append points to the same run's track at the same time
- **THEN** every point appears in the file as a complete, independently parseable record
- **AND** the total record count equals the number of points appended

### Requirement: A path cannot escape the configured storage root
The location of a run's track file SHALL be derived only from validated identifiers, and any
attempt to resolve a path outside the configured storage root MUST be refused rather than
silently redirected or allowed.

#### Scenario: A malicious or malformed identifier is refused
- **WHEN** a run reference would resolve to a path outside the configured storage root
- **THEN** the operation is refused
- **AND** nothing is read from or written to any location outside that root

### Requirement: Disk operations never fail the location ping
A failure to write, read, or delete a run's track file on disk SHALL NOT cause the calling
operation to fail. The track is retained on a best-effort basis, matching the existing
Firestore-mode guarantee that a movement-history failure never blocks a location update.

#### Scenario: A disk write failure does not fail the ping
- **WHEN** appending a track point to disk fails for any reason
- **THEN** the location update still completes successfully

### Requirement: A run's track can be read back for the movement heatmap
The stored points for a run SHALL be retrievable as a plain list of coordinates, suitable for
the existing density aggregator, and reading a run with no stored file MUST yield a result the
caller can distinguish from "this run's track is stored on disk but empty."

#### Scenario: A run's full track is returned
- **WHEN** a run's track is read back after several points were appended
- **THEN** every appended point is present in the result

#### Scenario: A run with no disk file is distinguishable from an empty track
- **WHEN** a run has no disk track file
- **THEN** the read reports that no file exists, rather than reporting zero points
- **AND** the caller can therefore fall back to another source instead of concluding the run
  had no movement

### Requirement: A run's disk track can be deleted for retention
The system SHALL support deleting a run's disk track file as part of PII retention, and
deleting a run with no disk file MUST succeed without error.

#### Scenario: An existing track file is removed
- **WHEN** a run's disk track is deleted
- **THEN** the file no longer exists
- **AND** a subsequent read reports that no file exists

#### Scenario: Deleting a track that was never stored on disk is a no-op
- **WHEN** deletion is requested for a run that has no disk track file
- **THEN** the operation completes without error
