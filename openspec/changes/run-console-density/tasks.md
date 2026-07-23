## 1. RED — the pure model, failing first

- [x] 1.1 Extend `apps/creator-web/src/lib/__tests__/runConsole.test.ts` (reusing its existing
      `fullState`/`emptyState`/`PRIMARY_PANELS` fixtures, not duplicating them) with the twelve
      groups in the design's Test Strategy: placement totality, section coverage, section order and
      empty suppression, summary parity, `resolveSection` defaulting and fallback, priority/weight/
      span catalogue totality, unknown-id totality, column placement totality, phone identity,
      determinism, lane count, empty input, spans, viewport column counts and the static class
      lookup.
- [x] 1.2 Run the creator-web vitest and confirm it FAILS because the new API does not exist.
      Recorded verbatim: `TypeError: buildRunConsoleSections is not a function` at
      `src/lib/__tests__/runConsole.test.ts:302:16`, `Test Files 1 failed (1) / Tests no tests`.

## 2. GREEN — the pure section + placement model

- [x] 2.1 `runConsoleLayout.ts`: derive `SectionId` / `SECTION_ORDER` from `GROUP_ORDER` minus the
      pinned group; add `panelPlacement`, `pinnedPanels`, `buildRunConsoleSections`,
      `DEFAULT_SECTION`, `resolveSection`, `sectionStateKey`.
- [x] 2.2 Remove the now-dead accordion state API (`DEFAULT_GROUP_OPEN`, `GroupOpenState`,
      `readGroupState`, `writeGroupState`, `groupStateKey`) rather than leaving it as dead code.
- [x] 2.3 Add the placement rule: `PANEL_PRIORITY`, `panelPriority`/`panelWeight`/`panelSpan` (total
      over arbitrary strings), `assignPanelColumns` (one column returns the input untouched; more
      returns a priority-ordered, least-loaded, deterministic distribution), `buildPinnedLayout`
      (the join card's state-dependent rank), `consoleColumnCount`, `sectionColumnCount`,
      `gridTemplateClass`, `columnSpanClass`.
- [x] 2.4 Re-run the creator-web vitest — GREEN (72 tests in that file, 325 in the workspace).

## 3. GREEN — the copy

- [x] 3.1 One new key, `runConsole.sectionsHeader`, in BOTH dictionaries in
      `apps/creator-web/src/i18n.ts` (HE `מדורים`, EN `Sections`). No other string added, moved or
      changed; every section title reuses the existing `group*` keys.

## 4. GREEN — the console

- [x] 4.1 Re-read `RunConsolePage.tsx` immediately before editing and confirm it is not mid-edit.
- [x] 4.2 Address the pinned panels by id: move the alerts card, the control bar and the live map
      into the existing `renderPanel` switch alongside new `joinShare` / `stationQr` / `broadcast`
      cases, so lanes (not a hardcoded `lg:col-span-2`) decide placement.
- [x] 4.3 Replace the accordion state with the section selection (localStorage per run, resolved
      through `resolveSection`); `openGroupNow('shareAndScreens')` after a staff invite becomes
      `openSection('shareAndScreens')`, preserving the behaviour.
- [x] 4.4 Replace the `Advanced` accordion list with the Builder's rail pattern: an `aside` that is
      a vertical rail at `lg` and a horizontally scrolling strip below it, `aria-current` on the
      selected entry, the same badge chips the folded headers used, and one `section` pane rendering
      only the selected section's lanes (with the section title repeated in the pane, because on a
      phone the rail scrolls out of view).
- [x] 4.5 Add the `PanelLanes` renderer, which owns no layout decisions and only consumes a
      `ColumnLayout`.
- [x] 4.6 Tighten this page's own rhythm (`space-y-5` → `space-y-4`) and give the `/run/` route the
      Builder's container width in `App.tsx`. No shared primitive, no colour and no other page
      touched.

## 5. REFACTOR / verify

- [x] 5.1 Remove the now-unused `has()` helper, the `planHasPanel` import and the `Advanced` import.
- [x] 5.2 Gates: `npm run typecheck` ✓ · `npm run lint` ✓ (0 errors, 53 pre-existing warnings) ·
      `npm test` ✓ (creator-web 325, functions 357) · `npm run creator:build` ✓ ·
      `npm run play:build` ✓ · `npm run bundle:budget` ✓ · `npm run i18n:check:strict` ✓
      (PART A and PART B both clean) · `scripts/test-no-dashes.ts` ✓.
- [ ] 5.3 NOT DONE, and cannot be: visual confirmation. A live playtest stack serves from this tree,
      so no browser, preview or emulator tool could be used. The rail's proportions, the lane
      balance and the RTL rendering need the product owner's eyes before this is called finished.
