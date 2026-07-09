# import-game-spreadsheet Specification

## Purpose
TBD - created by archiving change import-game-spreadsheet. Update Purpose after archive.
## Requirements
### Requirement: A spreadsheet can be imported into a game model
The Builder SHALL accept a CSV/XLSX upload and parse it client-side into a game model via
`parseGameRows`, grouping rows by stage and mapping each row to a task by type. The mapping MUST
reuse the shared task validators.

#### Scenario: Valid rows produce stages and tasks
- **WHEN** `parseGameRows` is given valid rows spanning two stages
- **THEN** it returns a game with those two stages and their tasks in order
- **AND** the errors list is empty

#### Scenario: Empty sheet yields an empty game
- **WHEN** `parseGameRows` is given no data rows
- **THEN** it returns an empty game with no errors

### Requirement: Bad rows are reported before saving
`parseGameRows` SHALL collect per-row validation errors (unknown task type, missing answer for a
quiz, missing numericAnswer for a numeric task, invalid coordinates for a geofence) and the import
UI MUST show a validation report and block creation while blocking errors exist.

#### Scenario: Unknown task type is flagged
- **WHEN** a row has a type that is not a valid `TaskType`
- **THEN** an error is reported for that row and creation is blocked

#### Scenario: Quiz without an answer is flagged
- **WHEN** a quiz row has no answer
- **THEN** an error is reported for that row

#### Scenario: Invalid coordinates are flagged
- **WHEN** a geofence row has out-of-range lat/lng
- **THEN** an error is reported for that row

### Requirement: Confirmed import creates a new game via existing callables
On confirmation with no blocking errors, the parsed game SHALL be persisted through `createGame` +
`updateGame`. Import MUST always create a new game and never overwrite an existing one.

#### Scenario: Import creates a new game
- **WHEN** the creator confirms a valid import
- **THEN** a new game is created and populated from the parsed model

