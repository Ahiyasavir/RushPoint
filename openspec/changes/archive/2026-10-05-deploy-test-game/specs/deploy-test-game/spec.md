## ADDED Requirements

### Requirement: Every deploy puts a test game in the organizer's account

`npm run deploy:test-game` SHALL create a game titled `deploy <YYYY-MM-DD>` in the given creator
account, through the `importGameFile` callable, whose missions are the checks to play, each
description saying what to do ("מה עושים") and what should happen ("מה אמור לקרות"). Running it
again for the same date SHALL leave the existing game alone.

#### Scenario: The deploy of 2026-10-05
- **WHEN** the script runs for 2026-10-05
- **THEN** the account holds "deploy 2026-10-05" with ten missions in three stages

### Requirement: The test game launches once its one pin is placed

The template SHALL pass the game file parser and the go-live structure, completability and
points-by-answer checks once the walking mission has a pin, and Quick Setup SHALL ask for that pin.

#### Scenario: Before and after the pin
- **WHEN** the game is created
- **THEN** readiness blocks only on the unplaced walking mission, and nothing blocks once it is placed

### Requirement: Behaviour not live yet is marked

A notes file SHALL be able to append "ידוע: …" to named missions, so a fix that is in the repo but
not deployed is not reported twice; a note for an unknown mission SHALL be refused.

#### Scenario: A fix waiting for the next deploy
- **WHEN** the notes file names `dt-sos`
- **THEN** that mission's description ends with the "ידוע" line
