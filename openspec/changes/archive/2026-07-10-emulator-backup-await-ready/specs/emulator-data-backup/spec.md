## MODIFIED Requirements

### Requirement: Periodic crash-safe snapshots

While the local emulator stack is running, the system SHALL export the emulator data to a
new timestamped snapshot folder on a fixed configurable interval, independent of the
clean-exit export, so that a crash or power loss loses at most one interval of writes.

The system SHALL NOT attempt any export until the emulator stack reports fully ready. Until
readiness is observed the loop SHALL wait (polling readiness with bounded backoff) and SHALL
NOT run an export, so that a snapshot can never be taken against a still-booting emulator and
therefore can never wedge it. The first snapshot is taken only after readiness is observed.

#### Scenario: No export before the emulator is ready

- **WHEN** the snapshot loop is running but the emulator stack has not yet reported ready
- **THEN** the gating logic reports that no export may be attempted
- **AND** no `emulators:export` is spawned and no snapshot folder is created

#### Scenario: First snapshot waits for readiness then fires

- **WHEN** the emulator stack transitions to fully ready
- **THEN** the gating logic reports that an export may be attempted
- **AND** the first snapshot folder is created after readiness, not on a fixed boot timer

#### Scenario: Snapshot written on each interval tick

- **WHEN** the snapshot loop is running, the emulator is ready, and a configured interval has elapsed since the last snapshot
- **THEN** a new snapshot folder named with that tick's timestamp is created under the backups directory
- **AND** a log line reporting the snapshot path is emitted

#### Scenario: No snapshot before the interval elapses

- **WHEN** the emulator is ready but less than the configured interval has elapsed since the last snapshot
- **THEN** the interval-gating logic reports that no snapshot is due
- **AND** no new snapshot folder is created

#### Scenario: Crash between ticks loses at most one interval

- **WHEN** the host process is killed without a clean exit
- **THEN** the most recent completed snapshot remains intact on disk and is usable for restore
