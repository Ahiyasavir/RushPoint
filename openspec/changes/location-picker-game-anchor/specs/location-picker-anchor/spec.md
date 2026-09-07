# location-picker-anchor

## ADDED Requirements

### Requirement: An unplaced mission opens on the game's own neighbourhood

The Builder's map picker SHALL derive its initial view from the coordinates the surrounding game
already holds whenever the mission being edited has none of its own. Only a game in which nothing
is placed anywhere MAY fall back to the platform-wide default view.

#### Scenario: Second mission in a placed game
- **WHEN** the picker opens for a mission with no coordinates, in a game whose other missions are
  pinned within one neighbourhood
- **THEN** the initial view is centred on those pins
- **AND** the view spans roughly 100 m around them, not the whole country

#### Scenario: First mission of a brand-new game
- **WHEN** the picker opens for a mission with no coordinates, in a game where no mission anywhere
  has coordinates
- **THEN** the initial view is the platform default (central Israel, zoom 8)

#### Scenario: A mission that already has a pin
- **WHEN** the picker opens for a mission that has valid coordinates
- **THEN** the initial view is centred on that mission's own pin, regardless of what the rest of
  the game holds

### Requirement: A spread-out game shows its whole spread

The anchor view SHALL contain every placed mission of the game. Clamping to the ~100 m
neighbourhood scale applies only when the placed missions are closer together than that.

#### Scenario: Missions a kilometre apart
- **WHEN** the game's placed missions span about a kilometre
- **THEN** the initial view contains all of them, zoomed out further than the 100 m clamp

#### Scenario: Missions ten metres apart
- **WHEN** the game's placed missions are within a few metres of each other
- **THEN** the view is clamped to the ~100 m neighbourhood scale rather than zooming to rooftop level

### Requirement: The anchor never invents a location

An anchor SHALL be computed only from coordinates that are valid and actually placed. Absent,
malformed, non-finite or sentinel `{0,0}` coordinates SHALL NOT contribute to it, and a set
containing none of them SHALL yield no anchor rather than a wrong one.

#### Scenario: Placeholder and malformed coordinates are ignored
- **WHEN** the game's other missions carry only `{0,0}`, `NaN`, out-of-range or missing coordinates
- **THEN** no anchor is produced and the platform default view is used

#### Scenario: Mixed valid and invalid
- **WHEN** some of the game's missions are validly placed and others carry sentinel or malformed
  coordinates
- **THEN** the anchor is computed from the valid ones alone

### Requirement: The anchor is a starting view, never a constraint

The anchor SHALL affect only the view the map opens on. It SHALL NOT restrict where a location can
be placed, SHALL NOT move an existing pin, and SHALL NOT be written to any stored game or task.

#### Scenario: Placing outside the anchor area
- **WHEN** the creator pans away from the anchored view and clicks a point in another town
- **THEN** that point is accepted and stored exactly as it would be without an anchor

#### Scenario: Nothing is persisted
- **WHEN** the picker opens with an anchor and the creator changes nothing
- **THEN** no field of the game or of any mission is modified
