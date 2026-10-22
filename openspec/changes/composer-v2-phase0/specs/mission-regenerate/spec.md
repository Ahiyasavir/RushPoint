## MODIFIED Requirements

### Requirement: Regenerate is one visible press on every mission card
Every mission card SHALL show a regenerate button outside its actions menu.

#### Scenario: One press swaps, with feedback
- **WHEN** a creator presses the card's regenerate button
- **THEN** the mission is replaced at once, the card plays a short spin
- **AND** a toast says it was replaced and offers undo

#### Scenario: Undo restores the exact mission
- **WHEN** the creator presses the toast's undo
- **THEN** the mission is exactly the mission it was before the press

#### Scenario: Reduced motion
- **WHEN** the device asks for reduced motion
- **THEN** the swap happens without the spin
