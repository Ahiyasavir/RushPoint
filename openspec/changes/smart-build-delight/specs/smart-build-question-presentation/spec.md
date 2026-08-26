## ADDED Requirements

### Requirement: Options are illustrated choice cards
Each selectable option in the smart-build questionnaire SHALL render as a choice card carrying an
illustration or icon alongside its label, rather than a text-only chip. Cards SHALL show their
selected state visibly, and multi-select questions SHALL remain multi-select.

#### Scenario: Every option carries an illustration
- **WHEN** a creator reaches any single-choice question
- **THEN** every offered option renders as a card with an illustration and a label

#### Scenario: Selection is visible
- **WHEN** a creator picks an option
- **THEN** that card renders in a selected state distinguishable without relying on colour alone

#### Scenario: Multi-select questions still take several answers
- **WHEN** a creator selects two kinds of place on the multi-select question
- **THEN** both cards show as selected
- **AND** both answers reach the composer payload

### Requirement: Moving between questions is animated
Advancing to the next question or returning to the previous one SHALL animate the questions in and
out rather than replacing them instantly. The animation SHALL respect a reduced-motion preference.

#### Scenario: Advancing slides
- **WHEN** a creator advances from one question to the next
- **THEN** the outgoing question animates out and the incoming one animates in

#### Scenario: Reduced motion is honoured
- **WHEN** the operating system requests reduced motion
- **THEN** questions change without the sliding animation
- **AND** the questionnaire remains fully usable

### Requirement: Progress is shown as a completion ring
The questionnaire SHALL show how far through it the creator is as a ring that fills toward
completion, in addition to the existing textual step count.

#### Scenario: The ring tracks progress
- **WHEN** a creator is on question 4 of 8
- **THEN** the ring is filled to the proportion that question represents
- **AND** the textual step count still reads "question 4 of 8"

#### Scenario: The ring is announced to assistive technology
- **WHEN** the ring is reached by a screen reader
- **THEN** it exposes the current step, the minimum and the maximum

### Requirement: Advancing gives haptic acknowledgement
Advancing a question SHALL fire the application's existing haptic feedback on devices that support
it. Absence of haptic support SHALL NOT affect the questionnaire.

#### Scenario: Advancing buzzes
- **WHEN** a creator advances a question on a device supporting haptics
- **THEN** the existing haptic feedback fires

#### Scenario: No haptic support is harmless
- **WHEN** a creator advances a question on a device with no haptic support
- **THEN** the question advances normally and no error is raised

### Requirement: The questionnaire's existing behavior is unchanged
The presentation change SHALL NOT alter which questions are asked, their order, their defaults,
whether answers survive navigation, the back-out signal from the first question, or the fact that
nothing is created until the questionnaire finishes.

#### Scenario: The flow is the same
- **WHEN** a creator walks the whole questionnaire
- **THEN** the same questions are asked in the same order as before this change

#### Scenario: Answers still survive navigation
- **WHEN** a creator answers every question, walks back to the first and forward again
- **THEN** every answer they gave is still selected

#### Scenario: Backing out of the first question still leaves
- **WHEN** a creator presses Back on the first question
- **THEN** the flow signals that the creator left, exactly as before

### Requirement: All new text is translatable
Every user-facing string introduced by this change SHALL come from the translation maps. No
component SHALL hardcode a UI string that will not switch language.

#### Scenario: Card labels switch language
- **WHEN** the console language is switched between Hebrew and English
- **THEN** every choice card label switches with it

#### Scenario: The strict i18n gate stays clean
- **WHEN** the strict i18n check runs over the changed components
- **THEN** it reports no new hardcoded-string findings
