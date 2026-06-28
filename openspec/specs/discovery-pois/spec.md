# discovery-pois Specification

## Purpose
TBD - created by archiving change surprise-trivia-waypoints. Update Purpose after archive.
## Requirements
### Requirement: Creator can place hidden geofenced POIs on a game
A creator SHALL be able to add `DiscoveryPoi` documents to a `discoveryPois` subcollection under a
game, each with a location, radius, trivia question, correct answers, bonus points, and optional
flavor text. POIs MUST NOT appear on the participant's route map or task list.

#### Scenario: Creator adds a POI in the Builder
- **WHEN** the creator places a POI on the Builder map and saves it
- **THEN** the POI is persisted under `games/{ownerUid}/{gameId}/discoveryPois/{poiId}`
- **AND** it does NOT appear on the participant's route map or task list

#### Scenario: POI coordinates are server-secret
- **WHEN** a play client calls `getRunDiscoveryPois`
- **THEN** the response contains `DiscoveryPoiResult[]` with no `coordinates` and no `answers` fields

### Requirement: Participants are surprised when entering a POI radius
The play app SHALL run a background geofence watcher against the loaded `DiscoveryPoiResult[]` and
MUST show a surprise overlay when the team enters a POI radius for the first time. The overlay MUST
NOT appear again for the same POI (one trigger per team per POI).

#### Scenario: Discovery overlay appears on first proximity
- **WHEN** a team's GPS coordinates enter a POI's radius for the first time
- **THEN** a discovery overlay appears with the flavor text and trivia question

#### Scenario: Already-triggered POI is silently skipped
- **WHEN** a team re-enters a POI radius they have already answered
- **THEN** no overlay appears and no callable is invoked

### Requirement: claimDiscoveryPoi validates proximity and awards bonus server-side
`claimDiscoveryPoi` SHALL re-validate that the team's submitted coordinates are within the POI
radius before crediting bonus points. It MUST be idempotent — a second call for the same
`(teamId, poiId)` MUST return `already-exists` without double-crediting. Wrong answers receive
`{ correct: false, bonusPoints: 0 }` without error.

#### Scenario: Correct answer within radius awards bonus
- **WHEN** `claimDiscoveryPoi` is called with coordinates inside the radius and a correct answer
- **THEN** the response is `{ correct: true, bonusPoints: N }`
- **AND** the team's `earnedScore` is incremented by N

#### Scenario: Coordinates outside radius are rejected
- **WHEN** `claimDiscoveryPoi` is called with coordinates outside the POI radius
- **THEN** the call fails with `failed-precondition`
- **AND** the team's score is unchanged

#### Scenario: Double-claim is idempotent
- **WHEN** `claimDiscoveryPoi` is called a second time for the same team and POI
- **THEN** the call returns `already-exists` and the score is not incremented again

#### Scenario: Wrong answer grants no points
- **WHEN** `claimDiscoveryPoi` is called with a wrong answer (but valid coords)
- **THEN** the response is `{ correct: false, bonusPoints: 0 }` with no error

### Requirement: POI proximity math is a pure, unit-tested function
`isWithinPoiRadius(teamCoords, poi)` SHALL be a pure function using `haversineKm` and MUST be
tested with boundary cases. `matchesDiscoveryAnswer(input, answers)` SHALL normalise case,
whitespace, and diacritics before comparison.

#### Scenario: Boundary — exactly on the edge is inside
- **WHEN** `isWithinPoiRadius` is called with coords at exactly `radiusMeters` distance
- **THEN** it returns `true`

#### Scenario: Answer matching is case/whitespace-insensitive
- **WHEN** the correct answer is "King David" and the input is "  king david  "
- **THEN** `matchesDiscoveryAnswer` returns `true`

### Requirement: Firestore rules deny play clients direct access to POI documents
The `discoveryPois` subcollection MUST deny all `get` and `list` operations for play clients. Only
the creator (owner) and the Admin SDK (Cloud Functions) may read POI coordinates.

#### Scenario: Play client is denied direct POI access
- **WHEN** a play client attempts to `get` or `list` the `discoveryPois` subcollection
- **THEN** the Firestore rules deny the operation

#### Scenario: Creator has full POI access
- **WHEN** the run owner reads or writes the `discoveryPois` subcollection
- **THEN** the operation is allowed

### Requirement: Builder suggests nearby POIs from OpenStreetMap
During route setup, a "Suggest POIs" action SHALL query the Overpass API for historic, cultural, and
heritage landmarks near the game's tasks and present them as add-cards. `buildOverpassQuery` MUST
produce a valid Overpass QL string for the route's bounding box and MUST NOT include user-controlled
content that could alter the query structure.

#### Scenario: Suggestions are returned for landmarks near the route
- **WHEN** the creator taps "Suggest POIs" with a non-empty route
- **THEN** up to 10 nearby OSM landmarks are shown as add-cards with name and category

#### Scenario: Overpass query is injection-safe
- **WHEN** `buildOverpassQuery` is called with any bounding box
- **THEN** the result is a string that contains only the expected Overpass QL structure and OSM tags

