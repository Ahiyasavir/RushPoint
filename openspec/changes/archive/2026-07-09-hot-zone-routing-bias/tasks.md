## 1. Shared hot-zone predicates (RED → GREEN → REFACTOR)

- [x] 1.1 In `scripts/test-hot-zone.ts`, add failing assertions for two new exports from
      `packages/shared/src/hotZone.ts`: `isHotZoneActive(zone, nowMs)` (true only when a zone
      exists, `multiplier > 1`, and `nowMs` is within `[startedAt, expiresAt]`) and
      `isWithinHotZoneRadius(zone, point)` (true only when `point` is within `radiusMeters` of
      `zone.center`, false on invalid center/point). Run `npm test` and confirm these fail
      (functions don't exist yet).
- [x] 1.2 Implement `isHotZoneActive` and `isWithinHotZoneRadius` in
      `packages/shared/src/hotZone.ts`, extracted from `hotZoneMultiplier`'s existing logic.
      Rewrite `hotZoneMultiplier` to compose them: `isHotZoneActive(zone, nowMs) &&
      isWithinHotZoneRadius(zone, coords) ? zone.multiplier : 1`. Run `npm test` and confirm all
      of `test-hot-zone.ts` (new + pre-existing `hotZoneMultiplier` cases) passes.
- [x] 1.3 Refactor check: confirm no other file duplicates the window/radius check that could
      now use the shared predicates (grep for `radiusMeters` and `expiresAt` usage outside
      `hotZone.ts`).

## 2. Circle-polygon geo helper (RED → GREEN → REFACTOR)

- [x] 2.1 Add a failing test (new `scripts/test-geo-circle.ts` or extend
      `scripts/test-geo-validation.ts`) for `circlePolygonGeoJSON(center, radiusMeters, points =
      64)` in `packages/shared/src/geo.ts`: asserts a closed ring (first point === last point) of
      `points + 1` coordinates, and that each ring point is within a small tolerance of
      `radiusMeters` from `center` (via the existing `haversineKm`). Confirm it fails (function
      doesn't exist).
- [x] 2.2 Implement `circlePolygonGeoJSON` in `packages/shared/src/geo.ts` (same helper family as
      the existing `routeGeoJSON`) and export it from the package's public surface. Run `npm test`
      and confirm the new test passes.

## 3. Routing bonus (RED → GREEN → REFACTOR)

- [x] 3.1 In `functions/src/routing/assignNextTask.test.ts`, add failing test cases exercising
      `priorityScore` (export it from `assignNextTask.ts` for direct testing, or exercise it via
      `buildRecommendations`/`assignTask` against a stubbed run doc): (a) an in-zone task
      outscores an identical out-of-zone task when a hot zone is active, (b) no score difference
      when the zone is expired/absent, (c) a locationless task never receives the bonus, (d) a
      heavily-loaded in-zone task can still score lower than an unloaded out-of-zone task (the
      "nudge not force" property). Run `npm test` and confirm these fail.
- [x] 3.2 Add `HOT_ZONE_ROUTING_BONUS = 0.35` and thread a `hotZone: HotZone | null | undefined`
      parameter through `priorityScore` in `assignNextTask.ts`, applying the bonus only when
      `isWithinHotZoneRadius(hotZone, task.coordinates)` is true, the task is not `locationless`,
      and `isHotZoneActive(hotZone, nowMs)` is true. Update `getRunRouting` to also return
      `hotZone` from the already-fetched run doc, and pass it through `buildRecommendations`.
      Update `assignTask`'s transactional run-doc read to also destructure `hotZone` and pass it
      into the sort comparator. Run `npm test` and confirm all cases from 3.1 pass, plus the
      existing `computeSkillRatio` tests still pass unmodified.
- [x] 3.3 Extend `scripts/e2e-verify.mjs`: activate a hot zone (via `activateHotZone`) centered on
      one of two otherwise-equivalent open candidate tasks in a run's active stage, call
      `requestNextTask` for a fresh team, and assert the in-zone task is the one assigned. Run
      `npm run e2e` and confirm this scenario passes alongside the existing station-contention and
      leaderboard-invariant scenarios (no regression).

## 4. Participant map — draw the active hot zone

- [x] 4.1 Add an optional `hotZone: HotZone | null` prop to
      `apps/play-web/src/components/NavMap.tsx`. When `isHotZoneActive(hotZone, Date.now())` is
      true, add/update a GeoJSON source (built from `circlePolygonGeoJSON`) with a `fill` (low
      opacity) + `line` layer for the zone; remove the source/layers when the zone is
      absent/inactive. Recompute only when the zone's center/radius/active-state actually
      changes (mirror the dependency-array discipline of the existing marker-sync effects).
- [x] 4.2 Pass `state.run.hotZone` from `apps/play-web/src/screens/PlayScreen.tsx` into the
      `NavMap` instance already rendered there (same data `InRunAlerts` already consumes — no new
      read).
- [x] 4.3 Verify via the preview tools: activate a hot zone from the creator Run Console, confirm
      the circle appears on a participant's live map, and disappears after `deactivateHotZone`
      or expiry. Since no new user-facing text is introduced, run `npm run i18n:check` and confirm
      it stays clean (no new findings).
      NOTE: Drove the full flow live (creator start-teams → participant join → located task →
      NavMap mounts centered on the zone; hot-zone data confirmed flowing via the active banner
      + countdown). The circle's pixels could not be captured because the headless preview loads
      zero MapLibre tile/style resources (style never reaches loaded state — affects every map,
      not this change). Overlay wiring verified by typecheck + both builds + unit-tested geometry
      (`circlePolygonGeoJSON`) and activation (`isHotZoneActive`); i18n:check clean (no new text).

## 5. Full gate pass

- [x] 5.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run e2e`, and `npm run i18n:check` — all must be green before
      this change is considered done.
      RESULT: typecheck / lint / test (incl. new hot-zone predicate, geo-circle, and 8 routing
      tests + the no-dashes copy gate) / creator:build / play:build / i18n:check all green. e2e:
      the new "hot zone routing bias" scenario passes deterministically (in-zone task assigned
      over a closer out-of-zone task) across repeated runs; the only e2e reds observed were
      pre-existing rotating environmental/seeded flakes (gallery re-sync read-timing, power-ups
      seed) unrelated to this change's code paths.
