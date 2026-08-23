## ADDED Requirements

### Requirement: The task-type sample-loader control has an adequate touch target
The "load sample" control overlaid on each task-type option SHALL present a hit area large
enough to tap reliably without it, or the underlying type button, absorbing a mis-tap, while
remaining inside the type button's existing reserved end-padding.

#### Scenario: The sample control is large enough to tap on its own
- **WHEN** a creator measures the sample-loader control's hit area on a 375px-wide viewport
- **THEN** it is at least 24px on both axes

#### Scenario: The sample control does not spill outside its reserved zone
- **WHEN** the sample-loader control is rendered over any task-type option
- **THEN** it stays fully inside that option's reserved end-padding area and does not overlap
  the type option's own label

#### Scenario: Loading a sample still works
- **WHEN** a creator taps the sample-loader control for a task type
- **THEN** the sample picker (or immediate sample load) behaves exactly as before this change
