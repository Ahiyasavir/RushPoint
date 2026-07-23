## ADDED Requirements

### Requirement: The featured demo is playable from anywhere with no setup
The app SHALL offer a featured demo game that a first-time visitor can start solo, free, and
anonymously, from any location on earth, with no organizer, no access code, no GPS, and no map. The
demo game SHALL have every task marked locationless, and SHALL NOT contain any task whose completion
depends on physical arrival (no field, geofence, or smart_station task).

#### Scenario: Every task needs no location
- **WHEN** the demo game's tasks are evaluated for their trigger mode
- **THEN** each task resolves to the locationless trigger mode
- **AND** the game's derived requirement is "anywhere"

#### Scenario: No task type can gate on GPS or a code
- **WHEN** the demo game's task types are inspected
- **THEN** no task is of type field, geofence, or smart_station
- **AND** no task carries a hidden location

### Requirement: The featured demo runs with no human in the loop
The demo game SHALL be eligible for instant play and SHALL NOT require guardian consent, so it can
be started through the instant-play path with no organizer. Every photo task in the demo SHALL be
auto-approved, so it scores immediately with no staff review and no code verification.

#### Scenario: Instant play is permitted and unblocked
- **WHEN** the demo game document is inspected
- **THEN** it permits instant play
- **AND** it does not require guardian consent

#### Scenario: A photo task needs no reviewer
- **WHEN** a photo task in the demo game is inspected
- **THEN** it is configured to auto approve
- **AND** it is not marked as requiring photo review
- **AND** it carries no secret station code

### Requirement: The featured demo can never dead-end
Every stage of the demo game SHALL be winnable: its required task count SHALL never exceed the
number of tasks a team can actually complete in that stage.

#### Scenario: No stage requires more completions than are attainable
- **WHEN** each stage's required task count is checked against its attainable completions
- **THEN** no stage reports a required-count problem

### Requirement: The featured demo is bilingual and its content is dash-free
The demo game SHALL present natural Hebrew as the default and polished English alongside it: its
description SHALL contain both Hebrew and English, its how-to instructions SHALL carry both a Hebrew
body and an English body, and each task's description SHALL contain both Hebrew and English. No task
title or description SHALL contain any hyphen or dash, per the product copy standard.

#### Scenario: Content carries both languages
- **WHEN** the demo game's description, instructions, and task descriptions are inspected
- **THEN** each contains both Hebrew and English text

#### Scenario: Content contains no dashes
- **WHEN** each task title and description is scanned for hyphen or dash characters
- **THEN** none is present

### Requirement: The featured demo button opens the flagship instant-play game
The creator landing page's "try a sample game" button SHALL open the flagship demo game's promo
route, from which a visitor starts a fresh solo run through the instant-play path. It SHALL NOT
point visitors at a shared pre-launched run.

#### Scenario: Tapping the demo button lands on the flagship
- **WHEN** a logged-out visitor taps the "try a sample game" button
- **THEN** the participant app opens the flagship demo game's promo view
- **AND** its "Play now" action starts an instant-play run of that game
