## ADDED Requirements

### Requirement: An approved media submission can be reversed

An organizer or run-scoped staff member SHALL be able to reject a media submission that
has already been approved, including one that was approved automatically.

Reversing an approval SHALL remove from the team exactly the score that submission
earned, so that the submission's status and the team's score can never disagree. A
reversal that could not determine what was awarded SHALL remove nothing and SHALL say
so, rather than guessing at an amount.

A reversal SHALL be audited, naming who performed it and the reason given, as every
other privileged act on a run is.

#### Scenario: Reversing an automatic approval takes the points back

- **WHEN** a submission that was approved automatically is rejected by an organizer
- **THEN** the submission is marked rejected
- **AND** the team's score falls by exactly what that submission awarded

#### Scenario: A reversal is recorded

- **WHEN** an approval is reversed
- **THEN** an audit record names the operator and the reason

#### Scenario: Reversing twice is the same as reversing once

- **WHEN** an already-reversed submission is rejected again
- **THEN** no further score is removed

#### Scenario: An unknown award removes nothing

- **WHEN** the award for a submission cannot be determined
- **THEN** no score is changed and the caller is told the reversal did not apply

### Requirement: A reversal does not send the team backwards

Reversing an approval SHALL NOT un-complete the mission, re-route the team, or move a
run that is already in progress. It SHALL only remove the award and mark the submission
rejected.

Putting a team back onto a mission they have walked away from is a separate and riskier
act, and SHALL remain the job of the existing force-assign tool.

#### Scenario: The team keeps playing

- **WHEN** an approval is reversed while the team is mid-run
- **THEN** the team's current mission and position are unchanged

#### Scenario: A finished run is not reopened

- **WHEN** an approval is reversed for a team that has finished
- **THEN** the team remains finished
