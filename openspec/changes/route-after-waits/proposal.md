## Why

Found by the 8 team load sim on 22.10 (2 runs in 7, the log line `queuedRoute.dropped ... waivable:
["stationFull"], waived: []`). An organizer sends a team to a station "after this mission"; by the time
the team is free another team has taken the last place there. `consumeQueuedRoute` saw a blocker the
organizer had not confirmed and dropped the queue in silence: the team was handed a different mission,
finished the stage without the station it was sent to, and the console never said so. A second path did
the same: the place taken between the check and the claim threw, and the catch deleted the queue. At an
event with 31 teams and stations capped at 3 this is ordinary, not rare.

Ahiya's decision (22.10): the team waits for a free place at that station, its clock stopped, and the
console shows that it is waiting and for which mission.

## What Changes

- `queuedRouteVerdict(blockers, waived)` in `packages/shared/src/routeBlockers.ts`: `route` when nothing
  new is in the way, `wait` when the only new obstacle is a full station, `drop` for anything else new
  (a prerequisite, a closed mission: a different decision the organizer did not make).
- `consumeQueuedRoute` keeps the queue on `wait`, also when the last place is taken mid-claim;
  `assignNextInActiveStage` then answers `stationsFull` and stamps the station wait (station-wait-clock),
  so the race clock stops and the phone keeps asking. The claim that finally hands the station over
  settles the wait (`applyRoute` already spreads `stationWaitSettlePatch`).
- `listRunTeams` rows carry `queuedRouteTaskId`; the console badge names the station the team waits for,
  and a queued route that is not waiting shows as "after the current mission: X".
- `queuedRoute.dropped` is logged with its blockers, so a drop in the field explains itself.

## Impact

`packages/shared/src/routeBlockers.ts`, `functions/src/runs/index.ts`, creator-web `services/calls.ts`,
`RunConsolePage.tsx`, `i18n.ts`, `scripts/test-route-blockers.ts`, `scripts/e2e-verify.mjs`,
`scripts/simulate-run.mjs` (the failure detail names the record and the queue).
