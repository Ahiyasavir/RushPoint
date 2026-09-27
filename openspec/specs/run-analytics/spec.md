# run-analytics Specification

## Purpose
TBD - created by archiving change run-analytics-heatmap. Update Purpose after archive.
## Requirements
### Requirement: getRunAnalytics returns a post-run aggregate for the owner
A new `getRunAnalytics` callable SHALL return per-task and per-stage analytics (completion rate,
median/p90 time, hint count, skip count, drop-off) for a finished run. It MUST be restricted to
the run owner and MUST aggregate anonymously — no team-level PII in the payload.

#### Scenario: Owner receives per-task analytics
- **WHEN** the run owner calls `getRunAnalytics` for a finished run
- **THEN** the response contains per-task completion rates, median and p90 completion times,
  hint usage counts, skip counts, and drop-off counts

#### Scenario: Non-owner is denied
- **WHEN** a non-owner calls `getRunAnalytics`
- **THEN** the call fails with `permission-denied`

#### Scenario: Analytics survive the 90-day PII prune
- **WHEN** a run's team-level PII has been pruned
- **THEN** aggregates that were already computed remain available
- **AND** teams whose data was cleared contribute 0 to counts without causing an error

### Requirement: Analytics aggregator is correct and deterministic
The `computeRunAnalytics` pure function SHALL compute correct completion rates, median/p90 times,
hint/skip counts, and stage drop-off from a set of team summaries and tasks, with no dependence on
evaluation order.

#### Scenario: Completion rate computed correctly
- **WHEN** 8 of 10 teams complete a task and 2 skip it
- **THEN** the task's `completionRate` is 0.8

#### Scenario: Median is computed correctly for odd and even team counts
- **WHEN** team completion times are [2, 4, 6, 8, 10] minutes
- **THEN** the median is 6 minutes

### Requirement: Creator dashboard shows a route heatmap (Pro-gated)
The creator RunConsole SHALL show an Analytics tab after run finalization with the route map
task pins recolored by completion rate and a sortable per-task table. This surface MUST be Pro-gated
(non-Pro creators see an upsell chip, not blank data).

#### Scenario: Task pins are colored by drop-off intensity
- **WHEN** the analytics tab renders the route map
- **THEN** tasks with ≥ 80% completion rate show green pins, 50–79% amber, < 50% red

#### Scenario: Non-Pro creator sees upsell state
- **WHEN** a creator without an active Pro subscription opens the Analytics tab
- **THEN** an upsell chip is shown and the analytics data is not rendered

### Requirement: The movement heatmap stays representative under a sampled track
The movement heatmap SHALL remain representative when its input track is distance-sampled rather
than exhaustive. Fidelity is defined at the AGGREGATE level — across all teams in a run — not per
team: a single team's retained track MAY skip grid cells it crossed, but the relative density
ordering of cells across the run MUST be preserved. Retention SHALL be driven by distance travelled
rather than elapsed time, so a stationary team contributes no points to a movement heatmap.

#### Scenario: Relative density ordering is preserved across the run
- **WHEN** a heatmap is built from a distance-sampled track for many teams
- **THEN** the ordering of cells by weight matches the ordering produced from the unsampled track,
  for cells whose unsampled weights differ by more than the sampling factor

#### Scenario: A stationary team contributes no movement points
- **WHEN** a team remains within the retention distance of its last retained point for many pings
- **THEN** no further history points are retained for that team
- **AND** the heatmap does not develop a hot cell purely because a team stood still

#### Scenario: A traversed corridor still registers
- **WHEN** teams repeatedly walk the same route between two tasks
- **THEN** cells along that route carry non-zero weight in the resulting heatmap

#### Scenario: An empty or fully-suppressed track still renders
- **WHEN** a run retained no history points
- **THEN** the heatmap yields no cells and does not error, preserving today's prune-safe behavior

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

