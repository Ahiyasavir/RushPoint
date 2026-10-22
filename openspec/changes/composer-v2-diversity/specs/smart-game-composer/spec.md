## ADDED Requirements

### Requirement: A composed game varies its mechanics
The composer SHALL prefer, among well-fitting missions, ones whose mechanic is not already in the stage.

#### Scenario: No stage of strangers
- **WHEN** a game is composed
- **THEN** no stage holds more than two missions tagged `strangers`, unless the pool has nothing else

#### Scenario: One ongoing rule at a time
- **WHEN** a game is composed
- **THEN** it holds at most one mission tagged `ongoing`, unless the pool has nothing else

#### Scenario: Reproducible
- **WHEN** the same answers and seed compose twice
- **THEN** the games are identical, and diversity consumes no extra random draws
