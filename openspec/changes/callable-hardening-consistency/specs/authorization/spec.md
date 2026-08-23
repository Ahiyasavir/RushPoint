## ADDED Requirements

### Requirement: A privileged action's audit record names the principal that caused it

When a privileged action is recorded in the audit trail, the recorded operator SHALL be the principal
that actually caused the action.

A system operator identity SHALL be recorded only when a scheduled job, and not a person, initiated
the action. An on-demand invocation by an authenticated operator SHALL be attributed to that
operator, including when the invocation supplies an override that changes what the underlying sweep
would otherwise have destroyed.

#### Scenario: Scheduled sweep destroys expired games

- **WHEN** the scheduled retention job purges games whose trash window has elapsed
- **THEN** each resulting audit record names the system operator identity

#### Scenario: Operator forces a purge on demand

- **WHEN** an authenticated operator invokes the on-demand purge, including with a grace-period
  override that widens what is destroyed
- **THEN** each resulting audit record names that operator, not the system operator identity

### Requirement: On-demand destruction of participant data is auditable

An on-demand invocation that irreversibly destroys participant data SHALL write a durable audit
record naming the operator and identifying what was destroyed.

The record SHALL be written once per invocation, summarising the outcome, rather than once per
affected document.

A failure to write the audit record SHALL NOT abort or reverse the action that was requested.

#### Scenario: Single run pruned on demand

- **WHEN** an operator prunes one named run's participant data on demand
- **THEN** a durable audit record names the operator and that run

#### Scenario: Retention sweep run on demand

- **WHEN** an operator runs the retention sweep on demand
- **THEN** a single durable audit record names the operator and how many runs were pruned

#### Scenario: Audit write fails

- **WHEN** the durable audit record cannot be written
- **THEN** the requested destruction still completes and the failure is reported through the
  best-effort failure channel

### Requirement: Bulk rewrites of public data are auditable

An on-demand invocation that bulk-rewrites a world-readable collection SHALL write a durable audit
record naming the operator and summarising the page's outcome.

An invocation that only reports what it would change, without writing, SHALL still be recorded, and
SHALL be distinguishable from an invocation that wrote.

#### Scenario: Backfill page applied

- **WHEN** an operator runs a page of the public-task coordinate backfill
- **THEN** a durable audit record names the operator and the number of documents scanned and repaired

#### Scenario: Backfill dry run

- **WHEN** an operator runs the backfill in report-only mode
- **THEN** a durable audit record is written and marks the invocation as a dry run
