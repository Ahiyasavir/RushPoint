# active-run-bar-recent Specification

## Purpose
Which live runs the creator console's floating run bar is about: only runs being played now (launched within a day), by the same predicate as the run history badge.
## Requirements
### Requirement: The floating run bar is about runs being played now

The creator console's floating run bar SHALL feature and count only live runs launched within
the last 24 hours, and SHALL treat a live run with no readable launch time as being played.

#### Scenario: Only a forgotten run is open
- **WHEN** the creator's only live run was launched a month ago
- **THEN** no floating run bar is shown

#### Scenario: One event now and old ones left open
- **WHEN** one live run was launched an hour ago and three were launched last month
- **THEN** the bar features the recent run and does not count the old ones

### Requirement: One rule for "playing now"

The run history badge and the floating run bar SHALL decide "playing now" with the same
predicate.

#### Scenario: The two surfaces agree
- **WHEN** a run is labelled "עדיין פתוחה" in the run history
- **THEN** the floating bar does not feature it

