## 1. Reproduce and MEASURE before changing anything

- [x] 1.1 Boot `dev:all`, sign in, open a game with readiness issues at 375x812 RTL.
- [x] 1.2 Probe with `getBoundingClientRect`. Recorded: slot `left 204 width 0`, panel
  `204 -> 555` width 351, **180px off screen, 49% visible**, `scrollWidth` 375 so the
  overflow is clipped not scrollable, computed `max-width` 351px (the cap applied and
  changed nothing). This is the evidence the whole change rests on; a source scan
  cannot produce it.

## 2. The pure placement — RED

- [x] 2.1 `scripts/test-popover-placement.ts`: the measured production case yields a
  placement fully inside the gutters. Run; confirm it fails because the module does
  not exist.
- [x] 2.2 Add the identity case (a placement that already fits is not moved), both
  directions, and anchors at both edges across 320 / 375 / 768 / 1440. Still RED.
- [x] 2.3 Add narrowing (viewport smaller than preferred width) and the degenerate
  viewport (narrower than two gutters) - never a negative width. Still RED.
- [x] 2.4 Add totality: NaN / Infinity / negative / missing inputs never yield NaN and
  always land on screen. Still RED.
- [x] 2.5 Add a seeded sweep (>=4000 cases) asserting `gutter <= left` and
  `left + width <= viewportWidth - gutter`, printing the denominator and asserting the
  sweep actually exercised the clamped path.

## 3. The pure placement — GREEN

- [x] 3.1 Create `apps/creator-web/src/lib/popoverPlacement.ts` exporting
  `POPOVER_GUTTER_PX` and `popoverPlacement(input)`. Pure, total, no React, no DOM.
- [x] 3.2 Run the suite - GREEN, and confirm no other suite regressed.

## 4. Wire it into the readiness panel

- [x] 4.1 `ReadinessPanel`: a ref on the slot, a layout effect measuring it plus
  `document.documentElement.clientWidth`, result applied as an inline `left` / `width`.
  **A SECOND defect only the browser could find:** `popoverPlacement` answers in
  VIEWPORT pixels, but an absolutely positioned element's `left` is measured from its
  CONTAINING BLOCK - the zero-width slot. Setting the viewport number directly put the
  box at `slot.left + left` and it was STILL 192px off screen. The types were happy
  and the pure suite was green; only `getBoundingClientRect` said otherwise. The
  component now converts once, at the boundary between the two frames.
- [x] 4.2 Re-measure on open and on window resize, so an orientation change cannot
  leave a stale placement.
- [x] 4.3 **REMOVE** the now-defeated `end-0`, `w-[22rem]` and
  `max-w-[calc(100vw-1.5rem)]` classes. Leaving a rule that no longer does anything is
  how the next reader concludes the cap is still protecting them.
- [x] 4.4 Confirm the direction is read from the document, not assumed, so LTR
  creators get the mirrored preference.

## 5. Verify in a real browser, by measuring

- [x] 5.1 Re-ran the exact probe at 375x812. **Before `204 -> 555`, 180px off screen.
  After `12 -> 363`, 0px off screen, fully on screen.**
- [x] 5.2 The reported symptom, measured directly with a `Range` over the intro's first
  character: **before x=555 (off screen), after x=351 (on screen).**
- [x] 5.3 Measured at 1440x900: panel `1076 -> 1428`, width 352, right gutter exactly
  12px, fully on screen. NOTE the slot sits near the right edge at every width in this
  shell, so the popover would have overflowed at desktop widths too - the defect was
  not phone-only, merely less visible there. The true identity case (a placement that
  already fits is not moved) is covered directly by the pure suite, which is the right
  place for it.
- [x] 5.4 Screenshot both, as the before/after record.

## 6. Gates

- [x] 6.1 `npm run verify` - **298/298 pure-logic unit files green**, i18n PART A and
  PART B clean, every build green, lint 0 errors. The only red gate is the
  pre-existing `check-marketing-output` failure on the untracked
  `apps/marketing/public/_kit-b83f9d2e/` template kit, which was present at session
  start and is untouched by this change.
- [x] 6.2 No i18n string changed and no callable added, so `npm run e2e` is unaffected.
  State that in the change summary so the omission reads as a decision.
