## 1. RED — failing tests first

- [x] 1.1 Add a co-located vitest test for a new pure function
      `triggerModeFromRadius(radiusMeters: number): 'exact' | 'radius'` asserting `<= 4 → 'exact'`
      and `> 4 → 'radius'`. Confirm it fails (function doesn't exist yet).
- [x] 1.2 Add a test asserting that enabling "Skip GPS check" derives `triggerMode: 'instant'`
      while leaving `coordinates`/`geofenceRadiusMeters` untouched.
- [x] 1.3 Add assertions that existing `'exact'`, `'radius'`, and `'instant'` tasks round-trip
      through the wizard's load path unchanged (no forced re-derivation on open, coordinates and
      routing-relevant fields intact).

## 2. GREEN — implementation

- [x] 2.1 Add the `triggerModeFromRadius` pure helper.
- [x] 2.2 In `TaskWizard.tsx`, collapse the trigger-mode button row from 4 buttons to 2 (Anywhere /
      Specific Location).
- [x] 2.3 Build the single Advanced panel under "Specific Location": radius input (wired to
      `triggerModeFromRadius`, with 40m/4m presets), "Skip GPS check" toggle (wired to
      `'instant'`), and the relocated "Hide location" checkbox + clue field (moved from the `rules`
      section, `:1120-1151`).
- [x] 2.4 Update `i18n.ts` (HE + EN): retire `fireRadiusDesc`/`fireExactDesc` as separate button
      labels, add consolidated "Specific Location" copy plus new strings for the "Skip GPS check"
      toggle; keep `fireAnywhereDesc` largely as-is for the "Anywhere" button.

## 3. Verify

- [x] 3.1 `npm run typecheck`
- [x] 3.2 `npm test`
- [x] 3.3 `npm run lint`
- [x] 3.4 `npm run creator:build`
- [x] 3.5 `npm run i18n:check:strict`
- [x] 3.6 Manual preview: create a new task, confirm exactly 2 top-level buttons, confirm
      "Anywhere" shows no Advanced panel, confirm "Specific Location" defaults to 40m with no
      visible number until Advanced is opened, confirm the radius slider derives `triggerMode` at
      the 4m cutoff, confirm "Skip GPS check" sets `'instant'` while keeping the map pin, confirm
      hide-location only appears inside Specific Location's Advanced panel, confirm opening
      pre-existing `'exact'`, `'radius'`, and `'instant'` tasks shows correct state without
      altering stored values.
