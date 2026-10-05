## ADDED Requirements

### Requirement: Skipping a stage can award nothing

`skipStage` SHALL accept `noPoints`; with it, every skipped mission SHALL earn 0 and no consolation
SHALL reach the score ledger. The console SHALL ask the organizer whether to skip with or without
consolation points.

#### Scenario: Skip without points
- **WHEN** the organizer skips a team's stage and chooses "דילוג בלי ניקוד"
- **THEN** the stage completes, every mission in it is skipped with 0, and the team's score is unchanged
