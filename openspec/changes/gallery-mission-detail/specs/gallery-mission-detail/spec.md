## ADDED Requirements

### Requirement: Pressing a gallery mission opens a full detail view
A creator browsing public missions SHALL be able to press any mission and see, in one view,
everything the sanitized public payload carries about it: its title, its full description, its
interaction type in plain language, its difficulty, its estimated minutes, its point value, its
tags, the game it came from, its author, when it was published, how many creators copied it, and how
many liked it.

The detail view SHALL be reachable from both public mission surfaces: the Gallery's mission library
tab and the Builder's mission picker.

The detail view SHALL offer the "use this mission" action wherever a target game exists, and SHALL
say where the mission can be added wherever one does not, rather than offering an action that cannot
complete.

#### Scenario: A creator inspects a mission before copying it
- **WHEN** a creator presses a mission in the Builder's mission library
- **THEN** the mission's full description and every published attribute are shown
- **AND** the mission is NOT inserted into the game until the creator takes the use action

#### Scenario: A mission with no description says so
- **WHEN** the detail is built for a mission whose description is absent or blank
- **THEN** the description is reported as absent
- **AND** the view states that the author wrote none, rather than rendering an empty gap

#### Scenario: Liking a mission does not open its detail
- **WHEN** a creator presses the like control on a mission card
- **THEN** the like is applied and the detail view does not open

### Requirement: The detail view never exposes a server-secret field
The detail view model SHALL be constructed by copying named public fields out of the source
document, and SHALL NOT be constructed by removing known-secret fields from it. A field that is not
named in the public allow-list SHALL NOT appear in the detail, whatever the source document carries.

The produced detail SHALL contain no answer key, no numeric answer, no sequence step answer, no hint
text, no station secret code, and no exact authored coordinate, under any input.

#### Scenario: A polluted source document leaks nothing
- **WHEN** the detail is built from a mission document that carries answers, a numeric answer,
  sequence step answers, hint text, a station secret code and exact coordinates
- **THEN** none of those values appear anywhere in the produced detail
- **AND** none of those field names appear anywhere in the produced detail

#### Scenario: A future public field does not leak by default
- **WHEN** the detail is built from a mission document carrying a field the allow-list does not name
- **THEN** that field is absent from the produced detail

### Requirement: Only the coarse published area is shown, never an exact point
The detail view SHALL derive a mission's location solely from the coarse published area, using the
same predicate that decides whether a mission may be plotted on the mission library map. The detail
SHALL NOT fall back to the deprecated exact coordinate field for any reason.

A mission with no usable published area SHALL be reported as having none, and the view SHALL explain
that rather than presenting an empty map.

#### Scenario: An exact coordinate is never promoted to the area
- **WHEN** the detail is built for a mission that carries an exact coordinate but no published area
- **THEN** the detail reports no area
- **AND** the exact coordinate does not appear in the detail

#### Scenario: The detail and the map agree on what is locatable
- **WHEN** the detail is built for missions whose area is absent, malformed, out of range, or valid
- **THEN** the detail reports an area exactly for those the library map would plot

#### Scenario: A hidden location mission is explained, not blanked
- **WHEN** the detail is built for a mission with no published area
- **THEN** the area state is reported as absent so the view can explain why

### Requirement: The detail is total and never renders a malformed value
Building a detail SHALL never throw, for any input, including a null, a non-object, an array, a
number and a string. Every numeric attribute SHALL be normalized before it can reach the view:
difficulty within 1 to 10, points and copy counts never negative, and a non-finite value SHALL
suppress its row rather than render.

A publish date SHALL be normalized to a fixed calendar-date form by the view model, and an
unparseable date SHALL suppress its row.

#### Scenario: Garbage input yields a well formed detail
- **WHEN** the detail is built from null, from a number, from a string and from an empty object
- **THEN** no call throws
- **AND** each result carries a title, a type key and a row list

#### Scenario: A non-finite attribute suppresses its own row
- **WHEN** a mission carries a difficulty, a point value or an estimated duration that is not a
  finite number
- **THEN** that attribute contributes no row to the detail
- **AND** no row value is reported as `NaN`

#### Scenario: An out of range difficulty is clamped
- **WHEN** a mission declares a difficulty of zero or of ninety nine
- **THEN** the reported difficulty is within 1 and 10

#### Scenario: A zero like count is not a row
- **WHEN** a mission has never been liked
- **THEN** the detail carries no likes row

#### Scenario: An unparseable publish date suppresses its row
- **WHEN** a mission's creation timestamp is absent or is not a date
- **THEN** the detail carries no published row

### Requirement: Every detail string is switchable between Hebrew and English
Every user-facing string introduced by the detail view SHALL come from the creator console
translation maps in both Hebrew and English, and SHALL NOT be hardcoded in a component.

#### Scenario: The detail view adds no hardcoded string
- **WHEN** the creator console i18n check runs in strict mode
- **THEN** it reports no new hardcoded string in the detail view
- **AND** every new key is defined in both the Hebrew and the English map
