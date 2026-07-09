# run-replay Specification

## Purpose
TBD - created by archiving change run-replay-vod. Update Purpose after archive.
## Requirements
### Requirement: getRunReplay returns a time-ordered timeline of a finished run
A `getRunReplay` callable SHALL return a chronologically ordered event stream (start, task
completion, photo, score milestone, finish), a cumulative score series per team, and per-team
summaries for a finished run. It MUST be owner-only.

#### Scenario: Owner receives an ordered timeline
- **WHEN** the run owner calls `getRunReplay` for a finished run
- **THEN** the response contains events sorted ascending by time and a cumulative score series per team

#### Scenario: Non-owner is denied
- **WHEN** a non-owner calls `getRunReplay`
- **THEN** the call fails with `permission-denied`

### Requirement: The timeline aggregator is correct and retention-safe
`buildRunTimeline` SHALL produce globally time-ordered events and correct cumulative score series,
and MUST handle pruned teams gracefully (omitted, no error).

#### Scenario: Events are globally time-ordered
- **WHEN** `buildRunTimeline` runs over multiple teams' task states
- **THEN** the events array is sorted ascending by timestamp across all teams

#### Scenario: Cumulative score series is correct
- **WHEN** a team completes tasks worth 10 then 15 points
- **THEN** its score series shows 10 then 25

#### Scenario: Pruned team is omitted without error
- **WHEN** a team's data has been pruned
- **THEN** it contributes no events and the timeline is returned without error

### Requirement: The replay page renders an interactive timeline
The RunConsole SHALL render a replay page with a time scrubber, per-team filter, photo gallery, and a
score-over-time chart. Export MUST use the browser print path (no server-side rendering).

#### Scenario: Replay page renders the timeline
- **WHEN** the owner opens the Replay page for a finished run
- **THEN** the timeline, scrubber, gallery, and score chart are shown

