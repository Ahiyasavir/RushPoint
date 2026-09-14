## ADDED Requirements

### Requirement: A manual score adjustment records why it was made

Every console that can adjust a team's score manually SHALL offer the operator a way
to say why, and SHALL send that reason to `adjustTeamScore` so it reaches the audit
record. The reason SHALL be drawn from a preset vocabulary appropriate to the sign of
the adjustment, with a free-text option alongside it.

The reason SHALL remain optional. No control may be disabled, and no adjustment may be
refused, because a reason was not chosen — an operator correcting a score during a
live event must never be blocked by an empty field.

#### Scenario: An organizer awards points with a preset reason

- **WHEN** an organizer enters a positive adjustment in the Run Console
- **THEN** the preset reasons offered are the award reasons, not the penalty reasons
- **AND** choosing one and confirming sends that reason's id to `adjustTeamScore`

#### Scenario: A deduction offers penalty reasons

- **WHEN** an organizer enters a negative adjustment
- **THEN** the preset reasons offered are the penalty reasons

#### Scenario: Free text is available

- **WHEN** an organizer chooses the free-text option and types a reason
- **THEN** the trimmed text is sent as the reason

#### Scenario: No reason is still a valid adjustment

- **WHEN** an organizer confirms an adjustment without choosing any reason
- **THEN** the adjustment is applied
- **AND** no control was disabled for the missing reason

### Requirement: The reason vocabulary has exactly one definition

The preset reason ids SHALL be defined in `packages/shared` and consumed by every
console. No app may declare its own reason id, and every id the shared module exports
SHALL have a display label in both language maps of every app that offers the picker.

The id that reaches the server SHALL be language-neutral and stable; the wording shown
to the operator SHALL be resolved per app through its own translation map, so an audit
trail written by a Hebrew-configured phone is readable by an English-configured
organizer.

#### Scenario: An app cannot invent a reason id

- **WHEN** an app declares a reason id that the shared module does not export
- **THEN** the parity guard fails

#### Scenario: An id without a label fails the gate

- **WHEN** the shared module exports a reason id that an app's language map has no
  label for
- **THEN** the parity guard fails, naming the id and the language

### Requirement: A console SHALL accept the characters its operators actually type

An amount entry SHALL accept the dash characters a Hebrew or typographic keyboard
emits, not only ASCII hyphen minus, so that a deduction typed on the phone an
organizer is holding is understood as a deduction.

Note: the creator console and the staff console currently apply different parsing
rules (leading `+`, Unicode dashes, decimal rounding, and the per action ceiling).
That divergence is KNOWN and is deliberately not resolved by this change, because
resolving it means changing one console's live input handling on its own merits.

#### Scenario: A typographic minus is a deduction

- **WHEN** an operator types a Unicode minus followed by a number
- **THEN** it is understood as a negative adjustment of that size

#### Scenario: An unusable amount is refused before any call is made

- **WHEN** the entered amount is empty, zero, or not a number
- **THEN** no call is made and no audit record is written
