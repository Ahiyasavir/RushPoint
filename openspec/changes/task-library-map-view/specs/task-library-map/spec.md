## ADDED Requirements

### Requirement: The mission library offers a map view

The Gallery's Tasks tab SHALL offer the same list/map view toggle the Games tab offers. Selecting
the map view SHALL show the current search results plotted on a map; selecting the list view SHALL
show them as cards. The card list SHALL remain visible in both views, so the map is an additional
way to reach a result and never the only way to see one.

The map SHALL use the platform's shared tile-style resolution and SHALL offer the same map-mode
toggle the games map offers.

#### Scenario: Switching the Tasks tab to the map view

- **WHEN** a creator is on the Tasks tab and selects the map view
- **THEN** a map appears above the result cards with a marker for every plottable result

#### Scenario: The toggle follows the tab

- **WHEN** a creator switches between the Games tab and the Tasks tab
- **THEN** the list/map toggle is offered on both, and each tab's map plots only that tab's results

### Requirement: Only plottable public tasks appear on the map

A public task SHALL be plotted if and only if it carries an area location that is present and
geographically real. A task SHALL NOT be plotted when its location is absent, when either
coordinate is non-finite or out of range, or when the location is the null-island placeholder
`(0, 0)`. The predicate SHALL be a pure function so that it is testable without a map.

The map SHALL NOT fall back to any other location field when the area location is absent.

#### Scenario: A task with no published location

- **WHEN** the results include a task with no published area location — because it is a
  hidden-location task, or because it was never placed
- **THEN** no marker is rendered for it
- **AND** its card is still present in the list, so it remains findable by search

#### Scenario: A placeholder coordinate

- **WHEN** the results include a task whose published location is `(0, 0)`
- **THEN** no marker is rendered for it and the map's framing ignores it

#### Scenario: No result is plottable

- **WHEN** the map view is selected and none of the current results are plottable
- **THEN** the map renders with an explicit message saying there is nothing to show, rather than an
  empty map the creator would read as a loading failure

### Requirement: The map states that pins are approximate

The mission library map SHALL carry visible text telling the creator that task pins show an
approximate area rather than an exact location, so a pin is never mistaken for a location fix.

#### Scenario: Viewing the mission library map

- **WHEN** the map view is shown on the Tasks tab
- **THEN** a visible notice states that pins are approximate

### Requirement: Selecting a marker focuses that task's card

Activating a task's marker SHALL bring that task's card into view and visually distinguish it from
the other cards, matching the behaviour the games map already provides.

#### Scenario: Clicking a task marker

- **WHEN** a creator clicks a marker on the mission library map
- **THEN** the corresponding task card is scrolled into view and highlighted

#### Scenario: Focus does not leak between tabs

- **WHEN** a creator focuses a task card from the map and then switches to the Games tab
- **THEN** no games card is highlighted as a result of that earlier task selection
