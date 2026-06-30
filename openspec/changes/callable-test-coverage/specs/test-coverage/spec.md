# Test Coverage

## ADDED Requirements

### Requirement: High-risk callables have isolated error-branch tests
The high-risk callables SHALL each have fast, emulator-free unit tests that assert their **failure and
edge branches**, not only the happy path. This covers `launchRun`, `submitTaskAnswer`, `finalizeRun`,
`joinRun`, and the scoring entry points: insufficient-credit and credit-rollback for `launchRun`,
finished-run and over-`attemptLimit` rejection for `submitTaskAnswer`, re-finalization idempotency for
`finalizeRun`, invalid/closed-code rejection for `joinRun`, and boundary inputs per scoring preset.

#### Scenario: launchRun rolls back a credit on a post-billing failure
- **WHEN** `launchRun` consumes a credit and a subsequent write fails
- **THEN** the unit test asserts `eventCredits` is unchanged (no credit burned)

#### Scenario: submitTaskAnswer rejects on a finished run
- **WHEN** `submitTaskAnswer` is called against a finished run
- **THEN** the unit test asserts a typed rejection and no score mutation

### Requirement: A documented mocked-Admin harness exists for callable unit tests
The repository SHALL provide a reusable mocked Admin-SDK / context harness (`functions/src/testutil/`)
with its own self-test, enabling any callable to be unit-tested in isolation without the emulator, plus
a short written guide so new callables add an error-branch test cheaply.

#### Scenario: The harness round-trips writes and transactions
- **WHEN** the harness self-test sets a document and reads it back, including via a transaction
- **THEN** the values and `merge` semantics match Firestore's documented behavior

### Requirement: Placeholder stubs do not masquerade as coverage
The `__planned__/v21-*.todo.test.ts` files SHALL be clearly annotated as RED-phase blueprints (not
passing coverage), and any `test.todo` whose behavior is already shipped SHALL be converted to an
executing assertion or removed, so the reported test inventory distinguishes real coverage from pending
intent.

#### Scenario: Shipped behavior is no longer only a todo
- **WHEN** a roadmap row's behavior is already shipped
- **THEN** its corresponding `test.todo` is an executing assertion or has been removed as redundant
