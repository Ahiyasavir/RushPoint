## ADDED Requirements

### Requirement: Every console panel is reachable in exactly one place

The Run Console SHALL place every panel in its catalogue either in the pinned zone or in exactly one
named section. No panel SHALL be placed in more than one section, and no panel SHALL be placed in
none.

A panel identifier the layout has no ranking for SHALL still be placed, at a defined position, rather
than being omitted. Placement SHALL NOT be able to remove a panel that the visibility plan decided to
show: the panels rendered across the pinned zone and all sections SHALL be exactly the panels the
plan marked visible, each appearing once.

#### Scenario: A panel added without being ranked

- **WHEN** the console is asked to lay out a panel identifier that is absent from the priority order
- **THEN** the panel is placed exactly once, at the end of the ordering, and nothing throws

#### Scenario: Coverage of the visible panels

- **WHEN** the console lays out any run state, at any run status
- **THEN** the pinned zone and the sections together contain each visible panel exactly once

### Requirement: One section is shown at a time, chosen from a persistent navigator

The Run Console SHALL present its non-pinned panels as named sections reachable from a persistent
section navigator, and SHALL render exactly one section at a time. It SHALL NOT require the organizer
to expand a section in place in order to see its contents.

A section with no visible panels SHALL NOT appear in the navigator. Sections SHALL appear in a stable
documented order.

The selected section SHALL default to the one an organizer needs while an incident is in progress:
the teams and their standings. A stored selection SHALL be honoured when it is still available, and a
stale, unknown or malformed stored selection SHALL fall back to a section that exists rather than
leaving the console showing nothing.

When an action produces something that lives in another section, the console SHALL navigate to that
section rather than requiring the organizer to find it.

#### Scenario: Opening the console

- **WHEN** an organizer opens a live run with no stored preference
- **THEN** the teams and standings section is shown

#### Scenario: A stored selection that no longer exists

- **WHEN** the stored section is one the current run state does not render
- **THEN** a section that does exist is shown instead, and the console is never blank

#### Scenario: Minting a staff PIN

- **WHEN** the organizer invites a staff member and a PIN is created
- **THEN** the console navigates to the section holding the PIN and the staff link

### Requirement: Incident controls stay on screen regardless of the selected section

The Run Console SHALL keep the incident and first-minutes controls outside the section navigator and
visible at all times: active alerts, the run control bar, the join code and QR, the station QR sheet,
the broadcast composer and the live team map.

Choosing a section SHALL NOT hide any of them.

#### Scenario: Reading a section while an alert arrives

- **WHEN** a team raises an alert while the organizer is looking at any section
- **THEN** the alert surface is on screen without navigating away from that section

### Requirement: The console uses the width of the viewport it is given

On a viewport wide enough to carry them, the Run Console SHALL distribute its panels over multiple
lanes rather than a single column, and SHALL NOT reserve width for a lane whose panels are not
currently visible.

Distribution SHALL be deterministic and stable: the same panels and the same lane count SHALL always
produce the same arrangement. Higher-priority panels SHALL be placed before lower-priority ones, and
the highest-priority panel SHALL lead the first lane.

A panel that reads badly in a narrow lane SHALL be allowed to occupy a wider lane.

#### Scenario: A run that has just launched

- **WHEN** no team has joined and there is no alert and no live map
- **THEN** the remaining panels are spread across the available lanes instead of leaving most of the
  width empty, and the join code leads

#### Scenario: The same state laid out twice

- **WHEN** the same panels are laid out twice at the same lane count
- **THEN** the resulting arrangement is identical

### Requirement: The phone layout is a single column in the plan's own order

On a phone-class viewport the Run Console SHALL render one lane containing exactly the panels the
visibility plan produced, in the plan's order, and SHALL NOT reorder or re-rank them.

The section navigator SHALL remain usable on a phone without becoming a side panel: it SHALL degrade
to a compact, horizontally scrollable strip consistent with the pattern the game builder already
uses.

When the viewport cannot be measured, the console SHALL behave as a phone.

#### Scenario: A phone-class viewport

- **WHEN** the console is rendered below the wide-layout breakpoint
- **THEN** the panels render in one column in the plan's order and the navigator renders as a strip

#### Scenario: No measurable viewport

- **WHEN** no viewport measurement is available
- **THEN** the single-column phone layout is used

### Requirement: The layout decision is pure and separate from rendering

The rule deciding section membership, section ordering, panel priority and lane placement SHALL live
in one pure module with no rendering, network or storage dependency, and SHALL be unit tested.

The rendering layer SHALL NOT contain an independent placement decision, and SHALL NOT construct
style class names by string interpolation.

#### Scenario: Changing where a panel sits

- **WHEN** a panel needs to move to a different section or a different rank
- **THEN** the change is made in the pure module and is covered by its unit tests
