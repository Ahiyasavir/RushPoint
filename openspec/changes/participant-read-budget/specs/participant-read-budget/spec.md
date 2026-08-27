## ADDED Requirements

### Requirement: The participant fallback poll is bounded by cost, not by habit
The participant screen SHALL refresh its team state on a fallback interval that is chosen against
a stated read budget, and mission state SHALL NOT depend on that interval for freshness. The
push channel (a document listener that refreshes on every change to the team's own document)
remains the primary source of gameplay state.

#### Scenario: Gameplay state stays immediate
- **WHEN** the server changes a team's document (a completion, an assignment, a score change)
- **THEN** the participant screen refreshes from the push channel
- **AND** the refresh does NOT wait for the fallback interval

#### Scenario: The fallback still recovers a failed listener
- **WHEN** the document listener cannot attach, or silently stops delivering
- **THEN** the fallback interval still refreshes the screen
- **AND** the participant continues to play without reloading

#### Scenario: The interval is justified against a budget
- **WHEN** the fallback interval is chosen or changed
- **THEN** the reads it implies for a full run at the target participant count SHALL be stated
- **AND** that figure SHALL be compared against the plan's read ceiling

### Requirement: The client declines to send a ping the server would discard
The participant client SHALL evaluate the same pure ping verdict the server applies before
invoking `updateLocation`, and SHALL NOT invoke it when the verdict is that no write would occur.
The server SHALL keep its own guard unchanged: the client gate is an optimisation and never the
authority.

#### Scenario: A stationary team stops paying for suppressed pings
- **WHEN** a team has not moved significantly since its last sent fix
- **AND** the minimum interval has not elapsed
- **THEN** the client does NOT invoke `updateLocation`
- **AND** no Firestore read is spent on that fix

#### Scenario: A moving team still reports immediately
- **WHEN** a team's fix is a significant distance from its last sent fix
- **THEN** the client invokes `updateLocation` without waiting for the interval

#### Scenario: The server remains correct on its own
- **WHEN** a client sends every fix regardless of the verdict
- **THEN** the server still suppresses the writes it would have suppressed
- **AND** no behaviour depends on the client having applied the gate

### Requirement: A suppressed ping never delays a safety verdict beyond a stated floor
The server evaluates the safe zone only when a ping arrives, so client-side suppression SHALL be
bounded by a maximum silence floor. The client SHALL send a fix once the floor has elapsed even
when the verdict would otherwise suppress it.

#### Scenario: A stationary team outside the safe zone is still detected
- **WHEN** a team is stationary outside the safe zone
- **AND** the maximum silence floor elapses
- **THEN** the client sends the fix
- **AND** the server raises the out-of-bounds verdict

#### Scenario: The floor bounds the worst case
- **WHEN** any sequence of fixes is suppressed by the client gate
- **THEN** the time between two consecutive sent fixes never exceeds the floor
- **AND** the floor is no longer than the server's own minimum write interval

### Requirement: The ping gate is total and fails toward sending
The ping gate SHALL be a pure function that never throws, and SHALL resolve every uncertain
input — a missing previous fix, a non-finite coordinate, an unusable timestamp — to "send".

#### Scenario: Malformed input sends rather than drops
- **WHEN** the gate is given a non-finite coordinate, no previous fix, or an unusable clock value
- **THEN** it returns "send"
- **AND** it does not throw
