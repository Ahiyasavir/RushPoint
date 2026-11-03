# Design

D1. Place on the task. `emit` sets `task.placeTrack = stagePlace` whenever the stage has one. Routing is
unchanged for a one-kind stage: `stickToPlaceTrack` only narrows when two sets are open. The swap
already reads `source.placeTrack` first.

D2. Lines are generated, never parsed from the creator's prose, by one pure module
(`apps/creator-web/src/lib/placeSpots.ts`): `placeTo/placeAt` forms per kind (from i18n) and per name
(Hebrew prefixes ל/ב with a leading ה dropped, the way Hebrew writes it; a name that does not start
with a Hebrew letter gets "אל"), and the four phrase forms. `applyPlaceLines(game, words, spots)`
rewrites every stage intro and two-set mission line it owns: a line is ours when it equals a form
generated for this kind or any of its spot names, in either language. A creator's own intro is never
touched. The composer calls the same function, so compose time and setup time cannot disagree.

D3. The places screen is a new beat after the plan, one per kind that has a composer-placed mission
(wizard step id ending `-placed-coordinates` on a task with `placeTrack`). Rows: name + which pin is
being placed; one map (`LocationStep`) for the selected row; "add another". Every change runs
`applySpots` (pins + lines) and saves through `onGameChange`. Item beats for coordinates the places
beat owns are dropped once that kind has a placed spot.

D4. Pins: stage k of a kind (in game order) takes spot `k mod n`; the i-th mission sits 12 m from the
spot on a ring (one at the centre when alone), so pins do not stack on the map.

D5. `Game.placeSpots?: PlaceSpot[]` ({ id, kind, name, lat, lng }), at most 40, validated by
`normalizePlaceSpots` in `packages/shared` (shared by `updateGame` and the client). `[]` clears it.
Not in the share projection, not sent to players.

## Tests
`scripts/test-place-spots.ts` (pure): forms, prefixes, rotation, "only where the place changes",
ownership (a creator intro survives), pins, rename, branch fit, normalizer, memorable spots.
`scripts/test-blank-start-clarity.ts`: place read from `placeTrack` instead of the text.
`scripts/e2e-verify.mjs`: `updateGame` stores `placeSpots` and refuses a malformed one.
UI: the walk in the browser at phone width.
