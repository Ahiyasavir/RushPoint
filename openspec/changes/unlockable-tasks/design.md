# Design — unlockable-tasks

## Data model (packages/shared/src/types/index.ts)
One optional field on `Task`:
```ts
unlockAfterTaskIds?: string[];  // same-stage task ids; ALL must be completed first
```
Optional → existing games unaffected (absent/empty = always unlocked). Rides
inside `stages[]` through the existing `updateGame` save path. NOT a secret (the
locked-task UI names its prerequisites), so it stays in `...rest` through
`sanitizeTaskForParticipant` — mirror of `releaseAt`/`media` passthrough.

## Pure logic (packages/shared/src/gating.ts — new)
```ts
isUnlocked(task: Pick<Task,'unlockAfterTaskIds'>, completedTaskIds: string[]): boolean
validateUnlockGraph(stage: Pick<Stage,'tasks'|'requiredTaskCount'>):
  { errors: string[]; warnings: string[] }
```
- `isUnlocked`: absent / empty / non-array gate ⇒ unlocked; otherwise every id in
  `unlockAfterTaskIds` ∈ `completedTaskIds`. Unknown ids never silently unlock —
  they are rejected at save time instead (below).
- `validateUnlockGraph` **errors** (save-blocking): self-reference; an id not
  found among this stage's `tasks[]` (covers cross-stage + typos); a cycle
  (iterative DFS over the same-stage graph). A cycle-free directed graph always
  has a source ⇒ at least one task with no prerequisites ⇒ the stage is routable.
  **Warnings** (Builder-only, non-blocking): `requiredTaskCount` > number of
  reachable tasks (all tasks are reachable in a valid DAG, but the warning
  guards future interactions, e.g. a prerequisite that is also expiry-gated).

## Server enforcement (functions/)
- **Routing** (`routing/assignNextTask.ts`): both candidate filters — in
  `buildRecommendations` and inside the `assignTask` transaction — already
  receive `completedTaskIds`; add `if (!isUnlocked(t, completedTaskIds)) return
  false;` next to the existing `isReleased` drop. That hides locked tasks from
  `requestNextTask` / `getRecommendedTasks` / `assignNextInActiveStage`.
- **Completion choke point** (`runs/index.ts` `completeTaskForTeam`): inside the
  transaction, after locating `taskRec` and the `gameTask` (`findGameTask`),
  compute `completedTaskIds` from the freshly-read `team.stages` and throw
  `functions.https.HttpsError('failed-precondition', …)` when
  `!isUnlocked(gameTask, completedTaskIds)`. One guard covers every path that
  funnels here: `completeTask`, `submitTaskAnswer`, `submitSequenceStep`,
  `verifyStationCode`, `submitStationPhoto` → `reviewStationSubmission`.
- **Save-time validation** (`games/index.ts` `updateGame`): when `stages` is in
  the payload, run `validateUnlockGraph` per stage (same hook point as
  `normalizeStagesMedia`) and throw `invalid-argument` listing the errors.

## Sanitizer
Passthrough — `unlockAfterTaskIds` carries no answer key. Add it to the e2e
`ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` (a forgotten entry fails loud).

## UI
- **creator-web** (`components/TaskWizard.tsx`): a collapsible "Unlocks after…"
  section (like the hint toggle) with a checkbox per sibling task (title +
  index), writing `unlockAfterTaskIds` (empty ⇒ undefined). The save guard runs
  `validateUnlockGraph` and blocks with the error text; warnings render inline.
  Strings via `t.*` (EN + HE).
- **play-web** (`screens/PlayScreen.tsx`): the active-stage task list already has
  every sanitized task (`getMyTeamState.activeStageTasks`) plus per-task status
  in `team.stages`. Compute locked-ness client-side with the SAME shared
  `isUnlocked` (play-web imports `@rushpoint/shared`); render 🔒 + title +
  "complete X first" (prerequisite titles resolved from `activeStageTasks` by
  id). Display-only — the server independently refuses locked completions.

## Test strategy
- **Pure (TDD RED→GREEN):** `scripts/test-gating.ts` — `isUnlocked` truth table
  (absent/empty/met/partially-met/unmet) and `validateUnlockGraph`
  (self-ref, unknown id, cross-stage id, 2-cycle, 3-cycle, valid diamond DAG,
  requiredTaskCount warning). Auto-run by the aggregator (`npm test`).
- **Callable (e2e):** an `unlockable tasks` scenario in `scripts/e2e-verify.mjs`:
  a 2-task stage where B `unlockAfterTaskIds: [A]` — first `requestNextTask`
  hands out A (never B); a direct `completeTask(B)` fails `failed-precondition`;
  after completing A, B is assigned and completes; the sanitized payload of B
  still carries `unlockAfterTaskIds` (passthrough) and stays allowlisted; an
  `updateGame` with a B↔C cycle is rejected `invalid-argument`.
- **UI:** preview Builder multi-select + play-web lock row; `npm run i18n:check`.

## Footguns respected
- The completion guard reads team state INSIDE the existing transaction — no
  extra read outside it, no dotted array-element updates.
- Locked ≠ skipped: `requiredTaskCount` early-completion auto-skip in
  `completeTaskForTeam` is untouched — a still-locked leftover simply auto-skips.
- Server-write-only state, `FIRESTORE_PATHS`, answer-key secrecy all unchanged.
