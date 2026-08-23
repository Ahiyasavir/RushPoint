## ADDED Requirements

### Requirement: Orphan selection is a pure, total, auditable decision

The system SHALL decide which processes are reapable orphans using a pure function of a supplied
process snapshot, a record of this repository's emulator-exec sessions, the repository root, the
caller's own process identity, and a minimum process age. The function SHALL NOT read the clock,
the filesystem, or the process table itself.

The decision SHALL be total: every input process SHALL appear exactly once in either the reap set or
the keep set, with an explicit reason. A process that matches no rule SHALL be kept, never dropped
silently.

#### Scenario: Every process receives exactly one verdict

- **WHEN** a process snapshot is evaluated
- **THEN** the reap set and the keep set together contain exactly the input processes, with no process in both

#### Scenario: Verdicts are explained

- **WHEN** a process is selected for reaping
- **THEN** the selection carries a reason identifying why it was attributed to a finished emulator-exec session

#### Scenario: Empty and malformed input is safe

- **WHEN** the snapshot is empty, the session record is empty, or arguments are missing
- **THEN** the decision completes without error and selects nothing for reaping

### Requirement: Reaping requires positive attribution to a finished exec session of this repository

The system SHALL select a process for reaping only when it is positively identified as an emulator
process whose lineage resolves to a `firebase emulators:exec` session started by **this repository**
and that session has **finished**. Matching an emulator-related pattern SHALL be a necessary but not
sufficient condition.

Lineage SHALL resolve either through parent links present in the snapshot, or — for a process whose
parent is no longer present — through a recorded session whose root process identifier matches and
whose time window contains the process's start time.

A process whose lineage cannot be resolved to such a session SHALL be kept.

#### Scenario: A finished session's leftovers are reaped

- **WHEN** emulator processes remain whose parent is a recorded exec session's root that is no longer present, the session is recorded as finished, and they were started during that session
- **THEN** those processes are selected for reaping

#### Scenario: A surviving exec parent of a finished session is reaped

- **WHEN** the exec process itself is still present after its session has been recorded as finished
- **THEN** it is selected for reaping

#### Scenario: An unattributable emulator process is kept

- **WHEN** an emulator-looking process's lineage leaves the snapshot and matches no recorded session
- **THEN** it is kept and not reaped

#### Scenario: A pattern match alone never suffices

- **WHEN** a process matches an emulator-related pattern but has no lineage to a finished exec session of this repository
- **THEN** it is kept and not reaped

### Requirement: A live emulator session is never selected

The system SHALL keep any process whose lineage reaches a live emulator session — an emulator started
for development or playtesting rather than by `emulators:exec` — and SHALL evaluate this protection
before any reaping rule, so that it cannot be overridden by a later match.

The system SHALL also keep any process identified as still belonging to an exec session that has not
finished, and SHALL keep the reaping process itself, its ancestors, any explicitly protected process,
and their descendants.

#### Scenario: The serving dev stack survives

- **WHEN** a development or playtest emulator stack is running and holding the emulator ports
- **THEN** none of its processes are selected for reaping, and each is kept with a reason identifying it as a live emulator session

#### Scenario: A live stack alongside real orphans

- **WHEN** a live emulator stack and a finished exec session's leftovers are present in the same snapshot
- **THEN** only the finished session's leftovers are selected, and the live stack is untouched

#### Scenario: A running exec session is untouched

- **WHEN** an exec session is recorded as still running and its root process is present
- **THEN** no process belonging to that session is selected for reaping

#### Scenario: The reaper never reaps itself

- **WHEN** the reaping process and its ancestors appear in the snapshot
- **THEN** they are kept, together with their descendants

### Requirement: Unrelated and foreign processes are never selected

The system SHALL NOT select a process that belongs to another repository's emulator session, nor any
process that is not identified as an emulator process — including unrelated Java processes, editors
and IDEs, language servers, and general-purpose tooling — regardless of superficial similarity in
their command lines.

#### Scenario: Another repository's emulator is untouched

- **WHEN** an emulator session belonging to a different checkout is present, with command lines otherwise identical to this repository's
- **THEN** none of its processes are selected for reaping

#### Scenario: Unrelated Java is untouched

- **WHEN** a Java process unrelated to the emulator is present
- **THEN** it is kept and not reaped

#### Scenario: Developer tooling is untouched

- **WHEN** an editor, IDE, or language-server process is present
- **THEN** it is kept and not reaped

### Requirement: Ambiguity resolves toward keeping

The system SHALL keep any process whose attribution is uncertain. In particular, a process SHALL be
kept when its start time is unknown or falls outside the window of the session it would otherwise be
attributed to, when its parent link is missing, when its command line is empty, or when it is younger
than the configured minimum age.

Cycles or self-references in parent links SHALL NOT prevent the decision from completing, and the
processes involved SHALL be kept.

#### Scenario: Process-identifier reuse does not cause a kill

- **WHEN** a process's parent identifier matches a finished session's root but the process started outside that session's window
- **THEN** it is kept and not reaped

#### Scenario: Unknown start time is kept

- **WHEN** a candidate process has a missing or unusable start time
- **THEN** it is kept and not reaped

#### Scenario: A very young process is kept

- **WHEN** a candidate process started more recently than the configured minimum age
- **THEN** it is kept and not reaped

#### Scenario: A parent-link cycle terminates safely

- **WHEN** the snapshot contains a parent-link cycle or a self-parenting process
- **THEN** the decision completes and those processes are kept

### Requirement: A finished exec run cleans up after itself

The system SHALL record each emulator-exec session while it runs — its root process, its start, and
its end — and SHALL perform a guarded reap when the wrapped command finishes, whether it succeeded,
failed, or was signalled, so that a completed run cannot hold the emulator ports against the next
run.

The reap SHALL be best-effort: it SHALL NOT change the wrapped command's exit code and SHALL NOT
fail the run if it cannot enumerate or terminate processes.

The session record SHALL be tolerant of absence and corruption; when it cannot be read, the system
SHALL behave as though no sessions were recorded, which SHALL make the reaper more conservative
rather than less.

#### Scenario: Cleanup runs after a successful gate

- **WHEN** an emulator-exec run's wrapped command exits successfully
- **THEN** its session is recorded as finished and a guarded reap is performed before the exit code is propagated

#### Scenario: Cleanup runs after a failing gate

- **WHEN** an emulator-exec run's wrapped command exits with a failure or is signalled
- **THEN** its session is recorded as finished and a guarded reap is still performed

#### Scenario: Cleanup cannot fail the gate

- **WHEN** the reap itself errors
- **THEN** the error is reported as a warning and the wrapped command's exit code is propagated unchanged

#### Scenario: A missing or corrupt session record is safe

- **WHEN** the session record is absent, empty, or unparseable
- **THEN** the system proceeds as if no sessions were recorded and reaps nothing on that basis

### Requirement: Launch-time cleanup covers runs that never unwound

The system SHALL also perform the same guarded reap when the development ports are freed before a
launch, so that debris from a run whose cleanup never executed — a closed terminal, a crash — is
collected on the next launch.

This SHALL be in addition to, and SHALL NOT replace, the existing port sweep and stale-helper
cleanup.

#### Scenario: Next launch collects earlier debris

- **WHEN** ports are freed before a launch and orphans from an earlier finished exec session are still alive
- **THEN** the guarded reap selects and terminates them

#### Scenario: Existing sweeps still run

- **WHEN** ports are freed before a launch
- **THEN** the existing port-based and pattern-based cleanup still runs as before

### Requirement: The reap can be observed and disabled without code changes

The system SHALL provide a way to disable the reap entirely, a way to adjust the minimum age below
which a process is never considered, and a diagnostic mode that reports the full keep/reap verdict
table **without terminating anything**.

#### Scenario: Disabled reap does nothing

- **WHEN** the reap is explicitly disabled
- **THEN** no process is enumerated for reaping and nothing is terminated

#### Scenario: Diagnostic mode kills nothing

- **WHEN** the diagnostic mode is enabled
- **THEN** the verdicts for every process are reported and no process is terminated
