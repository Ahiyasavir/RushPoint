## Why

`Task.status` (`packages/shared/src/types/index.ts:264`, `StationStatus = 'active' | 'paused' | 'closed'`)
is described in the type itself as an "operator override", and routing already ENFORCES it in three
places: the recommendation filter (`functions/src/routing/assignNextTask.ts:172`), the
"why nothing was assigned" classifier (`:286`) and the transactional assignment filter (`:334`).

Nothing in either app ever writes it. A repo-wide search for a writer of `status: 'paused'` on a
task returns no producer: the Builder does not offer it, no callable sets it, and no run document
carries an equivalent. The enforcement exists, the control does not.

That gap is a live-event gap, not a cosmetic one. A shop closes, a street is blocked, a station host
walks away, weather makes a stop unsafe. Today the organizer has exactly two options: let team after
team be routed to a dead stop, or end the run for everybody. A prior lane spotted the gap and
deliberately deferred it as needing its own change. This is that change.

## What Changes

**A run-scoped availability override, written only by a new authorized callable.**

- `Run.taskStatusOverrides?: Record<taskId, StationStatus>` on the run document (server-write-only,
  like every other run field). The GAME TEMPLATE is never touched: the shop is closed today, not
  forever, and the same template is replayed by later runs, duplicated and published to the gallery.
- New callable `setRunTaskStatus({ ownerUid, gameId, runId, taskId, status, reason?, force? })`,
  authorized with `assertStaffOrOwner` (staff on the ground are exactly who notices a stop is dead),
  registered through `loggedCallable`, re-exported from `functions/src/index.ts`, and recorded in
  `auditLogs` because taking a task out of play changes what every team can score.

**Routing honours the override wherever it already honours `Task.status`.** The override is resolved
by one pure function, `effectiveTaskStatus(task, overrides)`, applied at the three existing filter
sites. The run document is ALREADY read at each of those sites (`getRunRouting`, and the run-doc read
inside `assignTask`'s transaction), so enforcement costs zero extra reads.

**A team already holding the task keeps it and can finish it.** The override is applied at
ASSIGNMENT time only, never at completion time. Pausing a stop must not strand the team standing at
it: that is the stuck-player bug class this repo has repeatedly paid for.

**The organizer is told, at the moment they pause, when the pause would break a stage.** The same
pure module computes whether the owning stage can still yield its `requiredTaskCount`. If it cannot,
the callable refuses with `failed-precondition` and machine-readable details; the console renders the
warning and offers an explicit "pause anyway" that re-sends with `force: true`.

**A compact per-task control in the Run Console.** A new `taskAvailability` panel in the existing
"Game systems" group lists the run's tasks with their live availability and a pause / resume / close
control each. Existing primitives, existing action-severity classification, no new dependency, no
layout rewrite.

## Impact

- Affected specs: `live-task-availability` (new capability, ADDED requirements).
- Affected code: `packages/shared/src/liveTaskStatus.ts` (new pure module) + its vitest,
  `packages/shared/src/index.ts` (export), `packages/shared/src/types/index.ts`
  (`Run.taskStatusOverrides`), `functions/src/routing/assignNextTask.ts` (three filter sites +
  `getRunRouting`), `functions/src/index.ts` (the callable + its re-export),
  `apps/creator-web/src/services/calls.ts`, `apps/creator-web/src/lib/runConsoleLayout.ts` (one panel
  id), `apps/creator-web/src/lib/runConsoleActions.ts` (three action ids),
  `apps/creator-web/src/pages/RunConsolePage.tsx` (the panel), `apps/creator-web/src/i18n.ts` (HE+EN).
- NOT touched: the Builder, `Task.status` on the template, completion/scoring, the participant
  sanitizer, any authorization rule, and `scripts/e2e-verify.mjs` (owned by another lane this
  session; the assertions owed are reported instead).
