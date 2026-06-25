## Context — current map stack

`packages/shared/src/mapStyle.ts` exposes `resolveMapStyle(maptilerKey?, mode)`:
- With a MapTiler key → vector `outdoor`/`hybrid` styles.
- Without a key → **keyless** raster fallback: OpenTopoMap (topo) / Esri World Imagery (satellite).

Maps render via MapLibre GL (open-source, BSD) behind `React.lazy` in `LocationPicker`,
`RoutePreviewMap` (creator-web) and `NavMap` (play-web). The app therefore renders maps with **zero
configuration and zero cost** today, and supports topo + satellite + RTL/Hebrew.

## Feasibility assessment — Google Maps JS API

**Cost / billing.** Google Maps Platform requires a Google Cloud **billing account and an API key to
render at all** — there is no keyless tier. Dynamic map loads are billed per use under the Maps
JavaScript API SKU; volume beyond the free allowance is charged. This converts a currently-free,
zero-setup capability into a metered external cost that scales with participant count (exactly the
dimension RushPoint grows on: many players × many map loads per run).

**Dependency / setup.** Adoption adds a hard external dependency: every deployment (and local dev,
and the playtest/cloudflared flow) would need a provisioned, billing-enabled key. Today a creator can
clone and run with no map credentials. That regression in "works out of the box" is significant for a
self-serve product and for the no-signup demo funnel.

**Functional parity.** For a field-race the map needs: pan/zoom, markers, a route line, a "you are
here" dot, topographic + satellite layers, and RTL/Hebrew. MapLibre + MapTiler already deliver all of
these. Google Maps offers richer POI/places data and Street View, **none of which the product uses**.
So migration buys no feature we need.

**Blast radius.** Migrating means rewriting `mapStyle.ts`, `LocationPicker`, `RoutePreviewMap`,
`NavMap`, the geo overlay/projection helpers, and re-testing every map surface, plus introducing the
billing/key ops above — high effort, ongoing cost, no functional gain.

**Where Google would help (and doesn't apply):** turn-by-turn navigation, places autocomplete, and
Street View. RushPoint routes players between its own task pins with straight-line distance, authors
coordinates via a picker, and does not need Street View. None of the Google advantages are on the
critical path.

## Decision

**Reject the Google Maps migration. Keep MapLibre + MapTiler with the keyless fallback.** It is free,
zero-config, already meets every functional need, and avoids a per-load cost that scales with our
growth dimension. Optional `VITE_MAPTILER_KEY` remains the only (optional) upgrade lever for prettier
vector tiles.

## Optimization pass (the actionable part)

1. Confirm MapLibre stays behind `React.lazy` in all three components (per the CLAUDE.md bundle rule);
   add a guard test/note if any import path regressed it.
2. Reduce avoidable map re-renders (memoize style resolution + marker arrays; only re-fit bounds when
   coordinates actually change).
3. Verify raster source `maxzoom` + `attribution` are correct (OpenTopoMap CC-BY-SA, Esri credit).
4. Document `VITE_MAPTILER_KEY` as **optional** in `TECH_SPEC.md`/env docs and record this decision.

## Test strategy

**Pure logic** — `scripts/test-map-style.ts` (aggregator-picked):
- `resolveMapStyle()` (no key) returns the keyless object: a `version: 8` style with an `opentopo`
  raster source.
- `resolveMapStyle(undefined, 'satellite')` returns the Esri object (`esri` source).
- `resolveMapStyle('KEY', 'topo')` returns a MapTiler `outdoor` URL string containing `key=KEY`;
  `'satellite'` returns a `hybrid` URL. Locks in the zero-config guarantee + keyed upgrade.

**UI verification:** preview both apps' maps with and without a key set; confirm topo + satellite
render and attribution shows.

## Risks / Trade-offs

- [Risk: keyless raster tile providers rate-limit at very high volume] → MapTiler key is the
  documented optional upgrade; the decision keeps that lever without making it mandatory.
- [Trade-off: forgo Google's POI/Street View] → not used by the product; no user-facing loss.
