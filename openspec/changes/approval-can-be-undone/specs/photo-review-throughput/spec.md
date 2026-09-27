## MODIFIED Requirements

### Requirement: The review transition table admits reject after approve

The review transition table SHALL allow a reject action on an approved submission, and
the review controls SHALL offer it rather than disabling it.

This edge was previously refused because the server had no way to take the score back,
and flipping a status while the points stayed would have made the submission and the
scoreboard disagree. The reversal now removes the award, so the reason for refusing it
no longer holds.

Idempotence SHALL be preserved: applying the same action twice SHALL equal applying it
once, from every starting status.

#### Scenario: Reject is offered on an approved row

- **WHEN** a reviewer looks at an approved submission
- **THEN** a reject control is available rather than disabled

#### Scenario: Approving an approved row is still a no op

- **WHEN** an approved submission is approved again
- **THEN** nothing is sent and no second score is awarded

#### Scenario: Rejecting a rejected row is still a no op

- **WHEN** a rejected submission is rejected again
- **THEN** nothing is sent
