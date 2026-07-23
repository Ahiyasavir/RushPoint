# Tasks — hidden-mission-search-area

## RED

- [x] 1. Write `scripts/test-hidden-search-area.ts` against the not-yet-existing
      `hiddenSearchArea` (`packages/shared/src/hiddenSearchArea.ts`) and `selectSearchAreas`
      (`apps/play-web/src/lib/searchAreas.ts`): every case in design.md §5.1, including the seeded
      containment sweep, the determinism/non-inversion pair, and the selector's total-and-never-throw
      cases. Run it, confirm it fails for the right reason (module not found), record the output.
- [x] 2. Rewrite the `hidden-location-map-visibility` boundary describe block in
      `functions/src/runs/sanitizeTask.test.ts` to encode the new contract (design.md §5.2). Confirm
      the sealed-payload `searchArea` assertions fail and every "still withheld" assertion passes.

## GREEN — the derivation

- [x] 3. Create `packages/shared/src/hiddenSearchArea.ts`: `HIDDEN_SEARCH_CELL_DEG`,
      `HIDDEN_SEARCH_RADIUS_M`, the `SearchArea` interface and `hiddenSearchArea(task)`. Grid snap
      anchored at (0, 0), constant radius, clamped to the valid coordinate range, `undefined` for
      locationless / unusable coordinates. Header states the containment arithmetic and why it does
      NOT import from `publicTaskLocation.ts`.
- [x] 4. Export it from `packages/shared/src/index.ts`.
- [x] 5. Re-run the tsx suite; the derivation half is GREEN.

## GREEN — the boundary

- [x] 6. `functions/src/runs/sanitizeTask.ts`: derive the area from
      `smart?.stationCoords ?? coordinates` inside the sealed-stub branch and emit it as one
      conditional key. Nothing else in the function changes. Update the comment block so it states
      what the sealed stub now carries and why that is still a seal.
- [x] 7. Re-run `npx vitest run src/runs/sanitizeTask.test.ts` from `functions/`; GREEN.
- [x] 8. `scripts/e2e-verify.mjs`: add `searchArea` to `ALLOWED_TASK_KEYS` with the reason inline.

## GREEN — the client

- [x] 9. Create `apps/play-web/src/lib/searchAreas.ts` per design.md §4. Re-run the tsx suite; GREEN.
- [x] 10. `apps/play-web/src/services/calls.ts`: add `searchArea?: SearchArea` to `SafeTask`, with a
      comment stating it is the ONLY locational value a sealed task carries.
- [x] 11. `apps/play-web/src/components/NavMap.tsx`: the `searchAreas` prop, the dashed violet
      overlay applied inside the existing `styledata` handler, the centres joined into `overlayPts`,
      and the legend chip.
- [x] 12. `apps/play-web/src/screens/PlayScreen.tsx`: one `selectSearchAreas` call, one prop. The
      `arrivalPending` pin filter is unchanged.
- [x] 13. `apps/play-web/src/i18n.ts`: `task.sealedHelp` rewritten and `play.searchAreaLegend` added,
      in BOTH dictionaries, per design.md §6.

## REFACTOR / verify

- [x] 14. Re-read `sanitizeTask.ts` and confirm the sealed stub is still built by CONSTRUCTION and
      that no `coordinates` / `geofenceRadiusMeters` / `smart` key can reach a sealed payload.
- [x] 15. Confirm `evaluateTrigger`'s hidden branch and `publicTaskLocation` are byte-for-byte
      unchanged.
- [x] 16. `npx tsx scripts/test-hidden-search-area.ts` and `npx tsx scripts/test-play-a11y-scan.ts`
      green; `npx tsx scripts/check-i18n.ts --strict` clean.
- [ ] 17. Full gate set — **run by the parent agent**, sequentially, AFTER `shared` is rebuilt:
      `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`, `npm run play:build`,
      `npm run bundle:budget`, `npm run i18n:check:strict`, `npm run e2e`.
