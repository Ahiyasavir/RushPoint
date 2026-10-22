# Design
- D1 Clustering is single-linkage on haversine distance (Turf's clustersDbscan with minPoints 1),
  written in ~20 lines over `haversineKm` rather than adding Turf as a dependency.
- D2 Route: nearest neighbour then 2-opt with both ends fixed. At most 6 areas (closest merged), so
  exact enough and instant.
- D3 Stage floor 2 (the composer's MIN_MISSIONS_PER_STAGE): borrow a pin-less mission, else merge into
  the route neighbour.
- D4 Partial completion keeps the game's required/offered ratio; requiredTaskCount is always explicit.
- D5 Arrival missions carry the id prefix `zone-arrival-` so a re-plan replaces them (idempotent), and
  a gate on one of them is not mistaken for the creator's own logic.
- D6 Copy is injected (stage title, arrival title and description), like lib/composeGame.ts.
