## ADDED Requirements

### Requirement: Empty stage canvas shows onboarding guidance
When the currently active stage has zero missions, the Builder's task canvas SHALL display inline guidance copy explaining what to do next, instead of an empty area. The guidance SHALL disappear as soon as the stage has at least one mission.

#### Scenario: Empty stage shows guidance copy
- **WHEN** a creator selects a stage whose `tasks` array is empty
- **THEN** the task canvas area displays guidance copy (e.g. suggesting adding a few missions to the stage) near the existing "Add mission" / "From library" tiles

#### Scenario: Guidance disappears once a mission exists
- **WHEN** a creator adds the stage's first mission (via either the "Add mission" tile or the library)
- **THEN** the empty-state guidance copy is no longer rendered, and the canvas shows the normal mission-card grid

#### Scenario: A stage with existing missions never shows the empty-state guidance
- **WHEN** a creator selects a stage that already has one or more missions
- **THEN** the empty-state guidance copy is not rendered, regardless of how few missions the stage has

#### Scenario: Guidance copy is sourced from i18n, not hardcoded
- **WHEN** the empty-state guidance renders in either language
- **THEN** its text comes from a `t.*` translation key with EN and HE entries, matching the app's existing i18n conventions
