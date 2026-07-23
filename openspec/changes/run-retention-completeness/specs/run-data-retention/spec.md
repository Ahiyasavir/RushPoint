## ADDED Requirements

### Requirement: Retention reaches every run that is over

The system SHALL delete a run's raw participant data — GPS pings and movement tracks, uploaded photo
and audio objects and the URLs referencing them, live-feed items, alert records carrying coordinates,
chat messages, capture zones, trackable travel logs, guardian-consent names and consent tokens — once
the retention window has elapsed, for **every** run that is over.

Eligibility SHALL NOT depend on the run's creator having performed any action. A run that was
finalized and a run that was simply abandoned SHALL both be reached by the retention sweep.

Aggregate results — scores, rankings and the run's own record — SHALL be retained.

Deleting a run's data SHALL be idempotent: a run already processed SHALL be skipped on every
subsequent sweep.

#### Scenario: A finalized run is pruned after the window

- **WHEN** a run was finalized and the retention window has elapsed since it finished
- **THEN** its raw participant data is deleted and its scores are retained

#### Scenario: An abandoned run is pruned after the window

- **WHEN** a run was never finalized, and every timestamp it carries is older than the retention window
- **THEN** its raw participant data is deleted, exactly as if it had been finalized

#### Scenario: An abandoned run is not retained indefinitely

- **WHEN** a creator launches a run and never finalizes it
- **THEN** the run's participant data is still deleted once the retention window has elapsed

#### Scenario: Already-processed runs are skipped

- **WHEN** the sweep encounters a run whose data has already been deleted
- **THEN** it performs no further deletion for that run

### Requirement: Prune eligibility is a pure, total, fail-closed decision

The system SHALL decide whether a run may have its participant data destroyed using a **pure total
function** of the run's own metadata, the current instant and the retention policy — no I/O, no
implicit clock read.

For a run that was finalized, the decision SHALL be anchored on when it finished.

For a run that was not finalized, the decision SHALL be anchored on the **most recent** timestamp the
run carries, considering every timestamp available. A single recent timestamp SHALL prevent the run
from being eligible, regardless of how old its other timestamps are.

The decision SHALL fail closed. A run SHALL NOT be eligible when:
- it carries no usable timestamp at all, or
- its anchor timestamp lies in the future relative to the current instant, or
- its data has already been processed.

The function SHALL be total: every input, including absent, blank, malformed, non-string and
not-a-number values, SHALL yield an explicit decision with a stated reason rather than an error.

The boundary SHALL be exact and inclusive: a run becomes eligible at precisely the anchor plus the
retention window, and not one millisecond earlier.

#### Scenario: A run being played is never eligible

- **WHEN** a run has any timestamp newer than the retention window
- **THEN** it is not eligible, whatever its other timestamps say

#### Scenario: An old run touched recently is never eligible

- **WHEN** a run was created and launched long before the retention window but was written to recently
- **THEN** it is not eligible

#### Scenario: A corrupt timestamp is never destroyable

- **WHEN** a run carries no timestamp that can be interpreted
- **THEN** it is not eligible, and the reason states that no usable timestamp was found

#### Scenario: Clock skew is never destroyable

- **WHEN** a run's anchor timestamp is in the future relative to the current instant
- **THEN** it is not eligible

#### Scenario: The boundary is exact

- **WHEN** the current instant is one millisecond before anchor plus the retention window
- **THEN** the run is not eligible
- **AND WHEN** the current instant equals anchor plus the retention window
- **THEN** the run is eligible

### Requirement: The sweep is bounded and never widens a delete

The retention sweep SHALL treat its queries as a candidate filter only; the pure eligibility decision
SHALL be re-evaluated against each candidate document and SHALL be the sole authority for destroying
anything.

The sweep SHALL deduplicate candidates so that no run is processed twice in one invocation.

The sweep SHALL verify a candidate's document path has the expected shape and that every identifier
derived from it is non-empty before that identifier is used, so that no storage deletion prefix can
ever be widened by a blank identifier.

Deletions SHALL be committed in batches within the storage engine's per-batch operation limit, and the
number of runs processed in a single invocation SHALL be bounded, with the sweep reporting whether it
stopped early. Because processed runs are marked, a bounded sweep SHALL resume from where it stopped.

#### Scenario: A candidate the predicate rejects is not touched

- **WHEN** a query returns a run that the eligibility decision rejects
- **THEN** nothing belonging to that run is deleted

#### Scenario: A malformed run path is skipped

- **WHEN** a candidate's document path does not have the expected shape, or yields a blank identifier
- **THEN** the sweep skips it without deleting anything

#### Scenario: A large backlog does not exceed the bounds

- **WHEN** more runs are eligible than the per-invocation bound
- **THEN** the sweep processes up to the bound, reports that it stopped early, and the remainder are processed by a later invocation
