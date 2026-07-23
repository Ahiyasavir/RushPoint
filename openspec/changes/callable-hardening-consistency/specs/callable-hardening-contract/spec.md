## ADDED Requirements

### Requirement: Every callable is registered through the observability wrapper

Every Cloud Function callable SHALL be defined through the shared observability wrapper rather than
the platform's raw callable constructor, so that structured per-invocation logging and the
cost-containment instance cap apply by construction rather than by per-call-site discipline.

The raw callable constructor SHALL NOT appear outside the module that defines the wrapper.

#### Scenario: A callable defined through the wrapper conforms

- **WHEN** a callable is declared through the shared observability wrapper
- **THEN** it satisfies the registration requirement

#### Scenario: A callable bypassing the wrapper is rejected

- **WHEN** a module other than the wrapper's own module constructs a callable directly with the
  platform's raw callable constructor
- **THEN** the contract check fails and names that module

### Requirement: Every callable asserts the caller's identity unless declared public

Every callable SHALL reject an unauthenticated caller, either directly or through a helper it hands
the invocation context to.

A callable that is deliberately reachable without authentication SHALL be declared as a public
callable with a written reason. A callable that is not so declared and does not assert identity
SHALL fail the contract check.

#### Scenario: Direct assertion

- **WHEN** a callable asserts the caller's identity in its own body
- **THEN** it satisfies the identity requirement

#### Scenario: Assertion through a delegate

- **WHEN** a callable's body performs no assertion itself but hands the invocation context to a
  helper defined in the same module that asserts identity
- **THEN** it satisfies the identity requirement

#### Scenario: Undeclared public callable is rejected

- **WHEN** a callable neither asserts identity nor is declared public
- **THEN** the contract check fails and names that callable

#### Scenario: Declared public callable is allowed

- **WHEN** a callable is declared public with a written reason
- **THEN** it satisfies the identity requirement without asserting identity

### Requirement: Every privileged callable writes a durable audit record

A callable declared privileged SHALL write a durable audit record for the action it performs, either
directly or through a helper it calls.

The set of privileged callables SHALL be declared explicitly with a written reason per entry, rather
than inferred from the callable's name or body.

Every declared public or privileged callable name SHALL resolve to a callable that actually exists,
so that a renamed or removed callable turns its declaration into a failure rather than leaving a
silently dead exemption.

#### Scenario: Privileged callable that audits

- **WHEN** a callable declared privileged writes an audit record, directly or through a helper it
  calls
- **THEN** it satisfies the audit requirement

#### Scenario: Privileged callable that does not audit

- **WHEN** a callable declared privileged writes no audit record on any path
- **THEN** the contract check fails and names that callable

#### Scenario: Stale declaration

- **WHEN** a declared public or privileged name matches no discovered callable
- **THEN** the contract check fails and names the stale declaration

### Requirement: Every callable is reachable from the functions entry point

Every callable SHALL be re-exported from the functions entry point, whether by a wholesale module
re-export or by an explicit name, so that it is actually deployed.

#### Scenario: Callable in a wholesale re-exported module

- **WHEN** a callable's module is re-exported wholesale from the entry point
- **THEN** the callable satisfies the reachability requirement

#### Scenario: Callable listed by name

- **WHEN** a callable's module is re-exported by explicit name list and the callable appears in that
  list
- **THEN** the callable satisfies the reachability requirement

#### Scenario: Callable omitted from an explicit list

- **WHEN** a callable's module is re-exported by explicit name list and the callable does not appear
  in that list
- **THEN** the contract check fails and names that callable, because it would never deploy

### Requirement: The contract check cannot pass vacuously

The contract check SHALL fail rather than report success when its own source scan finds nothing to
check.

The check SHALL assert that the directory it scans exists, and SHALL assert a floor on the number of
callables discovered.

The decision functions the check relies on SHALL be proven against synthetic fixtures in both the
conforming and the non-conforming direction, independently of the current contents of the source
tree.

#### Scenario: Scan target missing

- **WHEN** the directory the check scans does not exist
- **THEN** the check fails rather than reporting that every callable conforms

#### Scenario: Scan finds implausibly few callables

- **WHEN** the number of callables discovered falls below the declared floor
- **THEN** the check fails, because the scan itself has stopped working

### Requirement: The contract does not require rate limiting

The contract check SHALL NOT require a callable to enforce a rate limit.

Rate limiting is decided per callable: participant-facing and unauthenticated-adjacent surfaces are
budgeted, while creator-console and staff-console operations driven by an authenticated human are
deliberately unthrottled so that an organizer can act repeatedly during a live incident.

#### Scenario: Unthrottled staff-console callable

- **WHEN** a staff-console callable enforces no rate limit
- **THEN** the contract check does not flag it

#### Scenario: Enforced bucket still needs a budget

- **WHEN** a callable does enforce a rate-limit bucket
- **THEN** that bucket must still have a configured budget, as required by the existing rate-limit
  budget coverage check
