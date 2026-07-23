# Tasks — play-map-recenter-control

## RED

- [x] 1. Write `scripts/test-map-recenter.ts` against the not-yet-existing
      `recenterVerdict` (`apps/play-web/src/lib/recenter.ts`): every case in design.md §5, including
      the hostile-input matrix, the `[lng, lat]` axis order, null island, the ±90/±180 boundaries,
      the zoom clamp/fallback and the purity pair. Run it, confirm it fails for the right reason
      (module not found), record the output.

## GREEN

- [x] 2. Create `apps/play-web/src/lib/recenter.ts` implementing design.md §1. Total, no clock, no
      I/O. Re-run the tsx suite; GREEN.
- [x] 3. `apps/play-web/src/i18n.ts`: add `play.recenter` and `play.recenterNoFix` to BOTH
      dictionaries per design.md §6.
- [x] 4. `apps/play-web/src/components/NavMap.tsx`: render the button per design.md §3, wire
      `onClick` to `easeTo` with the verdict's own `center`/`zoom`, and re-check the verdict inside
      the handler so a click that races a lost fix is a no-op.
- [x] 5. Remove MapLibre's `GeolocateControl` from the `addControl` block (design.md §4). Leave
      `NavigationControl`.

## REFACTOR / verify

- [x] 6. `npx tsx scripts/test-map-recenter.ts` green.
- [x] 7. `npx tsx scripts/test-play-a11y-scan.ts` green — zero new findings from the new markup.
- [x] 8. `npx tsx scripts/check-i18n.ts --strict` clean — no new PART B findings.
- [ ] 9. Full gate set — **run by the parent agent**: `npm run typecheck`, `npm run lint`,
      `npm test`, `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`.
- [ ] 10. Preview verification (parent/owner): drag the dot off screen, tap the control, confirm the
      camera returns; deny location permission and confirm the control is disabled, named, and blocks
      nothing else on the screen.
