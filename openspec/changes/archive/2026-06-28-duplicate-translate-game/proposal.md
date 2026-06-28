# Proposal — Duplicate & translate a game

## Why

creator-web is Hebrew-first, but the inbound-tourism and mixed-audience market needs English (and
other languages). An organizer with a polished Hebrew game should be able to produce an English
version in one tap rather than re-authoring everything. "Duplicate + translate" opens a whole new
audience for content the creator already built.

## What Changes

> Observable behavior. A new server-side translation callable; reuses duplicate + update.

- The Builder/Dashboard gains a **"Duplicate & translate"** action: pick a target language → the game
  is duplicated and its user-facing strings (titles, descriptions, questions, hints, flavor text) are
  **machine-translated server-side**, producing a new editable game in that language.
- **Answer keys are translated carefully**: for free-text answers the original is preserved as an
  accepted alias alongside the translation (so both work); coordinates, types, and scoring are copied
  verbatim.
- Translation runs in a **Cloud Function** (the API key stays server-side); the result is a normal
  game the creator can review and adjust before launching.

## Capabilities

### New Capabilities
- `duplicate-translate-game`: a one-tap duplicate + server-side machine translation of a game's
  user-facing content into a target language, producing a new editable game.

### Modified Capabilities
<!-- None — builds on the existing duplicateGame; adds a translate step. -->

## Surfaces touched

- **Callable:** new `translateGame(gameId, targetLang)` in `functions/src/games/index.ts` —
  duplicates the game, translates user-facing fields via a server-side translation API, writes the
  new game. The translation API key lives in `functions/.env` (server-only).
- **shared:** `collectTranslatableFields(game)` + `applyTranslations(game, map)` pure helpers
  (which fields are translatable; deterministic re-injection) — the TDD lever.
- **creator-web:** Dashboard/Builder "Duplicate & translate" action + language picker.
- **Tests:** `scripts/test-translate-fields.ts` (field collection + re-injection); e2e (mocked API).

## Non-goals

- No live UI-chrome i18n change (creator chrome already supports EN/HE; this translates *content*).
- No automatic translation quality guarantee — the creator reviews before launch.
- This is **content translation**, distinct from the excluded **AI task-generation** feature (#8).
