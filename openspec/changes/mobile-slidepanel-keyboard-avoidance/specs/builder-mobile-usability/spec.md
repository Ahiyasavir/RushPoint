## ADDED Requirements

### Requirement: The Builder shell sizes against the dynamic viewport
The Builder's root shell SHALL size its height against the dynamic viewport (`dvh`) rather
than the static viewport (`vh`), so the visible area — and anything anchored to its bottom
edge, such as the task editor's bottom sheet — tracks the actual visible viewport instead of
the largest possible one.

#### Scenario: The shell height matches the dynamic viewport unit
- **WHEN** the Builder shell is inspected on a mobile viewport with no on-screen keyboard open
- **THEN** its computed height is unchanged from before this change

#### Scenario: No regression to the 3-pane workspace or the task editor
- **WHEN** a creator views the Builder's header, 3-pane workspace, and the task-editor bottom
  sheet on desktop and on a 375px-wide viewport with no keyboard open
- **THEN** all three render and position identically to before this change
