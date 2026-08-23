## ADDED Requirements

### Requirement: The participant map offers a recentre control

The participant map SHALL provide a control that returns the camera to the player's own position.

The control SHALL be a real button, SHALL be present whenever the map is present, and SHALL expose an
accessible name in the player's own language. The name SHALL state what the control does when it is
available, and SHALL state why it is unavailable when it is not.

The control SHALL use the same position the map already draws the player's marker from, so the camera
destination and the marker can never disagree, and SHALL NOT initiate its own location request or
permission prompt.

The map SHALL run exactly one location affordance: no second, unlabelled built-in locate control is
present.

#### Scenario: A player pans away and returns

- **WHEN** the map holds a valid position for the player and the player has moved the camera away
- **THEN** activating the control moves the camera back to that position at the recentre zoom level

#### Scenario: The control is named in the player's language

- **WHEN** the control is rendered in Hebrew and in English
- **THEN** each carries a translated accessible name, and neither carries an untranslated literal

### Requirement: The recentre decision is a pure, total verdict

The decision of whether the control is available, and where the camera should go, SHALL be made by a
single pure function that takes a candidate position and returns a verdict. The function SHALL be
total: for a missing position, a null position, a non-object, a position missing either axis, a
non-numeric axis, a non-finite axis, an out-of-range axis, and the null-island placeholder, it SHALL
return an unavailable verdict rather than throwing.

The verdict SHALL carry the camera centre in the map library's own longitude-latitude order, and
SHALL carry a finite, in-range zoom level in every case, including when it is unavailable.

A caller-supplied zoom SHALL be honoured when it is finite and in range, clamped when it is out of
range, and replaced by the default when it is not a usable number.

The function SHALL NOT read a clock, SHALL NOT use randomness, SHALL NOT perform input or output, and
SHALL NOT mutate its argument. Called twice on the same input it SHALL return equal verdicts.

#### Scenario: A usable fix

- **WHEN** the verdict is computed for a valid latitude and longitude
- **THEN** it is available, its centre is the longitude followed by the latitude, and its zoom is the
  default recentre zoom

#### Scenario: An unusable fix

- **WHEN** the verdict is computed for a missing, null, non-object, partially missing, non-numeric,
  non-finite, out-of-range or null-island position
- **THEN** it is unavailable, it carries no centre, it reports that there is no fix, and its zoom is
  still finite and in range

#### Scenario: Extreme but valid coordinates

- **WHEN** the verdict is computed at the coordinate range boundaries
- **THEN** it is available

#### Scenario: A malformed zoom request

- **WHEN** a caller supplies a zoom that is not a number, is not finite, or is outside the supported
  range
- **THEN** the verdict's zoom is the default or the nearest supported value, and is never the
  malformed input

### Requirement: An unavailable recentre control blocks nothing

When no usable position is available the control SHALL render in a visibly and programmatically
disabled state, SHALL NOT silently do nothing while appearing active, and SHALL NOT prevent any other
interaction on the screen.

Activating the control SHALL be a no operation, rather than an error, when the map is not ready or
the position has become unusable between render and activation.

No task submission, arrival check, navigation action or map interaction SHALL depend on the control's
state.

#### Scenario: Location permission is denied

- **WHEN** the player has denied location access and no position is available
- **THEN** the control is disabled, its accessible name explains that there is no location yet, and
  the map, the mode switch and the task controls all continue to work

#### Scenario: The fix disappears between render and tap

- **WHEN** the control is activated after the position has become unusable
- **THEN** nothing happens and the map camera is left untouched
