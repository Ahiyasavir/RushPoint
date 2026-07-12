# Design: fix-territory-map-visibility

## Re-capture investigation (conclusion first)

**Not a state bug — the capture/flip logic is correct.** The playtest note "a player couldn't
re-capture a territory after another player captured it" is a direct symptom of the map-visibility
defect, not of the capture rule.

- `packages/shared/src/captureZone.ts:26` — `canCapture(zone, teamId)` returns
  `zone.ownerTeamId !== teamId`. **Every non-holder is allowed to flip.** The holder is the only team
  refused, with `failed-precondition` "Your team already holds this zone".
- `functions/src/runs/index.ts:1775-1781` — `captureZone` rejects only two ways, both
  `failed-precondition`: (a) `!canCapture(...)` (own zone), (b) `!isWithinZone(...)` (out of radius).
- `scripts/e2e-verify.mjs:2408-2423` already proves the happy path end-to-end: A captures, A **cannot**
  re-capture its own zone, out-of-radius is rejected, and **B flips A's zone** (`zone: B flips
  ownership`). So a non-holder re-capturing an enemy zone is a tested, working path.

Therefore the 8× `failed-precondition` "Not within the zone" in the run log are pure out-of-radius
GPS failures: the player didn't know where the radius was because the zone was never drawn. Fixing the
map removes the root cause. **No `captureZone` fix and no new e2e assertion are needed** (the existing
scenario already asserts flip + out-of-radius rejection).

## Files touched (UI only — MapLibre stays lazy)

### `apps/play-web/src/components/NavMap.tsx`
Add two props and a zone overlay mirroring the existing hot-zone overlay (same `circlePolygonGeoJSON`
+ `fill`/`line` GeoJSON-layer approach, same `styledata` re-application so a tile-mode toggle doesn't
wipe it).

```ts
import type { CaptureZone } from '@rushpoint/shared';
const ZONES_SOURCE = 'capture-zones';

// new props
zones?: CaptureZone[];
myTeamId?: string;
```

Color per holder (static hex, no runtime Tailwind interpolation):
```ts
function zoneColor(z: CaptureZone, myTeamId?: string): string {
  if (z.ownerTeamId && z.ownerTeamId === myTeamId) return '#22C55E'; // mine  (green)
  if (z.ownerTeamId) return '#EF4444';                               // rival (red)
  return '#94A3B8';                                                  // open  (grey)
}
```

`applyZones(m)` — same shape as `applyHotZone`, but builds a **FeatureCollection** (one polygon per
zone) so all circles live in one source/layer pair:
```ts
function applyZones(m: maplibregl.Map) {
  if (!m.isStyleLoaded()) return;
  const zs = zonesRef.current.filter((z) => isValidCoord(z.center?.lat, z.center?.lng));
  const src = m.getSource(ZONES_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (zs.length === 0) {
    if (m.getLayer(`${ZONES_SOURCE}-fill`)) m.removeLayer(`${ZONES_SOURCE}-fill`);
    if (m.getLayer(`${ZONES_SOURCE}-line`)) m.removeLayer(`${ZONES_SOURCE}-line`);
    if (src) m.removeSource(ZONES_SOURCE);
    return;
  }
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zs.map((z) => {
      const poly = circlePolygonGeoJSON(z.center, z.radiusMeters) as GeoJSON.Feature;
      poly.properties = { color: zoneColor(z, myTeamIdRef.current), title: z.title };
      return poly;
    }),
  };
  if (src) { src.setData(data); return; }
  m.addSource(ZONES_SOURCE, { type: 'geojson', data });
  m.addLayer({ id: `${ZONES_SOURCE}-fill`, type: 'fill', source: ZONES_SOURCE,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } });
  m.addLayer({ id: `${ZONES_SOURCE}-line`, type: 'line', source: ZONES_SOURCE,
    paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
}
```

Wiring, matching the hot-zone precedent exactly:
- `const zonesRef = useRef(zones ?? []); zonesRef.current = zones ?? [];` and a `myTeamIdRef` (so the
  `styledata` closure reads the latest values).
- Extend the existing `styledata` handler to also call `applyZones(map.current)` (re-applies after a
  `setStyle` tile-mode switch, which wipes GeoJSON layers).
- A dedicated effect keyed on a cheap serialization re-applies on data change without a style switch:
  `useEffect(() => { if (map.current) applyZones(map.current); },
   [JSON.stringify((zones ?? []).map((z) => [z.id, z.ownerTeamId, z.radiusMeters, z.center?.lat, z.center?.lng])), myTeamId]);`
- **Center-label markers:** render one HTML marker per zone at its center carrying the title
  (reuse the target-marker pattern: a small `🚩` element with a `Popup` `.setText(z.title)`), stored in
  a `zoneMarkers` ref and re-synced in the same effect. Keeps the title legible without a symbol-font
  dependency.
- **Empty-state + framing:** the current `if (valid.length === 0)` placeholder becomes
  `if (valid.length === 0 && (zones ?? []).length === 0)`. Map creation `center`/`zoom` and the
  fit-bounds pass fall back to the first zone center when there are no task targets, and extend the
  bounds with every zone center so the circles are framed.

### `apps/play-web/src/screens/PlayScreen.tsx`
Lift the zone fetch so map and list share one source of truth:
- Add `const [zones, setZones] = useState<CaptureZone[]>([]);` in the main component and a
  `reloadZones` callback that calls `getRunZones({ ownerUid, gameId, runId })` (best-effort; `[]` on
  error, exactly as `ZonesPanel` does today). Load on mount and after a successful `capture`.
- `ZonesPanel` becomes presentational: it receives `zones` + `reloadZones` as props instead of
  fetching itself (its `capture()` calls `captureZone` then `reloadZones()`), so the list and the map
  update together after a flip.
- Pass `zones` + `myTeamId={team.id}` into `NavMap`:
  `<NavMap targets={targets} me={me} hotZone={state.run.hotZone} zones={zones} myTeamId={team.id} accent={accent} className="h-52 mb-4" />`.
- Widen the map-mount gate so a zone-only stop still shows a map:
  `{(activeStage || zones.length > 0) && (<Suspense …><NavMap …/></Suspense>)}`.

### `apps/play-web/src/i18n.ts`
Only if a new **visible** string is added (e.g. a map legend/aria label for the zone layer): add the
key to BOTH `he` and `en` and read via `t.*`. The existing `t.zones.*` keys already cover the list;
prefer reusing them. No dash separators in copy. Run `npm run i18n:check` after the edit.

## Data flow

```
getRunZones (existing callable, unchanged)
   └─> PlayScreen: zones state  ──> NavMap (zones + myTeamId)  → holder-colored circles + title labels
                                └─> ZonesPanel (zones + reloadZones) → list + Capture button
captureZone (existing, unchanged) ──on success──> reloadZones() → both map + list refresh
```

## Test strategy

- **UI verification (house rule):** exercise `PlayScreen`/`NavMap` via the preview tools — a run with
  a zone shows a colored circle + title on the map; after a capture the circle recolors to "mine".
  No component test runner exists.
- **Backend:** untouched, so **no new e2e assertion**. The existing zone scenario
  (`scripts/e2e-verify.mjs:2388-2429`) already covers capture / no-self-recapture / out-of-radius /
  **flip** and remains the regression guard for the (correct) re-capture logic.
- **i18n:** `npm run i18n:check` must be clean after any string touch (PART A hard gate).

## Gates

`npm run typecheck` · `npm run lint` · `npm test` · `npm run i18n:check` · `npm run creator:build` ·
`npm run play:build`. (No emulator gate needed — this change adds no callable and no backend seam.)
