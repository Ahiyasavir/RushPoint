## 1. Persisted preference
- [x] 1.1 `loadColorblind`/`saveColorblind` in `apps/play-web/src/store.ts` (localStorage,
  Safari-private-mode guarded; default off).
- [x] 1.2 Extend `i18nContext` `I18nValue` with `colorblind` + `setColorblind`; reflect on
  `<html data-colorblind>` via effect.

## 2. Non-color cues + aria
- [x] 2.1 `Progress` (ui.tsx): `role="progressbar"` + aria values; colorblind mode adds a
  numeric `done/total` readout and a dashed border on pending segments.
- [x] 2.2 `MapModeToggle`: `role="switch"` + `aria-checked` + `aria-label`; labels routed
  through `t.play.mapView`/`satelliteView` (were hardcoded English).

## 3. Toggle UI
- [x] 3.1 Join screen: an accessibility toggle (◐, `role="switch"` + `aria-checked`) beside
  the language toggle.
- [x] 3.2 i18n: `common.colorblindMode`, `play.progressLabel`, `play.mapView`,
  `play.satelliteView` EN + HE.

## 4. Gates
- [x] 4.1 typecheck · i18n:check · no-dashes · lint · play:build — all green.
- [ ] 4.2 Preview smoke: toggle on → progress shows `done/total`, map switch reads as a
  switch; toggle persists across reload (batch/preview gate).

## Notes / follow-ups (not in this slice)
- Leaderboard podium already shows rank numbers as a fallback; map-pin `aria-label`s and a
  creator-web mirror of the preference are deferred to a follow-up.
