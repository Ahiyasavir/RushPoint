## ADDED Requirements

### Requirement: The phone sees who did their part, and the sender counts

The participant projection SHALL carry `taskContributions`. The phone that submits a mission SHALL
count as one of its contributors, so a team whose requirement reduces to one phone SHALL see no
extra "I did my part" control, and the server SHALL count the submitter when checking the
requirement.

#### Scenario: One phone
- **WHEN** a team with one phone plays a mission that asks for two contributors
- **THEN** it submits without tapping "עשיתי את החלק שלי"

#### Scenario: Two phones
- **WHEN** the second phone taps "עשיתי את החלק שלי"
- **THEN** both phones read "2 מתוך 2" and the sender can submit
