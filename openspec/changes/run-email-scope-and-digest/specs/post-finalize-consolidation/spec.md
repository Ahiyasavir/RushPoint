## ADDED Requirements

### Requirement: Post-finalize work executes in any deployment topology

When a run transitions to `finished`, the system SHALL perform the three post-finalize concerns —
per-team player-profile folds, the platform-benchmark contribution, and the organizer summary email
— regardless of whether the deployment provides a Firestore trigger runtime. A host that serves only
callables MUST NOT silently skip them.

#### Scenario: Finalizing on a callable-only host

- **WHEN** `finalizeRun` completes its authoritative `status:'finished'` write on a host where no
  Firestore trigger runtime exists
- **THEN** the player-profile folds, the benchmark contribution and the summary-email seam are each
  invoked before the call returns
- **AND** each invocation leaves its observable breadcrumb, so the log distinguishes "ran and chose
  not to send" from "never ran"

#### Scenario: Finalizing where the Firestore trigger also fires

- **WHEN** a deployment invokes both the inline path and the `onRunFinalized` trigger for the same
  `status:'finished'` transition
- **THEN** each concern's side effects occur exactly once
- **AND** the later path is a no-op rather than an error

### Requirement: Consolidation is exactly-once per finalized run

Each concern SHALL be guarded by a transactional claim so that repeated invocation for the same run
cannot repeat its side effects. The claims are the per-team `profileRecorded`, the run-level
`benchmarkContributed`, and the run-level `summaryEmailSent`.

#### Scenario: Repeated consolidation for the same run

- **WHEN** the consolidation routine is invoked a second time for a run whose claims are already set
- **THEN** no additional email is sent, no additional benchmark merge occurs, and no player profile
  is folded twice

#### Scenario: A run that was never eligible to email

- **WHEN** consolidation runs for a run that is not eligible for a summary email
- **THEN** the `summaryEmailSent` claim is left unset
- **AND** no email provider request is made

### Requirement: A failing concern never blocks finalize or the other concerns

The three concerns SHALL be independently isolated. A failure in one MUST NOT prevent the others,
and none of them MUST cause the organizer's `finalizeRun` call to fail — the authoritative
`status:'finished'` write happens first and is never rolled back by consolidation.

#### Scenario: Email provider is unreachable

- **WHEN** the email provider request throws or returns a non-success status during consolidation
- **THEN** the player-profile folds and the benchmark contribution still complete
- **AND** `finalizeRun` still returns the final rankings successfully

#### Scenario: A corrupt team document

- **WHEN** one team's document cannot be parsed during the profile folds
- **THEN** the benchmark contribution and the summary email still proceed
- **AND** the failure is logged rather than surfaced to the caller

### Requirement: The inline and triggered paths share one implementation

The consolidation logic SHALL exist in exactly one routine called by both the inline finalize path
and the Firestore trigger, so the two cannot diverge as the code changes.

#### Scenario: Adding a fourth post-finalize concern

- **WHEN** a new post-finalize concern is added to the shared consolidation routine
- **THEN** it takes effect on both the inline path and the trigger path with no second edit
