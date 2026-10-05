## Decisions

**D1. Every `possible` mission of a placed game is sited.** `stationAnchorIndex` is no longer used
to pick one per stage; step 8 sites a mission when `placedGame && placePrompt !== '' &&
bankSiting(entry) === 'possible'`. A `must` mission is sited by nature (unchanged); a `never` one
is never sited (unchanged).

**D2. Riddles and trivia are `possible`.** The explicit `siting: 'never'` is removed from:
trivia-bones, trivia-longest-river, the-hard-riddle, invention-order, anagram-easy,
anagram-medium, anagram-hard, puzzle-code, mystery-gift, balloon-message, echo-riddle,
vault-combination-riddle, disarm-the-device, household-riddle-comb, thinking-room. They carry
`fromAnywhere`, so the derived siting is `possible`.

**D3. Cost line = planned pins.** `previewPrepCost` counts the planned missions a place can help
(the shape's slots), so the line stays honest now that pins follow missions. Still 1.5 minutes a pin.

## Test strategy

`scripts/test-composer-siting.ts` is rewritten RED first: over the answer sample at prep 2 every
`possible` mission is sited and no `never` one is; level 1 sites nothing; the 15 keys resolve to
`possible`; the conversation and chore keys still resolve to `never`; the cost line equals the
pins the composed game actually asks for (within the shared seed's plan).
