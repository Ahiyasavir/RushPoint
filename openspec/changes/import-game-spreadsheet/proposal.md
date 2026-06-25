# Proposal — Import game from a spreadsheet

## Why

Many organizers already have their event script in a Google Sheet or Excel file — stops, questions,
answers, points. Forcing them to retype it all into the Builder is the single biggest adoption
barrier for the "I already planned my event" crowd. A drag-and-drop **spreadsheet import** that turns
a structured sheet into a game in one step removes that barrier entirely.

## What Changes

> Observable behavior. A client-side import flow in the Builder; reuses `createGame`/`updateGame`.

- The Builder gains an **"Import from spreadsheet"** option: the creator downloads a **template
  CSV/XLSX**, fills it (one row per task: stage, title, type, question, answer, points, lat, lng,
  radius…), and drags it back in.
- The file is **parsed client-side** into the game model; a **preview + validation report** shows
  what will be created and flags any bad rows (unknown type, missing answer for a quiz, invalid
  coordinates) before anything is saved.
- On confirm, the parsed game is persisted via the existing `createGame` + `updateGame` — no new
  backend.

## Capabilities

### New Capabilities
- `import-game-spreadsheet`: a client-side CSV/XLSX → game-model importer with a validation report,
  driven from the Builder and persisted through existing callables.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **creator-web:** Builder "Import" panel + a downloadable template; `lib/importSheet.ts` with the
  pure parser/validator. Uses a CSV parser (and `xlsx` reader for `.xlsx`) client-side only.
- **shared:** `parseGameRows(rows): { game, errors }` pure mapper (rows → stages/tasks + per-row
  validation), reusing the existing `validation.ts` task validators.
- **Tests:** `scripts/test-import-sheet.ts` (row mapping + validation report).
- **No callable change.**

## Non-goals

- No live Google Sheets API sync (one-time file import only).
- No image/photo import via the sheet (text/coordinate fields only).
- No overwrite of an existing game (import always creates a new game).
