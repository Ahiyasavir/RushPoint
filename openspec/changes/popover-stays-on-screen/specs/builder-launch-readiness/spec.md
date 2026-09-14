## ADDED Requirements

### Requirement: A popover is drawn inside the viewport it is drawn in

A popover in the creator console SHALL be positioned so that its whole width lies
inside the viewport, with a gutter on each side, regardless of where its anchor sits,
how wide the anchor is, or which text direction the document uses.

Where the popover's preferred width does not fit between the gutters, it SHALL be
narrowed to the width that does fit rather than being drawn wider than the space
available. A popover SHALL NOT rely on a maximum width to keep it on screen, because a
maximum width bounds how wide a box is and not where it sits.

The placement decision SHALL be total: any unusable measurement SHALL still yield a
position that is on screen.

#### Scenario: An anchor with no width does not push the popover off screen

- **WHEN** a popover is anchored to an element of zero width positioned past the middle
  of the viewport
- **THEN** the popover is drawn fully inside the viewport

#### Scenario: A narrow viewport narrows the popover

- **WHEN** the viewport is narrower than the popover's preferred width plus its gutters
- **THEN** the popover is drawn at the width that fits between the gutters

#### Scenario: A popover that already fits is not moved

- **WHEN** the preferred placement is already fully inside the viewport
- **THEN** the placement is unchanged

#### Scenario: A measurement that is not usable still yields something drawable

- **WHEN** any measurement is missing, negative or not a finite number
- **THEN** a placement inside the viewport is produced and no returned value is NaN

### Requirement: The launch readiness list is readable on a phone

The whole readiness list SHALL be readable on a viewport where the launch control
itself opens it, because that list is the only explanation the organizer is given for
why the game will not start.

#### Scenario: The readiness list is fully on screen on a phone

- **WHEN** an organizer on a phone opens the launch readiness list
- **THEN** the list is drawn entirely inside the viewport
- **AND** the first character of each line is visible
