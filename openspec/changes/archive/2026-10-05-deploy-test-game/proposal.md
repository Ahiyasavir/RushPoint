## Why

Ahiya, 2026-10-05: "every deploy, build a game that goes into my creator account with all the
checks and their descriptions, automatically, so I don't have to build a special game for it", named
`deploy <date>`. Checking a deploy by playing meant hand-building a game with the right mission
types every time.

## What Changes

- `scripts/lib/deployTestGame.mjs`: a pure template of missions that ARE the checks (points by
  answer, station code points, a 2-minute time limit, a mission for every phone, auto-approved photo,
  10 to 30 second video, a photo the organizer rejects, a walk to a point, SOS and HQ chat, a flash
  mission). Every description: "מה עושים" and "מה אמור לקרות". The walking point is left unplaced so
  Quick Setup asks for it (no address in the repo). Optional per-deploy notes mark behaviour fixed in
  the repo but not live yet.
- `scripts/deploy-test-game.mjs` (`npm run deploy:test-game`): creates it in the creator's account
  through the real `importGameFile` callable, signed in via a custom token minted on the API host.
  Idempotent by title.
- `scripts/test-deploy-test-game.ts`: the template passes `parseGameFile`, the go-live structure
  checks, completability and points-by-answer validation once the pin is placed; readiness blocks
  only on the pin; Quick Setup asks for it.
- DEPLOY.md §9 and the deploy checklist rule: every deploy runs it.

## Impact

New scripts only; no product code. First run: `deploy 2026-10-05`, game E32wFxBymnUMlCbO9WZN.
