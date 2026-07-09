## 1. Assessment (decision of record)

- [x] 1.1 Confirm the feasibility assessment in `design.md` is complete (cost, dependency, parity,
  blast radius) and the decision is "keep MapLibre".
- [x] 1.2 Add a short note to `TECH_SPEC.md` Maps section: "Evaluated Google Maps; kept MapLibre +
  MapTiler keyless fallback (see change map-provider-decision). VITE_MAPTILER_KEY is optional."

## 2. RED — Failing map-style test

- [x] 2.1 Create `scripts/test-map-style.ts` asserting `resolveMapStyle()` keyless object shape,
  satellite Esri object, and MapTiler URL (outdoor/hybrid) when a key is passed. Run `npm test`;
  confirm RED only if behavior differs (it should already pass — this is a regression lock; if it
  passes immediately, record it as a characterization guard). _(Passes immediately — recorded as a
  characterization guard, per the task's own note.)_

## 3. GREEN — Optimization pass

- [x] 3.1 Confirm MapLibre is `React.lazy`-loaded in `LocationPicker`, `RoutePreviewMap`, `NavMap`.
  _(Confirmed — documented in TECH_SPEC §20 / §21.)_
- [x] 3.2 Memoize style resolution + marker arrays; re-fit bounds only when coordinates change.
- [x] 3.3 Verify raster `maxzoom` + `attribution` for OpenTopoMap (CC-BY-SA) and Esri.

## 4. Verify

- [x] 4.1 `npm run typecheck` — 0 errors. _(5/5 workspaces green.)_
- [x] 4.2 `npm test` — map-style test green. _(Pure-logic lane: 13 files green.)_
- [x] 4.3 `npm run creator:build` — production build passes (and bundle still splits the map chunk).
  _(Built in 14.31s; `MapModeToggle` map chunk split out at 803 kB, separate from `index`.)_
- [ ] 4.4 Preview both apps' maps with and without `VITE_MAPTILER_KEY`; confirm topo + satellite +
  attribution. _(MANUAL sign-off — not run in this archive pass; left open for a human preview check.)_
