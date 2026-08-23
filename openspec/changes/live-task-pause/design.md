## Context

Verified in this working tree before writing a line:

- `packages/shared/src/types/index.ts:173` — `export type StationStatus = 'active' | 'paused' | 'closed'`.
- `packages/shared/src/types/index.ts:264` — `status?: StationStatus;  // operator override: paused/closed` on `Task`.
- `functions/src/routing/assignNextTask.ts:172` — `buildRecommendations` candidate filter drops paused/closed.
- `functions/src/routing/assignNextTask.ts:286` — `classifyNoAssignment` pool excludes paused/closed.
- `functions/src/routing/assignNextTask.ts:334` — `assignTask`'s transactional candidate filter drops paused/closed.
- No writer anywhere. The Builder never sets it, no callable sets it, seed data never sets it. The
  only producer in the repo is a test fixture (`assignNextTask.reason.test.ts:35`).

Hard constraint: a live playtest stack serves from this tree. Nothing here starts, stops or restarts
any process, and the emulator-bound gates (`e2e`, `verify:emulator`, `test:rules`, `simulate`) are
deliberately not run. Every new decision is therefore PURE logic verified in the no-emulator lane,
plus the production builds.

## Goals / Non-Goals

**Goals**
- An organizer or on-the-ground staff member can take one task out of play for a LIVE run, and put
  it back, in one click.
- No team is ever stranded by that action.
- If the action would make a stage impossible to finish, the person doing it is told BEFORE it lands.
- Routing enforcement stays in the three places it already lives; no fourth copy of the rule.

**Non-Goals**
- Editing the game template mid-run. The Builder is untouched.
- Pausing a whole STAGE. `skipStage` already exists as the organizer's stage-level escape hatch.
- Scheduling a pause, or auto-resuming. A pause ends when a human ends it.
- Any change to scoring, completion, the participant sanitizer, or authorization rules.

## Decisions

### D1 — The override is RUN-scoped, and lives on the RUN document

The field is declared on `Task`, which lives on the game template
(`users/{ownerUid}/games/{gameId}`). Writing the pause THERE would be wrong:

- The template is replayed. `launchRun` reads the same game document for every run; a task paused for
  Saturday's event would still be paused for Sunday's, silently, with nothing on screen saying why.
- The template is copied. `duplicateGame`, `exportGameFile` / `importGameFile` and the public gallery
  (`publicGames` / `publicTasks`) all propagate template fields, so a today-only operational fact
  would be baked into other people's copies of the game.
- The template is edited by a human. The Builder writes `stages` wholesale through `updateGame`; a
  creator opening the Builder during or after the run would silently clobber or resurrect the pause.
- Runs are already the right ownership boundary: run documents are server-write-only, are already
  scoped by `assertStaffOrOwner`, and are already where every other per-run operational fact lives
  (`taskCounts`, `hotZone`, `launchedAt`, `leaderboard`).

So: `Run.taskStatusOverrides?: Record<taskId, StationStatus>`, and the template `Task.status` stays
supported as the fallback (backwards compatible: a template that ever does set it keeps working).

Resolution order, in one pure function:

```
effectiveTaskStatus(task, overrides) =
  valid(overrides[task.id])  ??  valid(task.status)  ??  'active'
```

Total by construction: an unknown, missing, empty or non-string value at either level resolves to
`'active'` (fail OPEN). A task must never become permanently unroutable because a bad value got into
a map; the failure mode of failing closed here is an unwinnable game, which is strictly worse than
an operator having to click pause again.

Cost: zero extra reads. `getRunRouting` already reads the run document for `taskCounts` /
`launchedAt` / `hotZone`, and `assignTask` already reads it inside its transaction. The override
rides along on reads that already happen.

Write shape: the callable rewrites the whole small map inside a transaction
(`tx.update(runRef, { taskStatusOverrides: { ...current, [taskId]: status } })`). It deliberately
does NOT use a dotted path: task ids are opaque strings, and the repo has already been bitten twice
by dotted-key writes (`.set({merge})` writing a literal `"a.b"` field, and dotted updates coercing
an array into a map). One nested object, no dots.

### D2 — A team already holding the task KEEPS it and finishes it

The override is consulted at ASSIGNMENT time only: the three filters in `assignNextTask.ts`. It is
NOT consulted by `completeTask` / `submitTaskAnswer` / `verifyStationCode` / `submitStationPhoto`.

Consequence, and it is the intended one: a team that already has the task in flight can still
complete it and still scores it. Nobody is revoked, nothing is re-routed underneath them, no station
slot is released out from under a team standing at the station.

Why not the alternative (revoke and re-route the holders, as the task-expiry sweep does)? Because it
buys a worse trade:

- The holders are, by definition, the teams who already walked to the stop. They are the ones most
  likely to be able to finish it (they are standing there; the host who is leaving is often still
  there for another minute).
- Revocation is a mass write across an unbounded number of team documents from inside a live-ops
  callable, on the hottest documents in the system, contending with those teams' own
  `completeTask` / `requestNextTask` transactions. That is exactly the contention that produced the
  "frozen screen" 20 second lock timeouts already fixed in this repo.
- Revocation destroys work a team has already done (a `sequence` task half stepped through, a photo
  already uploaded and waiting on review).

So the guarantee is "finish", not "re-route", and it is true by construction rather than by a new
code path: nothing on the completion path reads the override. The callable RETURNS the number of
teams currently holding the task (`teamsHolding`, one indexed `where('activeTaskId','==',taskId)`
query) so the console can state it plainly: "2 teams are on it now and will still be able to finish".

If a holder abandons the paused task instead, the existing machinery already covers it: the stage's
own completion logic auto-skips non-completed tasks once the stage is otherwise done
(`applyStageCompletion`), and `skipStage` remains the organizer's escape hatch.

### D3 — Pausing is refused when it would make the stage unwinnable, unless forced

A stage completes when `completedCount >= min(requiredTaskCount ?? tasks.length, tasks.length)` OR
every task is terminal (`applyStageCompletion`, `functions/src/runs/helpers.ts:28-34`). If pausing
drops the stage's available task count below its required count, teams that have not yet completed
enough tasks in that stage have no assignable task left: `assignTask` finds no candidate and
`classifyNoAssignment` answers `'none'`, a terminal dead end. That is a stuck player.

The repo already treats this exact shape as a first-class error at authoring time: the Builder's
`gameReadiness.ts` emits `stageUnwinnable` ("requiredTaskCount above what the stage can yield") and
the Dashboard renders it. This change applies the SAME rule at pause time rather than inventing a
new one, over the same quantity: `availableAfter < requiredCount`.

Behaviour:

- The callable computes the plan and, when `stageUnwinnable` is true and `force !== true`, throws
  `failed-precondition` with `details = { code: 'stageUnwinnable', availableCount, requiredCount, stageTitle }`.
  Nothing is written.
- The console catches that code, shows the numbers and the stage name, and offers an explicit
  "pause anyway" that re-sends with `force: true`. Forcing is legitimate (the street really is
  closed) and is recorded in the audit entry.

Resume (`status: 'active'`) can never be unwinnable, so it is never refused.

### D4 — Transitions: every status may follow every status; only unknown VALUES are rejected

`active -> paused`, `paused -> active`, `active -> closed`, `closed -> active`, `paused -> closed`,
`closed -> paused` are all permitted. Refusing to reopen a closed stop would be a trap: mid-event,
"closed" often turns out to be "closed for twenty minutes", and the only recovery would be ending the
run. `paused` and `closed` are identical in ENFORCEMENT (neither is handed out); they differ in what
they tell the operator and in the audit trail, which is the honest description of the difference.

What IS rejected: a status value that is not one of the three (`undefined`, `''`, `'PAUSED'`,
`'disabled'`, a number, an object) -> `invalid-argument`, nothing written.

A no-op (`from === to`) is reported as `noop: true` and is idempotent: it is still written (so a
retried call converges) and it never trips the unwinnable guard.

### D5 — The decision is ONE pure module in `@rushpoint/shared`, unit-tested first

`packages/shared/src/liveTaskStatus.ts`, because both sides need the same answer: the server enforces
it and the console must display exactly what the server will do. Shared is imported from SOURCE by
both `functions` (tsconfig `paths`) and `creator-web` (vite alias + tsconfig `paths`), so no
`shared:build` is needed, which matters: a live stack owns this tree and `shared:build` rewrites
`dist` in place.

Exports:

```ts
LIVE_TASK_STATUSES: readonly ['active','paused','closed']
isStationStatus(v: unknown): v is StationStatus
effectiveTaskStatus(task, overrides?): StationStatus
isTaskAssignable(task, overrides?): boolean
planTaskStatusChange(input): TaskStatusChangePlan
```

`planTaskStatusChange` is total and takes only plain data (the owning stage's task list, its
`requiredTaskCount`, the current override map, the requested status, and the number of teams
currently holding the task). It returns either a rejection reason or the full plan:
`{ from, to, noop, holdersKeepTask: true, teamsHolding, availableAfter, requiredCount, stageUnwinnable }`.

No I/O, no Date, no Firebase, no React. Verified by `packages/shared/src/liveTaskStatus.test.ts`
(vitest, run by `turbo run test` inside `npm test`).

### D6 — The callable

`setRunTaskStatus`, in `functions/src/index.ts` next to the other live-ops callables it is a sibling
of (`adjustTeamScore`, `hideFeedItem`, `reviewStationSubmission`), following that file's pattern
exactly: `loggedCallable('setRunTaskStatus', …)`, `assertStaffOrOwner(context, ownerUid, runId)` as
the FIRST statement, explicit payload validation, then the work, then `writeAuditLog`.

`assertStaffOrOwner` rather than owner-only: the person who discovers that a stop is dead is usually
the staff member standing next to it, and a staff token is already scoped to exactly one run
(`t.staff && t.ownerUid === ownerUid && t.runId === runId`), which is precisely the blast radius this
action should have. The e2e authz matrix's participant / stranger / other-run-staff rows apply
unchanged.

Audit entry: `actionType: 'task_status_changed'`, `previousValue: from`, `newValue: to`, plus
`taskId`, `taskTitle`, `forced`, `reason`. Written with `writeAuditLog` (not best-effort): this is a
scoring-relevant operator action, in the same class as `adjustTeamScore`, which also awaits its audit
write.

Order of operations: authz, validate, read game + run + holder count, plan, refuse-or-force,
transactional write, audit. Nothing is written on any refusal path.

### D7 — The UI is one panel, not a redesign

`runConsoleLayout.ts` already models the console as DATA: a new `taskAvailability` panel id is added
to the closed `PanelId` union and mapped to the existing `gameMechanics` group, visible only while
the run is live (a finished run has nothing to pause). `runConsoleActions.ts` gets
`pauseTask` / `resumeTask` / `closeTask` in its closed `RunActionId` union: pause and close are
`cautionary` (reversible, but they take something away from teams), resume is `routine`.

The panel itself reuses `Card`, `Button`, `Badge`, `EmptyState` and the existing `dialog` confirm
helper, fetches the task list with the one owner-scoped `getGame` the page already performs elsewhere
(`StationQrPrint` does exactly this), and reads live status from the run document the page ALREADY
subscribes to (`onSnapshot`), so a pause pushed by staff appears in the creator's console without a
refresh. Task titles are user-authored, so they render with `dir="auto"`; all Tailwind classes are
static and RTL-logical.

## Risks / Trade-offs

- **A forced pause can still dead-end teams mid-stage.** Accepted and deliberate: the operator is
  shown the numbers and must confirm, the action is audited, and `skipStage` remains the per-team
  recovery. Auto-skipping a stage for every affected team from inside this callable would be a mass
  write on live team documents (D2's contention argument) and is out of scope.
- **`classifyNoAssignment` keeps answering `'none'`** for a team whose only remaining tasks are
  paused, rather than a new `'paused'` reason. Adding a reason value would require play-web to learn
  it; an unknown reason reaching an older client is a worse failure than the existing dead-end copy.
  Recorded as a follow-up, not smuggled in here.
- **The override map grows by one entry per touched task.** Bounded by the number of tasks in a game
  and written only by a human clicking a button.

## Test Strategy

RED first, pure lane, `packages/shared/src/liveTaskStatus.test.ts`:

1. `effectiveTaskStatus`: override wins over template; template used when no override; `'active'`
   when neither; unknown / empty / non-string / null at either level falls back rather than throwing;
   an override for a DIFFERENT task id does not affect this one.
2. Transitions: `active -> paused`, `paused -> active`, `active -> closed`, `closed -> active` all
   plan `ok`; `from === to` plans `ok` with `noop: true`.
3. Invalid values: `undefined`, `''`, `'PAUSED'`, `'disabled'`, `42`, `null` are rejected with
   `unknownStatus` and no plan.
4. A task already held by teams: `teamsHolding: 3` -> plan is `ok`, `holdersKeepTask: true`,
   `teamsHolding: 3` (pausing never revokes).
5. Partial-completion stage still satisfiable: 4 tasks, `requiredTaskCount: 2`, pause one ->
   `availableAfter: 3`, `requiredCount: 2`, `stageUnwinnable: false`.
6. Partial-completion stage made unsatisfiable: 4 tasks, `requiredTaskCount: 3`, two already paused,
   pause a third -> `availableAfter: 1`, `requiredCount: 3`, `stageUnwinnable: true`.
7. `requiredTaskCount` absent (all tasks required) -> pausing any task makes the stage unwinnable.
8. `requiredTaskCount` larger than the task count is clamped to the task count, matching
   `applyStageCompletion`.
9. RESUMING is never unwinnable, even from a fully paused stage.
10. Empty stage -> rejected with `emptyStage`, no plan.
11. Task not in the given stage -> rejected with `taskNotInStage`.
12. Totality sweep: every combination of {valid, invalid} x {present, absent} override and template
    value returns an object, never throws.

Plus the existing routing tests must stay green with the new optional parameter
(`assignNextTask.test.ts`, `assignNextTask.reason.test.ts` call the old arities).

Emulator lane, NOT run here (`scripts/e2e-verify.mjs` is owned by another lane this session):
the assertions owed are enumerated in `tasks.md` section 6 and in the final report. The callable
coverage guard means `setRunTaskStatus` ships RED until a scenario invokes it.
