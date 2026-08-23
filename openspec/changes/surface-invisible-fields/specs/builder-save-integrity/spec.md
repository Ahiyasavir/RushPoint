## ADDED Requirements

### Requirement: Every builder-editable field is persisted

The creator console SHALL persist every game field its own editing surface allows a creator to
change. A control that mutates local game state SHALL NOT exist without its field being carried in
the update sent to the server.

The set of builder-editable fields SHALL be declared explicitly in one place, and the payload
builder SHALL be verified against that declaration by an automated test, so that adding a control
without adding its field fails the test suite rather than shipping as a control that does nothing.

The payload builder SHALL NOT send server-owned fields — the game id as a content field, the owner,
visibility, play count, deletion markers, or the creation/update timestamps.

#### Scenario: Wrong-answer cost survives a save

- **WHEN** a creator selects a wrong-answer cost level in the builder
- **THEN** the selected level is included in the update sent to the server
- **AND** reloading the game shows the selected level

#### Scenario: An unsaved field fails the suite

- **WHEN** the payload builder omits a field declared as builder-editable
- **THEN** the payload completeness test fails

#### Scenario: Server-owned fields are not sent

- **WHEN** a game is saved from the builder
- **THEN** the update contains no owner, visibility, play count, deletion marker or timestamp field

### Requirement: Unsaved-change detection covers every persisted field

The builder's unsaved-change detection SHALL be derived from the same payload that is sent to the
server, so that any field the server would receive also marks the game as having unsaved changes and
triggers the auto-save.

#### Scenario: Editing a scoring option marks the game dirty

- **WHEN** the only change a creator makes is a scoring option
- **THEN** the game is marked as having unsaved changes and an auto-save is attempted

### Requirement: Presentation fields are authorable

The creator console SHALL provide inputs for the game presentation fields that participant surfaces
already render: the cover image, the brand display name, and the brand accent colour.

A cover image URL SHALL be accepted only over https; anything else SHALL be treated as unset rather
than persisted. A brand accent colour SHALL be accepted only as a hex colour literal, normalized to
lowercase six-digit form. A brand section in which every value is empty SHALL be persisted as unset,
never as an object of empty strings.

All labels, hints and placeholders introduced by these inputs SHALL come from the translation
dictionaries in both Hebrew and English.

#### Scenario: Cover image is authored

- **WHEN** a creator enters an https image URL as the game's cover image
- **THEN** it is persisted and the public promo page renders it

#### Scenario: Non-https cover image is rejected

- **WHEN** a creator enters a non-https URL as the cover image
- **THEN** the value is treated as unset

#### Scenario: Accent colour is normalized

- **WHEN** a creator picks a brand accent colour written in shorthand or uppercase hex
- **THEN** it is persisted as a lowercase six-digit hex colour

#### Scenario: Emptying the brand section clears it

- **WHEN** a creator clears both the brand name and the accent colour
- **THEN** the branding field is persisted as unset rather than as empty strings
