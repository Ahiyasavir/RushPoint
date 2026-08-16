## ADDED Requirements

### Requirement: Stage warning banners open the settings drawer that owns their cause
Each of the three stage-level warning banners (exclusive-group unwinnable, unlock-graph risk, partial-stage starvation) SHALL be clickable. Clicking a banner SHALL open the stage settings drawer for the currently active stage, using the same state transition the "⚙ Stage settings" gear pill already uses. The banners SHALL remain unconditionally visible regardless of whether the settings drawer is open, unchanged from current behavior.

#### Scenario: Clicking the exclusive-group-unwinnable warning opens stage settings
- **WHEN** a creator clicks the exclusive-group-unwinnable warning banner
- **THEN** the stage settings drawer opens for the active stage, and any open task editor closes, matching the existing gear-pill click behavior

#### Scenario: Clicking the unlock-graph-risk warning opens stage settings
- **WHEN** a creator clicks the unlock-graph-risk warning banner
- **THEN** the stage settings drawer opens for the active stage

#### Scenario: Clicking the partial-stage-starvation warning opens stage settings
- **WHEN** a creator clicks the partial-stage-starvation warning banner
- **THEN** the stage settings drawer opens for the active stage

#### Scenario: Warnings stay visible whether or not the drawer is open
- **WHEN** any of the three warning conditions is true for the active stage
- **THEN** its banner renders regardless of the stage settings drawer's open/closed state, unchanged from the existing "always visible" invariant

#### Scenario: A warning banner is visually distinguishable as clickable
- **WHEN** any of the three warning banners renders
- **THEN** it is rendered as an interactive control (e.g. a button) with a visible affordance (such as an underline or hover state) distinguishing it from static text, while preserving its existing warning styling
