# Design — scheduled-release

## Data model (packages/shared/src/types/index.ts)
Add two optional fields to both `Task` and `Stage`:
```ts
releaseAt?: string;          // ISO wall-clock instant
releaseAfterMinutes?: number; // minutes after run start
```
Both are optional → existing games/tasks are unaffected (absent gate = always available).
They ride inside `stages[]`, so they persist through the existing `updateGame` /
`buildSavePayload` with no allowlist change.

## Pure predicate (packages/shared/src/schedule.ts)
```ts
isReleased(gate, runStartedAt, nowMs): boolean
releaseInstantMs(gate, runStartedAt): number | null
```
- No gate / empty gate ⇒ released.
- `releaseAt`: released once `nowMs >= Date.parse(releaseAt)`; an unparseable value is
  treated as locked (never silently open).
- `releaseAfterMinutes`: released once `(nowMs - runStart) >= minutes`; with no known run
  start ⇒ locked.
- Both set ⇒ the later instant wins (AND semantics).
`releaseInstantMs` returns the unlock instant for the countdown UI (max of the two).

The server clock is authoritative — callers pass `Date.now()`; clients never decide.

## Server enforcement (functions/)
- **Routing** (`routing/assignNextTask.ts`): `getRunRouting` returns the run's
  `launchedAt` alongside `taskCounts`; the candidate filters in `buildRecommendations`
  and the `assignTask` transaction drop any task where `!isReleased(task, launchedAt,
  now)`.
- **Stage unlock** (`runs/index.ts` `completeTaskForTeam`): when the completed stage
  would unlock the next one, gate it with `isReleased(nextGameStage, launchedAt, now)`;
  a gated stage stays `locked`.
- **Poll re-check** (`computeStageUnlock`, called at the top of `assignNextInActiveStage`
  and in `getMyTeamState`): when no stage is active, flip the earliest eligible locked
  stage to `active` once its gate opens. Linear-flow safe (only the earliest locked
  stage whose predecessor is completed is considered). Writes the FULL `stages` array
  (never a dotted array-element update).
- **completeTask guard**: reject a direct completion of a not-yet-released task with
  `failed-precondition` "This task is not available yet".
- **getMyTeamState**: returns `run.launchedAt` and `nextStageReleaseAt` (ms epoch or
  null) for the countdown.

## Sanitizer
`releaseAt` / `releaseAfterMinutes` are NOT secret — they stay in `...rest` and pass
through `sanitizeTaskForParticipant` unchanged (added to the e2e `ALLOWED_TASK_KEYS`).

## UI
- **creator-web Builder** (`BuilderPage.tsx`): a "Release this stage — N minutes after
  the game starts" number input in the stage editor, shown for any stage after the
  first. Writes `stage.releaseAfterMinutes` (0/empty ⇒ undefined). Strings via `t.*`.
- **play-web** (`PlayScreen.tsx`): when the team has no active stage but
  `nextStageReleaseAt` is in the future, render `StageDropCountdown` (a ticking mm:ss /
  hh:mm:ss card) instead of the "no active stage" text; on hitting zero it polls
  (`refresh`) so the server unlocks the stage. Strings via `t.*`.

## Test strategy
- **Pure (TDD RED→GREEN):** `scripts/test-schedule.ts` — truth table for `isReleased`
  (absent/empty/zero → released; past/future/exact `releaseAt`; unparseable → locked;
  `releaseAfterMinutes` vs run start incl. no-start; both-set AND semantics) and
  `releaseInstantMs`. Auto-run by the aggregator (`npm test`).
- **Callable (e2e):** a `scheduled release` scenario in `scripts/e2e-verify.mjs`:
  future-`releaseAt` task is skipped by routing + refused by `completeTask` + survives
  the sanitizer; a stage gated `releaseAfterMinutes: 120` keeps the team between stages
  with `nextStageReleaseAt` set and no task handed out; a second game whose later stage's
  `releaseAt` is in the PAST unlocks and completes. `ALLOWED_TASK_KEYS` updated.
- **UI:** preview the Builder release input + the play countdown; `npm run i18n:check`.

## Footguns respected
- Full-array writes for `stages` (no dotted array-element updates → no array→map coercion).
- Server clock only; idempotent unlock (only flips `locked→active`).
- Answer-key secrecy unaffected (release fields carry no secret).
