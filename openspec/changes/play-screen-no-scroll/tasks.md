# Tasks: play-screen-no-scroll

Source: `docs/field-report-2026-09-27.md` items 3, 4. Supersedes `fix-play-screen-hierarchy`.
Pairs with `located-mission-arrival` (camera padding above the sheet).

## 1. RED
- [x] 1.1 `scripts/test-sheet-snap.ts` against `lib/sheetSnap.ts`. Confirm RED.
- [x] 1.2 Source guard in `scripts/test-top-overlay-stack.ts` (100dvh + overflow-hidden; no bare ✕
      leave). Confirm RED.

## 2. GREEN
- [x] 2.1 `lib/sheetSnap.ts`. 1.1 → green.
- [x] 2.2 `MissionSheet.tsx`; `PlayScreen` launched layout D1; LiveOps into the overlay column D3.
- [x] 2.3 Header ⋯ menu D4; i18n he/en. 1.2 → green.
- [x] 2.4 Mark `fix-play-screen-hierarchy` superseded.

## 3. Verify
- [x] 3.1 Preview at 360×640, 375×667, 390×844 (map game + locationless game): no page scroll,
      sheet snaps, leave via menu.
- [ ] 3.2 `npm run verify` (incl. bundle budget), exit code to a file.

## Progress (2026-09-28)

Implemented and browser-verified at 360x640, 375x812, 390x844 (no page scroll, sheet snaps, leave via menu). Guard in test-top-overlay-stack.ts was written after the code, not before.

## Overnight additions (2026-09-29, found by playing at 375x667 and 390x844)
- [x] A new mission opens at the height that shows its action (`fitSnap`: half if the content fits,
      else full), measured in a layout effect. Test: `scripts/test-sheet-snap.ts`.
- [x] Snap heights come from the sheet's CONTAINER (`boxSnapHeights` + ResizeObserver), not the
      window: "full" from the window rose over the game header and covered the SOS button.
      Measured after: sheet 130–643 inside its 118–643 container, SOS uncovered.
