# Proposal — Map provider decision: keep MapLibre + optimize (Google Maps assessed, rejected)

## Why

We were asked to evaluate whether replacing the current map stack (MapLibre GL + MapTiler vector
styles, with a keyless OpenTopoMap/Esri raster fallback) with Google Maps is realistic,
architecturally sound, and smarter for the ecosystem. This change records that **feasibility
assessment** (see `design.md`) and acts on its conclusion.

## What Changes

> Outcome: **keep MapLibre** (migration rejected on cost + dependency grounds) and do a small
> optimization pass. No user-visible map behavior changes beyond being leaner.

- A documented assessment (in `design.md`) comparing Google Maps JS API vs the current stack on
  cost, setup/dependency, RTL/Hebrew, topo/satellite needs, and migration blast radius.
- Conclusion: keep MapLibre + MapTiler with the keyless fallback; Google Maps adds a hard API-key +
  billing dependency and per-load cost for no functional gain for a field-race product.
- A focused optimization pass on the existing map layer (lazy-load confirmation, fewer re-renders,
  attribution/`maxzoom` correctness, documenting `VITE_MAPTILER_KEY` as optional).

## Capabilities

### New Capabilities
- `map-provider-optimized`: the existing MapLibre stack, confirmed zero-config and tuned, with the
  provider decision documented for the record.

## Surfaces touched

- **docs / design:** the assessment lives in this change's `design.md`; a short note added to
  `TECH_SPEC.md` Maps section ("evaluated Google Maps; kept MapLibre, see this change").
- **shared:** `scripts/test-map-style.ts` pins `resolveMapStyle()`'s zero-config + keyed behavior.
- **creator-web / play-web:** light optimization of map components (`LocationPicker`,
  `RoutePreviewMap`, `NavMap`) only — no provider swap.
- **No callable change**, no new runtime dependency.

## Non-goals

- No migration to Google Maps (explicitly rejected by the assessment).
- No new paid API key requirement; the keyless fallback stays the default.
- No redesign of map UX; this is a provider decision + tune-up only.
