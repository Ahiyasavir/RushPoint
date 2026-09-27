## 1. The URL contract (pure) — RED

- [x] 1.1 Write `scripts/test-mission-editor-route.ts` against a not-yet-existing
      `apps/creator-web/src/lib/missionEditorRoute.ts`, encoding: `readOpenMissionId` on an absent,
      empty, whitespace-only and repeated `task` param; `missionEditorSearch` adding, replacing and
      REMOVING the key while preserving unrelated params. Run it, confirm it fails because the
      module does not exist.
- [x] 1.2 Extend the same test with `resolveOpenMission(game, taskId)`: a real id returns the task
      and its containing stage; an unknown id returns null; an id in a non-active stage still
      resolves; a null/malformed game returns null and never throws. Confirm RED.
- [x] 1.3 Extend the same test with the D2 history table EXHAUSTIVELY —
      `missionEditorNavAction(prev, next, weOwnEntry)` over every combination of
      {closed, open A, open B} x {closed, open A, open B} x {true, false}, asserting
      push / replace / back / none. This is the decision that can strand or accumulate history
      entries, so no case may be left implicit. Confirm RED.

## 2. The URL contract (pure) — GREEN

- [x] 2.1 Write `apps/creator-web/src/lib/missionEditorRoute.ts` with the minimum to make 1.1-1.3
      pass: `MISSION_PARAM`, `readOpenMissionId`, `missionEditorSearch`, `resolveOpenMission`,
      `missionEditorNavAction`. Every function total and non-throwing on malformed input.
- [x] 2.2 Run `node --import tsx scripts/test-mission-editor-route.ts` and confirm ALL PASS.

## 3. Wire the Builder to the URL

- [x] 3.1 Replace `BuilderPage`'s `editing` state with a derivation from the search param plus the
      loaded game, placed beside the existing `readiness` `useMemo` — ABOVE the early returns at
      lines 904/912 (React #300). Add the `weOwnEntry` ref.
- [x] 3.2 Convert all 6 open sites (mission tile 2415/2724, readiness 2479, הקמה מהירה 2489, canvas
      target 2470) and all 5 close sites (2323, 2602, 2673, 2685, 2712, 2852) to navigations driven
      by `missionEditorNavAction`. No call site decides push-vs-replace itself.
- [x] 3.3 Move `revealAll` to local state keyed by task id (design D3); confirm a readiness entry
      still opens its mission with validation messages visible.
- [x] 3.4 Handle the stale address: when the param names a task the loaded game does not have, clear
      it with `replace` and open no editor. Confirm no error surface and no history entry.
- [x] 3.5 Verify in the browser at 375px: open from a tile, back closes the editor and keeps the
      Builder, ✕ closes it, back after ✕ leaves the Builder, reload restores the mission,
      `?task=<deleted-id>` opens the plain Builder.

## 4. Full-screen phone presentation

- [x] 4.1 Add `variant?: 'sheet' | 'fullscreen'` to `SlidePanel` (default `'sheet'`, so
      `StageSettingsPanel` is untouched); implement `fullscreen` as `max-lg:inset-0` with
      `env(safe-area-inset-*)` padding. Keep the flex column with a single scrolling body and a
      pinned footer.
- [x] 4.2 Pass `variant="fullscreen"` from `ContextPanel` and DELETE the `reserveTop` prop and its
      one call site, along with the `62dvh`/`88dvh` height branch.
- [x] 4.3 Add an accessible back/close control to the full-screen header; route its label through
      `t.*` in BOTH dictionaries (HE + EN). No hardcoded string.
- [x] 4.4 Verify at 375px: the editor fills the viewport, the footer stays reachable with the
      keyboard open, and the body is the only scroller (it already carries `overscroll-contain`
      from stage A).
- [x] 4.5 Verify at 1280px that the desktop side pane is visually and behaviourally unchanged.

## 5. The הקמה מהירה instruction moves inside (design D5)

- [x] 5.1 Add an `inline` presentation to `QuickSetupBar` (same component, same copy, no new
      strings) and render it inside the full-screen editor's header region.
- [x] 5.2 Suppress the floating bar while the full-screen editor is open, so exactly one instruction
      is on screen. Confirm `scripts/test-quick-setup-flow.ts` still passes.
- [x] 5.3 Verify at 375px: following a הקמה מהירה step into a mission shows the instruction inside
      the editor, and nothing overlaps.

## 6. Gates

- [x] 6.1 Run `npm run verify` (typecheck · lint · test · creator:build · play:build ·
      bundle:budget · base:check · origin:check · i18n:check:strict) redirected to a file, and read
      the captured exit code — never a piped tail (CLAUDE.md). All nine green.
- [x] 6.2 Confirm `npm run i18n:check:strict` reports zero NEW PART B findings for the new control.
- [x] 6.3 Run `npm run e2e` and confirm still green (no callable changed, so this is a regression
      check only).
- [x] 6.4 Re-run the stage A guards: `scripts/test-mobile-form-zoom.ts` and
      `scripts/test-quick-setup-flow.ts`.
- [x] 6.5 Report what was verified in a real browser vs. what still needs a real iPhone — per the
      standing rule that no gate in this repo can see any of this.
