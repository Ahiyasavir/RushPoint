# Design — builder-file-menu

## Decision: a labelled "File" menu, not a labelled button pair

Two clean options were considered for making the affordance legible:

1. **A labelled button pair** — two visible buttons, "Save a copy" and "Load a copy", side by side in
   the header.
2. **One labelled "File" menu** — a single "File" trigger opening a two-entry menu.

**Chosen: the menu (option 2).** Reasons:

- The Builder header (`h-14`, `BuilderPage.tsx:411`) is already dense: logo, back, title, save-status
  chip, undo/redo, then a centered tab strip and the launch button. Two full-width text buttons
  ("Save a copy" / "Load a copy" are 3–4 words each in both languages) would crowd the row and push
  on the tab strip. One compact "File" trigger costs a single slot.
- The two actions are a natural **group** ("things you do with the game file"), which is exactly the
  shape a menu expresses — and the same shape the Dashboard card ("⋯") and Run Console team row
  already use via `OverflowMenu`. Using it here means the Builder joins one established pattern rather
  than introducing a third styling.
- Legibility, the actual bug, is solved either way once the trigger has a visible **text** label. The
  menu keeps that win while staying compact.

The button pair would have been the pick if the header had room and the two actions were unrelated;
neither holds here.

## Reusing `OverflowMenu` without breaking its callers

`OverflowMenu` (`components/OverflowMenu.tsx`) is consumed by `DashboardPage.tsx:497` and
`RunConsolePage.tsx:923`. Its trigger is a small `ghost` `Button` (`min-h-0 px-2.5 py-1 text-[11px]`),
sized for a dense row of controls. The Builder's File trigger wants a **44px** tap target and to sit
visually with the other bordered header controls.

To get that without disturbing the two existing callers, `OverflowMenu` gains **one optional prop**,
`triggerClassName`, defaulting to the exact current class string. Existing callers pass nothing, so
their trigger markup is byte-identical. The Builder passes a header-styled class that reaches 44px.
This is a strictly additive, non-breaking extension — no prop rename, no default change, no markup
change to the menu popover itself.

## Preserving the wiring exactly

The presentation swap touches **only** which element the user clicks. Untouched:

- `exportToFile()` (`BuilderPage.tsx:328`) — saves then calls `exportGameFile`, downloads the blob.
- `importFromFile(file)` (`BuilderPage.tsx:345`) — parses, pre-validates with `parseGameFile`, calls
  `importGameFile`, navigates to the new game.
- The hidden `<input ref={importInput} type="file" accept="application/json,.json">` and its
  `onChange` (`BuilderPage.tsx:475-485`) — kept verbatim. The "Load a copy" menu entry still does
  `importInput.current?.click()`, identical to the old Import glyph button.

So the menu is a pure relabelling of the click targets; the data flow behind each is unchanged.

## i18n

New keys (HE + EN), additive to the Builder `b` dictionary:

- `fileMenu` — visible trigger label. `'קובץ'` / `'File'`.
- `fileMenuAria` — descriptive trigger `aria-label` (the accessible name; more informative than the
  bare visible word). `'פעולות קובץ המשחק'` / `'Game file actions'`.

The two menu entries reuse the **existing** keys: `b.exportFile` (`'שמירת עותק'` / `'Save a copy'`)
and `b.importFile` (`'טעינת עותק'` / `'Load a copy'`), with `b.exportFileHint` / `b.importFileHint`
as their `title` tooltips. No new export/import label strings are invented. Natural Hebrew, no em
dash, no en dash, no spaced hyphen, no hardcoded component literal.

## Test strategy

This is a **presentation swap with no extractable pure logic** — the change moves two existing click
handlers behind a menu and adds two dictionary strings. There is no decision function to extract, so
there is no RED unit test to write; inventing one (e.g. "the menu has two entries") would only assert
JSX structure, which the type-checker and build already cover.

Verification is therefore the **UI lane**:

- `npm run typecheck` — the new `triggerClassName` prop and the `OverflowMenu` usage type-check.
- `npm run creator:build` — the Builder compiles and bundles.
- `npm run i18n:check:strict` — the two new keys exist in BOTH dictionaries, are real HE / real EN,
  and add zero new PART B hardcoded-string findings (the visible label routes through `b.fileMenu`).

Plus a manual preview check (recorded UNVERIFIED if the preview pane is unavailable): the header shows
a "File" control that opens a menu listing "Save a copy" and "Load a copy"; export downloads a file;
import opens the file picker and creates a new game; the Dashboard and Run Console overflow menus are
visually unchanged.
