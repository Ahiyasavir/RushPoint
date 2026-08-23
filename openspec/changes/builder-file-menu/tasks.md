# Tasks — builder-file-menu

## RED

- [ ] 1. No RED unit task: this is a presentation swap with no extractable pure logic (see design.md
      "Test strategy"). The two actions keep their existing handlers; only the click target's markup
      changes. Verification is the UI lane (typecheck / creator:build / i18n:check:strict). Recorded
      deliberately so the TDD skip is explicit, not forgotten.

## GREEN

- [ ] 2. Extend `apps/creator-web/src/components/OverflowMenu.tsx`: add an OPTIONAL
      `triggerClassName?: string` prop, defaulting to the current exact class string
      (`min-h-0 px-2.5 py-1 text-[11px] rounded-lg`). Pass it to the trigger `Button`. Existing
      callers (Dashboard, Run Console) pass nothing ⇒ byte-identical output. No other change.
- [ ] 3. Add HE + EN `fileMenu` and `fileMenuAria` to the Builder `b` dictionary in
      `apps/creator-web/src/i18n.ts` (re-read immediately before editing — the file is contended).
      Additive only; reuse existing `exportFile` / `importFile` / hint keys for the entries. No em
      dash, no en dash, no spaced hyphen.
- [ ] 4. In `apps/creator-web/src/pages/BuilderPage.tsx`, replace the Export (`↓`) and Import (`↑`)
      glyph buttons (`:458-474`) with one `OverflowMenu` labelled `b.fileMenu`
      (`ariaLabel={b.fileMenuAria}`, a 44px header-styled `triggerClassName`) containing two
      `role="menuitem"` buttons: "Save a copy" (`b.exportFile`, `title={b.exportFileHint}`,
      `onClick={() => { void exportToFile(); }}`) and "Load a copy" (`b.importFile`,
      `title={b.importFileHint}`, `onClick={() => importInput.current?.click()}`). KEEP the hidden
      `<input ref={importInput} …>` and its `onChange` verbatim. Import `OverflowMenu`.

## REFACTOR / VERIFY

- [ ] 5. `npm run typecheck` and `npm run creator:build` green.
- [ ] 6. `npx tsx scripts/check-i18n.ts --strict` clean; zero new PART B findings; `fileMenu` +
      `fileMenuAria` present in BOTH language maps.
- [ ] 7. Preview check (creator-web, record UNVERIFIED if the pane is unavailable): the Builder header
      shows a "File" control; opening it lists "Save a copy" and "Load a copy"; export downloads a
      file; import opens the OS file picker and creates a new game; the Dashboard "⋯" and Run Console
      team-row overflow menus look and behave exactly as before.
- [ ] 8. Hand the full `npm run verify` gate set to the build lane (this change owns the build lane).
- [ ] 9. Confirm no e2e owed: no callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
      untouched, no backend or rules touched.
