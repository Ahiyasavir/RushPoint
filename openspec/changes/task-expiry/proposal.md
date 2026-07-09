## Why

A task, once live, stays available forever. Creators can't author time-pressure
mechanics — a "bonus objective for the first hour", a pop-up station that closes
at lunch, or a decaying map of opportunities. Scheduled-release (`releaseAt` /
`releaseAfterMinutes` in `packages/shared/src/schedule.ts`) already gates the
START of availability; this is its mirror: an END. Together they define an
availability window, completing the timed-drop story competitors ship.

## What Changes

- A **Task** may carry an optional `expiresAfterMinutes?: number` — minutes after
  the run's `launchedAt` at which it stops being available (mirrors the existing
  relative `releaseAfterMinutes`). Fractional minutes are honored (lets tests
  exercise expiry without waiting).
- An **expired task**:
  - is dropped from the routing candidates (`buildRecommendations` +
    `assignTask`), so it is never handed out again;
  - is refused by `completeTask` / `submitTaskAnswer` / `submitSequenceStep`
    with `failed-precondition` (anti-cheat — a hand-crafted call can't complete
    a closed task);
  - **auto-skips** when a team is stuck ON it: the next poll
    (`getMyTeamState` or `requestNextTask` → `assignNextInActiveStage`) marks the
    in-flight expired task `skipped`, frees its station slot (`releaseTask`),
    and routes the team onward — same lazy-evaluation pattern as the
    scheduled-release stage-unlock re-check (`computeStageUnlock`). If nothing
    doable remains, the stage completes with what was earned (existing
    all-terminal semantics).
- The decision is **server-side from the server clock** — never a client claim.
- The participant app renders a per-task **"expires in mm:ss" countdown** once
  fewer than 10 minutes remain (`expiresAfterMinutes` is sanitizer-passthrough,
  and `getMyTeamState` already returns `run.launchedAt`).
- **Interaction rule:** a task gated by both release and expiry is available only
  in `[release, expiry)`. The validator rejects a relative expiry ≤ a relative
  release (an empty window); a wall-clock `releaseAt` + relative expiry can only
  be compared at run time, so the Builder warns instead.
- The Builder task editor gains an "expires N minutes after start" input.

## Capabilities

### New Capabilities
- `task-expiry`: optional `expiresAfterMinutes` on Task; the pure `isExpired` /
  `expiryInstantMs` predicates in `shared/schedule.ts`; server enforcement in
  routing, the completion callables, and the in-flight auto-skip sweep;
  sanitizer passthrough; the Builder authoring input and the play-web countdown.

## Non-goals

- No **stage-level** expiry (release has one; expiry of a whole stage is a
  different mechanic — forced advancement — and is out of scope).
- No wall-clock `expiresAt` in v1 — relative-only keeps the window statically
  validatable against `releaseAfterMinutes`.
- No partial credit for a task expired mid-work — it is skipped, not scored.
- No push on expiry — evaluated lazily on poll, like scheduled release.

## Surfaces touched

- **shared:** `packages/shared/src/schedule.ts` gains `isExpired`,
  `expiryInstantMs`, and the window validator; `Task` gains
  `expiresAfterMinutes?`.
- **functions:** routing candidate filters (`routing/assignNextTask.ts`);
  `runs/index.ts` — guards in `completeTask` / `submitTaskAnswer` /
  `submitSequenceStep`, the auto-skip sweep in `assignNextInActiveStage` +
  `getMyTeamState`, save-time validation in `games/index.ts` `updateGame`.
  No new callable. Sanitizer passthrough.
- **creator-web:** `TaskWizard.tsx` expiry input + i18n.
- **play-web:** `TaskRunner.tsx` expiry countdown + i18n.
- **Tests:** `scripts/test-schedule.ts` extended (pure); a `task expiry` e2e
  scenario + `ALLOWED_TASK_KEYS` allowlist entry (`expiresAfterMinutes`).
- No Firestore index, rules, or env change.
