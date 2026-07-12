# game-intro-instructions Specification (delta)

## ADDED Requirements

### Requirement: A game may carry an optional intro/instructions primer
A Game SHALL support an optional `instructions` primer consisting of a title, a bilingual body
(`body` and optional `bodyHe` that falls back to `body`), and an optional image URL. The field MUST
be optional so that existing games and update payloads without it are unaffected and render no
primer surface.

#### Scenario: A game without a primer is unchanged
- **WHEN** a creator saves a game that sets no `instructions`
- **THEN** the game persists with no `instructions` field and no "How to play" surface appears for
  players before start or in-game

#### Scenario: A creator authors a bilingual primer
- **WHEN** a creator saves `instructions` with a title, an English `body`, and a Hebrew `bodyHe`
- **THEN** the primer is persisted on the game and is available to be shown to players

### Requirement: The primer is cleaned and https-guarded on save and on echo
When a primer is persisted or delivered to a participant, every text field MUST be trimmed and the
`imageUrl` SHALL be kept only when it is an `https://` URL; a non-https image MUST be dropped. A
primer that has no content after cleaning MUST clear/omit the field rather than persist an empty
object.

#### Scenario: A non-https image is stripped
- **WHEN** a primer is saved with an `imageUrl` that is not `https://`
- **THEN** the stored and echoed primer contains no `imageUrl` while its text fields are preserved

#### Scenario: An empty primer clears the field
- **WHEN** a creator submits an `instructions` payload whose fields are all empty or whitespace-only
- **THEN** the game's `instructions` field is cleared (absent), not stored as an empty object

### Requirement: Players can view the primer before start and in-game
The participant experience SHALL expose a game's primer to a joined player before the run starts and
from within the live game. `getMyTeamState` MUST echo the cleaned primer in its `game` subset, or
`null` when the game has none, so play-web can render a pre-start card and an in-run "How to play"
control. The primer is cosmetic and MUST NOT gate joining, starting, or progression.

#### Scenario: getMyTeamState echoes the cleaned primer
- **WHEN** a participant polls `getMyTeamState` for a run whose game has a primer with a non-https image
- **THEN** the response's `game.instructions` carries the title and bilingual body and has no
  `imageUrl`

#### Scenario: A primer-less game echoes null
- **WHEN** a participant polls `getMyTeamState` for a run whose game has no primer
- **THEN** the response's `game.instructions` is `null` and no "How to play" surface is shown
