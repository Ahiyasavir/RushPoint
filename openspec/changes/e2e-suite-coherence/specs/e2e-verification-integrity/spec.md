## ADDED Requirements

### Requirement: Every asserted response field exists on the callable that produces it

The end-to-end suite SHALL assert only on response fields that the corresponding callable actually
returns, with the shape being asserted.

An assertion naming a field that no longer exists SHALL be treated as a defect, because such an
assertion reads `undefined` on both sides of a comparison — it either fails at runtime for a reason
unrelated to the behavior under test, or passes without testing anything.

When a callable's payload shape changes, the assertions that read the removed or renamed field SHALL
be updated to the shape the implementation actually supports, not to whichever shape makes the run
likelier to pass.

#### Scenario: A renamed payload field is reconciled

- **WHEN** a lane changes a callable's response so a previously-asserted field is replaced
- **THEN** every assertion on the old field is rewritten against the field the callable now returns

#### Scenario: A deprecated field kept on the wire is still asserted

- **WHEN** a callable keeps a deprecated field alongside its replacement for older cached clients
- **THEN** the suite asserts both the replacement field and the continued presence of the deprecated one

### Requirement: Every assertion is falsifiable

The suite SHALL NOT contain an assertion that cannot fail. For every assertion there SHALL exist a
realistic regression in the behavior it names that makes it fail.

An assertion whose stated subject is pre-empted by a stronger earlier rule in the implementation
SHALL be given its own fixture so that it exercises the rule it names, rather than passing through
the pre-empting rule.

An assertion that a collection is empty after an operation SHALL be preceded by a fixture that puts
something in that collection, and by a check that the fixture took effect.

An assertion SHALL prefer the positive outcome over the absence of a flag when the success path of
the callable does not emit that flag at all.

A repair SHALL never weaken an assertion to raise the odds of a green run. Where the intended
behavior is genuinely unclear, the stricter form SHALL be kept and the ambiguity reported.

#### Scenario: A masked assertion gets its own fixture

- **WHEN** an assertion targets a rule that a higher-precedence rule in the implementation always pre-empts for that actor
- **THEN** the assertion is moved onto an actor for which the higher-precedence rule does not apply, and it pins the reason the implementation reports

#### Scenario: An emptiness check is seeded first

- **WHEN** an assertion checks that a destructive operation removed records from a collection
- **THEN** the records are created first and a fixture check confirms they existed before the operation ran

#### Scenario: Absence of a flag is not accepted as success

- **WHEN** a callable's success path omits a flag that only its failure path sets
- **THEN** the assertion additionally requires the positive result the success path does return

#### Scenario: A known tautology is documented, not silently kept

- **WHEN** an assertion is true by construction and is deliberately retained as a contract check
- **THEN** it is recorded as a known tautology so it is never mistaken for real coverage

### Requirement: An assertion builds the state it reads

Each assertion SHALL depend only on state created by its own scenario, because scenarios are
isolated and a failure in one must not silently change what a later one observes.

Where a scenario borrows shared state in order to exercise a platform-wide operation, it SHALL
restore what it borrowed, and its assertions SHALL identify the specific record it acted on rather
than accepting an aggregate result that unrelated records could satisfy.

#### Scenario: A new participant is created rather than reused

- **WHEN** an assertion needs an actor in a state that an existing actor of the scenario is not in
- **THEN** the scenario creates its own additional actor in that state

#### Scenario: A borrowed record is identified in the result

- **WHEN** a scenario triggers a platform-wide sweep to observe its effect on one record
- **THEN** the assertion checks that the sweep's own report names that record, not merely that the sweep succeeded

### Requirement: The participant sanitizer allowlists track the real task shape

The suite's participant-payload allowlists SHALL match the set of keys the participant sanitizer can
actually emit: every field passed through, plus the keys the sanitizer synthesizes.

A key the sanitizer can emit that is missing from the allowlist SHALL fail the run loudly. A key
added to the allowlist that the sanitizer does not emit SHALL be treated as a worse defect than a
missing one, because it silently pre-authorizes a future leak.

An answer key or other server-secret SHALL never appear in an allowlist.

#### Scenario: A new task field appears in the payload

- **WHEN** a field is added to the task type and passed through the sanitizer
- **THEN** the suite fails until that field is deliberately allowlisted

#### Scenario: No speculative allowlist entries

- **WHEN** a change does not add a participant-visible task field
- **THEN** no allowlist entry is added

### Requirement: Every deployed callable is exercised

The suite SHALL invoke every callable the emulator serves, so that a newly added callable ships red
until a scenario exercises it.

An invocation that is expected to be DENIED SHALL count as exercising the callable, since the
authorization boundary is itself behavior under test.

The exemption list SHALL be empty whenever full coverage is achievable, and each entry, if any,
SHALL carry a reason and SHALL be removed once the callable is exercised or no longer deployed.

#### Scenario: A callable added while the suite could not run

- **WHEN** a lane adds a callable without being able to execute the suite
- **THEN** the coverage arithmetic is performed statically and any callable with no scenario is reported before the suite is ever run

#### Scenario: A denial-only callable counts as covered

- **WHEN** a callable appears only in the authorization denial matrix
- **THEN** it counts as exercised, because the call is recorded whether it succeeds or throws

### Requirement: A suite that cannot be executed is validated statically and reported as unrun

When the emulator is unavailable, the suite SHALL still be validated by static reconciliation — field
existence, falsifiability, reachability, isolation, allowlist drift and callable coverage — and the
result SHALL be reported explicitly as NOT having been executed.

A successful static validation SHALL NOT be described as a passing run, and SHALL NOT be used to
justify relaxing any assertion.

#### Scenario: Static validation completes

- **WHEN** the suite is reconciled against the implementation without being executed
- **THEN** the report states plainly that nothing was run and that the end-to-end suite remains the authority

#### Scenario: Limits of static validation are disclosed

- **WHEN** static validation cannot establish a property, such as real timing or index availability
- **THEN** that limit is named in the report rather than left implied
