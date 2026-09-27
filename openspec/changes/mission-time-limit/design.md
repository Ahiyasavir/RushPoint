# Design: mission-time-limit

- Shared: `taskTimeLimit.ts` (remaining, up, save-time problem; grace 5 s; max 600 min);
  `schedule.ts` gains `expiresAt` in `isExpired`/`expiryInstantMs`, `hasScheduleGate`, and window
  validation for absolute times.
- Server: `assertWithinTimeLimit(team, task)` at every submission door (completeTask, answers,
  sequence steps, station codes, photo submissions). The poll and requestNextTask sweeps skip a held
  mission whose countdown ran out, unless a submission is waiting for review, and stamp
  `team.timeUpNotice`. `getMyTeamState` ships `activeTaskTimeLeftMs`, a DURATION on the server's
  clock. updateGame and game file import validate both fields; the game file exports them.
- play-web: `TimeLimitCountdown` counts the duration down from when it arrived
  (`lib/timeLimitCountdown.ts`) and refreshes at zero; the notice card reuses the closure one.
- Builder: "opens at / closes at" datetime inputs (`lib/timeWindowInput.ts`, clearing stores
  ABSENT) and "time per team".

## Test strategy
`scripts/test-task-time-limit.ts`, `test-time-limit-countdown.ts`, `test-time-window-input.ts`;
e2e "mission time limits" (validation, countdown payload, refusal after time, sweep + notice + no
points, stage still completes, a pending photo survives and scores, absolute close); browser batch.
