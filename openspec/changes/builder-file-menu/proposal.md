# Proposal — builder-file-menu

## Why

In the Builder shell header (`apps/creator-web/src/pages/BuilderPage.tsx:458-486`) the two
game-file portability actions — Export (`↓`) and Import (`↑`) — are rendered as bare glyph
icon-buttons (`w-7 h-7`), sitting right next to the undo (`↶`) and redo (`↷`) glyphs. Their meaning
is carried **only** by `title` / `aria-label`; on the screen they are two arrows. A creator who has
never opened the file feature cannot tell, at a glance, that one arrow saves a copy of the game to
their computer and the other builds a new game from a file. It reads as a fourth and fifth undo-like
control.

A simplification audit flagged this as "Builder file export/import are bare glyph buttons". The
capability already exists and works; the problem is purely that the affordance is illegible.

## What Changes

**The two glyph buttons are replaced by one clearly-labelled "File" affordance** — a menu with the
visible text label "File" (קובץ) containing two entries, "Save a copy" (export) and "Load a copy"
(import). The menu reuses the shared `OverflowMenu` primitive
(`apps/creator-web/src/components/OverflowMenu.tsx`) already used by the Dashboard game card and the
Run Console team row, so the Builder joins the same one menu pattern rather than inventing a third.

- Both actions are preserved **exactly**. "Save a copy" calls the same `exportToFile()` (which calls
  `exportGameFile`), and "Load a copy" triggers the same hidden `<input type="file">` whose change
  handler runs the same `importFromFile()` (which calls `importGameFile`). No handler, no callable,
  no file-input wiring changes.
- The menu trigger carries a **visible text label**, not a glyph alone, and meets a 44px minimum tap
  target. Each menu entry has an accessible name and its existing hint as a tooltip.

## What does not change

- **No ability is removed.** Export and import stay one click (open menu) plus one click (entry)
  away, wired to the identical handlers and the identical hidden file input.
- **The `OverflowMenu` primitive stays byte-compatible for its existing callers.** It gains one
  **optional** `triggerClassName` prop whose default reproduces the current trigger classes verbatim,
  so the Dashboard card and Run Console team row render exactly as before.
- **No backend, no callable, no `savePayload`, no shared types, no play-web, no rules.**

## Non-goals

- No change to the export/import callables, the file schema, or the import validation.
- No change to the undo/redo controls, the tab strip, the save indicator or the launch button.
- No change to `functions/`, `packages/shared`, `firestore.rules`, or play-web.

## Impact

- Affected specs: `game-file-export-import` (MODIFIED: the Builder affordance requirement)
- Affected code:
  - `apps/creator-web/src/pages/BuilderPage.tsx` — replace the two glyph buttons with one `File`
    `OverflowMenu`; keep the hidden `<input>` and both handlers.
  - `apps/creator-web/src/components/OverflowMenu.tsx` — add optional `triggerClassName` prop
    (non-breaking; default = current classes).
  - `apps/creator-web/src/i18n.ts` — additive: `fileMenu` label + `fileMenuAria` trigger label, HE
    and EN; existing `b.exportFile` / `b.importFile` / hints reused for the entries.
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules.
