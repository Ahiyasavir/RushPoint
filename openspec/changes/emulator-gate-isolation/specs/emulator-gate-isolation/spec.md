## ADDED Requirements

### Requirement: An offset emulator run is invisible to the default-block suite
The tooling SHALL ensure that an emulator suite started on an offset port block and an emulator
suite started on the default port block cannot discover, overwrite or command each other, even
though both run under the same Firebase project id.

The Firebase CLI locates a running emulator suite through a single rendezvous file whose name is
derived from the project id alone and whose directory is the process temp directory. The tooling
SHALL therefore give an offset run its own temp directory, so that the offset run's rendezvous file
is written somewhere the default-block suite never reads, and the default-block suite's rendezvous
file is never read or written by the offset run.

The rendezvous file name the tooling assumes SHALL be asserted as a literal by an automated test, so
that a Firebase CLI upgrade that changes it fails a unit gate rather than a live run.

#### Scenario: A data export issued by the live stack can only reach the live stack
- **GIVEN** a long-lived default-block emulator suite with a periodic data-export loop
- **AND** a gate suite running concurrently on an offset port block
- **WHEN** the periodic loop issues a data export for the shared project id
- **THEN** the export is directed at the default-block suite
- **AND** the offset suite is never contacted

#### Scenario: Neither suite reports the other as a duplicate instance
- **GIVEN** a default-block suite is already running
- **WHEN** a gate suite starts on an offset port block
- **THEN** neither suite warns that multiple instances of the suite are running for the project
- **AND** neither suite's rendezvous file is modified by the other

#### Scenario: Two different offsets are isolated from each other
- **WHEN** two gate suites run on two different non-zero offsets
- **THEN** each resolves a different private temp directory

### Requirement: Isolation is applied only to an offset run
The tooling SHALL apply temp-directory isolation if and only if an effective non-zero port offset is
in force. With no offset configured, the emulator launcher SHALL spawn the Firebase CLI with the
same command line, the same configuration and the same environment it used before this capability
existed, overriding no environment variable.

An operator SHALL be able to disable the isolation with a single environment variable, without
changing any other behaviour of the run.

The decision SHALL live in a pure module that performs no input or output of any kind: it SHALL NOT
read `process.env` itself, SHALL NOT touch the filesystem and SHALL NOT spawn a process. It SHALL be
total — for any input at all, including absent, blank, non-numeric, negative and absurd values, it
SHALL return a verdict and SHALL NOT throw.

#### Scenario: No offset means no environment override
- **WHEN** the isolation planner is asked for a plan with no offset in force
- **THEN** it reports that the run is not isolated
- **AND** it supplies no environment overrides and no private directory

#### Scenario: A non-zero offset yields a private directory under the emulator state directory
- **WHEN** the isolation planner is asked for a plan with a positive offset
- **THEN** it reports that the run is isolated
- **AND** it supplies a private directory beneath the repository's emulator state directory
- **AND** it supplies that same directory as the value of every temp-directory variable the
  operating system and the Java runtime consult

#### Scenario: Isolation can be switched off in one place
- **WHEN** the operator sets the isolation opt-out variable
- **THEN** the planner reports that the run is not isolated
- **AND** supplies no environment overrides

### Requirement: The stale-helper sweep never kills a different live port block
The port-clearing tool SHALL NOT terminate an emulator process that belongs to a different port
block that is still live. Matching a stale command-line pattern SHALL be necessary but SHALL NOT be
sufficient to terminate a process.

The decision SHALL live in a pure module, separate from the shell that enumerates and signals
processes, following the existing orphan-reap split. The decision SHALL be total: every input
process SHALL receive exactly one explicit verdict with a reason, the kept and killed sets SHALL be
disjoint, and their union SHALL be the input. The decision SHALL NOT throw for any input, including
missing fields, malformed identifiers and cyclic parent references.

A process SHALL be spared when any of the following holds: it is the sweeping process or one of its
ancestors; it is explicitly protected by the caller; its lineage reaches an emulator-run session
that is recorded as still running, or it is the root of such a session, or it is an ancestor of such
a root; its command line identifies it as belonging to an offset port block; or it is an emulator
bound to a port that is not part of the block being swept.

#### Scenario: An in-flight offset gate survives a port sweep
- **GIVEN** a gate suite running on an offset port block, with its run recorded as still running
- **WHEN** the port-clearing tool sweeps the default port block
- **THEN** the gate's launcher, its Firebase CLI process, its emulator processes and its function
  workers are all spared
- **AND** the reason recorded for each is that it belongs to a live run or a foreign port block

#### Scenario: The default block is still cleared
- **GIVEN** emulator processes of the default-block stack, bound to the ports being swept, belonging
  to no running recorded run and carrying no offset marker
- **WHEN** the port-clearing tool sweeps the default port block
- **THEN** those processes are terminated, exactly as before this change

A run record that was never marked finished SHALL stop protecting processes once it is older than a
bounded age, so that a run terminated without cleanup cannot make its debris permanently
unclearable.

#### Scenario: A run record left open by a crash stops protecting
- **GIVEN** a recorded run that was never marked finished and started far longer ago than any gate
  can run
- **WHEN** the port-clearing tool sweeps
- **THEN** processes attributable only to that record are terminated

#### Scenario: Leftovers of a finished run are still cleared
- **GIVEN** processes attributable only to an emulator run recorded as finished
- **WHEN** the port-clearing tool sweeps
- **THEN** those processes are terminated

#### Scenario: The sweeper never targets itself
- **WHEN** the sweeping process's own command line matches a stale pattern
- **THEN** it is spared, along with its ancestors
