# play-screen-hierarchy Specification (delta)

## ADDED Requirements

### Requirement: The primary task is the top-most prominent element while racing
On the active racing screen (a launched, not-yet-finished team), the assigned-task card SHALL render
above every secondary status panel (live ops, photo feed, chat, trackables, territory capture, team
devices), immediately below the header, progress, and safety-alert row. The player MUST NOT have to
scroll the main screen to reach the task.

#### Scenario: Task card sits above the secondary panels
- **WHEN** a launched team views the play screen with an active stage
- **THEN** the task card (and its map) render directly under the header/progress/alerts, before the
  live-ops, feed, chat, trackables, and territory-capture panels

#### Scenario: The task is reachable without scrolling the page
- **WHEN** the play screen renders on a typical phone viewport height
- **THEN** the assigned-task card is visible without scrolling the main screen; only the secondary
  region scrolls

### Requirement: The primary task text is legibly sized
The assigned-task title and description SHALL be rendered at a size and contrast large enough to be
the visual focal point: the title at least `text-2xl` and the description at least `text-base` at a
darker (higher-contrast) foreground than the previous `text-zinc-400`, using the play-web light theme
(reversed zinc scale). All classes MUST be static Tailwind strings.

#### Scenario: Task title and description are prominent
- **WHEN** the task card renders for an assigned task with a title and description
- **THEN** the title is at least `text-2xl` and the description is at least `text-base` at
  `text-zinc-300` (or darker), not the previous small low-contrast styling

### Requirement: Secondary panels occupy a self-contained scroll region
Secondary status panels SHALL be grouped in a single region below the task that scrolls independently
(bounded max height with vertical overflow), so long status content does not grow the main screen
unbounded. This covers live ops, photo feed, chat, trackables, territory capture, team devices, and
the viewer role banner. Every panel that renders today MUST still render, with all existing
visibility conditions preserved.

#### Scenario: Long secondary content scrolls within its own region
- **WHEN** the secondary panels collectively exceed the region's bounded height
- **THEN** the secondary region scrolls internally while the header, map, and task card stay in place

#### Scenario: No panel is dropped by the reorder
- **WHEN** a run has photo feed enabled, trackables, capture zones, teammate devices, and a viewer
  role active
- **THEN** the feed, chat, trackables, territory-capture, team-devices, and viewer-banner panels all
  still render, now within the secondary region, under the same conditions as before

### Requirement: The reorder does not disturb the offline-continuity overlay
The reordering SHALL NOT move, remove, or alter the `ReconnectingPill` overlay introduced by
`fix-play-offline-continuity` or any other fixed overlay (story interstitial, power-up toast); those
remain position-independent overlays rendered above the reordered in-flow content.

#### Scenario: Reconnecting pill still overlays the reordered screen
- **WHEN** the play screen is reconnecting after a connectivity drop
- **THEN** the reconnecting pill renders on top of the reordered content exactly as before, and the
  in-flow task and secondary region are unaffected by its presence
