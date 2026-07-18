# public-game-stats-integrity Specification (delta)

## ADDED Requirements

### Requirement: Public game estimated-minutes total is always finite
The server SHALL compute the denormalized `estimatedTotalMinutes` written to `publicGames/{id}` (on
public-game resync and on publish) by treating any task whose `estimatedMinutes` is missing or
non-finite as 0, so the written value MUST always be a finite, non-negative number.

#### Scenario: A task without an estimate does not poison the total
- **WHEN** a published game has some tasks with no `estimatedMinutes`
- **THEN** the `estimatedTotalMinutes` written to `publicGames/{id}` is a finite number equal to the
  sum of the present, positive estimates (not `NaN`)

#### Scenario: All estimates missing
- **WHEN** no task in the game carries an `estimatedMinutes`
- **THEN** the written `estimatedTotalMinutes` is `0`
