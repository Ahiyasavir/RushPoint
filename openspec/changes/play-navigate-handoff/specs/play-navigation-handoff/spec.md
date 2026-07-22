## ADDED Requirements

### Requirement: A located task offers a navigation hand-off
The participant task card SHALL offer a control that opens the task's coordinates in an external
turn-by-turn navigation application, presented alongside the existing distance indicator. A Waze
destination link SHALL be offered, with a Google Maps link available as an alternative.

#### Scenario: An ordinary located task
- **WHEN** the current task carries valid coordinates and does not hide its location
- **THEN** a navigation control appears next to the distance indicator
- **AND** it targets the task's latitude and longitude

#### Scenario: A smart station with its own coordinates
- **WHEN** the current task carries `smart.stationCoords`
- **THEN** the navigation control targets the station coordinates rather than the task's own

#### Scenario: The link opens outside the app
- **WHEN** the participant activates the navigation control
- **THEN** it opens in a new context and does not navigate the running game away

### Requirement: A hidden location is never handed off
The navigation hand-off SHALL NOT be offered for a task whose location is part of the puzzle, whose
arrival the server has not yet confirmed, that has no location at all, or whose coordinates are
absent or invalid. The decision SHALL fail closed: anything not positively recognised as a
released, valid, non-hidden coordinate pair yields no hand-off.

#### Scenario: A treasure-hunt task hides its location
- **WHEN** the current task is marked as hiding its location
- **THEN** no navigation control is rendered
- **AND** no latitude or longitude is written into any link, attribute or handler

#### Scenario: A sealed task is awaiting arrival confirmation
- **WHEN** the current task is still awaiting the server's arrival confirmation
- **THEN** no navigation control is rendered

#### Scenario: A locationless task
- **WHEN** the current task is marked as locationless
- **THEN** no navigation control is rendered

#### Scenario: Coordinates are missing
- **WHEN** the current task carries no coordinates and no station coordinates
- **THEN** no navigation control is rendered

#### Scenario: Coordinates are not finite numbers
- **WHEN** a coordinate is absent, not a number, `NaN` or infinite
- **THEN** no navigation control is rendered

#### Scenario: Coordinates are the null island
- **WHEN** both coordinates are zero
- **THEN** no navigation control is rendered

### Requirement: Hand-off links are well formed
A generated navigation URL SHALL encode the target coordinates numerically and SHALL contain no
other task data.

#### Scenario: A Waze link is generated
- **WHEN** a navigation target is resolved
- **THEN** the Waze URL carries the latitude and longitude and requests navigation

#### Scenario: A Google Maps link is generated
- **WHEN** a navigation target is resolved
- **THEN** the Google Maps URL carries the latitude and longitude as its query

#### Scenario: No task text leaks into a link
- **WHEN** any navigation URL is generated
- **THEN** it contains only the coordinates, and no task title, clue, hint or answer
