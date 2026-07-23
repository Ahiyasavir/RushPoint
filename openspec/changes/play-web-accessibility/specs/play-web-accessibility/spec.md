## ADDED Requirements

### Requirement: Participant text meets WCAG AA contrast

Every glyph the participant app renders SHALL reach a contrast ratio of at least 4.5:1 against the
surface it is drawn on, computed with the WCAG 2.1 relative-luminance formula, so that it stays
readable in direct sunlight.

Brand colours that fail that threshold as text SHALL NOT be used as a text colour. The participant
theme SHALL therefore define a dedicated set of text ("ink") colours, distinct from the fill,
border, ring and gradient colours, so that darkening text does not repaint the app's surfaces.

Placeholder text SHALL meet the same threshold as body text, because it is frequently the only
instruction a field carries.

#### Scenario: A brand colour used as text

- **WHEN** a participant-facing element renders text in a brand colour
- **THEN** the colour used is the ink variant, whose ratio against the app's white, page and raised
  surfaces is at least 4.5:1

#### Scenario: A brand colour used as a fill

- **WHEN** a participant-facing element uses a brand colour as a background, border, ring or
  gradient stop
- **THEN** the original brand colour is unchanged

#### Scenario: Text on a brand-coloured fill

- **WHEN** text is drawn on a solid brand-coloured fill
- **THEN** that pairing also reaches at least 4.5:1

#### Scenario: Placeholder legibility

- **WHEN** an input renders its placeholder
- **THEN** the placeholder reaches at least 4.5:1 against the field background

### Requirement: Every entry field has an accessible name

Every input, textarea and select in the participant app SHALL expose a programmatic accessible name.
A placeholder alone SHALL NOT be treated as a name, because it disappears on the first keystroke.

Where a field already renders a visible label, that label SHALL be programmatically associated with
its control so that activating the label also focuses the control. Where a field's only visible copy
is its placeholder, the accessible name SHALL be that same string, so the name and the visible text
agree.

Satisfying this requirement SHALL NOT introduce new user-facing copy.

#### Scenario: A field whose only visible copy is a placeholder

- **WHEN** an answer field renders with a placeholder and no visible label
- **THEN** it also exposes an accessible name equal to that placeholder text

#### Scenario: A field with a visible label

- **WHEN** a registration field renders a visible label above its control
- **THEN** the label is associated with the control, and activating the label focuses it

### Requirement: Interactive controls are reachable one handed

Every control a participant operates during a run SHALL present a touch target of at least 44 CSS
pixels in its constrained axis.

This SHALL include controls that recover a player from a dead end — in particular the escape hatch
offered when satellite positioning fails — and controls that let a player re-read the rules or
change the map view mid-run.

#### Scenario: A recovery control

- **WHEN** the app offers the player a way out of a stuck state
- **THEN** that control is at least 44 CSS pixels tall

#### Scenario: A control in a dense row

- **WHEN** several controls sit side by side in one row
- **THEN** each of them is at least 44 CSS pixels tall

### Requirement: The installed app respects the device safe area

The participant app SHALL keep its fixed chrome and the end of its scrollable page clear of the
device's display cutout and home indicator, using the platform-reported safe-area insets.

Because the app opts into drawing under the cutout, every element pinned to the top of the viewport
SHALL offset itself by the top inset, and the page shell SHALL pad its end by the bottom inset.

On a device that reports no insets the rendering SHALL be unchanged.

#### Scenario: A banner pinned to the top of the viewport

- **WHEN** a status banner, toast or pill is pinned to the top of the viewport
- **THEN** its offset includes the reported top safe-area inset

#### Scenario: The last control on a page

- **WHEN** a page's final action control sits at the end of the scrollable shell
- **THEN** the shell's end padding includes the reported bottom safe-area inset

#### Scenario: A device with no cutout

- **WHEN** the platform reports no safe-area insets
- **THEN** the layout is identical to one with no safe-area handling

### Requirement: The participant app can be zoomed

The participant app SHALL NOT prevent the user from scaling the page. The viewport declaration SHALL
NOT cap the maximum scale or disable user scaling.

#### Scenario: A player magnifies a clue

- **WHEN** a player pinches to zoom on task text
- **THEN** the page scales

### Requirement: Every control is operable from a keyboard

Any element that responds to a click in the participant app SHALL be a natively interactive element,
or SHALL carry an explicit button role, a tab stop and a key handler.

Text entry fields that submit an answer SHALL submit on Enter, so a player is never required to
reach a button that the on-screen keyboard may be covering. Fields expecting a fixed-format code
SHALL request a keyboard that does not autocorrect or auto-capitalise unpredictably.

#### Scenario: A full-surface advance control

- **WHEN** an entire screen acts as a control that advances to the next state
- **THEN** that control is operable from the keyboard

#### Scenario: An answer field with the keyboard open

- **WHEN** a player types an answer or a station code and presses Enter
- **THEN** the answer is submitted without reaching for the submit button

### Requirement: Celebration effects honour reduced motion

Every animation the participant app runs, including canvas-driven celebration effects, SHALL be
suppressed when the user has requested reduced motion.

#### Scenario: A celebration under reduced motion

- **WHEN** the user has requested reduced motion and a celebration screen opens
- **THEN** no animated particle effect is drawn

### Requirement: Direction-sensitive layout uses logical properties

Layout that depends on reading direction SHALL be expressed with logical (start/end) properties
rather than physical (left/right) ones, because Hebrew is the participant app's default language.

A physical value MAY be used only where it is direction-symmetric, such as a centring offset paired
with an equal and opposite translation.

#### Scenario: An overlay control on the map

- **WHEN** a control is positioned against one side of a map or card
- **THEN** it is positioned with a logical start/end offset

#### Scenario: A symmetric centring offset

- **WHEN** an element is centred with a half offset and an equal opposite translation
- **THEN** the physical offset is acceptable because it renders identically in both directions

### Requirement: Accessibility regressions are caught by a static guard

The repository SHALL carry a pure-logic guard, run by the standard unit-test lane and requiring no
emulator, that scans the participant app's source and fails the build on: a physical-direction
layout class, a button whose only content is an icon and which exposes no accessible name, and a
click handler on a non-interactive element.

The guard SHALL additionally recompute the contrast of the theme's ink colours against the app's
surfaces and fail if any drops below the AA threshold.

The guard SHALL also resolve, against the participant theme's own colour tokens, any element that
draws white text on an opaque brand fill, and fail if that pairing falls below the AA threshold. It
SHALL NOT flag a translucent tint or a gradient, whose effective colour is not decidable from the
token name alone, and SHALL skip rather than guess at a colour token it cannot resolve.

The guard's detection logic SHALL be pure functions, unit-tested against synthetic fixtures that
include cases which must NOT be flagged, so that the guard cannot degrade into a source of false
positives.

#### Scenario: A physical-direction class is reintroduced

- **WHEN** a participant-app component adds a physical-direction layout class
- **THEN** the unit-test lane fails and names the file, line and offending class

#### Scenario: An icon-only button loses its name

- **WHEN** a button whose content is only an icon carries no accessible name
- **THEN** the unit-test lane fails and names the file and line

#### Scenario: A theme colour is darkened below AA

- **WHEN** an ink colour is changed to one that falls below 4.5:1 against an app surface
- **THEN** the unit-test lane fails with the computed ratio

#### Scenario: White text is placed on a sub-AA brand fill

- **WHEN** a participant-app control renders white text on an opaque brand-coloured background whose
  contrast with white is below 4.5:1
- **THEN** the unit-test lane fails and names the file, line, resolved colour and computed ratio

#### Scenario: A translucent tint is not mistaken for a fill

- **WHEN** a control uses a translucent brand tint as its background with dark ink text
- **THEN** the guard reports no finding, because the effective colour is not decidable from the class
  token

#### Scenario: Compliant code is not flagged

- **WHEN** the participant app uses logical properties, labelled buttons and native interactive
  elements
- **THEN** the guard reports no findings
