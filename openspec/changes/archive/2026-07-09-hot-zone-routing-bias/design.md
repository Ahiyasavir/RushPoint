## Context

`functions/src/routing/assignNextTask.ts` computes a `priorityScore(task, teamLocation,
skillRatio, taskCounts, skillAware)` for every open candidate task in a team's active stage,
then `assignTask` picks the highest-scoring one (transactionally, incrementing
`run.taskCounts[taskId]`) and `buildRecommendations` returns the top N for the
`getRecommendedTasks` read-only callable. Neither function is passed the run's `hotZone`
today, so an active hot zone (`packages/shared/src/hotZone.ts`) has zero effect on which task a
team is routed to. `hotZoneMultiplier(zone, coords, nowMs)` — the existing eligibility check
used at completion time to decide whether to multiply the earned score — bundles a time-window
check and a radius check together and takes a specific point, not a task.

The participant app already reads `run.hotZone` for `InRunAlerts.tsx` (banner + countdown), but
`NavMap.tsx` never draws it, even though `openspec/specs/hot-zone-bonus/spec.md` already states
participants "see... the zone drawn on the map" — that requirement was written but never built.

## Goals / Non-Goals

**Goals:**
- Make the hot zone bonus something a team can benefit from via the game's existing (fully
  automatic) task assignment, without giving teams manual task choice (out of scope / a much
  bigger change to the whole routing model).
- Keep the effect a *nudge*: an in-zone task should usually win against a similar out-of-zone
  task, but a badly-loaded or far in-zone task can still lose to a great out-of-zone one — the
  existing load/transit/skill signals must remain meaningful.
- Reuse the existing eligibility semantics (active window + radius) rather than inventing a
  second notion of "is the zone active."
- Give participants visual context (the zone circle) for why routing might be steering them
  somewhere, fulfilling the spec's pre-existing (unbuilt) requirement.

**Non-Goals:**
- No manual task selection / player agency over routing — routing stays fully automatic.
- No change to `hotZoneMultiplier`'s scoring behavior at completion time.
- No new callable, no Firestore schema change — `run.hotZone` is already the source of truth.
- Locationless tasks are not made hot-zone-eligible — they have no coordinates, so "is this task
  inside the zone" isn't defined for them; they're unaffected, matching how `transitMinutes`
  already treats them as a special case (always 0 transit).

## Decisions

**1. Extract two pure predicates out of `hotZoneMultiplier` in `packages/shared/src/hotZone.ts`:**
`isHotZoneActive(zone, nowMs): boolean` (the existing exists/multiplier>1/time-window check) and
`isWithinHotZoneRadius(zone, point): boolean` (the existing haversine/radius check, reusing the
same try/catch-on-invalid-center behavior). `hotZoneMultiplier` is rewritten to compose them
(`isHotZoneActive(zone, nowMs) && isWithinHotZoneRadius(zone, coords) ? zone.multiplier : 1`),
preserving its exact existing behavior (covered by its current tests). The routing bonus reuses
the same two predicates instead of re-implementing the radius/window math a second time — one
definition of "is this point, right now, in the hot zone."

Alternative considered: duplicate a small radius+window check directly in
`assignNextTask.ts`. Rejected — would drift from `hotZoneMultiplier`'s semantics over time (e.g.
if the eligibility rule ever gains a condition, routing would silently miss it).

**2. Add a flat additive bonus term, same constant for both scoring presets:**
`priorityScore` gains a `hotZone: HotZone | null | undefined` parameter. When
`isHotZoneActive(hotZone, nowMs)` is true and the task has valid, non-locationless coordinates
within `isWithinHotZoneRadius`, add `HOT_ZONE_ROUTING_BONUS = 0.35` to the score (both the
skill-aware and non-skill-aware formulas). Chosen so the bonus dominates in *close* contests
(load/transit/skill deltas are usually well under 0.35) without becoming an absolute override —
a task that's fully loaded (`loadFactor = 0`) deep inside the zone vs. an empty, nearby task
outside it can still go either way depending on magnitudes, which is the "nudge not force"
property called out in Goals. This is verified directly by a unit test (see Test Strategy).

Alternative considered: scale the bonus by the zone's own `multiplier` (e.g. proportional to
how good the score payoff is). Rejected for this iteration — couples two independently-tunable
knobs (routing weight vs. score payoff) for a marginal gain in "realism"; a flat constant is
easier to reason about and to test, and can be revisited later if organizers report the nudge
feels too weak/strong at high multipliers.

**3. Thread `hotZone` through both call sites, not just one:** `getRunRouting` (used by
`buildRecommendations`) and `assignTask`'s in-transaction run-doc read both already fetch the run
document for `taskCounts`/`launchedAt` — both are extended to also read `hotZone` off the same
already-fetched doc (no extra read). This keeps `getRecommendedTasks` (what a team *sees* as
upcoming options) and `requestNextTask` (what they're actually *assigned*) consistent — an
organizer or curious participant checking recommendations sees the same bias that assignment
will apply.

**4. Draw the zone via a GeoJSON circle source/layer, not a fixed-pixel marker:** `NavMap.tsx`'s
existing task/me markers are plain DOM `Marker` elements, which don't scale with real-world
meters as the map zooms. A radius in meters needs a geographically-accurate circle, so this adds
a small pure helper `circlePolygonGeoJSON(center, radiusMeters, points = 64)` to
`packages/shared/src/geo.ts` (same helper family as the existing `routeGeoJSON`), and `NavMap`
adds/updates a `fill` + `line` layer sourced from it when `isHotZoneActive` is true, removing the
source/layers when the zone is absent/expired. `NavMap` gains one new optional prop
(`hotZone: HotZone | null`), passed from `PlayScreen.tsx`'s already-available `state.run.hotZone`
(the same data `InRunAlerts` already consumes).

Alternative considered: reuse `LocationPicker`'s MapLibre instance/pattern. Rejected —
`LocationPicker` is a creator-side authoring tool (click-to-place); `NavMap` is the
participant-facing live map with its own marker-sync lifecycle. Sharing the new `geo.ts` helper
is enough; the map-instance code isn't meaningfully shared between them today.

## Test Strategy

- **Pure logic — `packages/shared` / `scripts/test-hot-zone.ts`:** extend to assert
  `isHotZoneActive`/`isWithinHotZoneRadius` in isolation, and that `hotZoneMultiplier`'s
  behavior is unchanged after the refactor (existing scenarios: active+in-range multiplies,
  expired/out-of-range/missing-coords don't).
- **Pure logic — new `scripts/test-geo-circle.ts` (or extend `test-geo-validation.ts`):** assert
  `circlePolygonGeoJSON` returns a closed ring of the requested point count, each within a small
  tolerance of `radiusMeters` from center (via the existing `haversineKm`).
- **Pure logic — `functions/src/routing/assignNextTask.test.ts`:** extend with `priorityScore`
  cases (exported for the test, or exercised via `buildRecommendations`/`assignTask` with a
  fake run doc): (a) an in-zone task outscores an identical out-of-zone task when the zone is
  active, (b) no bonus when the zone is expired or absent, (c) no bonus for a locationless task,
  (d) a heavily-loaded in-zone task can still lose to an empty out-of-zone task — proving the
  bonus nudges rather than overrides.
- **e2e — `scripts/e2e-verify.mjs`:** extend the existing locationless/routing scenario (or add a
  new one) — activate a hot zone centered on one of two otherwise-equivalent candidate tasks,
  call `requestNextTask`, assert the in-zone task is assigned; confirm the untouched
  station-contention and leaderboard-invariant scenarios still pass unmodified.
- **UI (manual/preview):** confirm the hot zone renders as a circle on the participant map while
  active and disappears on expiry/deactivation; run `npm run i18n:check` (no new user-facing
  strings are introduced by this change, so this should stay a no-op pass).

## Risks / Trade-offs

- **[Risk] A flat bonus constant tuned wrong could feel either invisible or heavy-handed.** →
  Mitigation: unit-test the "nudge not force" property explicitly (case d above) so a future
  constant change that breaks that property fails CI, not just organizer intuition.
- **[Risk] Drawing a 64-point polygon per zone is cheap, but re-computing it every render could
  jank on low-end phones.** → Mitigation: recompute only when the zone's center/radius/active
  state actually changes (same dependency-array discipline `NavMap` already uses for its marker
  effects), not on every location ping.
- **[Trade-off] Locationless tasks stay unaffected by the bonus.** Acceptable per Non-Goals — a
  future change could special-case "hot zone active + only locationless tasks available" if that
  ever proves confusing in practice, but it's out of scope here.

## Migration Plan

Pure additive logic change + one new optional UI prop; no data migration, no rollback beyond a
revert (no persisted schema changes). Ship behind the existing `activateHotZone` control — an
organizer who never activates a hot zone sees no behavior change at all.

## Open Questions

- Should the routing bonus scale with the zone's `multiplier` in a later iteration once we have
  organizer feedback on whether ×2 vs ×5 zones should pull harder? (Deferred — see Decision 2.)
