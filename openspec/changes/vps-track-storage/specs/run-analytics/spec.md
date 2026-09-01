## ADDED Requirements

### Requirement: A full-fidelity track is distance-sampled before it reaches the heatmap
The movement heatmap SHALL apply distance-based sampling on READ to any track recorded at full
fidelity (one point per ping, as disk storage allows), matching what the quota-bounded path
applies on write. The aggregator counts points per grid cell, so an
unsampled track would make the places teams stood STILL the hottest cells — a movement heatmap
reporting the opposite of movement. Sampling SHALL be per team, since two teams near each other
have not travelled between one another's fixes.

#### Scenario: A stationary team does not become a hot cell in a full-fidelity run
- **WHEN** a heatmap is built for a run whose track recorded every ping, including many while
  teams stood still
- **THEN** the idle location is not disproportionately weighted relative to a typical moving cell

#### Scenario: Both storage modes produce comparable heatmaps
- **WHEN** the same movement is recorded once at full fidelity and once distance-sampled on write
- **THEN** the resulting heatmaps weight cells equivalently

#### Scenario: One team's points never satisfy another team's distance rule
- **WHEN** two teams report fixes close together in space
- **THEN** each team's track is sampled against its own previous retained point only

### Requirement: The heatmap falls back to Firestore when no disk track exists
The heatmap builder SHALL use the disk-stored track when one exists for the run, and MUST fall
back to the existing Firestore-stored track otherwise, so a run recorded before disk storage
existed, or recorded under a deployment where it is unavailable, still produces a heatmap.

#### Scenario: A run predating disk storage still renders
- **WHEN** the heatmap is requested for a run whose track was recorded entirely in Firestore
- **THEN** the heatmap is built from the Firestore-stored points, unchanged from today's behavior

#### Scenario: An empty or missing track still renders without error
- **WHEN** neither a disk track nor a Firestore track exists for a run
- **THEN** the heatmap yields no cells and does not error, preserving the existing prune-safe
  guarantee
