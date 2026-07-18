# PLAN — fix-territory-map-visibility

## Summary
Territory zones are invisible on the participant map, so players couldn't find the capture radius →
8× `failed-precondition` "Not within the zone" in the playtest log. The "couldn't re-capture" report
is the same root cause, NOT a state bug: `canCapture` lets any non-holder flip, and the e2e already
proves it. Fix = draw holder-colored zone circles on `NavMap`. UI-only, no backend change.

## Re-capture conclusion
- `packages/shared/src/captureZone.ts:26` — `canCapture` = `zone.ownerTeamId !== teamId` → every
  non-holder may flip. Only the current holder is refused.
- `functions/src/runs/index.ts:1775-1781` — `captureZone` rejects only "own zone" and "out of radius"
  (both `failed-precondition`).
- `scripts/e2e-verify.mjs:2415-2423` — already asserts A-can't-self-recapture + out-of-radius-rejected
  + **B-flips-A**. Working, tested. → No backend fix, no new e2e assertion.

## Exact files
1. `apps/play-web/src/components/NavMap.tsx` — add zone overlay (main work).
2. `apps/play-web/src/screens/PlayScreen.tsx` — lift zone fetch; pass `zones`/`myTeamId` to NavMap;
   make `ZonesPanel` presentational; widen map-mount gate.
3. `apps/play-web/src/i18n.ts` — only if a new visible string is added (reuse `t.zones.*` where
   possible); run `i18n:check`.

## NavMap zone-layer sketch (mirror the hot-zone overlay)
- New props: `zones?: CaptureZone[]`, `myTeamId?: string`. Refs `zonesRef`, `myTeamIdRef` for the
  `styledata` closure.
- `const ZONES_SOURCE = 'capture-zones';`
- `zoneColor(z, myTeamId)` → mine `#22C55E`, rival `#EF4444`, open `#94A3B8` (static hex).
- `applyZones(m)`: build one `FeatureCollection` of `circlePolygonGeoJSON(z.center, z.radiusMeters)`
  features, each `properties: { color, title }`; add `capture-zones` source + `fill`
  (`'fill-color': ['get','color']`, `'fill-opacity': 0.18`) and `line` (`'line-color': ['get','color']`,
  `'line-width': 2`) layers. Remove source/layers when empty. Same add/update/remove shape as
  `applyHotZone`.
- Re-apply: call `applyZones` inside the existing `styledata` handler AND a dedicated effect keyed on
  `[JSON.stringify(zones.map(z=>[z.id,z.ownerTeamId,z.radiusMeters,z.center?.lat,z.center?.lng])), myTeamId]`.
- Center-label markers: one 🚩 HTML marker per zone with `Popup.setText(z.title)`, in a `zoneMarkers`
  ref, synced in the same effect.
- Empty-state guard: `if (valid.length === 0 && (zones ?? []).length === 0)`. Map create `center`/
  `zoom` and fit-bounds fall back to / extend with zone centers.

## Data plumbing
`getRunZones` (unchanged) → `PlayScreen` `zones` state (`reloadZones` on mount + after capture) →
props into BOTH `NavMap` (`zones` + `myTeamId={team.id}`) and `ZonesPanel` (`zones` + `reloadZones`).
`captureZone` (unchanged) on success calls `reloadZones()` so map + list refresh together.
Map-mount gate widened to `activeStage || zones.length > 0`.

## e2e assertion
None added — backend untouched. Existing zone scenario (`scripts/e2e-verify.mjs:2388-2429`) remains
the re-capture / flip / out-of-radius regression guard.

## Constraints honored
- MapLibre stays behind `React.lazy` (NavMap already lazy in PlayScreen); no eager map import.
- UI strings via `t.*`; static Tailwind class strings only; zone colors are hardcoded hex in JS paint
  (not `bg-${x}`), so no dynamic Tailwind.

## Gates
`npm run typecheck` · `npm run lint` · `npm test` (incl. no-dashes) · `npm run i18n:check` ·
`npm run creator:build` · `npm run play:build`. Preview-verify the map circle + recolor-on-capture.
No emulator gate required.
