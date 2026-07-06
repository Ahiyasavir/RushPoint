## Why

Every task and stage in a run goes live the instant the run starts. There is no way
to build a multi-day hunt, a timed "drop" of a new chapter, or an async game where a
mission opens at a scheduled moment. Competitors (Goosechase's scheduled missions)
treat this as a core capability. It is the cleanest additive extension of the existing
Game → Stage → Task model.

## What Changes

- A **Task** or a whole **Stage** may carry an optional scheduled-release gate:
  - `releaseAt` — an ISO wall-clock instant it becomes available at, and/or
  - `releaseAfterMinutes` — minutes after the run started it becomes available.
  When both are set, the later of the two wins (both must be satisfied).
- **Task-level gate:** a not-yet-released task is not routed/assigned (hidden from
  `requestNextTask` / `getRecommendedTasks`) and cannot be completed even by a direct
  `completeTask` call (anti-cheat). Once released it behaves normally.
- **Stage-level gate:** a gated next stage is NOT unlocked when the prior stage
  completes — it stays `locked` until its gate opens. A subsequent `requestNextTask` /
  `getMyTeamState` poll unlocks it the moment the gate opens (a timed "drop").
- The decision is made **server-side from the server clock** — never a client claim.
- The participant app renders a live **countdown** to the next timed stage drop and can
  render per-task countdowns (the release fields are sanitizer-passthrough, not secret).
- The Builder lets a creator set a stage's release ("open this stage N minutes after the
  game starts") on any stage after the first.

## Capabilities

### New Capabilities
- `scheduled-release`: optional `releaseAt` / `releaseAfterMinutes` gates on Task and
  Stage; the pure `isReleased` / `releaseInstantMs` predicates; server enforcement in
  routing, the stage-unlock path, and `completeTask`; sanitizer passthrough; the Builder
  authoring control and the play-web countdown.

## Non-goals

- No gating of the FIRST stage (it opens at run start; timed release applies to later
  stages / individual tasks). 
- No recurring / cron-driven release — release is evaluated lazily on poll, not pushed.
- No per-team personalized schedules — the gate is the same for every team in the run.
- No calendar/timezone UI beyond a relative "minutes after start" input in the Builder
  (a wall-clock `releaseAt` is supported in the data model + e2e for API/import use).

## Surfaces touched

- **shared:** new `packages/shared/src/schedule.ts` (`isReleased`, `releaseInstantMs`,
  `ReleaseGate`); `Task` + `Stage` gain `releaseAt?` / `releaseAfterMinutes?`.
- **functions:** routing candidate filters (`routing/assignNextTask.ts`), the stage-unlock
  gate + poll re-check + `completeTask` guard + `getMyTeamState` countdown
  (`runs/index.ts`). No new callable. Sanitizer passes the fields through unchanged.
- **creator-web:** Builder stage editor release control + i18n.
- **play-web:** `PlayScreen` stage-drop countdown + `MyTeamState.nextStageReleaseAt` +
  i18n.
- **Tests:** `scripts/test-schedule.ts` (pure); a `scheduled release` e2e scenario +
  `ALLOWED_TASK_KEYS` allowlist entry.
- No Firestore index, rules, or env change.
