# Proposal — Hot zone bonus (timed location multiplier)

## Why

Live-ops levers that create sudden scrambles are pure fun and pure virality — everyone rushes, the
room buzzes. A **Hot Zone** lets the organizer drop a temporary 2× points multiplier on a location
for a few minutes; teams race there to cash in. It turns a static route into a dynamic game show.

## What Changes

> Observable behavior. A new live-ops action + a server-enforced scoring multiplier window.

- The organizer activates a **Hot Zone** from the RunConsole: a center, a radius, a multiplier
  (e.g. 2×), and a duration (e.g. 5 min). A new `activateHotZone` callable writes it to the run.
- While active, **task completions within the zone radius and time window earn multiplied points**.
  The multiplier is applied **server-side** in the scoring path (never client-asserted), validated by
  the team's server-side location and the server clock.
- Participants see a live **"🔥 Hot Zone active!"** banner with a countdown and the zone on the map.
- The zone auto-expires; the multiplier stops applying the instant the window closes.

## Capabilities

### New Capabilities
- `hot-zone-bonus`: an organizer-activated, time-boxed, geofenced scoring multiplier enforced
  server-side, with a live participant banner + map indicator.

### Modified Capabilities
<!-- The scoring path reads an active hot zone and multiplies eligible task scores. -->

## Surfaces touched

- **Callable:** new `activateHotZone(runId, center, radiusM, multiplier, durationMin)` +
  `deactivateHotZone(runId)` in `functions/src/runs/index.ts`. Writes `run.hotZone`.
- **Scoring:** the completion-scoring path reads `run.hotZone`; if the completion is within radius +
  window, multiply the earned score. Pure `hotZoneMultiplier(hotZone, coords, nowMs)` helper.
- **shared types:** `HotZone { center, radiusMeters, multiplier, startedAt, expiresAt }`.
- **play-web:** Hot Zone banner + countdown + map circle. **creator-web:** RunConsole activate panel.
- **Tests:** `scripts/test-hot-zone.ts` (multiplier predicate); e2e for activation + multiplied score.

## Non-goals

- No stacking of multiple simultaneous hot zones (one active zone per run).
- No client-side multiplier application — always server-enforced.
- No retroactive multiplier (only completions during the active window count).
