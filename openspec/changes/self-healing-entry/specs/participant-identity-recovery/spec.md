## ADDED Requirements

### Requirement: An unrequested sign-out is reversed with the same identity

The participant app SHALL detect when its signed-in user becomes absent while the page is open and the
app did not request a sign-out, and SHALL reinstate the same user so the phone keeps its identity, its
team and its progress. Reinstating SHALL NOT require a network request, SHALL NOT create a new identity,
and SHALL persist the reinstated user again so the browser's stored copy is repaired.

A sign-out the app itself requested (for example, switching from a staff identity to a player) SHALL
NOT be reversed.

#### Scenario: The stored sign-in disappears on the join screen

- **WHEN** a phone opens a join link, the code check succeeds, and the browser's stored sign-in is
  wiped before the player taps join
- **THEN** the join succeeds, and the server sees the same identity that performed the code check

#### Scenario: The stored sign-in disappears mid-game

- **WHEN** a playing phone's stored sign-in is wiped while the play screen is open
- **THEN** the next team-state request succeeds with the same identity, and the player sees no error and
  no lasting "reconnecting" indicator

#### Scenario: A requested sign-out is respected

- **WHEN** the app signs out deliberately, as when a staff identity switches to a player
- **THEN** the previous identity is not reinstated

### Requirement: No server call leaves without checking the sign-in

Before every server call, the participant app SHALL confirm that a user is signed in. When none is, it
SHALL first attempt the reinstatement above for a bounded time, and only then proceed according to the
phase:

- before the phone has joined a team, it SHALL sign in afresh and continue;
- after it has joined, it SHALL NOT silently create a new identity, and SHALL instead report the
  signed-out state to the player (see participant-offline-continuity).

A call the server refuses because the request carried no sign-in SHALL trigger this check and be sent
again once. Re-sending the same unsigned request without this check SHALL NOT happen.

#### Scenario: Joining with no restorable identity

- **WHEN** a phone that has not joined any team has no signed-in user and none can be reinstated
- **THEN** it signs in afresh and the join proceeds without any error shown

#### Scenario: A call refused for a missing sign-in

- **WHEN** a call returns "sign-in required"
- **THEN** the app re-checks the sign-in, recovers it, and sends the call once more, and the player
  sees the call's normal result

### Requirement: Existing signed-in players keep their identity across the storage change

The participant app SHALL preserve the identity of a player who was signed in before a change to
where the sign-in is stored: after loading the new version, the player MUST keep the same identity.

#### Scenario: A player signed in under the old storage loads the new version

- **WHEN** a phone whose identity is stored only in the previous storage opens the new version of the app
- **THEN** it continues with the same identity and the same team

### Requirement: Every lost sign-in is visible on the server

The participant app SHALL report each detected loss of its sign-in to the server once recovery has run,
stating the outcome (reinstated, signed in afresh, or failed), the phase (joining or playing), how long
after sign-in it happened, and the browser it ran on. Reporting SHALL NOT block or fail the player's
action, and a failure to report SHALL be ignored.

The server SHALL accept such a report only from a signed-in caller, SHALL refuse a malformed or
oversized report, SHALL rate-limit reports per caller, and SHALL record each accepted report as one
structured log entry without writing to the database.

#### Scenario: A recovered loss is reported

- **WHEN** the app reinstates a lost sign-in
- **THEN** the server log contains one entry for that phone with the outcome "reinstated" and its browser

#### Scenario: A malformed report is refused

- **WHEN** a caller sends a report with an unknown kind or an oversized field
- **THEN** the server refuses it and records nothing

### Requirement: A phone that lost its identity can rejoin its own team

After a phone has joined a team, the participant app SHALL keep what it needs to rejoin that same team
as an additional phone. When the phone's identity is genuinely lost (for example, after a reload with
the stored sign-in gone), the app SHALL offer a one-tap rejoin of that team instead of a new-team form
or an unrecoverable error. If the team cannot take another phone, the app SHALL say that the team is
full and to ask the organizer.

#### Scenario: Reopening the game after the identity was lost

- **WHEN** a player reopens the game on the same phone, the saved session points to their team, and the
  phone's identity is no longer a member
- **THEN** the player is offered to rejoin their team with one tap and, on tapping, continues in that
  team
