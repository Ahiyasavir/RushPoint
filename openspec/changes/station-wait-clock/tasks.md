## 1. Pure rule

- [x] 1.1 RED `packages/shared/src/stationWait.test.ts`.
- [x] 1.2 GREEN `stationWait.ts` + barrel + `RunTeam` fields + `raceElapsedMs`.

## 2. Server

- [x] 2.1 RED e2e scenario "station wait".
- [x] 2.2 GREEN stamp + settle in `assignNextInActiveStage`; settle on force-assign, hold start,
  finalize; `buildRankings`; participant projection; `listRunTeams` row.

## 3. Apps

- [x] 3.1 play-web: waiting card copy (HE + EN), the clock stands still.
- [x] 3.2 creator-web: RED signals test, GREEN `waitingForStation` signal + row mark + copy.

## 4. Gates

- [x] 4.1 `npm run verify`, e2e, `simulate-station-caps` on the real game.
