## ADDED Requirements

### Requirement: Landing hero explains the brand term on first use
The logged-out landing page SHALL pair the "field game" / "משחק שדה" brand term with a short
plain-language explanation in the hero section, in both Hebrew and English.

#### Scenario: First-time visitor in Hebrew
- **WHEN** a Hebrew-locale visitor lands on the logged-out landing page
- **THEN** the hero section shows the brand term together with a plain-language explanation of
  what a field game is, without requiring the visitor to scroll

#### Scenario: First-time visitor in English
- **WHEN** an English-locale visitor lands on the logged-out landing page
- **THEN** the hero section shows the equivalent English explanation

### Requirement: Dashboard and gallery subtitles carry the same gloss
The dashboard subtitle and gallery subtitle SHALL carry the same plain-language gloss pattern as
the landing hero on their first appearance.

#### Scenario: New creator reaches an empty dashboard
- **WHEN** a creator with zero games views the dashboard
- **THEN** the subtitle explains what a field game is, not only that they can create one

<!-- Non-goal: this capability does not cover a rename of the brand term itself; see design.md Open Questions. -->
