# Design — task-expiry

## Data model (packages/shared/src/types/index.ts)
One optional field on `Task`:
```ts
expiresAfterMinutes?: number; // minutes after run launchedAt; task closes at that instant
```
Optional → existing games unaffected (absent = never expires). Fractional values
are honored (documented: lets e2e use ~1s expiries instead of waiting minutes).
Not a secret → `...rest` passthrough in `sanitizeTaskForParticipant`, exactly
like `releaseAfterMinutes`.

## Pure predicates (packages/shared/src/schedule.ts — extend)
```ts
export interface ExpiryGate { expiresAfterMinutes?: number }
isExpired(gate, runStartedAt, nowMs): boolean
expiryInstantMs(gate, runStartedAt): number | null
validateAvailabilityWindow(gate: ReleaseGate & ExpiryGate): string | null  // error text or null
```
- No gate / non-finite / ≤ 0 ⇒ never expired; `expiryInstantMs` ⇒ null.
- No known run start ⇒ NOT expired (nothing can expire before the run exists) —
  the mirror of `isReleased`'s "no start ⇒ locked" (both fail safe: the task is
  simply not yet in play).
- Expired once `(nowMs - startMs) >= expiresAfterMinutes * 60_000`.
- `validateAvailabilityWindow`: error when both `releaseAfterMinutes` and
  `expiresAfterMinutes` are set and expiry ≤ release (empty window). A
  wall-clock `releaseAt` + relative expiry is NOT an error (launch time unknown
  statically) — the Builder shows a warning string instead.

Availability everywhere becomes: `isReleased(t, launchedAt, now) && !isExpired(t, launchedAt, now)`.

## Server enforcement (functions/)
- **Routing** (`routing/assignNextTask.ts`): `getRunRouting` already returns
  `launchedAt`; add `if (isExpired(t, launchedAt, nowMs)) return false;` beside
  the existing `isReleased` drop in BOTH `buildRecommendations` and the
  `assignTask` transaction filter.
- **Completion guards** (`runs/index.ts`): `completeTask` already loads the game
  task + run for the scheduled-release gate (the `gtask.releaseAt ||
  gtask.releaseAfterMinutes` block) — extend that block to also throw
  `failed-precondition` "This task has expired" when `isExpired`. Add the same
  guard to `submitTaskAnswer` and `submitSequenceStep` (both already have the
  game task in hand; they read the run doc for `launchedAt` only when the task
  actually carries `expiresAfterMinutes` — zero cost on the common path).
- **Auto-skip sweep** (`runs/index.ts`): a helper
  `sweepExpiredInFlight(team, game, launchedAt, nowMs)` that clones `stages`
  (full-array, never dotted), and when the active stage's `assigned` task is
  expired: marks it `skipped`, and — if every task in the stage is now terminal
  (completed/skipped) — completes the stage + unlocks the next one using the
  SAME logic/ordering as `completeTaskForTeam`'s stageDone block (including the
  scheduled-release `isReleased` gate on the next stage). Returns
  `{ stages, expiredTaskId } | null`. Call sites:
  - `assignNextInActiveStage` — right before the `inFlight` early-return, so a
    stuck team is rerouted on its next `requestNextTask` (write the new stages,
    `releaseTask(expiredTaskId)`, clear `activeTaskId`, then continue assigning);
  - `getMyTeamState` — beside the existing `computeStageUnlock` re-check, so a
    merely-polling team sees the reroute too (play-web polls state, then calls
    `requestNextTask` when it has no active task).
- **Save-time validation** (`games/index.ts` `updateGame`): run
  `validateAvailabilityWindow` per task when `stages` is present; throw
  `invalid-argument` on an empty window.

## Sanitizer
Passthrough (`...rest`). Add `expiresAfterMinutes` to `ALLOWED_TASK_KEYS` in
`scripts/e2e-verify.mjs`.

## UI
- **creator-web** (`components/TaskWizard.tsx`): an "expires — N minutes after
  the game starts" number input beside the schedule controls (0/empty ⇒
  undefined); inline error for expiry ≤ release (relative-relative), inline
  warning for `releaseAt` + expiry. Strings via `t.*`.
- **play-web** (`components/TaskRunner.tsx`): compute
  `expiryInstantMs(task, run.launchedAt)` (both already in the client payload);
  when 0 < remaining < 10 min, render a ticking "expires in mm:ss" badge; on
  hitting zero, trigger the existing state refresh so the server sweep reroutes.
  Strings via `t.*`.

## Test strategy
- **Pure (TDD RED→GREEN):** extend `scripts/test-schedule.ts` — `isExpired`
  truth table (absent/zero/negative/non-finite → never; before/at/after the
  instant; fractional minutes; no run start → not expired), `expiryInstantMs`
  (none/set/no-start), `validateAvailabilityWindow` (expiry>release ok,
  expiry==release error, expiry<release error, releaseAt+expiry → no error),
  and the combined window: released-but-expired ⇒ unavailable.
- **Callable (e2e):** a `task expiry` scenario in `scripts/e2e-verify.mjs`: a
  2-task stage where E has `expiresAfterMinutes: 0.02` (~1.2s) — team gets E
  assigned, sleep ~1.5s, `completeTask(E)` → `failed-precondition`, then
  `requestNextTask` reroutes to the other task and `run.taskCounts` shows E's
  slot released; a generous-expiry task passes the sanitizer allowlist with
  `expiresAfterMinutes` intact; `updateGame` with `releaseAfterMinutes: 30,
  expiresAfterMinutes: 10` → `invalid-argument`.
- **UI:** preview the Builder input + the TaskRunner countdown; `npm run i18n:check`.

## Footguns respected
- Full-array `stages` writes in the sweep (no dotted array-element updates).
- `releaseTask` is transactional + floor-at-zero — the sweep can't double-free a
  slot even if two pollers race (second sweep sees status `skipped`, no-op).
- Server clock only; the sweep is idempotent (skipped stays skipped).
- The completion-bonus/scoring path is untouched — skipped tasks earn nothing,
  identical to `requiredTaskCount` auto-skip.
