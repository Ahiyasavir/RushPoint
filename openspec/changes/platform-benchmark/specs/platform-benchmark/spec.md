# Platform Benchmark

## ADDED Requirements

### Requirement: Finished runs contribute anonymized aggregates per task type
On finalization, a run SHALL contribute anonymized per-task-type aggregates (median completion time,
completion rate) to a platform `benchmarks/{taskType}` document via a rolling merge. The stored data
MUST contain only counts and aggregates — no run, game, or team identifiers — and contribution MUST be
opt-outable.

#### Scenario: Finalization updates the benchmark aggregate
- **WHEN** a run is finalized and contribution is not opted out
- **THEN** `benchmarks/{taskType}` is updated with rolling aggregates and no per-run identifiers

#### Scenario: Opt-out skips contribution
- **WHEN** a run has opted out of benchmark contribution
- **THEN** finalization does not modify any benchmark document

#### Scenario: Rolling merge initializes from empty
- **WHEN** `mergeBenchmark(null, sample)` is called
- **THEN** it returns an aggregate initialized from that sample with count 1

### Requirement: Analytics shows a data-backed benchmark indicator
`compareToPlatformMedian` SHALL read the platform aggregate, and `benchmarkIndicator` SHALL map a
value against the platform median to a directional indicator (faster / slower / on par / unknown).

#### Scenario: Indicator thresholds
- **WHEN** `benchmarkIndicator(value, platformMedian)` is given a value within ±10% of the median
- **THEN** it returns 'on_par'
- **WHEN** the value is below the median
- **THEN** it returns 'faster'
- **WHEN** there is no platform median yet
- **THEN** it returns 'unknown'

#### Scenario: No individual run is identifiable
- **WHEN** any client reads the benchmark surface
- **THEN** no individual run, game, or team can be identified from the aggregate
