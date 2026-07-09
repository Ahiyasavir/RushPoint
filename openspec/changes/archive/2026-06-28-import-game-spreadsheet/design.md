# Design — Import game from a spreadsheet

## Current behavior

- New-game flow seeds a template via `updateGame`. Builder edits `users/{uid}/games/{gameId}`.
- `packages/shared/src/validation.ts` has task field validators (the `auth-anticheat-hardening`
  change wires them into callables; here they validate import rows).

## Approach

### Pure mapper → `packages/shared/src`

```ts
parseGameRows(rows: Record<string,string>[]): { game: GameDraft; errors: RowError[] }
  // rows = parsed CSV/XLSX rows. Groups by `stage`, maps each row to a Task by `type`,
  // validates required fields per type (quiz needs answer, numeric needs numericAnswer,
  // geofence needs lat/lng/radius), collects RowError{row, field, message} for bad cells.
```

Tested in `scripts/test-import-sheet.ts` (no DOM): valid rows → correct stage/task structure;
unknown type → error; quiz without answer → error; bad coordinates → error; empty sheet → empty game.

### Builder UI

- "Import from spreadsheet" → download template (a static CSV with header + example rows).
- Drag-drop → `lib/importSheet.ts` reads the file (CSV via a small parser; `.xlsx` via the `xlsx`
  reader, lazy-loaded) into rows → `parseGameRows` → show a preview table + the error report.
- "Create game" (enabled only when 0 blocking errors) → `createGame` + `updateGame(game)`.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-import-sheet.ts`: `parseGameRows` mapping + validation cases.
- **UI (preview):** drop a sample CSV → preview + errors render; fix → create → lands in the Builder.

## Conventions

- Client-side parsing only; persistence via existing callables (no new backend, server-write rules intact).
- Reuses `validation.ts` validators — single source of truth for task validity.
- `xlsx` reader lazy-loaded (bundle rule 18).
