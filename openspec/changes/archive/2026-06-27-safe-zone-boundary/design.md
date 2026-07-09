# Design — Safe zone boundary

## Current behavior

- `updateLocation` (root `functions/src/index.ts` ≈L195) writes the team's location. `triggerSOS`
  (L205) writes an alert that the organizer acknowledges. `haversineKm` available.
- Routing assigns the next task; a soft pause means skipping assignment while out of bounds.

## Approach

### Pure helper → `packages/shared/src` (the TDD lever)

```ts
isOutsideSafeZone(coords: GeoPoint, safeZone: { center: GeoPoint; radiusMeters: number }): boolean
  // haversineKm(coords, center) * 1000 > radiusMeters
```

Tested in `scripts/test-safe-zone.ts`: inside → false; on boundary → false; outside → true; invalid
coords → throws `LocationError`; no safe zone configured → treated as always-inside by the caller.

### updateLocation integration

On each location update, if the run's game has a `safeZone` and `isOutsideSafeZone(coords, safeZone)`:
- set `team.outOfBounds = true`;
- if it is a new breach (transition false→true), write an alert (reuse the `triggerSOS` alert shape,
  flagged `type: 'safe_zone_breach'`).
On return inside, clear `team.outOfBounds`. The routing/assignment path skips assigning new tasks
while `outOfBounds` is true (soft pause).

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-safe-zone.ts`: the breach predicate cases above.
- **e2e** → send an out-of-zone location → an alert is created + `team.outOfBounds` true + no new task
  assigned; send an in-zone location → flag cleared + assignment resumes.
- **UI (preview):** participant out-of-bounds banner; RunConsole map shows the team flagged.

## Conventions

- Breach computed server-side (Appendix A rule 12 — never trust client location/completion).
- Reuses the existing alert surface (no parallel alert system). `FIRESTORE_PATHS`, no dotted-array writes.
- `safeZone` is a single nested object on the game.
