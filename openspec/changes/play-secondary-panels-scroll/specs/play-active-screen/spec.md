## ADDED Requirements

### Requirement: The play active screen keeps the task on top with all secondary panels below in page scroll
On the participant's active racing screen, the current task and its map SHALL sit above the secondary
status panels, and every secondary panel — the standings peek, the photo feed, team chat, trackables,
territory, and team devices — SHALL render below the task within the natural page scroll.

The screen SHALL NOT place the secondary panels in a separate nested scroll region. Every secondary
panel SHALL remain reachable by scrolling the page, and no panel SHALL be removed, collapsed into a
tab, or hidden behind an invisible fold.

#### Scenario: The task stays above the secondary panels
- **WHEN** the active racing screen renders with a current task
- **THEN** the task and its map appear above every secondary status panel

#### Scenario: Every secondary panel is reachable in the page scroll
- **WHEN** a run is busy and the standings peek, feed, chat, trackables, territory and devices panels
  all have content
- **THEN** each panel is present below the task and can be reached by scrolling the page
- **AND** none of them is placed inside a separate nested scroll container

#### Scenario: A simple game shows little below the task
- **WHEN** the active screen renders for a game with no trackables, no zones and no teammate devices
- **THEN** those panels are absent because they self hide, leaving the task prominent

### Requirement: The play active screen documents that its secondary layout is reorder only
The play active screen's source SHALL describe its secondary panel layout accurately: the panels sit
below the task and scroll with the page, with no nested bounded scroll region. The description SHALL
NOT claim a bounded independently scrolling region that is not implemented.

#### Scenario: The source comment matches the shipped behavior
- **WHEN** a developer reads the secondary panel block's explanatory comment
- **THEN** it states the panels scroll with the page and that a nested scroll region is deliberately
  not used, matching what the markup does
