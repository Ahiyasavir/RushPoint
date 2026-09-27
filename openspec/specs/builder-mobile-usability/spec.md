# builder-mobile-usability Specification

## Purpose
TBD - created by archiving change mobile-back-button-target. Update Purpose after archive.
## Requirements
### Requirement: The Builder's back-to-games control meets a 44px minimum touch target on mobile
Below the `sm` breakpoint, the Builder header's back-to-games button SHALL present a hit area
of at least 44×44px, even though its text label stays hidden at that width.

#### Scenario: The back button is large enough to tap on mobile
- **WHEN** a creator measures the back-to-games button's hit area on a 375px-wide viewport
- **THEN** it is at least 44px on both axes

#### Scenario: The back button still navigates correctly
- **WHEN** a creator taps the back-to-games button, on mobile or desktop
- **THEN** the Builder leaves to the game list exactly as before this change

#### Scenario: The desktop button is unchanged
- **WHEN** a creator views the back-to-games button at or above the `sm` breakpoint
- **THEN** its geometry (padding, visible label) is identical to before this change

### Requirement: The Builder shell sizes against the dynamic viewport, with an explicit fallback
The Builder's root shell SHALL size its height against the dynamic viewport (`dvh`) on a
browser that supports it, so the visible area — and anything anchored to its bottom edge,
such as the task editor's bottom sheet — tracks the actual visible viewport instead of the
largest possible one. On a browser that does NOT support `dvh`, the shell SHALL fall back to
the static viewport (`vh`) rather than an unconstrained height, and this fallback SHALL be
selected by an explicit feature query, not by an assumption about CSS rule order.

#### Scenario: The shell height matches the dynamic viewport unit where supported
- **WHEN** the Builder shell is inspected on a mobile viewport with no on-screen keyboard open,
  on a browser that supports the `dvh` CSS unit
- **THEN** its computed height is unchanged from before this change

#### Scenario: The shell falls back to the static viewport where dvh is unsupported
- **WHEN** the Builder shell is inspected on a browser that does not support the `dvh` CSS unit
- **THEN** its height resolves to the static viewport height, not to an unconstrained
  (`auto`) height

#### Scenario: No regression to the 3-pane workspace or the task editor
- **WHEN** a creator views the Builder's header, 3-pane workspace, and the task-editor bottom
  sheet on desktop and on a 375px-wide viewport with no keyboard open
- **THEN** all three render and position identically to before this change

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

