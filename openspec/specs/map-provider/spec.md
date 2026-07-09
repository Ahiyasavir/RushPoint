# map-provider

## Purpose

The map rendering stack for RushPoint — MapLibre GL JS with MapTiler vector tiles and a keyless
raster fallback. Captures both the runtime behavior and the recorded provider decision (Google Maps
evaluated and rejected on cost + dependency grounds).

## Requirements

### Requirement: Maps render with zero configuration
The map layer SHALL render without any API key or billing account, using a keyless raster fallback,
and SHALL optionally upgrade to MapTiler vector tiles when `VITE_MAPTILER_KEY` is set.

#### Scenario: No key renders the keyless fallback
- **WHEN** `resolveMapStyle()` is called with no key
- **THEN** it returns a `version: 8` style backed by the keyless OpenTopoMap raster source (topo) or
  the Esri World Imagery source (satellite)

#### Scenario: Key upgrades to MapTiler vector
- **WHEN** `resolveMapStyle('KEY', 'topo')` is called
- **THEN** it returns a MapTiler `outdoor` style URL containing the key; `satellite` returns `hybrid`

### Requirement: Provider decision is recorded
The decision to keep MapLibre (and reject the Google Maps migration) SHALL be documented so future
contributors do not re-litigate it without the cost/dependency context.

#### Scenario: Decision is discoverable
- **WHEN** a contributor reads the Maps section of `TECH_SPEC.md`
- **THEN** it references the assessment and states that `VITE_MAPTILER_KEY` is optional
