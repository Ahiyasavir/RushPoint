## Why

The most replayable mechanic in AR field games (Ingress Control Fields, Pokémon GO Gyms)
is *contested territory*: teams physically claim a zone that rivals can flip, with
ownership visible live on the map and points for holding. RushPoint has geofenced check-ins
and organizer hot-zones but no per-team, contestable ownership — this adds a genuinely
competitive, spatial layer on top of the existing run.

## What Changes

- A run gains capturable **zones** (a run-scoped `…/runs/{runId}/zones/{zoneId}`
  subcollection): `{ center, radiusMeters, title, ownerTeamId, capturedAt, captureBonus }`.
  Coordinates are public (they render on the live map).
- A new **`captureZone`** callable: a team physically inside a zone's radius claims it (or
  flips it from a rival). Proximity is **re-validated server-side** (never trust client GPS);
  a transaction + min-hold guard prevents flip-flap races.
- Ownership renders live on both the creator `LiveTeamMap` and the participant `NavMap`
  (zone circles colored by owning team). The organizer authors/edits zones from the
  RunConsole (the existing `HotZonePanel` center-picker is the template) via owner
  `createZone` / `deleteZone` callables.
- **Scoring**: at `finalizeRun` (and live in `refreshLeaderboard`), each zone's final owner
  gets its `captureBonus`, folded into the raw score via `buildRankings` so live/final can't
  drift. (Flat capture/hold bonus — no per-minute scheduler in v1.)

## Capabilities

### New Capabilities
- `territory-capture`: run-scoped capturable zones, a server-validated `captureZone`
  claim/flip callable, owner zone authoring, live-map ownership rendering, and a finalize
  capture bonus.

## Non-goals
- No continuous "points per minute held" (needs a scheduled function — deferred; v1 is a
  flat capture/hold-at-finalize bonus).
- No zones on the game TEMPLATE (ownership is live per-run state).
- No AR camera overlay (separate concern).

## Surfaces touched
- **shared:** `captureZone.ts` (`CaptureZone` type, `isWithinZone`, capture/flip state +
  bonus math — pure, unit-tested); `FIRESTORE_PATHS.zone`/`zonesCol`.
- **functions:** `captureZone` + `createZone`/`deleteZone` in `runs/index.ts` (+ re-exports);
  scoring hook in `buildRankings`.
- **rules:** `match /zones/{id}` — `read: if isAuthenticated()`, `write: if false` (CF-only).
- **creator-web / play-web:** zone authoring panel + live-map circles; `calls.ts` wrappers; i18n.
- **Tests:** `scripts/test-capture-zone.ts` (capture/flip/idempotence + bonus); e2e cloned
  from the hot-zone scenario (A captures, B flips, out-of-radius rejected, finalize bonus);
  authz matrix entry.
