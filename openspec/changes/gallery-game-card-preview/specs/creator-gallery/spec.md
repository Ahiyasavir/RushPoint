## ADDED Requirements

### Requirement: Gallery game cards can be previewed before copying

The creator Gallery SHALL let a creator open a read-only detail of a whole public game before
copying it, matching the preview affordance already available on mission (task-library) cards. The
game card SHALL expose a keyboard- and pointer-accessible control that opens the detail, while
keeping the game's Copy action and Like control independently operable.

The detail SHALL be built from the `PublicGame` the gallery already holds (no fetch on open) and
SHALL render only named public fields — title, description, mode, stage count, task count, estimated
length, play count, coarse location label, and tags. It SHALL NOT render exact coordinates or any
field not explicitly named, so a future `PublicGame` field cannot leak by default.

Copying SHALL NOT be gated by the preview: the Copy action SHALL remain available on the card and
SHALL also be offered inside the detail, invoking the same copy path.

#### Scenario: A game card opens a read-only detail

- **WHEN** a creator activates a game card in the Gallery (click, Enter, or Space)
- **THEN** a read-only detail opens showing the game's title, description, mode, stage count, task
  count, estimated length, play count, coarse location label, and tags
- **AND** no exact coordinates are shown

#### Scenario: Copy stays reachable and ungated

- **WHEN** the game detail is open
- **THEN** a Copy action is available in the detail and still on the card
- **AND** invoking either duplicates the game via the existing copy path

#### Scenario: Like control is not hijacked by the preview affordance

- **WHEN** a creator taps the game card's Like control
- **THEN** the like toggles without opening the detail

#### Scenario: Unknown fields never reach the preview

- **WHEN** the game detail view-model is built from a `PublicGame` that carries an unnamed extra
  field or exact coordinates
- **THEN** the resulting view-model contains neither
