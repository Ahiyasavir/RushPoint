## ADDED Requirements

### Requirement: Pause-clock control is visually marked as advanced
The pause-clock (`pausesTimer`) control on wizard step 3 SHALL carry a small, explicit "advanced" visual marker directly on the control itself, in addition to its existing position below the "Advanced timing" divider, so its advanced status does not depend solely on scroll position within the group.

#### Scenario: Pause-clock control shows an advanced marker
- **WHEN** a creator has the `timerPoints` group open on wizard step 3
- **THEN** the pause-clock control's label includes a small advanced-tag marker distinct from the surrounding "Advanced timing" section divider text

#### Scenario: The marker does not change the control's behavior
- **WHEN** a creator toggles the pause-clock checkbox
- **THEN** `task.pausesTimer` is set/cleared exactly as before this change, with no change to validation, scoring, or persistence

#### Scenario: Marker text is sourced from i18n, not hardcoded
- **WHEN** the advanced marker renders in either language
- **THEN** its text comes from a `t.*` translation key with EN and HE entries, matching the app's existing i18n conventions
