# Tasks — skip-single-task

## RED

- [x] 1. Write `scripts/test-skip-single-task.ts` against the not yet existing
      `planTaskSkip` (`packages/shared/src/taskSkip.ts`): every row of design §2 D1's table, the
      refusal reasons (`taskNotInStage`, `taskAlreadyTerminal`), `heldSlot`, unset / `NaN` /
      negative / oversized `requiredTaskCount`, exclusive groups (one alternative skipped vs all of
      them), `remainingTaskIds` content + order, purity (no mutation of the inputs), and that no
      output is ever `NaN` or negative. Run `npx tsx scripts/test-skip-single-task.ts`, confirm it
      fails because the module does not exist. Record the RED output.

## GREEN

- [x] 2. Create `packages/shared/src/taskSkip.ts`: `SkipTaskPlan`, `SkipTaskProblem`,
      `planTaskSkip()`. Pure, no Firebase import, built on `maxCompletableTasks` from
      `./mutualExclusion` so the ceiling has one definition. Export from `packages/shared/src/index.ts`.
      Re run the pure test, confirm GREEN.
- [x] 3. Move `assertStaffOrOwner` from `functions/src/index.ts` into `functions/src/auth.ts`
      (design D5) and import it back into `functions/src/index.ts`. No behaviour change.
- [x] 4. Implement `skipTaskForTeam` in `functions/src/runs/index.ts` per design §3: staff/owner
      gate, finished run refusal, one team transaction, `planTaskSkip` + `applyStageCompletion`,
      whole array `stages` rewrite, post commit `releaseTask` for the skipped task and every auto
      skipped leftover, best effort `assignNextInActiveStage`, `writeAuditLog('task_skipped')`,
      forced leaderboard refresh.
- [x] 5. Re export `skipTaskForTeam` from `functions/src/index.ts`.
- [x] 6. Declare `skipTaskForTeam` in `PRIVILEGED_CALLABLES`
      (`scripts/lib/callableHardening.mjs`) with its reason. Run
      `npx tsx scripts/test-callable-hardening.ts`, confirm green (it proves the callable carries
      both an auth marker and an audit write).
- [x] 7. Typed wrapper `skipTaskForTeam` in `apps/creator-web/src/services/calls.ts`.
- [x] 8. Extend `scripts/e2e-verify.mjs`:
      - new scenario `single task skip (one mission, same stage, no stage jump)`:
        a 3 task stage requiring 3; the team is holding task A; owner skips with no `taskId`;
        assert A is `skipped` with `earnedScore` 0, the stage is **still active**, B and C are still
        playable, `run.taskCounts[A]` came back to 0, the response carries a `nextTaskId` inside the
        same stage, the team's score did not move, and the stored stage `requiredTaskCount` dropped
        to 2; then the team completes B and C and the stage completes normally and the run finalizes;
        a second skip of the SAME task id is refused (`failed-precondition`) and writes nothing;
        skipping the last playable task of a stage DOES complete the stage (and only then);
        run scoped staff may skip (the allowed side of authz); the `auditLogs` record exists with
        `actionType: 'task_skipped'`, the team id, the task id and the operator's reason;
        `skipStage` still skips the whole stage (the regression guard for "this is an addition").
      - denial matrix rows: `['participant', pl, 'skipTaskForTeam', …]`,
        `['stranger', str, 'skipTaskForTeam', …]`,
        `['other-run staff', staffB, 'skipTaskForTeam', …]`.
- [x] 9. Creator console: `skipTask` in `RunActionId` + `SEVERITY` (cautionary, like `skipStage`)
      in `apps/creator-web/src/lib/runConsoleActions.ts`, the matching cases in
      `apps/creator-web/src/lib/__tests__/runConsole.test.ts`, one button on the team row in
      `RunConsolePage.tsx` (confirm dialog, `aria-label`, `loadTeams()` after), HE + EN copy in
      `apps/creator-web/src/i18n.ts`.

## REFACTOR / VERIFY

- [x] 10. `npx tsx scripts/check-i18n.ts --strict` — clean, zero new PART B findings.
- [x] 11. `npx vitest run src/runs` inside `functions/` — the run domain's co located suites still pass.
- [ ] 12. Full gate set, run by the parent lane (shared must be rebuilt first, this change adds a
      module to `packages/shared`): `npm run verify` then `npm run verify:emulator` (never
      concurrently, both rewrite `packages/shared/dist`).
- [ ] 13. **NOT RUNNABLE HERE.** `npx openspec validate skip-single-task --strict` — the `openspec`
      CLI is not installed in this repo or globally (`npx openspec` exits with
      "could not determine executable to run"), so the artifacts were validated by reading them
      against `openspec/config.yaml`, not by tooling. Leave open until the CLI is available.
