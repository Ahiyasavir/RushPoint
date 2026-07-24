# Spec: play-pending-states-speak

## ADDED Requirements

### Requirement: The first screen after Join shows a branded, advancing wait instead of a bare spinner

The participant app SHALL, while it has no team state yet on the initial load right after joining,
present the existing branded `Working` panel (rotating RushPoint-voiced status lines plus an
advancing indicator) instead of a single wordless spinning ring, so the very first thing a player
sees after tapping Join reads as forward motion rather than a motionless wait.

The panel SHALL rotate through 2 to 4 already-translated status lines and SHALL show an indicator
that reads as forward motion, reusing the existing `Working` component with no new logic. The
adjacent persistent-error branch (retry + leave) SHALL be unchanged, so a genuine load failure still
offers a way out rather than an endless wait.

#### Scenario: A participant waits for their game to load after joining

- **WHEN** the participant app has joined a run but does not yet have team state, and no error has
  occurred
- **THEN** the screen shows the branded working panel with rotating status lines and an advancing
  bar, not a bare 8px spinning ring

#### Scenario: The initial load fails persistently

- **WHEN** the initial team-state load fails and surfaces an error
- **THEN** the error branch (message plus retry and leave controls) is shown, not the working panel

### Requirement: Quick-submit task actions show pending feedback during the network round-trip

The participant task view SHALL show pending feedback on its fast submit actions — station-code
verify, field check-in, and quiz / numeric / survey answer submission — for the duration of the
network round-trip, so a submit on a slow link is acknowledged instead of leaving a silently greyed
button with no signal.

Each such submit control SHALL show an in-flight indicator while its request is pending, reusing the
existing shared `Button` `loading` prop driven by the already-present busy state. The in-flight
signal SHALL be tied to the request being in flight (the busy state), not to a read-only viewer
device, so a viewer device does not display a false loading state. The existing disabled guards that
prevent double submission SHALL remain in effect.

#### Scenario: A player submits a station code on a slow connection

- **WHEN** the player taps the verify / check-in / answer submit button and the request is still in
  flight
- **THEN** that button shows an in-flight loading indicator until the server responds, rather than
  only greying out with no feedback

#### Scenario: A read-only viewer device does not show a false pending state

- **WHEN** the task view is shown on a read-only viewer device with no submission in flight
- **THEN** the submit controls do not display a loading indicator

### Requirement: New pending-state copy is bilingual and routed through the dictionary

Every status string introduced for these pending states SHALL be defined in both the Hebrew and the
English play-web dictionaries and SHALL be rendered through the translation layer, never hardcoded in
a component.

The Hebrew copy SHALL be natural Hebrew and the English copy SHALL be English, and neither SHALL use
an em-dash. The initial-load rotation keys `play.loadingGame`, `play.syncingProgress` and
`play.almostReady` SHALL exist in both dictionaries; if the optional in-flight progress line is
included, the key `task.checking` SHALL likewise exist in both dictionaries.

#### Scenario: The app is in Hebrew

- **WHEN** the participant app language is Hebrew and a pending-state panel or line is shown
- **THEN** the copy renders in Hebrew from the Hebrew dictionary, not in English

#### Scenario: The app is in English

- **WHEN** the participant app language is English and a pending-state panel or line is shown
- **THEN** the copy renders in English from the English dictionary
