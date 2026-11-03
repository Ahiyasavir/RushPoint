## 1. RED
- [x] 1.1 scripts/test-place-spots.ts: every assertion of the design, failing
- [x] 1.2 e2e: updateGame stores placeSpots, refuses malformed

## 2. GREEN
- [x] 2.1 shared: PlaceSpot type, normalizePlaceSpots, memorablePlaceSpots; Game + UpdateGamePayload
- [x] 2.2 functions: updateGame validates and writes placeSpots
- [x] 2.3 creator-web: branch kind (tags, i18n, setting, school fit)
- [x] 2.4 lib/placeSpots.ts: forms, lines, pins
- [x] 2.5 composer: placeTrack on every placed stage, stage line via applyPlaceLines
- [x] 2.6 setup walk: places beat, owned coordinate items dropped
- [x] 2.7 savePayload: placeSpots

## 2b. Review rounds with Ahiya in the emulator (3.11)
- [x] every place a moving game sends teams to is asked, even with nothing to pin (not home)
- [x] a resumed walk opens on a place not yet on the map
- [x] every map screen of a mission at a named place is pinned and skipped, except one with a photo of its spot
- [x] go-to phrases are functions, so the dictionary purity check reads real words
- [x] light theme by default; dark only by the creator's own choice
- [x] mouse wheel zooms a map whose page does not scroll (lib/wheelPassThrough.ts)
- [x] a sound when a placed pin moves
- [x] the tour: 6 short steps around the generator (7 with payments)

## 3. Gates
- [x] 3.1 npm run verify (origin:check red only for the worktree's missing .env), e2e ALL PASS (offset 1000), i18n strict, 375px check
- [x] 3.2 gate fixes: a workplace group keeps kids+adults missions (no corporate opener was left); a placed game from prep 2 prefers missions a pin can host; applyPlaceLines is total on a malformed copy; site-youth-movement swaps human-letter for chain-reaction; taste test over 40 seeds
- [ ] 3.3 bank gap: adults outdoors have only four missions a pin can host (4 of 30 light prep placed games get no pin)
