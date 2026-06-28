# Design — Surprise trivia waypoints

## Current behavior (authoritative refs)

- `TaskType = 'field' | 'smart_station' | 'photo' | 'self_report' | 'quiz' | 'numeric' | 'geofence' | 'sequence'`
  (`packages/shared/src/types/index.ts` L102). POIs are NOT a task type — they are a separate entity.
- `haversineKm(a, b)` in `packages/shared/src/geo.ts` — used today in `submitTaskAnswer` (L874–880
  of `functions/src/runs/index.ts`) for geofence task validation. Reused for POI proximity.
- Scoring: `buildRankings()` sums `earnedScore + completionBonus - bonusPenalty`. Discovery bonuses
  will be credited to `earnedScore` on the team doc via the `claimDiscoveryPoi` transaction.
- Firestore rules: `discoveryPois` subcollection doesn't exist yet — must add allow creator
  read/write, deny play-client list/get (Admin SDK bypasses rules).

## Data model

### `DiscoveryPoi` (creator-facing, stored server-side)

```ts
interface DiscoveryPoi {
  id: string;
  coordinates: GeoPoint;         // NEVER sent to play clients
  radiusMeters: number;          // default 30
  question: string;              // trivia prompt shown in overlay
  answers: string[];             // correct answer(s) — server-secret (stripped in DiscoveryPoiResult)
  bonusPoints: number;
  flavorText?: string;           // "You're standing near…" intro shown before the question
  osmNodeId?: string;            // if suggested by Overpass
  createdAt: string;
}
```

### `DiscoveryPoiResult` (play-client-safe, coordinate-stripped)

```ts
interface DiscoveryPoiResult {
  id: string;                    // needed for claimDiscoveryPoi call
  radiusMeters: number;          // NOT coordinates — client never knows the location
  // coordinates and answers intentionally absent
}
```

The play client only receives `DiscoveryPoiResult[]` after joining. Proximity is checked
**server-side** by having the client pass its current GPS in `claimDiscoveryPoi`. This is the same
model as `geofence` task validation.

### `TeamDiscoveryState` per team

```ts
interface TeamDiscoveryState {
  [poiId: string]: 'triggered' | 'answered' | 'missed';
}
```

Stored as `team.discoveryState` map. A POI moves `undefined → triggered` when the overlay fires
(client-only optimistic update), then `answered` when `claimDiscoveryPoi` returns success.

### FIRESTORE_PATHS additions

```ts
discoveryPoisCol: (ownerUid, gameId) => `users/${ownerUid}/games/${gameId}/discoveryPois`
discoveryPoi:     (ownerUid, gameId, poiId) => `users/${ownerUid}/games/${gameId}/discoveryPois/${poiId}`
```

## Pure helpers (the TDD lever) → `packages/shared/src`

```ts
isWithinPoiRadius(teamCoords: GeoPoint, poi: { coordinates: GeoPoint; radiusMeters: number }) → boolean
  // haversineKm(teamCoords, poi.coordinates) * 1000 <= poi.radiusMeters

matchesDiscoveryAnswer(input: string, answers: string[]) → boolean
  // normalised: trim + lowercase + strip diacritics; true if any answer matches

buildOverpassQuery(bounds: {north,south,east,west}: BoundingBox, tags: string[]) → string
  // returns a valid Overpass QL query string for the given bbox + OSM tag list;
  // used client-side in the Builder suggestion flow; tested by string pattern.

isPoiAlreadyClaimed(discoveryState: TeamDiscoveryState, poiId: string) → boolean
  // discoveryState[poiId] === 'answered'
```

## Callables

### `getRunDiscoveryPois(runId)` (new, `functions/src/runs/index.ts`)

Auth: `requireAuth`. Reads `games/{ownerUid}/{gameId}/discoveryPois` and returns
`DiscoveryPoiResult[]` (strips `coordinates` + `answers`). Also used by the Builder with the
creator's auth to return the full `DiscoveryPoi[]`.

### `claimDiscoveryPoi(runId, poiId, coords, answer)` (new, `functions/src/runs/index.ts`)

Auth: `requireAuth`. Flow:
1. Load the run → resolve `ownerUid/gameId` via `accessCode` already on the team doc.
2. Load the `DiscoveryPoi` (Admin SDK — coordinates accessible).
3. `isWithinPoiRadius(coords, poi)` → if false, throw `failed-precondition`.
4. `isPoiAlreadyClaimed(team.discoveryState, poiId)` → if true, throw `already-exists` (idempotent).
5. `matchesDiscoveryAnswer(answer, poi.answers)` → compute result.
6. In a transaction: update `team.discoveryState[poiId] = 'answered'`; if correct, increment
   `team.earnedScore += poi.bonusPoints`.
7. Return `{ correct: boolean, bonusPoints: number | 0 }`.

## Builder — Overpass suggestions

`apps/creator-web/src/lib/overpassPois.ts` (new): `queryOverpassPois(bounds, tags)`:
- Builds the Overpass QL string via `buildOverpassQuery`.
- Fetches `https://overpass-api.de/api/interpreter` (client-side, free, no API key).
- Returns a list of `{ osmId, name, coordinates, category }`.
- Rate-limited: one request per Builder "Suggest" action, with a loading state.
- The UI shows up to 10 cards; creator adds them as `DiscoveryPoi` stubs with an empty `question`.

## Firestore rules addition

```
match /users/{ownerUid}/games/{gameId}/discoveryPois/{poiId} {
  allow read, write: if request.auth.uid == ownerUid;  // creator full access
  allow list, get: if false;                            // play clients: coordinates must never leak
}
```

## Test strategy (TDD — proves the change)

- **Pure (RED first)** → `scripts/test-discovery-poi.ts`:
  - `isWithinPoiRadius`: inside/on-boundary/outside; rejects invalid coords.
  - `matchesDiscoveryAnswer`: case-insensitive, trims whitespace, diacritics; no false positives.
  - `buildOverpassQuery`: returns a string containing the bbox and expected OSM tags; no injection.
  - `isPoiAlreadyClaimed`: returns true only for `'answered'`; false for `undefined`/`'triggered'`.
- **Rules** → `scripts/test-rules.mjs`: creator `get`/`list` succeeds; play-client `get`/`list`
  denied; Admin SDK reads the full doc.
- **e2e** → `scripts/e2e-verify.mjs`:
  - `claimDiscoveryPoi` with correct coords + correct answer → `{ correct: true, bonusPoints: N }`;
    team's `earnedScore` increases.
  - Correct coords + wrong answer → `{ correct: false, bonusPoints: 0 }`; score unchanged.
  - Coords outside radius → `failed-precondition`.
  - Double-claim → `already-exists`.
  - `getRunDiscoveryPois` returns `DiscoveryPoiResult[]` (no `coordinates`, no `answers`).
- **UI** → preview: Builder panel shows POI list + Overpass suggestion cards; play screen shows
  discovery overlay when triggered; correct answer grants bonus, wrong answer shows result.

## Conventions / footguns respected

- POI coordinates NEVER leave the server — `claimDiscoveryPoi` takes **team coords**, not the other
  way around. The `DiscoveryPoiResult` strips coordinates so no client reverse-engineering is possible.
- Answer keys (`answers[]`) stripped in `DiscoveryPoiResult` (same pattern as task answer keys).
- `isPoiAlreadyClaimed` + a Firestore transaction = idempotent bonus — no double-crediting.
- `buildOverpassQuery` returns a literal string; the Overpass endpoint is a public URL — no secret.
- No dotted-array writes; `discoveryState` is a flat map keyed by `poiId` (safe `.update({['discoveryState.'+poiId]: ...})`... actually use the nested object rewrite to be safe).
- `FIRESTORE_PATHS` extended with `discoveryPoisCol` / `discoveryPoi` — never hardcoded strings.
