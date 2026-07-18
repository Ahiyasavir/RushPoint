# territory-map-visibility Specification (delta)

## ADDED Requirements

### Requirement: Capturable zones render on the participant map
The participant `NavMap` SHALL draw every capturable zone in the run as a metres-accurate circle
(a geographic fill plus outline sized by the zone's `radiusMeters`, not a fixed-pixel marker), so a
player can see where to physically stand to capture or flip a zone. The zone overlay MUST survive a
tile-style (map mode) toggle, re-applying after the style reloads, exactly like the hot-zone overlay.

#### Scenario: A run's zones appear as circles on the map
- **WHEN** a participant views the run map and the run has one or more capturable zones with valid
  coordinates
- **THEN** each zone is drawn as a circle centered on its `center` and sized to its `radiusMeters`,
  with a label carrying the zone title

#### Scenario: Zone circles persist across a map-mode switch
- **WHEN** the participant toggles the map tile style (e.g. topo to satellite)
- **THEN** the zone circles are re-drawn after the style reloads and remain visible

### Requirement: Zone circles are colored by their current holder
Each zone circle's color SHALL reflect ownership so a player can tell at a glance which zones are
theirs, a rival's, or open: a zone held by the viewing team is shown in the "mine" color, a zone held
by another team in the "rival" color, and an unowned zone in the neutral "open" color. When ownership
changes, the circle's color MUST update on the next zone refresh.

#### Scenario: A flipped zone recolors for both teams
- **WHEN** a zone the viewing team holds is captured by a rival team and the participant's zones
  refresh
- **THEN** that zone's circle is no longer shown in the "mine" color but in the "rival" color

#### Scenario: An open zone is visually distinct from an owned one
- **WHEN** the run contains one unowned zone and one zone held by the viewing team
- **THEN** the two circles render in different colors (neutral "open" vs. "mine")

### Requirement: The map is shown when a run has zones
The participant map SHALL be presented whenever the run has at least one capturable zone, even if the
active stage has no located task pin, so a zone-only stop still gives the player something to navigate
by rather than an empty placeholder.

#### Scenario: A stop with zones but no task pin still shows a map
- **WHEN** the active stage exposes no located task target but the run has one or more zones
- **THEN** the map renders and frames the zone(s) (it does not fall back to the empty placeholder)
