## Why

The Hot Zone bonus (`hot-zone-bonus`) lets an organizer activate a timed, geofenced score
multiplier during a live run. Today the smart-routing engine (`assignNextTask.ts`) that
auto-assigns each team's next task has zero awareness of an active hot zone, and the
participant app never draws the zone on the map (a requirement the existing spec already
states but that was never implemented) — so a team has no way to act on the bonus. It only
pays off if the task the system happens to route them to, by chance, falls inside the zone
during the window. Organizers activate a feature that participants can't meaningfully pursue.
This makes the hot zone feel broken/arbitrary in play, which is why an organizer using it in
the console asked "what does this actually do if teams can't choose their tasks?".

## What Changes

- Add a routing bonus term to `assignNextTask.ts`'s task-scoring formula: when a hot zone is
  active, a candidate task whose location falls within the zone's radius gets a bonus added to
  its score, alongside the existing load/transit/skill terms (for `smart_weighted`) and
  load/transit terms (for `fixed_points_speed` / `time_only`). This is additive — it does not
  replace or reweight the existing factors, and a task with no location (locationless) or
  outside the zone is unaffected.
- The bonus only applies while the hot zone is actually active (same eligibility rule already
  used by `hotZoneMultiplier`: zone exists, multiplier > 1, now within `[startedAt, expiresAt]`)
  and only nudges tasks whose stored location is within `radiusMeters` of the zone center — it
  never forces a specific task, so station-cap contention and existing load-balancing behavior
  are preserved.
- Render the active hot zone as a circle overlay on the participant's live map
  (`apps/play-web/src/components/NavMap.tsx`), fulfilling the existing (but unimplemented)
  `hot-zone-bonus` spec requirement that participants see the zone drawn on the map. This gives
  players the context for why routing is nudging them toward that area.
- No new callables. No Firestore schema changes — `run.hotZone` already carries center/radius/
  multiplier/expiry; the routing function and the map component just start reading it.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `hot-zone-bonus`: adds a requirement that smart routing biases task assignment toward the
  active hot zone, and implements the already-specified "zone drawn on the map" participant
  requirement (previously spec'd but not built).

## Impact

- `functions/src/routing/assignNextTask.ts` — routing score formula gains a hot-zone bonus term
  for both scoring presets; needs the run's `hotZone` (already loaded alongside the run doc in
  this function's call path) and each candidate task's resolved location.
- `packages/shared/src/hotZone.ts` — may gain a small shared helper (e.g. a distance-to-zone or
  in-zone check) reused by both the routing bonus and the existing multiplier check, to avoid
  duplicating the haversine/radius logic.
- `apps/play-web/src/components/NavMap.tsx` — draw a circle layer for the active hot zone,
  sourced from `run.hotZone` (already available to the participant via `getMyTeamState`/live run
  read — same data already used by `InRunAlerts.tsx`).
- Test coverage: a new pure-logic test for the routing bonus term (`scripts/test-*.ts` or a
  co-located vitest file next to `assignNextTask.ts`), plus an `e2e-verify.mjs` scenario
  extension confirming a team is preferentially routed into an active hot zone without breaking
  the existing station-contention / leaderboard invariant scenarios.
