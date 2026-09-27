## ADDED Requirements

### Requirement: The console's sections are always in view
The Run Console SHALL present its sections as primary navigation that is visible without
scrolling: under the run header on wide screens and as a fixed bottom bar on phones. Every section
SHALL be visible at once on a 375 px wide screen. Each section SHALL show its current badge on
every screen size.

#### Scenario: Phone, top of the page
- **GIVEN** the Run Console of a live run on a 375×812 screen
- **WHEN** the page loads, before any scrolling
- **THEN** all five section tabs are fully visible

#### Scenario: Desktop, top of the page
- **GIVEN** the Run Console of a live run on a 1400×860 screen
- **WHEN** the page loads, before any scrolling
- **THEN** the section tabs start within the top 200 pixels

### Requirement: Only urgent panels are pinned above the sections
The Run Console SHALL pin above the section content only an active-alerts strip while an alert is
unacknowledged and the start-teams control while a team has not been started. Every other panel
SHALL live in a section.

#### Scenario: A quiet live run
- **GIVEN** a live run with every team started and no unacknowledged alert
- **THEN** no panel is pinned above the active section

### Requirement: A section with something new says so
The Run Console SHALL mark a section whose items increased since the organizer last viewed it.

#### Scenario: A new photo arrives
- **GIVEN** the organizer is viewing the teams section
- **WHEN** a new photo submission arrives
- **THEN** the field section's tab shows that something new is waiting
