# Tasks: fix-territory-map-visibility

## 1. Verify the re-capture report is not a bug (no code)
- [ ] 1.1 Confirm `canCapture` (`packages/shared/src/captureZone.ts:26`) allows any non-holder to flip
  and that the existing zone e2e (`scripts/e2e-verify.mjs:2415-2423`) already asserts A-can't-self-
  recapture + out-of-radius-rejected + **B-flips-A**. Conclusion: map-visibility fix only, no backend
  change. (Documented in design.md.)

## 2. NavMap zone layer (map UI)
- [ ] 2.1 Add `zones?: CaptureZone[]` and `myTeamId?: string` props to `NavMap`; add `zonesRef` +
  `myTeamIdRef` (so the `styledata` closure reads latest values).
- [ ] 2.2 Add `applyZones(map)` — a FeatureCollection of `circlePolygonGeoJSON` polygons in one
  `capture-zones` source, with `fill`/`line` layers colored per-feature via `['get','color']`
  (mine=green, rival=red, open=grey). Mirror `applyHotZone`'s add/update/remove shape.
- [ ] 2.3 Call `applyZones` from the existing `styledata` handler (re-apply after a tile-mode switch)
  and from a dedicated effect keyed on `[JSON.stringify(zones ids/owner/radius/center), myTeamId]`.
- [ ] 2.4 Render one center-label marker per zone (🚩 + `Popup.setText(title)`), stored in a
  `zoneMarkers` ref and re-synced in the same effect; removed on unmount/empty.
- [ ] 2.5 Empty-state guard → `valid.length === 0 && (zones ?? []).length === 0`; map create
  `center`/`zoom` and fit-bounds fall back to / extend with zone centers.

## 3. PlayScreen plumbing
- [ ] 3.1 Lift zone fetch into `PlayScreen`: `zones` state + `reloadZones` (calls `getRunZones`,
  `[]` on error), load on mount + after a successful capture.
- [ ] 3.2 Make `ZonesPanel` presentational (receive `zones` + `reloadZones` props; `capture()` calls
  `captureZone` then `reloadZones()`).
- [ ] 3.3 Pass `zones` + `myTeamId={team.id}` into `NavMap`; widen mount gate to
  `activeStage || zones.length > 0`.
- [ ] 3.4 If any new visible string, add key to `he` + `en` in `apps/play-web/src/i18n.ts` (no dash
  separators) and read via `t.*`.

## 4. Verify (gates)
- [ ] 4.1 Preview: a run with a zone shows a holder-colored circle + title on `NavMap`; after a
  capture the circle recolors to "mine" and the list updates together.
- [ ] 4.2 `npm run i18n:check` clean (PART A hard gate).
- [ ] 4.3 `npm run typecheck` · `npm run lint` · `npm test` (no-dashes) · `npm run creator:build` ·
  `npm run play:build` — all green.

## Notes
- MapLibre stays behind `React.lazy` (NavMap is already lazy-imported in PlayScreen) — no eager map
  import added.
- No backend/shared/rules change; no new callable; the existing zone e2e scenario remains the
  re-capture regression guard.
