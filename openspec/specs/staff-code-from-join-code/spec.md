# staff-code-from-join-code Specification

## Purpose
TBD - created by archiving change staff-code-from-join-code. Update Purpose after archive.
## Requirements
### Requirement: A staff code is the join code with two planted characters

A new staff code SHALL be the run's join code with exactly two characters from the join-code
alphabet inserted at random positions.

#### Scenario: Minting a code
- **WHEN** the organizer creates a staff code for a run whose join code is `63MZWC`
- **THEN** the code has 8 characters and removing two of them gives `63MZWC`

### Requirement: Staff sign in with a name and a code only

The staff sign-in screen SHALL ask only for the person's name and the staff code, whether or not it
was opened from the organizer's link.

#### Scenario: Opened without a link
- **WHEN** a marshal opens player.rush-point.com/?staff and types their name and `6K3MZW7C`
- **THEN** they are signed in to that run's staff console

### Requirement: Guessing a staff code is bounded per run

A wrong code built on a run's join code SHALL count toward that run's failed-attempt lockout, and a
correct code SHALL still succeed while the run-wide lockout is active.

#### Scenario: A player tries codes
- **WHEN** someone who knows the join code submits wrong staff codes built on it
- **THEN** each one is refused and counted against that run, and the lockout applies

