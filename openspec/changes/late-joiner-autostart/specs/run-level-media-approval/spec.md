## ADDED Requirements

### Requirement: A run may approve every media submission automatically

A game SHALL offer a setting, off by default, that makes every media submission in a
run approve on arrival without a human reviewing it, so an organizer running a
creative-content game is not the bottleneck for their own event.

The setting SHALL be captured onto the RUN when the run is launched and read from
there, never from the game template during play. An operational choice written on the
template is replayed by every later run, copied by duplicate, export and publish, and
rewritten wholesale by the builder.

A mission that already declares itself automatically approved SHALL keep that
behaviour regardless of the run level setting.

#### Scenario: Off by default

- **WHEN** a game has never set the option
- **THEN** media submissions still wait for review exactly as they do today

#### Scenario: On, a submission is approved on arrival

- **WHEN** the run was launched from a game with the option on
- **THEN** a media submission is approved immediately and the team is not blocked

#### Scenario: A run in flight is unaffected by editing the game

- **WHEN** the option is changed on the game after a run was launched
- **THEN** the run already under way keeps the behaviour it was launched with

#### Scenario: The caller can tell which rule approved it

- **WHEN** a submission is approved automatically
- **THEN** the response says whether the mission itself or the run wide setting did it
