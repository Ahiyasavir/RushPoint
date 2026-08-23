## MODIFIED Requirements

### Requirement: The creator can export and import from the Builder

The creator console SHALL offer, from the Builder for a game, an action that downloads the game's
export document as a file, and an action that creates a new game from a chosen file. Both actions'
labels, confirmations and error messages SHALL be available in both Hebrew and English through the
translation dictionaries.

Both actions SHALL be presented through a single **clearly-labelled** file affordance whose meaning is
carried by a **visible text label**, not by a glyph alone. The affordance's trigger SHALL provide an
accessible name in both Hebrew and English and SHALL meet a minimum tap target of 44 pixels. Each of
the two actions inside the affordance SHALL carry its own accessible name.

#### Scenario: Exporting from the Builder downloads a file

- **WHEN** the creator triggers the export action in the Builder
- **THEN** a file is downloaded whose name identifies the game

#### Scenario: The file affordance is legible without hovering

- **WHEN** the Builder header renders
- **THEN** the file affordance shows a visible text label rather than a bare icon
- **AND** its two actions, export a copy and create a game from a file, are each reachable with an
  accessible name in the console's current language

#### Scenario: Importing from the Builder still uses the file picker

- **WHEN** the creator triggers the import action in the Builder
- **THEN** the operating system file picker opens
- **AND** choosing a valid file creates a new game, exactly as before the affordance was relabelled

#### Scenario: A rejected import explains why

- **WHEN** the creator chooses a file the server refuses
- **THEN** the refusal reason is shown to the creator in the console's current language
- **AND** the Builder's current game is left untouched
