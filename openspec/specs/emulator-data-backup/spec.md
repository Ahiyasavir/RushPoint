# emulator-data-backup Specification

## Purpose
TBD - created by archiving change emulator-data-backup. Update Purpose after archive.
## Requirements
### Requirement: Periodic crash-safe snapshots

While the local emulator stack is running, the system SHALL export the emulator data to a
new timestamped snapshot folder on a fixed configurable interval, independent of the
clean-exit export, so that a crash or power loss loses at most one interval of writes.

#### Scenario: Snapshot written on each interval tick

- **WHEN** the snapshot loop is running and a configured interval has elapsed since the last snapshot
- **THEN** a new snapshot folder named with that tick's timestamp is created under the backups directory
- **AND** a log line reporting the snapshot path is emitted

#### Scenario: No snapshot before the interval elapses

- **WHEN** less than the configured interval has elapsed since the last snapshot
- **THEN** the interval-gating logic reports that no snapshot is due
- **AND** no new snapshot folder is created

#### Scenario: Crash between ticks loses at most one interval

- **WHEN** the host process is killed without a clean exit
- **THEN** the most recent completed snapshot remains intact on disk and is usable for restore

### Requirement: Bounded snapshot retention

The system SHALL retain only the most recent N snapshots (N configurable, default a small
fixed number) and prune older snapshots, so that long-running events cannot exhaust disk.

#### Scenario: Prune keeps the newest N

- **WHEN** more than N snapshots exist after a new one is written
- **THEN** the retention logic selects exactly the oldest snapshots beyond N for deletion
- **AND** the N newest snapshots are kept

#### Scenario: Under the limit keeps everything

- **WHEN** N or fewer snapshots exist
- **THEN** the retention logic selects nothing for deletion

### Requirement: Restore from the most recent good snapshot

The system SHALL provide a documented way to select a snapshot to restore from and boot
the next emulator session against it, defaulting to the most recent valid snapshot.

#### Scenario: Default selects the newest valid snapshot

- **WHEN** restore is requested without naming a specific snapshot and at least one valid snapshot exists
- **THEN** the selection logic returns the most recent valid snapshot path

#### Scenario: Ignore incomplete or empty snapshots

- **WHEN** the newest snapshot folder is incomplete or empty and an older valid snapshot exists
- **THEN** the selection logic skips the invalid one and returns the older valid snapshot

#### Scenario: No snapshots available

- **WHEN** restore is requested and no valid snapshot exists
- **THEN** the selection logic returns nothing and the restore command reports that none was found

