## ADDED Requirements

### Requirement: The emulator port block is resolved by one pure function
The tooling SHALL provide a single pure module that resolves the emulator port block from an
environment mapping passed in by the caller. The module SHALL perform no input or output of any
kind: it SHALL NOT read `process.env` itself, SHALL NOT touch the filesystem, and SHALL NOT spawn a
process.

The resolver SHALL cover every port the emulator suite binds, not only those declared in
`firebase.json`: the Emulator UI, the emulator hub, the logging emulator, Cloud Functions, Hosting,
Firestore, the Firestore UI websocket, Auth and Storage.

Every resolved port SHALL be a finite integer within 1024 and 65535 for every possible input. The
resolver SHALL never return `NaN`, and SHALL never throw.

#### Scenario: Every emulator-bound gate reads the same source
- **WHEN** the emulator launcher, the end-to-end suite, the rules suites and the simulations
  determine which port to connect to
- **THEN** each obtains it from the shared resolver
- **AND** no gate script carries a hardcoded emulator port literal

#### Scenario: The resolver is total
- **WHEN** the resolver is given an absent, empty, blank, non-numeric, negative, fractional,
  exponent-notation, hexadecimal or absurdly large offset value
- **THEN** it returns a complete port map without throwing
- **AND** every port in that map is a finite integer within 1024 and 65535

### Requirement: With no offset configured the ports are unchanged
When no port offset is configured, the resolved ports SHALL be exactly the ports the tooling used
before this capability existed: Emulator UI 4000, hub 4400, logging 4500, Functions 5001, Hosting
5002, Firestore 8080, Firestore websocket 9150, Auth 9099, Storage 9199.

An offset that cannot be interpreted as a non-negative integer SHALL be treated as no offset, so a
mistyped value can never move the block somewhere unrequested.

The emulator launcher SHALL, when no offset is configured, invoke the Firebase CLI with the same
command line and the same configuration file it used before this capability existed, and SHALL NOT
generate any temporary configuration.

#### Scenario: An unset offset yields today's ports
- **WHEN** the resolver is given an environment with no offset variable
- **THEN** the resolved ports are UI 4000, hub 4400, logging 4500, Functions 5001, Hosting 5002,
  Firestore 8080, Firestore websocket 9150, Auth 9099 and Storage 9199

#### Scenario: An empty, zero or invalid offset yields today's ports
- **WHEN** the offset variable is an empty string, whitespace, `0`, or a value that is not an
  integer
- **THEN** the resolved ports are identical to the unset case

#### Scenario: The launcher's default invocation is untouched
- **WHEN** the emulator launcher runs with no offset configured
- **THEN** it passes no configuration override to the Firebase CLI
- **AND** it writes no generated configuration file

### Requirement: A configured offset moves the whole block clear of the default block
When a positive offset is configured, every resolved port SHALL be its default value plus the same
effective offset, so the whole block moves together.

The effective offset SHALL be rounded up to a multiple of 1000, with a minimum of 1000 and a maximum
of 56000. The effective offset SHALL never be smaller than the requested offset unless the requested
offset exceeds the maximum.

The resolved block SHALL share no port with the default block, and SHALL share no port with the
participant and creator development servers or the tunnel proxy.

No two ports within a resolved block SHALL be equal.

#### Scenario: A whole block shifts together
- **WHEN** an offset of 1000 is configured
- **THEN** every resolved port equals its default value plus 1000

#### Scenario: A small offset is raised to a safe separation
- **WHEN** an offset smaller than 1000 but greater than zero is configured
- **THEN** the effective offset is 1000
- **AND** the caller is told the requested value was adjusted

#### Scenario: An offset that would overlap the live block is prevented
- **WHEN** an offset that is not a multiple of 1000 is configured
- **THEN** the effective offset is the next multiple of 1000
- **AND** no resolved port equals any default emulator port

#### Scenario: An offset is bounded to the legal port range
- **WHEN** an offset far beyond the legal port range is configured
- **THEN** the effective offset is the largest value that keeps every port at or below 65535
- **AND** every resolved port remains a legal port

#### Scenario: The shifted block avoids the development servers
- **WHEN** any supported offset is configured
- **THEN** no resolved port equals the creator development server port, the participant development
  server port, or the tunnel proxy port

### Requirement: The emulator launcher starts the suite on the resolved ports
When an offset is configured, the emulator launcher SHALL start the Firebase emulator suite bound to
the resolved ports, without modifying the repository's committed Firebase configuration.

The launcher SHALL achieve this by generating a temporary configuration derived from the committed
one, with only the emulator port block replaced, and directing the Firebase CLI at that file. The
generated file SHALL be placed such that every relative path it contains continues to resolve
correctly, and SHALL be excluded from version control.

The launcher SHALL report the effective offset and the resolved ports when an offset is in effect,
and SHALL report when a requested offset was adjusted or ignored.

#### Scenario: An offset run does not disturb a live stack
- **WHEN** a live emulator stack occupies the default port block and a gate is started with an
  offset configured
- **THEN** the gate's emulator suite binds only ports in the shifted block
- **AND** the committed Firebase configuration file is not modified

#### Scenario: The generated configuration preserves the rest of the config
- **WHEN** the temporary configuration is derived from the committed one
- **THEN** only the emulator port entries differ
- **AND** the functions source, rules paths, index path and hosting targets are carried over
  unchanged
- **AND** the committed configuration object is not mutated

### Requirement: The orphan reaper stays lineage based and fails closed
The reaper that cleans up leftovers from a finished emulator exec run SHALL continue to decide
solely from process lineage, recorded exec sessions and process age. It SHALL NOT use a port number
as evidence for or against terminating a process.

A live development or playtest stack SHALL never be terminated by the reaper, whether the finished
gate ran on the default block or on a shifted block.

#### Scenario: An offset run is reaped by the same rule
- **WHEN** a gate that ran on a shifted block leaves orphaned emulator processes behind
- **THEN** those processes are attributed and reaped by lineage exactly as a default-block run's
  orphans are

#### Scenario: The live stack survives regardless of ports
- **WHEN** the reaper runs while a live stack holds the default port block
- **THEN** the live stack's processes are kept
