## ADDED Requirements

### Requirement: A team stranded after the run started is always surfaced

The run console SHALL raise an attention signal naming every team that joined after
the organizer started the cohort and is still not playing, counting them and saying
how long they have waited.

This signal SHALL NOT depend on any setting. An organizer who never enabled automatic
starting is exactly the organizer whose team can be stranded, so a safety net that
only listed teams the platform had already rescued would be silent in the only
situation that matters.

A stranded late joiner SHALL be told apart from a run that simply has not started
yet. The two are the same teams in the same counter but a different situation, and
the calmer message SHALL NOT be shown alongside the urgent one about the same people.

#### Scenario: A team that joins after the start is flagged

- **WHEN** a team joins a run whose cohort has already been started, and is not playing
- **THEN** the console raises a warning naming how many such teams there are

#### Scenario: The flag does not depend on the auto start setting

- **WHEN** automatic starting is off
- **THEN** a stranded late joiner is still flagged

#### Scenario: A run that has not started strands nobody

- **WHEN** the organizer has not yet started the cohort
- **THEN** no team is reported as stranded
- **AND** the ordinary "not started yet" note is what the console shows instead

#### Scenario: A team that joined before the start is not stranded

- **WHEN** a team joined before the organizer pressed start and is not playing
- **THEN** it is not reported as stranded

#### Scenario: A join in the same moment as the start is not late

- **WHEN** a team joins within the grace window after the start
- **THEN** it is not treated as late

### Requirement: A run may start late joiners by itself

A game SHALL offer a setting, off by default, that makes a team joining an
already-started run receive its first mission immediately instead of waiting.

The setting SHALL be read as a literal true. Any other stored value SHALL leave the
behaviour exactly as it is without the setting, because this starts a team playing
without being asked.

#### Scenario: Off by default

- **WHEN** a game has never set the option
- **THEN** a late joiner waits for the organizer exactly as it does today

#### Scenario: On, a late joiner starts immediately

- **WHEN** the option is on and a team joins an already-started run
- **THEN** the team is launched and receives its first mission

#### Scenario: A non boolean value does not enable it

- **WHEN** the stored value is anything other than the literal true
- **THEN** no team is started automatically

### Requirement: Automatic starting never bypasses guardian consent

A game that requires guardian consent SHALL NOT start a late joiner automatically,
whatever the auto start setting says. The team SHALL still be reported as stranded so
a human is told, and the reason SHALL name consent rather than the setting.

#### Scenario: A consent gated game holds the team

- **WHEN** the game requires guardian consent and auto start is on
- **THEN** the late joiner is not started
- **AND** it is still reported as stranded
- **AND** the recorded reason names consent
