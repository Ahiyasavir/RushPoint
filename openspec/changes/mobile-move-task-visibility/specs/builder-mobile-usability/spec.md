## ADDED Requirements

### Requirement: The move-to-stage control is discoverable without hovering
A task card's "move to another stage" control SHALL be visible at rest (not fully
transparent), so a creator using a touchscreen — which has no persistent hover state — can
discover and use it without dragging.

#### Scenario: The control is visible before any interaction
- **WHEN** a creator views a task card that has other stages to move into, with no hover or
  focus on the card
- **THEN** the move-to-stage control is visibly present, not fully transparent

#### Scenario: The control still escalates to full visibility on hover or focus
- **WHEN** a creator hovers or focuses the task card on a desktop pointer
- **THEN** the move-to-stage control reaches full opacity, same as before this change

#### Scenario: Moving a task via the control still works
- **WHEN** a creator selects a target stage from the move-to-stage control
- **THEN** the task moves to that stage exactly as it did before this change
