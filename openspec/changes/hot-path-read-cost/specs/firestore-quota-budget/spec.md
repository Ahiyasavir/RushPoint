## ADDED Requirements

### Requirement: A periodic recomputation reads only what changed
Server-side work that recomputes run-wide state on a timer SHALL read the team collection through the shared cached-collection helper, so its cost scales with how many teams actually changed rather than with how many teams exist. The live leaderboard snapshot is the case this exists for.

#### Scenario: A quiet interval costs almost nothing
- **WHEN** the leaderboard snapshot is recomputed and few teams have changed since the last
  recomputation
- **THEN** only the changed team documents are read
- **AND** the reads performed are far fewer than the number of teams in the run

#### Scenario: A team that just scored is never stale
- **WHEN** a team's document is written and the snapshot is recomputed afterwards
- **THEN** that team's fresh data is used in the ranking
- **AND** the published standings never reflect the pre-write score for that team

#### Scenario: The cost is stated per participant count
- **WHEN** the recomputation interval or its read strategy changes
- **THEN** the reads it implies for a full run at the target participant count SHALL be stated
- **AND** compared against the plan's read ceiling

### Requirement: A staleness indicator is not refreshed at interaction speed
A staleness indicator SHALL be refreshed on its own cadence, independent of the poll that displays it, when refreshing it costs reads proportional to participant activity. Its only purpose is to distinguish "no recent evidence" from "recent evidence".

#### Scenario: The organizer board does not re-read locations every poll
- **WHEN** the run console polls the teams board at its normal interval
- **THEN** the location-freshness source is re-read at most once per its own longer interval
- **AND** rows in between carry the most recently read freshness value

#### Scenario: The indicator never gates a safety decision
- **WHEN** the location-freshness value is stale by up to its refresh interval
- **THEN** no safety verdict depends on it
- **AND** the safe-zone decision continues to be made where the fix arrives, not here

### Requirement: Immutable run inputs are not re-read per action
A document that cannot change for the duration of a run SHALL be read through the document cache on every hot participant path, not re-fetched per action.

#### Scenario: The game template is read once, not per submission
- **WHEN** many participants submit answers, arrive, or request tasks during one run
- **THEN** the game template is served from cache rather than re-read for each action

#### Scenario: An edit during a run is still seen
- **WHEN** the game template is written through the API
- **THEN** the cached copy is invalidated
- **AND** the next read observes the new value
