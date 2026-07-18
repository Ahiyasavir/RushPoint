# Proposal: fix-territory-map-visibility

## Why

A real family playtest of the **territory-capture** feature failed on the ground: capturable zones
were **invisible on the participant map**. The `ZonesPanel` in `PlayScreen` lists each zone's title
and holder, but the actual geographic circles (center + radius) are **never drawn on `NavMap`** —
`NavMap` only renders task pins, the "me" dot, and the organizer hot-zone. Players had no idea where
to physically stand, so the server's `isWithinZone` GPS precondition kept failing: the run log shows
**8× `failed-precondition` "Not within the zone"** from `captureZone`.

This also fully explains the second complaint ("a player couldn't re-capture a territory after
someone else took it"). We verified the capture/flip logic and it is **correct**:
`canCapture(zone, teamId)` in `packages/shared/src/captureZone.ts:26` returns
`zone.ownerTeamId !== teamId`, i.e. **any non-holder may flip the zone**; the only rejections are
"you already hold it" (own zone) and "not within the zone" (out of radius), both `failed-precondition`.
The e2e suite already proves the flip works end-to-end (`scripts/e2e-verify.mjs:2415-2423`: A cannot
re-capture its own zone, out-of-radius is rejected, **B flips A's zone**). So the "couldn't
re-capture" report was **not a state bug** — the player simply wasn't standing inside the (unseen)
radius. **No backend change is warranted.** The fix is to draw the zones on the map.

## What Changes

- **Draw zones on `NavMap`.** Add a `zones` (and `myTeamId`) prop to `NavMap` and render each zone as
  a metres-accurate circle (fill + outline) using the exact MapLibre GeoJSON pattern already proven
  by the hot-zone overlay (`circlePolygonGeoJSON` + a `fill`/`line` layer pair, re-applied on
  `styledata` so a tile-style toggle doesn't wipe it). Circle color is keyed by holder:
  **mine** (accent/green), **rival** (fire red), **open** (neutral grey). A small center label marker
  carries the zone title, matching how task pins render.
- **Plumb zone data up one level.** Lift the `getRunZones` fetch out of `ZonesPanel` into the
  `PlayScreen` body so a single `zones` array feeds **both** the map and the list, and both refresh
  together after a capture. `ZonesPanel` receives `zones`/`reload` as props.
- **Show the map when a run has zones**, even if the active stage has no located task pin: the
  `NavMap` mount guard and its internal empty-state both consider zones, so a zone-only stop still
  shows a map to navigate by.

## Non-goals

- **No capture/flip logic change.** `canCapture` is correct; re-capture already works. No
  `captureZone`/`getRunZones` signature or behavior change.
- No creator-side `LiveTeamMap` zone rendering (that surface already had zone plumbing in the
  original change; this fix targets the **participant** map the playtesters used).
- No per-minute hold scoring, no map-pick zone authoring (both already deferred by territory-capture).

## Capabilities

### New Capabilities
- `territory-map-visibility`: capturable zones render as holder-colored circles on the participant
  `NavMap`, so players can see where to stand to capture/flip a zone.

## Impact

- **Surfaces touched (UI only):** `apps/play-web/src/components/NavMap.tsx` (new zone layer +
  `zones`/`myTeamId` props, empty-state guard), `apps/play-web/src/screens/PlayScreen.tsx` (lift zone
  fetch; pass `zones` to `NavMap` and `ZonesPanel`), `apps/play-web/src/i18n.ts` (zone map label key
  if any new visible string). No backend, shared, or rules change.
- **Tests:** UI is verified via the preview tools (no component runner), per the house rule. The
  re-capture path is already covered by the existing zone e2e scenario; this change adds no backend
  seam, so no new e2e assertion is required. Gates: typecheck · lint · i18n:check · no-dashes ·
  creator:build · play:build.
