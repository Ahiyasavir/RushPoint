## 1. RED — the verdict, before any of it exists

- [x] 1.1 Write `scripts/test-map-anchor.ts` against the not-yet-existing
      `apps/creator-web/src/lib/mapAnchor.ts`, one assertion per spec scenario: self-placed ⇒
      `point` at zoom 14 even when anchors exist · one anchor ⇒ `bounds` whose opening span is
      ≥ 200 m and < ~3× that (convert the returned zoom back to metres-per-pixel — the derived-zoom
      property, not a hardcoded 17) · two anchors ~1 km apart ⇒ `bounds` containing both, maxZoom
      not binding · two anchors metres apart ⇒ clamped at the neighbourhood zoom · empty / `{0,0}` /
      `NaN` / out-of-range / missing / `null` entries ⇒ `point` at `DEFAULT_CENTER` zoom 8 · mixed
      valid+invalid ⇒ computed from the valid ones alone · `viewportPx` of 0 or NaN ⇒ a finite zoom
      inside `[8, 18]` · called with no argument ⇒ the default view, not a throw.
- [x] 1.2 Run `npx tsx scripts/test-map-anchor.ts` and confirm it fails because the module does not
      exist — the right reason, not a typo in the test.

## 2. GREEN — the pure module

- [x] 2.1 Write `apps/creator-web/src/lib/mapAnchor.ts`: `DEFAULT_CENTER`, `InitialView`,
      `neighbourhoodZoom(lat, viewportPx, radiusMeters)` and `resolveInitialView(...)` per design
      D1/D2/D5 — total, non-throwing, `{0,0}` sentinel excluded, zoom clamped to `[8, 18]`.
- [x] 2.2 Re-run `scripts/test-map-anchor.ts` and confirm every assertion passes.

## 3. GREEN — the picker honours the verdict

- [x] 3.1 `LocationPicker.tsx`: accept `anchors?: {lat: number; lng: number}[]`, measure the
      container's shorter side at construction, resolve the view ONCE inside the existing mount-only
      effect, and pass it to MapLibre as `center`/`zoom` or `bounds`/`fitBoundsOptions`. Move the
      local `DEFAULT_CENTER` to the new module. Leave the `[lat, lng]` effect untouched (design D4).
- [x] 3.2 `LocationStep.tsx`: thread `anchors` straight through to `LocationPicker` on both render
      paths (`fill` and fixed-height), optional at every hop.

## 4. GREEN — the surfaces that own the game supply the anchors

- [x] 4.1 `BuilderPage.tsx`: `useMemo` the game-wide placed coordinates and pass them to
      `ContextPanel`; `ContextPanel` → `TaskWizard` → `LocationStepBody` → `LocationStep`.
- [x] 4.2 `RunConsolePage.tsx`: collect placed coordinates in the existing `getGame` effect that
      already builds `taskTitles` (no extra read), and pass them to the hot-zone and zone-create
      `LocationStep`s.

## 5. REFACTOR + verification

- [x] 5.1 Re-read the touched components for duplication left behind: one `DEFAULT_CENTER`, one
      "is this coordinate really placed" predicate, no anchor logic left inline in a component.
- [x] 5.2 Verify in the running app (preview tools): in the seeded demo game place mission 1, open
      mission 2's location step and confirm the map opens on mission 1's street at street scale;
      then open a mission in a game with nothing placed and confirm the central-Israel default is
      unchanged; then open an already-placed mission and confirm it still opens on its own pin.
- [x] 5.3 Run the full gate set — `npm run verify` (typecheck · lint · test · creator:build ·
      play:build · bundle:budget · base:check · origin:check · i18n:check:strict) — and confirm all
      nine are green, with zero new PART B findings. Capture the exit code directly; never read a
      gate's result through `head`/`tail`.
