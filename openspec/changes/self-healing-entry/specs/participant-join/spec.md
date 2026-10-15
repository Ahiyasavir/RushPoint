## MODIFIED Requirements

### Requirement: Every join failure is shown as one localized, actionable sentence

The participant app SHALL map every failure returned by the join lookup and the join call to a
message in the participant's own language that states what to do next. It SHALL NOT display a raw
server message, a raw error code, or copy written for the host.

The mapping SHALL be a pure, total function from the failure to a message key: any input, including
an unrecognized failure code, a failure carrying no code, and a non-error value, SHALL produce a key
rather than an error.

The app SHALL distinguish, at minimum:

- a code that does not resolve, in which case the participant is told to check the code with the
  host;
- a code that is no longer active, in which case the participant is told to ask the host for a new
  code;
- a run that has already finished, in which case the participant is told to ask the host for the
  current code;
- a run that is full, in which case the participant is told to tell the host, who can open more
  spots;
- a team that already has its maximum number of phones, on the add-a-phone path, in which case the
  participant is told the team is full and to ask the organizer, and is NOT told that the device code
  is wrong;
- a transport failure (network unavailable, timeout), in which case the participant is told to check
  their connection and try again, and is NOT told the code is wrong;
- a missing sign-in that automatic recovery could not repair, in which case the participant is told
  that the phone lost its sign-in and is offered to reload the page, and is NOT told to check their
  connection;
- anything else, in which case the participant is told to try again and to reach the host if it
  keeps happening.

A missing sign-in SHALL first be recovered automatically (participant-identity-recovery). The
participant SHALL only see the sign-in message when that recovery has failed.

Distinguishing these SHALL NOT change any server rule and SHALL NOT let the app proceed past a
failure the server returned.

#### Scenario: A finished run

- **WHEN** the join call fails because the run has already finished
- **THEN** the participant reads a localized sentence saying the race is over and to ask the host
  for the current code, and never the server's English sentence

#### Scenario: A revoked code

- **WHEN** the lookup or the join call fails because the code is no longer active
- **THEN** the participant reads a localized sentence telling them to ask the host for a new code

#### Scenario: A network failure

- **WHEN** the call fails because the network is unavailable or the call timed out
- **THEN** the participant reads the connection message and is not told that the code is invalid

#### Scenario: A sign-in that could not be recovered

- **WHEN** the join call is refused for a missing sign-in and automatic recovery has failed
- **THEN** the participant reads that the phone lost its sign-in, sees a reload action, and is not told
  to check their connection

#### Scenario: A full team on the add-a-phone path

- **WHEN** a phone tries to join an existing team that already has its maximum number of phones
- **THEN** the participant reads that the team is full and to ask the organizer, and is not told to
  check the device code

#### Scenario: An unrecognized failure

- **WHEN** the call fails with a code the app does not recognize, or with no code at all
- **THEN** the participant reads the generic retry message and no raw server text is shown
