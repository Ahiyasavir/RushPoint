## Why

The product owner: *"When someone skips a mission for a team it skips the whole stage, it should skip
that specific mission."*

Today the run console offers exactly one skip control per team, and it is wired to `skipStage`
(`functions/src/runs/index.ts:1131`). That callable marks **every** non completed task of the team's
active stage as `skipped`, completes the stage, and unlocks the next one. So when a single stop is
unreachable for one team, a stuck riddle, a closed shop, a member with a hurt ankle, the organiser's
only tool wipes out the rest of the stage as well. A team that was two tasks from finishing a five
task stage loses three tasks it could still have played, and the run console has no way to give them
back.

`setRunTaskStatus` does not solve it either: it is RUN scoped (it takes a stop out of play for
**every** team) and it deliberately does not touch a team that already holds the task.

There is no per team, per task escape hatch, which is exactly the granularity a live event needs.

## What Changes

**A new privileged callable skips ONE task for ONE team and keeps the team inside the same stage.**

- New `skipTaskForTeam` callable in `functions/src/runs/index.ts`, re exported from
  `functions/src/index.ts`, with a typed wrapper in `apps/creator-web/src/services/calls.ts`.
  **Owner or run scoped staff** may call it (the console is used by marshals, not only the creator),
  and it writes a durable `auditLogs` record, like every other privileged override.
- The named task, or, when no `taskId` is given, the task the team is currently holding, is marked
  `skipped` with an earned score of **exactly zero**. `skipStage`'s consolation `skipAward` is
  deliberately NOT paid: this is a single mission the organiser is removing, not a stage the
  organiser is compensating for.
- **The stage does not advance** unless the skip genuinely completes it. The team is routed to the
  next task **in the same stage**, through the ordinary assignment path, so station caps, exclusive
  groups, unlock gates, expiry, scheduled release and the run's live pause overrides all still apply.
- **The team is never dead ended.** A skip that puts the stage's `requiredTaskCount` out of reach
  lowers that team's stored requirement for that stage, by the smallest amount that keeps the stage
  winnable. The ceiling is the existing `maxCompletableTasks()` (exclusive groups yield one
  completion each), so the arithmetic matches the Builder and the live pause guard.
- **The station slot is released.** Skipping a task the team was holding decrements
  `run.taskCounts[taskId]` through the same guarded `releaseTask` every other path uses, so a skip
  can never leak capacity at that stop.
- **The skipped task never comes back to that team.** `skipped` is a terminal status, and the routing
  candidate filter only ever considers `unassigned` records.
- **Live and final standings cannot drift.** The skip writes a stored `earnedScore: 0` record and
  never touches `startedAt`, `finishedAt` or `excludedMs`, so `buildRankings` stays a pure function
  of the stored team document.
- **`skipStage` is untouched.** This is an addition. The console keeps "skip the stage" and gains
  "skip this mission".
- Creator console: one extra button on the team row, with HE + EN copy, calling the new callable with
  no `taskId` (the team's current mission).

## Non-goals

- **No un skip / restore.** A skipped record stays skipped; reversing it would have to re invent the
  routing reservation and the scoring it already bypassed. The organiser can still adjust the score.
- **No change to `skipStage`'s behaviour or its `skipAward` consolation.**
- **No participant facing self skip.** Only the owner and run scoped staff can skip a mission; a
  participant skipping their own hard tasks is a scoring exploit.
- **No RUN wide skip.** Taking a stop out of play for everyone is already `setRunTaskStatus`.
- **No template mutation.** Nothing here writes to the game template; the effect is confined to the
  one team document (plus the run's `taskCounts`), exactly like every other run scoped override.
- **No play-web change.** The participant simply sees a new task on their next poll.

## Impact

- Affected specs: `skip-single-task` (new)
- Affected code: `packages/shared/src/taskSkip.ts` (new), `packages/shared/src/index.ts`,
  `functions/src/runs/index.ts`, `functions/src/index.ts`, `functions/src/auth.ts`,
  `apps/creator-web/src/services/calls.ts`, `apps/creator-web/src/lib/runConsoleActions.ts`,
  `apps/creator-web/src/pages/RunConsolePage.tsx`, `apps/creator-web/src/i18n.ts`,
  `scripts/lib/callableHardening.mjs`, `scripts/e2e-verify.mjs`,
  `scripts/test-skip-single-task.ts` (new)
- **Surfaces touched:** a new callable, shared pure logic, creator-web. No Firestore rule change, no
  new index, no new env var, no play-web change, no participant facing wire format change.
- ⚠ `packages/shared` gains a module, so `packages/shared/dist` must be rebuilt before the
  typecheck / build gates run.
