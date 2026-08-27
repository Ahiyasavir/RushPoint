## ADDED Requirements

### Requirement: Firestore operations can be counted and attributed to a callable
The API SHALL provide an operation counter that tallies Firestore reads and writes and attributes
each to the callable that caused it. Attribution MUST cover work performed inside the callable's own
asynchronous execution, so a callable that awaits several reads has all of them charged to it.

#### Scenario: Reads and writes are attributed to the invoking callable
- **WHEN** the counter is enabled and a callable performs document reads and writes
- **THEN** the tally records those reads and writes under that callable's name

#### Scenario: Counts distinguish reads from writes
- **WHEN** a callable performs a mix of `get` and `set`/`update`/`delete`/`add` operations
- **THEN** reads and writes are reported as separate totals, not a combined operation count

#### Scenario: Totals are retrievable
- **WHEN** an operator requests the current tally
- **THEN** per-callable read and write counts and an overall total are returned

### Requirement: The counter is opt-in and inert when disabled
The counter SHALL be disabled by default and enabled only by explicit configuration. When disabled
it MUST NOT alter Firestore behavior, results, ordering or error propagation, and MUST NOT retain
per-operation state.

#### Scenario: Disabled counter changes nothing
- **WHEN** the counter is not enabled
- **THEN** every Firestore read and write returns exactly what it returns today
- **AND** no tally is accumulated

#### Scenario: Enabling the counter does not change results
- **WHEN** the counter is enabled
- **THEN** Firestore reads and writes return the same values and throw the same errors as when it is
  disabled

### Requirement: Counting never fails a request
A defect in the counting path SHALL NOT propagate to the caller. If attribution or tallying throws,
the underlying Firestore operation MUST still complete and its result or error MUST be returned
unchanged.

#### Scenario: A counting failure is swallowed
- **WHEN** the counting hook throws while recording an operation
- **THEN** the Firestore operation's own result is returned to the caller
- **AND** the request does not fail

### Requirement: A run's operation cost is expressible as a budget
The system SHALL support projecting a run's Firestore cost from measured per-callable counts and a
participant count, so headroom against a fixed daily quota is a computed figure. The projection MUST
report the denominator it used — the number of participants and the observed per-callable counts —
rather than a bare verdict.

#### Scenario: Projection reports its inputs
- **WHEN** a projection is produced for a given participant count
- **THEN** the output states the measured per-callable counts and the participant count it scaled by
- **AND** states the resulting read and write totals against the quota
