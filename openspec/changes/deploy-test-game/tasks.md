## 1. RED

- [x] 1.1 `scripts/test-deploy-test-game.ts`: title, date shape, `parseGameFile` with no errors,
  go-live structure + completability + points-by-answer once the pin is placed, readiness blocks only
  on the pin, Quick Setup asks for it, every mission says what to do and what should happen. It
  failed first on three real defects (outcomes beside an answer key, photo missions typed as
  stations, the readiness field shape).

## 2. GREEN

- [x] 2.1 `scripts/lib/deployTestGame.mjs`: the template, with notes.
- [x] 2.2 `scripts/deploy-test-game.mjs` + `npm run deploy:test-game`: custom token on the API host,
  ID token, idempotent `listGames` check, `importGameFile`.
- [x] 2.3 DEPLOY.md §9 rule; scripts/README.md row.

## 3. Verify

- [x] 3.1 Ran for 2026-10-05: game E32wFxBymnUMlCbO9WZN in Ahiya's account, 3 stages, 10 missions, 1
  Quick Setup step, 3 "ידוע" notes, read back from Firestore.
