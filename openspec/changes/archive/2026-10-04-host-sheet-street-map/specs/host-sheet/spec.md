## ADDED Requirements

### Requirement: The host sheet map shows the real streets

When the map is included and at least one mission has a location, the host sheet SHALL show a
street map framed to contain every located mission, north up, with each mission's number drawn at
its spot and the map's credit line. Printing SHALL wait, for a bounded time, until the map has
loaded. If the map cannot load, the numbered markers SHALL still be shown.

#### Scenario: Three stations across a neighbourhood
- **WHEN** a game has three located missions a few hundred metres apart
- **THEN** the sheet shows the streets around them with markers 1, 2 and 3 at their spots

#### Scenario: One station
- **WHEN** only one mission has a location
- **THEN** the map is centred on it at street level

#### Scenario: Offline
- **WHEN** the map tiles cannot be fetched
- **THEN** the numbered markers and the numbered list are still printed
