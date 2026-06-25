# Proposal — Safe zone boundary

## Why

When running a game for kids across a city, an organizer's biggest fear is a team wandering out of
the intended area. A **safe zone** — a geographic boundary the organizer defines — that automatically
raises an alert (and pauses the team) when a team crosses it turns a safety worry into a managed,
visible signal. It is a trust feature that makes RushPoint viable for youth events.

## What Changes

> Observable behavior. A boundary config + server-side breach detection wired into the existing SOS.

- The creator defines a **safe zone** for a game/run: a center + radius (or, later, a polygon).
- The server-side location update path **detects a breach** — when a team's reported location is
  outside the safe zone — and raises an **automatic alert** to the organizer (reusing the existing
  `triggerSOS` / alerts surface) and flags the team as out-of-bounds.
- The participant sees a clear **"You've left the play area — head back"** warning; the team's play is
  **soft-paused** (no new task assignment) until they return inside the zone.
- Breach detection is **server-side** (never client-trusted) using the same location feed.

## Capabilities

### New Capabilities
- `safe-zone`: an organizer-defined geographic boundary with server-side breach detection that
  auto-alerts the organizer and soft-pauses an out-of-bounds team.

### Modified Capabilities
<!-- The location-update path checks the safe zone and raises an alert / sets out-of-bounds state. -->

## Surfaces touched

- **shared:** `Game.safeZone { center, radiusMeters }`; pure `isOutsideSafeZone(coords, safeZone)`
  helper — the TDD lever (reuses `haversineKm`).
- **Callable:** `updateLocation` (root `functions/src/index.ts`) extended — on a breach, write an
  alert (reuse the `triggerSOS` alert shape) and set the team's `outOfBounds` flag.
- **play-web:** out-of-bounds warning banner; pause new task assignment while out of bounds.
  **creator-web:** safe-zone config in the Builder + an out-of-bounds indicator in the RunConsole map.
- **Tests:** `scripts/test-safe-zone.ts` (breach predicate); e2e for auto-alert + pause.

## Non-goals

- No hard kick/disable of a team (soft-pause + alert only — the organizer decides).
- No polygon zones in this change (circular center+radius first; polygon is a follow-up).
- No reliance on client-asserted "I'm inside" — breach is computed server-side.
