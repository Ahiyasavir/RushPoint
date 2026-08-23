## ADDED Requirements

### Requirement: Dashboard stat tiles and the Hot Zone form reflow to a single column on narrow viewports
The Dashboard's stat-tile grid (and its loading-skeleton mirror) SHALL render as a single
column below the `sm` breakpoint, and the Run Console's Hot Zone radius/multiplier/duration
form SHALL do the same, matching the responsive pattern already used elsewhere on both pages.

#### Scenario: Dashboard stat tiles stack on mobile
- **WHEN** a creator views the Dashboard's stat tiles on a 375px-wide viewport
- **THEN** they render in a single column

#### Scenario: The loading skeleton matches the loaded layout
- **WHEN** the Dashboard's stat tiles are still loading, on a 375px-wide viewport
- **THEN** the skeleton placeholders render in the same single-column layout the loaded tiles
  will use, so no reflow happens when loading finishes

#### Scenario: The Hot Zone form stacks on mobile
- **WHEN** a creator opens the Hot Zone activation form on a 375px-wide viewport
- **THEN** the radius, multiplier, and duration inputs render in a single column, each with
  its label attached

#### Scenario: Both grids are unchanged at wider viewports
- **WHEN** a creator views the Dashboard stat tiles or the Hot Zone form at or above the `sm`
  breakpoint
- **THEN** their column layout is unchanged from before this change
