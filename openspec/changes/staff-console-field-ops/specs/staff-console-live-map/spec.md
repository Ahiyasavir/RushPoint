## ADDED Requirements

### Requirement: Staff can see all teams' live locations on the phone
The mobile staff console SHALL offer a map showing every active team's last-known location, not
only a single team's location from an SOS alert.

#### Scenario: Opening the map shows every team with a known location
- **WHEN** a staffer expands the live-map section
- **THEN** a pin is shown for every team that has a recent `teamLocations` entry, labeled with the
  team's display name

#### Scenario: A team with no location yet is simply absent from the map
- **WHEN** a team has no `teamLocations` entry
- **THEN** the map shows no pin for that team and nothing errors

#### Scenario: Tapping a pin offers directions
- **WHEN** a staffer taps a team's pin
- **THEN** the console offers a way to open turn-by-turn directions to that team's last-known
  location, consistent with the existing SOS-alert directions link

### Requirement: The live map does not load until opened
The map's underlying mapping library SHALL NOT be part of the console's initial page load.

#### Scenario: The map section is collapsed by default
- **WHEN** the staff console first loads
- **THEN** the map section starts collapsed and its mapping library code has not been fetched

#### Scenario: Expanding the section loads the map on demand
- **WHEN** a staffer expands the map section for the first time
- **THEN** the mapping library loads at that point, and the play-web production bundle's
  first-load byte budget is unaffected by the map's code
