## ADDED Requirements

### Requirement: Welcome screen shows the real game description
The game welcome/entry screens (promo and join hero) SHALL render the real game's description, or a
neutral non-demo empty state when no description is set. They SHALL NOT display demo placeholder copy
for a live game.

#### Scenario: Real description is shown
- **WHEN** a participant opens the welcome screen for a game that has a description
- **THEN** that description is rendered with `dir="auto"`

#### Scenario: Blank description shows a neutral empty state
- **WHEN** a game has no description
- **THEN** a neutral localized empty state is shown (never demo placeholder text)

---

### Requirement: GPS requirement is derived, not free-text
The welcome screen SHALL show a GPS-requirement indicator derived from the game's task trigger modes
via `describeGameRequirements`, rather than relying on free-text claims in the description.

#### Scenario: Located game requires GPS
- **WHEN** a game has at least one `radius` or `exact` task
- **THEN** `describeGameRequirements(game)` returns `'gps'` and the screen shows the "requires GPS"
  indicator

#### Scenario: All-anywhere game is playable anywhere
- **WHEN** every task in a game is `instant` or `locationless`
- **THEN** `describeGameRequirements(game)` returns `'anywhere'` and the screen shows the "playable
  anywhere" indicator

#### Scenario: Helper never emits demo placeholder text
- **WHEN** `describeGameRequirements` is called with any game
- **THEN** it returns only an enum key (`'gps'` or `'anywhere'`), never the demo description string
