# Proposal — Surprise trivia waypoints (hidden geofenced POIs)

## Why

The current game structure is entirely **planned** — participants know every task in advance via the
route map. There is no element of surprise. Adding **hidden Points of Interest** that only reveal
themselves when a participant physically walks near them creates a completely different experience:
curiosity, discovery, and the "how did I not know that?" moment that is perfect for bar-mitzvah
tours, city walks, and heritage routes.

These are not part of the main race scoring — they are **optional bonus encounters** that reward
participants who happen to walk past a landmark. A clever creator plants them; no participant expects
them; everyone talks about them after.

## What Changes

> Observable behavior. Additive capability — zero impact on existing game/run/task flow.

**Creator side (Builder)**
- A new **"Discovery POIs"** panel in the Builder lets a creator place hidden geofenced POIs on the
  map, each with: location, radius, a trivia question (quiz or open text), correct answer(s), bonus
  points, and optional flavor text ("You're standing near the oldest well in the city…").
- A **"Suggest POIs"** smart button queries the Overpass API (OpenStreetMap free tier) for historic,
  cultural, and heritage landmarks near the game's route and presents them as one-click add cards.
- POIs are stored as a separate subcollection `games/{ownerUid…}/discoveryPois/{poiId}` — not tasks.
  They are **never shown** on the participant's route map or task list.

**Participant side (Play)**
- The play-web runs a **background geofence watcher** against the active run's loaded POIs. When a
  team enters a POI radius for the first time, a **surprise overlay** slides up ("🗺️ Discovery!
  You're near [flavor text]…") with the trivia question.
- Answering correctly awards bonus points via a new `claimDiscoveryPoi` callable (server-validates
  proximity again + idempotency). The bonus appears in the score and the final leaderboard.
- Each POI can be triggered at most once per team; already-triggered POIs are silently skipped.
- POI locations are **never sent to clients** before triggering — only the answer prompt is revealed
  upon proximity. The server re-validates coordinates on `claimDiscoveryPoi`.

**Smart suggestions**
- During Builder route setup, a "Suggest nearby POIs" call to the Overpass API (client-side,
  free, no API key) finds `tourism=*, historic=*, amenity=place_of_worship` nodes within 300 m of
  any game task. Results are shown as add-cards with the OSM name + category — the creator writes
  the trivia question, the system supplies the location.

## Capabilities

### New Capabilities
- `discovery-pois`: hidden geofenced POIs that trigger a trivia overlay when a participant enters
  their radius; bonus points via a server-validated `claimDiscoveryPoi` callable; smart Overpass
  suggestions in the Builder.

### Modified Capabilities
<!-- None — the scoring helpers absorb bonus points via the existing `bonusPenalty` field (inverted). -->

## Surfaces touched

- **Firestore:** new subcollection `users/{ownerUid}/games/{gameId}/discoveryPois/{poiId}` (client
  read for the creator; **server-read only** for play clients — coordinates never sent to clients).
  New `FIRESTORE_PATHS.discoveryPoisCol` + `discoveryPoi` path helpers.
- **shared types:** `DiscoveryPoi` interface; `DiscoveryPoiResult` (safe, coordinate-stripped);
  `TeamDiscoveryState` (per-team map of `{[poiId]: 'triggered' | 'answered' | 'missed'}`).
- **Callable:** `claimDiscoveryPoi(runId, poiId, coords, answer)` in `functions/src/runs/index.ts`.
  Server re-validates proximity (`haversineKm` < radius) + idempotency + answer + credits bonus.
- **Callable:** `getRunDiscoveryPois(runId)` (coordinate-stripped for play clients) + creator's full
  version in the Builder.
- **play-web:** background geofence watcher (reuses `updateLocation` GPS feed); discovery overlay
  component; `TeamDiscoveryState` in `store.ts`; loads POIs on run start.
- **creator-web:** Builder "Discovery POIs" panel; Overpass suggestion helper
  `queryOverpassPois(bounds)` (client-side fetch, no API key, no server round-trip).
- **Firestore rules:** `discoveryPois` subcollection — creator read/write; play clients: **list/get
  denied** (coordinates must not leak); Cloud Functions Admin SDK reads freely.
- **Tests:** `scripts/test-discovery-poi.ts` (proximity math, answer match, idempotency predicate,
  Overpass query builder); e2e for `claimDiscoveryPoi`.

## Non-goals

- **No AI-generated trivia** — the creator writes the question; OSM supplies the location.
- **No POI sharing** between games or a POI library — single-game scope.
- **No offline POI triggering** — proximity check requires a server round-trip on `claimDiscoveryPoi`
  (GPS spoofing prevention).
- **No impact on finalizeRun / buildRankings** beyond absorbing the bonus via the existing
  `bonusPenalty` mechanism (inverted as a bonus credit, already in the scoring model).
