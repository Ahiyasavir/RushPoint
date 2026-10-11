# Design

## D1. State on the team document (server-written)

`RunTeam.stationWaitSince?` (ISO, start of the open wait), `stationWaitSeenAt?` (ISO, the last
time the phone was answered "stationsFull"), `stationWaitMs?` (settled total). Same shape as
`held` / `heldAt` / `heldMs`, and for the same reason: `buildRankings` must stay a pure function
of the STORED team document, so it reads only the settled `stationWaitMs`, never `now`.

## D2. Where it is written

`assignNextInActiveStage` is the one choke point every routing caller goes through
(requestNextTask, completeTask's reassign, the poll sweep):

- it answers `stationsFull` → start the wait, or refresh `stationWaitSeenAt` when it is older
  than `STATION_WAIT_HEARTBEAT_MS` (30 s). In a transaction that re-reads the team and writes
  nothing when a mission is already in hand, so a slow answer cannot leave a wait open on a
  team that is playing.
- its claim transaction hands the team a mission → settle the wait in the same write.

Also settled: staff force-assign / route (the team got a mission another way), the start of a
staff hold (two exclusions must never overlap), and finalize (like an open hold).

## D3. The phone that went quiet

Credit for one wait = `min(now, seenAt + STATION_WAIT_GAP_MS) − since`, never negative.
`STATION_WAIT_GAP_MS` = 60 s: one heartbeat (30 s) + one retry of the phone (≤ 8 s) + slack.
A phone that keeps asking is credited to the second; one that was closed for twenty minutes is
credited one more minute. Stored on the document rather than in process memory: the verdict
changes a ranking, and it must be the same in every process and after a restart.

Cost: one read + one write when a wait starts, and one per 30 s while it lasts. Twenty teams
waiting five minutes is about 220 writes.

## D4. Reading it

- `packages/shared/src/stationWait.ts` (pure, total): `stationWaitCreditMs`,
  `settleStationWait`, `stationWaitStamp`, `teamStationWaitMs`.
- `buildRankings`: `excludedMs += teamStationWaitMs(team)`.
- `raceElapsedMs` (the phone's clock): subtracts `stationWaitMs`, stands still at
  `stationWaitSince` while the wait is open.
- `sanitizeTeamForParticipant` copies `stationWaitSince` + `stationWaitMs` (an allowlist: a
  field not copied never reaches the phone).
- `listRunTeams` row: `waitingForStationSince`.
- Console: `waitingForStation` signal (warn, answers in the teams panel) + a mark on the row.

## Test strategy

- vitest `packages/shared/src/stationWait.test.ts`: credit (asking phone, quiet phone,
  garbage, clock skew), settle, stamp verdicts, and the clock standing still.
- `apps/creator-web` signals test: the new signal, silent at zero.
- e2e scenario "station wait": cap 1, two teams; the second is told stationsFull, carries the
  wait, the console row shows it, it gets the station when the first finishes, the wait is
  settled and its board duration is shorter than its raw time by the wait.
