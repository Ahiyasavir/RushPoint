## ADDED Requirements

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
