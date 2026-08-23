## ADDED Requirements

### Requirement: Primary buttons and the editor/panel close controls meet a 44px minimum touch target
The shared `Button` component SHALL enforce a minimum height of 44px, and the task-editor,
map-modal, and stage-settings close controls SHALL each present a hit area of at least 36px
(44px where the surrounding row has room), so the highest-frequency taps in the mobile Builder
loop are reliably hittable.

#### Scenario: A short-label button meets the minimum height
- **WHEN** a creator measures a short-label `Button` (e.g. a wizard "Next"/"Back" control) on
  any viewport
- **THEN** its rendered height is at least 44px

#### Scenario: The close controls are large enough to tap
- **WHEN** a creator measures the task-editor close button, the map-modal close button, and
  the stage-settings close button on a 375px-wide viewport
- **THEN** each is at least 36px on both axes

#### Scenario: No layout regression from the larger targets
- **WHEN** a creator views the Builder's primary action bar and the task-editor's step-tab row
  on a 375px-wide viewport after this change
- **THEN** no row content is crowded, overlapped, or clipped as a result of the size increase
