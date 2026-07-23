## MODIFIED Requirements

### Requirement: The map states that pins are approximate

The mission-library map SHALL draw a precise marker for an ordinary mission — the exact spot the
creator placed — and SHALL NOT describe that pin as approximate. It SHALL surface a visible
"approximate area" caption only when at least one plotted pin is genuinely coarse: a hidden-location
mission, or a legacy mission not yet migrated to its exact point. When every plotted pin is a precise
ordinary pin, no "approximate" caption SHALL be shown.

Whether a given pin is coarse SHALL be decided by the shared `isCoarsePublicPoint` predicate — a point
is coarse exactly when it already sits on the public grid — so the map never claims a precision the
coordinate does not have, and never labels an exact point approximate.

The mission-detail view of a single mission SHALL use a plain "location on the map" heading and show
the exact spot with no approximate caveat for an ordinary mission, and SHALL use an "approximate area"
heading with the caveat only for a hidden-location (coarse) mission.

#### Scenario: An all-precise mission map

- **WHEN** the map view is shown on the Tasks tab and every plotted mission has an exact off-grid
  `approxLocation`
- **THEN** each pin is drawn as a precise marker
- **AND** no "approximate area" caption is shown

#### Scenario: The map includes a hidden-location or legacy mission

- **WHEN** the map plots at least one mission whose published `approxLocation` sits on the ~1 km grid
- **THEN** the "approximate area" caption is shown, describing the coarse pins

#### Scenario: The mission detail view of an ordinary mission

- **WHEN** the detail modal shows an ordinary mission whose `approxLocation` is an exact off-grid point
- **THEN** it uses the "location on the map" heading and shows the exact spot with no approximate caveat

#### Scenario: The mission detail view of a hidden-location mission

- **WHEN** the detail modal shows a mission whose `approxLocation` sits on the ~1 km grid
- **THEN** it uses the "approximate area" heading and shows the coarse area with the caveat note
