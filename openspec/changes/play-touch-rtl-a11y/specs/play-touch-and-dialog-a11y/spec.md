## ADDED Requirements

### Requirement: Machine-data fields are read left-to-right
An input holding a machine-generated identifier SHALL declare `dir="ltr"` regardless of the
document direction. This covers the access code, the team code, the station code and the staff
PIN. An input that
carries human-authored text SHALL NOT be given a fixed direction and SHALL continue to resolve its
direction from its content.

#### Scenario: A participant types an access code in a Hebrew session
- **WHEN** the app is in Hebrew and the participant focuses the access-code field
- **THEN** the caret starts at the left of the field and typed characters advance rightward

#### Scenario: A participant types a team name in a Hebrew session
- **WHEN** the app is in Hebrew and the participant focuses a free-text name field
- **THEN** the field's direction is still resolved from the typed content, not forced

#### Scenario: A volunteer enters a staff PIN
- **WHEN** the staff sign-in screen is rendered in Hebrew
- **THEN** the PIN field is left-to-right

### Requirement: Projected boards align to the screen edge
A leaderboard rendered for projection SHALL align its score column with a logical alignment so it
sits at the trailing edge of the screen in both reading directions.

#### Scenario: The TV leaderboard is projected in Hebrew
- **WHEN** the TV or ceremony leaderboard renders under `dir="rtl"`
- **THEN** the score column aligns to the trailing screen edge, not the middle

### Requirement: Interactive controls meet the touch-size minimum
A control that awards or spends points SHALL present a tap area of at least 44 by 44 CSS pixels.
The same minimum applies to a control that changes team or session state, and to any control that
sits adjacent to a control with the opposite effect.

#### Scenario: Reordering an ordering-quiz answer
- **WHEN** the participant taps the up or down control on an ordering-quiz row
- **THEN** each control's tap area is at least 44 by 44 pixels

#### Scenario: Revealing a paid hint
- **WHEN** the participant reaches for the hint control, which spends points
- **THEN** the control presents at least a 44 by 44 pixel tap area

#### Scenario: Leaving a run
- **WHEN** the participant reaches for the control that clears the session
- **THEN** the control presents at least a 44 by 44 pixel tap area

#### Scenario: Adjusting a team's score from the staff console
- **WHEN** a volunteer reaches for the plus or minus score adjusters
- **THEN** each adjuster is at least 44 by 44 pixels
- **AND** the deducting group is separated from the awarding group by more space than separates
  members of the same group

### Requirement: Every interactive control has an accessible name
A control whose visible label is an icon or a glyph SHALL carry an accessible name drawn from the
translation maps.

#### Scenario: Dismissing a live-ops announcement
- **WHEN** assistive technology reaches the announcement dismiss control
- **THEN** the control reports a localized name
- **AND** the control has padding that lifts its tap area to the touch-size minimum

### Requirement: Staff destructive actions are deliberate and acknowledged
A staff action that changes a team's score, rejects a submission, or ends the staff session SHALL
NOT be committed by a single tap on an unmarked control.

#### Scenario: A volunteer adjusts a score
- **WHEN** the score adjustment callable resolves successfully
- **THEN** a transient confirmation naming the applied delta appears on that team's row

#### Scenario: A volunteer reviews a photo submission
- **WHEN** the approve and reject controls are rendered
- **THEN** approve is the visually primary control and reject is a lower-weight outline control

#### Scenario: A volunteer signs out
- **WHEN** the volunteer activates sign-out
- **THEN** a confirmation is requested first, stating that signing in again needs the PIN
- **AND** the session is cleared only if the volunteer confirms

### Requirement: Expandable panels report their state
A panel that can be expanded and collapsed SHALL use the shared collapsible control, exposing
`aria-expanded` and a header tap target of at least 44 pixels tall.

#### Scenario: A volunteer expands the chat or photo-feed panel
- **WHEN** assistive technology reaches the panel header
- **THEN** the header is a button reporting `aria-expanded`

### Requirement: Modal surfaces announce themselves and are dismissible
A surface that blocks the page to ask for a decision SHALL carry `role="alertdialog"` and
`aria-modal="true"`, SHALL move focus into itself when it opens, SHALL restore focus to the
previously focused element when it closes, and SHALL treat the Escape key as a cancel.

#### Scenario: A paid-hint purchase is confirmed
- **WHEN** the hint confirmation opens
- **THEN** it is announced as an alert dialog and focus moves to its confirm control

#### Scenario: A confirmation is dismissed with the keyboard
- **WHEN** the user presses Escape while a confirmation is open
- **THEN** the confirmation resolves as if cancelled
- **AND** focus returns to the element that was focused before it opened

#### Scenario: A full-screen story or how-to-play overlay is open
- **WHEN** the user presses Escape
- **THEN** the overlay closes

### Requirement: The secondary panel region does not trap the scroll gesture
The participant play screen SHALL NOT nest a bounded scrolling region inside the page's own
scrolling flow for its secondary panels.

#### Scenario: A participant swipes over the standings panel
- **WHEN** the participant drags upward with the touch starting over the secondary panels
- **THEN** the page scrolls, rather than an inner region consuming the gesture

### Requirement: An attempt-limited answer is never spent on a single tap
When a task declares a finite answer attempt limit, a multiple-choice selection SHALL require a
confirmation before it is submitted, and that confirmation SHALL state how many attempts remain.
When a task declares no attempt limit, a selection SHALL be submitted on the first tap with no
confirmation.

#### Scenario: A quiz with no attempt limit
- **WHEN** the participant taps a choice on a task whose attempt limit is absent, zero or negative
- **THEN** the answer is submitted immediately with no confirmation

#### Scenario: A quiz with a finite attempt limit
- **WHEN** the participant taps a choice on a task whose attempt limit is a positive number
- **THEN** a confirmation is requested that states the remaining attempts
- **AND** the answer is submitted only if the participant confirms

#### Scenario: The participant cancels the confirmation
- **WHEN** the participant declines the confirmation
- **THEN** no answer is submitted and no attempt is consumed

#### Scenario: Wrong answers accumulate within the session
- **WHEN** the participant has already submitted a wrong answer on an attempt-limited task
- **THEN** the next confirmation reports a lower remaining-attempt count
- **AND** the reported count never falls below zero
