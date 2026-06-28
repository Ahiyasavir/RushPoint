# Run Analytics

## ADDED Requirements

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
