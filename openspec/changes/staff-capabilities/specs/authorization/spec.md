## ADDED Requirements

### Requirement: A game sets what its staff may do by default
The platform SHALL let a creator choose, in a game's settings, the default set of staff
capabilities for that game's runs, and SHALL use it as the starting permissions of every staff code
created for those runs. A game with no such setting SHALL default to every capability.

#### Scenario: Points blocked by default
- **GIVEN** a game whose staff defaults exclude changing scores
- **WHEN** the organizer creates a staff code without choosing permissions
- **THEN** people signed in with that code cannot adjust a team's score

### Requirement: The organizer creates staff codes with their own permissions
The platform SHALL let the run's owner create several staff codes for a run, each with a label and a
set of capabilities, each usable by more than one person. The owner SHALL be able to change a code's
capabilities at any time, with effect on the next operation of every person signed in with it; to
disable a code so that nobody new can sign in with it; and to remove an individual person.

#### Scenario: Judges may give points, marshals may not
- **GIVEN** a code "judges" with the score capability and a code "marshals" without it
- **WHEN** a person from each code tries to adjust a team's score
- **THEN** the judge's adjustment succeeds
- **AND** the marshal's adjustment is refused

#### Scenario: One code, several people
- **WHEN** two different people sign in with the same staff code
- **THEN** both are signed in as staff with that code's permissions

#### Scenario: Grant scoring mid-run
- **GIVEN** a code whose people cannot adjust scores
- **WHEN** the owner adds the score capability to that code
- **THEN** the next score adjustment by any of its people succeeds

#### Scenario: Remove one person
- **WHEN** the owner removes one person signed in with a code
- **THEN** that person's next operation is refused
- **AND** other people on the same code keep working

#### Scenario: Disable a leaked code
- **WHEN** the owner disables a code
- **THEN** a new sign-in with it is refused
- **AND** people already signed in with it keep working

### Requirement: Staff act only within their capabilities, and safety is always allowed
The platform SHALL refuse any staff-reachable operation whose capability the staff member does not
hold. Acknowledging alerts, releasing an out-of-bounds team and messaging the organizer SHALL always
be allowed.

#### Scenario: A marshal can always answer an SOS
- **GIVEN** a staff member whose code has no optional capabilities
- **WHEN** they acknowledge a team's SOS
- **THEN** the alert is acknowledged

### Requirement: Staff signed in before capabilities existed keep working
A staff member whose session predates capability grants SHALL keep full staff access for that run.

#### Scenario: Legacy staff session
- **GIVEN** a staff session with no recorded grant
- **WHEN** it performs a staff operation on its run
- **THEN** the operation is allowed

### Requirement: The staff app offers only permitted actions
The staff app SHALL show only the actions its user's capabilities allow and SHALL update when those
capabilities change, without asking for the code again.

#### Scenario: A marshal sees no score control
- **GIVEN** a staff member without the score capability
- **THEN** the staff app shows no score adjustment control
