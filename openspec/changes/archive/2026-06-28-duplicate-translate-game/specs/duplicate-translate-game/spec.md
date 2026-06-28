# Duplicate & Translate Game

## ADDED Requirements

### Requirement: A game can be duplicated and machine-translated server-side
A `translateGame` callable SHALL duplicate a game and translate its user-facing strings into a target
language, producing a new editable game. Translation MUST run server-side with the API key kept in
`functions/.env` (never in a client bundle).

#### Scenario: Translate produces a new game in the target language
- **WHEN** the owner calls `translateGame(gameId, 'en')` on a Hebrew game
- **THEN** a new game is created with titles, descriptions, questions, hints, and flavor text in English

#### Scenario: Non-text fields are preserved verbatim
- **WHEN** a game is translated
- **THEN** coordinates, task types, numeric answers, and scoring are copied unchanged

### Requirement: Translatable-field collection and re-injection are pure and deterministic
`collectTranslatableFields` SHALL enumerate exactly the user-facing strings (not coordinates, types,
or scoring) with stable paths, and `applyTranslations` SHALL re-inject translated strings
deterministically.

#### Scenario: Collection targets only user-facing text
- **WHEN** `collectTranslatableFields` runs on a game
- **THEN** it returns title/description/question/hint/flavor strings and excludes coordinates and types

#### Scenario: Identity translation round-trips
- **WHEN** `applyTranslations` is applied with a map that returns each text unchanged
- **THEN** the result equals the original game

### Requirement: Free-text answers keep the original as an accepted alias
For free-text answers, translation SHALL preserve the original answer as an accepted alias alongside
the translated answer, so submissions in either language are accepted.

#### Scenario: Original answer still accepted after translation
- **WHEN** a free-text task is translated
- **THEN** both the original and translated answers are present in the accepted answer set
