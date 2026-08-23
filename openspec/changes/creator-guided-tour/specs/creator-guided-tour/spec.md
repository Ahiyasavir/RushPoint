## ADDED Requirements

### Requirement: A first-run guided tour walks a new creator through the console
The creator console SHALL provide a guided tour that introduces, in a fixed order, the whole feature
surface a creator needs: creating a game, the games list, the Builder (stages, tasks, the available
task types, placing a task on the map, the scoring preset and stage rules, the preview, and launch
readiness), launching and running a live run, the gallery, credits, and settings.

The tour SHALL be expressed as an ordered list of declared steps. Each step SHALL declare the
console surface it describes, the element it points at (or that it is deliberately centred), and
whether it applies only when payments are enabled. No step SHALL be produced by a rendering
condition rather than by that list.

#### Scenario: Every feature area appears exactly once in order
- **WHEN** the tour steps are built
- **THEN** the list contains steps describing the dashboard, the Builder, the live run console, the
  gallery and settings
- **AND** the Builder steps cover stages, tasks, task types, location, scoring, preview and launch
- **AND** every step id is unique and the order is stable between two builds

#### Scenario: A payments-only step is absent in free mode
- **WHEN** the tour steps are built with payments disabled
- **THEN** the credits step is absent
- **AND** the relative order of the remaining steps is unchanged

#### Scenario: Every step has copy in both languages
- **WHEN** the tour steps are built
- **THEN** each step id has a title and a body in the Hebrew dictionary and in the English one
- **AND** neither dictionary carries a step id the other lacks

### Requirement: The tour can be skipped at any step and never re-fires by itself
The tour SHALL offer a skip control on every step, including the first and the last. Skipping SHALL
end the tour immediately and SHALL be remembered for that creator.

Completing the tour SHALL likewise be remembered. Once a creator has either skipped or completed the
tour, it SHALL NOT start on its own again, regardless of how the stored record was produced or which
version of the tour produced it.

#### Scenario: Skip from the first step ends the tour
- **WHEN** the tour is running on its first step and skip is invoked
- **THEN** the tour is no longer running
- **AND** the outcome is recorded as skipped

#### Scenario: Skip from the last step ends the tour
- **WHEN** the tour is running on its last step and skip is invoked
- **THEN** the tour is no longer running
- **AND** the outcome is recorded as skipped, not as completed

#### Scenario: Advancing past the last step completes the tour
- **WHEN** the tour is on its last step and is advanced
- **THEN** the tour is recorded as completed
- **AND** no step beyond the last is ever selected

#### Scenario: Going back from the first step does nothing
- **WHEN** the tour is on its first step and the creator goes back
- **THEN** the tour stays on the first step and stays running

### Requirement: A returning creator is never interrupted
The tour SHALL start on its own only for a creator with no stored record who does not already look
established. An account already known to hold games SHALL NOT be interrupted by the tour.

A stored record that cannot be read, is malformed, or was written by a different version of the tour
SHALL be treated as "already seen" rather than as an invitation to start again.

#### Scenario: A brand new creator is greeted
- **WHEN** no record is stored for this creator and the account is not established
- **THEN** the tour starts on its own

#### Scenario: A creator who already skipped it is left alone
- **WHEN** a stored record says the tour was skipped, or says it was completed
- **THEN** the tour does not start on its own

#### Scenario: An established account is left alone
- **WHEN** the account is already known to hold games
- **THEN** the tour does not start on its own, even with no stored record

#### Scenario: A record from another version still counts as seen
- **WHEN** the stored record carries a version other than the current one
- **THEN** the tour does not start on its own

#### Scenario: Unreadable storage does not break the console
- **WHEN** the stored value is absent, empty, not valid data, or carries an unknown outcome
- **THEN** reading it yields no record and raises no error

### Requirement: The tour can be replayed on demand
The creator SHALL be able to restart the tour from the first step at any time, from a help control
in the console header and from settings, whether they previously skipped it, completed it, or are
seeing it for the first time.

Restarting SHALL always begin at the first step, and SHALL work even after the tour has been
recorded as skipped or completed.

#### Scenario: Restart after skipping
- **WHEN** the tour has been skipped and the creator asks to replay it
- **THEN** the tour runs again from its first step

#### Scenario: Restart after completing
- **WHEN** the tour has been completed and the creator asks to replay it
- **THEN** the tour runs again from its first step

#### Scenario: An implicit start cannot replay a finished tour
- **WHEN** the tour has already been skipped or completed and an automatic start is attempted
- **THEN** nothing changes, and only an explicit replay resumes it

### Requirement: A step points at its subject or explains it plainly
A step that declares an anchor SHALL highlight that element when it is present on the screen. When
the anchor is absent, because the creator is on a different screen or the element no longer exists,
the step SHALL present its explanation in a centred card instead of pointing at nothing.

A step MAY offer a link to the surface it describes, and SHALL offer none when that destination
cannot be resolved. The tour SHALL NOT navigate the creator away on its own.

#### Scenario: The anchor is on screen
- **WHEN** a step declares an anchor and that element is present
- **THEN** the step is presented anchored to that element

#### Scenario: The anchor is missing
- **WHEN** a step declares an anchor and no such element is present
- **THEN** the step is presented as a centred card
- **AND** the step still shows its title and body

#### Scenario: A destination that cannot be resolved offers no link
- **WHEN** a Builder step is shown for a creator who has no game yet
- **THEN** no "take me there" destination is produced

#### Scenario: The card stays on screen
- **WHEN** a step is anchored to an element at the very edge of the viewport
- **THEN** the card position is finite, non negative, and within the viewport bounds

### Requirement: The tour introduces no server state
The tour SHALL record whether a creator has seen it using client side storage scoped to that
creator's account, and SHALL NOT add a callable, a stored document, or a security rule.

Two different creators using the same browser SHALL NOT share a tour record, and the tour record
SHALL NOT collide with any other stored onboarding value.

#### Scenario: Records are per creator
- **WHEN** the storage key is derived for two different creator accounts
- **THEN** the two keys differ
- **AND** neither equals the key used by the first run checklist

#### Scenario: Nothing is written before an outcome
- **WHEN** the tour is idle or still running
- **THEN** no record is produced to store
