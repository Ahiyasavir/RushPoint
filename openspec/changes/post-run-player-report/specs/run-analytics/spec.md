# run-analytics Specification

## ADDED Requirements

### Requirement: Post-run reporting is reachable after the console is closed
A run's analysis SHALL remain reachable from the creator console after the run has ended and the
live console has been left, addressed by `{ gameId, runId }` rather than by an access code the
creator must still be holding. The existing anonymous per-mission aggregate is unchanged; this adds
a player-level and answer-level view alongside it, restricted to the game's owner.

#### Scenario: A run finished last week is still analysable
- **WHEN** the owner opens run history and selects a run that finished days ago
- **THEN** its report loads without the access code being re-entered

#### Scenario: The anonymous aggregate is unchanged
- **WHEN** `getRunAnalytics` is called for the same run
- **THEN** it returns the same per-mission aggregate it returned before this change, with no
  team-level identity added to that payload
