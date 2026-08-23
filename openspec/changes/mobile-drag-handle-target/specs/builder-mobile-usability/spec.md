## ADDED Requirements

### Requirement: Stage and task drag handles meet a minimum touch target on mobile
The Builder's task-card and stage-rail drag handles SHALL present a hit area of at least
40×40px, so a creator on a touchscreen can reliably initiate a reorder drag without needing
to land a touch inside the handle glyph's own font-box.

#### Scenario: A task drag handle is large enough to grab
- **WHEN** a creator measures the task-card drag handle's hit area on a 375px-wide viewport
- **THEN** it is at least 40px on both axes

#### Scenario: A stage drag handle is large enough to grab
- **WHEN** a creator measures the stage-rail drag handle's hit area on a 375px-wide viewport
- **THEN** it is at least 40px on both axes

#### Scenario: Reordering still works from the enlarged handle
- **WHEN** a creator drags a task within a stage, drags a task to a different stage via the
  rail, or drags a stage to reorder it in the rail, starting the touch anywhere inside the
  enlarged handle
- **THEN** the reorder completes exactly as it did before the handle was enlarged
