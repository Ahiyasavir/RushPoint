# run-summary-report Specification (delta)

## ADDED Requirements

### Requirement: One consolidated run summary is composed from the existing aggregators
The platform SHALL compose a single run-summary object containing final standings, completion stats,
and a feedback digest, and it MUST derive every value by reusing the existing recap, analytics, and
feedback aggregators (it recomputes no scoring, ranking, timing, or feedback math of its own).

#### Scenario: Summary reuses recap standings and analytics completion verbatim
- **WHEN** the summary is composed from a run's recap, analytics, and feedback aggregates
- **THEN** its standings are the recap's ordered standings (score and duration intact), its completion
  block carries the analytics `overallCompletionRate` and the recap team/photo/winner stats unchanged,
  and no ranking or scoring is recalculated

#### Scenario: Feedback digest is bounded and finite
- **WHEN** the composed feedback digest is produced from the feedback summary
- **THEN** `topIssues` lists the reported issues sorted by descending count and capped at three, and a
  run with no feedback yields `responseCount` 0, `responseRate` 0, an empty `topIssues`, and no `NaN`,
  and the whole summary object serializes to JSON without error

### Requirement: The run summary is retrievable in-app by the organizer only
A callable SHALL return the composed run summary for a run resolved by its access code, and it MUST
reject any caller who is not the run's owner, so the summary is an organizer-only in-app view.

#### Scenario: Owner retrieves the summary after finalize
- **WHEN** the run's owner calls the summary callable with the run's access code after finalize
- **THEN** the response contains the non-empty standings, a completion block with a numeric overall
  completion rate, and a feedback digest

#### Scenario: A non-owner is denied
- **WHEN** a participant or any non-owner calls the summary callable for a run they do not own
- **THEN** the call is rejected with a permission-denied error and no summary data is returned

### Requirement: Run summary email is a wired seam that is off until a provider is configured
Finalizing a run SHALL invoke a single run-summary email seam best-effort AFTER the run's state is
committed, and that seam MUST default to a no-op (no mail provider imported, no network call, no real
email sent) that only records a breadcrumb, so it is safe to ship before a mail provider exists and
can be enabled later without changing finalize or the composing code.

#### Scenario: Finalize never fails because of the email seam
- **WHEN** a run is finalized while the email seam is disabled (the default) or the seam throws
- **THEN** the run is still finalized successfully with its standings published, and the seam call
  neither sends real email nor propagates any error to the finalize result

#### Scenario: The seam is invoked with the composed summary post-commit
- **WHEN** a run is finalized
- **THEN** the email seam is called after the finalize commit with the same composed run summary
  (standings, completion stats, and feedback digest) that the in-app view returns
