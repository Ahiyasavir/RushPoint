## ADDED Requirements

### Requirement: A realistic expected duration is derived from the task's own interaction
The platform SHALL provide a pure function that derives an expected duration in minutes for a task
from that task's type and its own authored content. The derived value SHALL model only the
interaction performed AT the stop, and SHALL NOT include any travel or walking time.

The derived value SHALL be a finite number of at least 0.5 minutes and at most 30 minutes for every
possible input, including a task with an unknown type, an absent type, a non-string type, and a task
carrying no content arrays. The function SHALL never return `NaN`, zero or a negative number.

A `survey` task SHALL never derive more than 2 minutes, however many choices it carries.

#### Scenario: Each interaction type derives its own duration
- **WHEN** the duration is derived for a `geofence`, `field`, `self_report`, `numeric`, `photo`,
  `quiz`, `survey`, `sequence` and `smart_station` task
- **THEN** each returns a finite value within 0.5 and 30 minutes
- **AND** an auto check-in derives less than a photo capture, and a photo capture derives less than
  a staffed code station

#### Scenario: A survey stays under the two minute ceiling
- **WHEN** the duration is derived for a survey carrying 1, 5 and 40 choices
- **THEN** every result is at most 2 minutes
- **AND** no result is zero or negative

#### Scenario: A sequence scales with its steps
- **WHEN** the duration is derived for a sequence of 1 step and a sequence of 12 steps
- **THEN** the twelve step sequence derives a strictly larger duration
- **AND** both results remain within the 0.5 to 30 minute bounds

#### Scenario: An unknown interaction falls back safely
- **WHEN** the duration is derived for a task whose type is unknown, absent, or not a string
- **THEN** a finite positive fallback duration is returned
- **AND** the result is never `NaN`, never zero and never negative

#### Scenario: Missing content arrays do not poison the result
- **WHEN** the duration is derived for a quiz, survey or sequence task carrying no choices, no
  options and no steps
- **THEN** the base duration for that type is returned as a finite positive number

### Requirement: An authored duration always overrides the derived default
An explicit `expectedDurationMinutes` SHALL win over the derived default whenever it is a finite
number greater than zero, and the derived default SHALL only fill the gap when no usable authored
value is present.

An authored value that is not finite, is zero, or is negative SHALL NOT be used; the derived default
SHALL apply instead. An authored value that is finite but larger than the maximum SHALL be clamped
to the maximum rather than used as written.

#### Scenario: An explicit value wins
- **WHEN** a photo task declares an expected duration of 7 minutes
- **THEN** the effective duration is 7 minutes, not the derived default

#### Scenario: A malformed explicit value falls back
- **WHEN** a task declares an expected duration of `NaN`, `Infinity`, zero or a negative number
- **THEN** the effective duration is the derived default for that task
- **AND** the result is finite and positive

#### Scenario: An absurd explicit value is clamped
- **WHEN** a task declares an expected duration of 10000 minutes
- **THEN** the effective duration is the 30 minute maximum

### Requirement: No run already in progress or already finalised is re-scored
Introducing derived defaults SHALL NOT change the value computed by any scoring function for any
game that exists at the time the change ships. The scoring path SHALL keep reading the authored
fields exactly as before, and SHALL NOT consult the derived default.

No migration, backfill or write-on-read SHALL apply the derived default to a stored task. Only a
creator action SHALL persist a derived value.

#### Scenario: A pre-existing game scores identically
- **WHEN** the expected route total is computed for a game whose tasks omit both duration fields
- **THEN** the result is identical to the result produced before this change

#### Scenario: The live and final boards cannot drift
- **WHEN** a run's standings are refreshed live and then finalised
- **THEN** both go through the one shared ranking function reading the same authored fields
- **AND** no derived duration is introduced on either path

### Requirement: The creator sees the derived duration and may override it
The task editor SHALL display the duration derived for the task's currently chosen interaction type,
in the creator's own language, and SHALL let the creator replace it with their own number.

The derived value SHALL NOT be applied on its own. It SHALL reach the task only through an explicit
creator action, so a number the creator has typed is never silently overwritten. The field SHALL
reach the server through the game's stages on save, and a completeness check SHALL prove that it
does.

The editor SHALL state that the duration covers the activity at the stop and not the walk to it.

#### Scenario: The suggestion is shown for the chosen type
- **WHEN** a creator opens the task editor for a survey task
- **THEN** the editor states the typical duration for that interaction
- **AND** the statement is rendered from the translation dictionary in the creator's language

#### Scenario: A creator's own number survives a type change
- **WHEN** a creator types their own expected duration and then changes the task type
- **THEN** the typed number is kept
- **AND** the displayed suggestion updates to the new type without being applied

#### Scenario: The override reaches the server
- **WHEN** a creator sets an explicit expected duration and the game is saved
- **THEN** the value is present on the task inside the saved stages

### Requirement: An authored duration is validated server side
A game accepted from outside the server SHALL be refused when any task carries an
`expectedDurationMinutes` that is present but is not a finite number, or is negative. The refusal
SHALL name the offending task and the field, and SHALL NOT store or coerce the value.

#### Scenario: A negative duration is refused on save
- **WHEN** a game is saved with a task declaring an expected duration of -5
- **THEN** the save is refused naming that task
- **AND** the stored game is unchanged

#### Scenario: A non-finite duration is refused on import
- **WHEN** a game file declares an expected duration that is not a finite number
- **THEN** the import is refused naming the field
- **AND** no game is produced
