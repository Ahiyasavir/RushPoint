## ADDED Requirements

### Requirement: A submission waiting for review raises an escalating alarm
The organizer console SHALL show, for every submission waiting for review, how long it has waited,
and SHALL mark it amber from 20 seconds and red from 60 seconds. When any submission has waited 20
seconds or more, the console SHALL raise an alarm that is visible in every section, audible (repeating
every 20 seconds until no submission is over the threshold), and reflected in the browser tab title.
The organizer SHALL be able to mute the sound for 5 minutes without hiding the alarm.

#### Scenario: The alarm starts at 20 seconds
- **GIVEN** a team submitted a video for review 19 seconds ago
- **WHEN** one more second passes without a decision
- **THEN** the console shows the alarm naming that team and how long it has waited
- **AND** the alarm sound plays

#### Scenario: The alarm stops when the queue is handled
- **GIVEN** an alarm for one waiting submission
- **WHEN** the organizer approves it
- **THEN** the alarm disappears and the sound stops repeating

#### Scenario: Mute
- **WHEN** the organizer mutes the alarm
- **THEN** no sound plays for 5 minutes
- **AND** the alarm banner stays visible

### Requirement: The organizer can see whether alert sounds are on
The organizer console SHALL show a control to enable alert sounds while the browser has not yet
allowed the page to play sound, and SHALL hide it once sound is enabled.

#### Scenario: Sound not yet enabled
- **GIVEN** the organizer opened the console and has not clicked anything
- **THEN** the console shows the control to enable alert sounds
