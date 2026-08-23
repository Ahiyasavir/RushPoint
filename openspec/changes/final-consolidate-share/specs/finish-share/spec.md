## ADDED Requirements

### Requirement: FinalScreen share affordances are consolidated into one place

The participant FinalScreen SHALL present its share affordances as a single cluster on the recap
card, rather than scattering them across the recap card and the podium card. The primary control
SHALL share the story card; the additional share outputs (photo card, podium card) SHALL be offered
together in one "more ways to share" row directly beneath the primary control.

Every share output that exists today SHALL remain reachable: story card, photo card, and podium card.
A secondary trigger SHALL appear only when its output applies — the photo trigger only when a
shareable photo exists, the podium trigger only when a podium is present — and when neither applies,
only the primary share control SHALL show.

Consolidation SHALL be presentation-only: the share callbacks, their busy/confirmation state, and the
generated share cards SHALL be unchanged; only the placement of the triggers moves.

#### Scenario: All share paths are grouped on the recap card

- **WHEN** a player reaches the FinalScreen on a finish that has both a shareable photo and a podium
- **THEN** the recap card shows the primary story-card share control and a single row beneath it
  offering the photo and podium share
- **AND** the podium card no longer carries its own separate share button

#### Scenario: Secondary shares appear only when applicable

- **WHEN** a finish has no shareable photo and no podium
- **THEN** only the primary story-card share control is shown, with no "more ways to share" row

#### Scenario: Every share output stays reachable

- **WHEN** the consolidated share cluster is shown
- **THEN** the story-card, photo-card, and podium-card share paths are all still invocable and produce
  their respective cards
