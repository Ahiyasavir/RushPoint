## ADDED Requirements

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
