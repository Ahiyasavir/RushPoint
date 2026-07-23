## 1. RED — the pure decision, failing first

- [x] 1.1 Write `packages/shared/src/liveTaskStatus.test.ts` (vitest) covering the twelve groups in
      the design's Test Strategy: resolution order and totality, every permitted transition, no-ops,
      rejected values, a task held by teams, a partial-completion stage still satisfiable, one made
      unsatisfiable, an absent `requiredTaskCount`, a `requiredTaskCount` above the task count, a
      resume from a fully paused stage, an empty stage, and a task not in the stage.
- [x] 1.2 Run the shared vitest and confirm it FAILS because the module does not exist. Record the
      failure verbatim.

## 2. GREEN — the pure module

- [x] 2.1 Add `packages/shared/src/liveTaskStatus.ts` per D1/D3/D4/D5: `LIVE_TASK_STATUSES`,
      `isStationStatus`, `effectiveTaskStatus`, `isTaskAssignable`, `planTaskStatusChange`. Pure,
      total, no I/O.
- [x] 2.2 Export it from `packages/shared/src/index.ts`.
- [x] 2.3 Add `taskStatusOverrides?: Record<string, StationStatus>` to `Run` in
      `packages/shared/src/types/index.ts`, documented as run scoped and server written.
- [x] 2.4 Re-run the shared vitest — GREEN.

## 3. GREEN — routing honours the override

- [x] 3.1 `functions/src/routing/assignNextTask.ts`: `getRunRouting` also returns
      `taskStatusOverrides`; the three existing paused/closed filters (`buildRecommendations`,
      `classifyNoAssignment`, `assignTask`) call `isTaskAssignable(t, overrides)` instead of
      comparing `t.status` inline. `classifyNoAssignment` takes the overrides as a trailing OPTIONAL
      parameter so existing call sites and tests keep their arity.
- [x] 3.2 Confirm `assignNextTask.test.ts` and `assignNextTask.reason.test.ts` still pass unchanged.

## 4. GREEN — the callable

- [x] 4.1 `functions/src/index.ts`: `setRunTaskStatus` via `loggedCallable`, `assertStaffOrOwner`
      first, payload validation (ids required, status validated by `isStationStatus`), read game +
      run + holder count (`where('activeTaskId','==',taskId)`), `planTaskStatusChange`, refuse with
      `failed-precondition` + `details.code === 'stageUnwinnable'` unless `force`, then the
      transactional whole-map write (no dotted keys), then `writeAuditLog`.
- [x] 4.2 Re-export from the callable surface (`functions/src/index.ts` already IS the surface —
      verify the export is reachable and not shadowed; a callable missing from the surface
      typechecks, lints and never deploys).

## 5. GREEN — the console control

- [x] 5.1 `apps/creator-web/src/services/calls.ts`: typed `setRunTaskStatus` wrapper. Re-read the
      file immediately before editing (another lane touched it this session).
- [x] 5.2 `apps/creator-web/src/lib/runConsoleLayout.ts`: `taskAvailability` panel id, mapped to
      `gameMechanics`, visible only while the run is live.
- [x] 5.3 `apps/creator-web/src/lib/runConsoleActions.ts`: `pauseTask` / `closeTask` cautionary,
      `resumeTask` routine.
- [x] 5.4 `apps/creator-web/src/pages/RunConsolePage.tsx`: the panel. Existing primitives only, run
      document read from the page's existing snapshot, `dir="auto"` on titles, static Tailwind,
      logical RTL classes, the forced-retry confirm. Re-read the file immediately before editing.
- [x] 5.5 `apps/creator-web/src/i18n.ts`: new `runConsole` keys in BOTH dictionaries, Hebrew in
      Hebrew and English in English, no dashes. Re-read immediately before editing.

## 6. REPORT — the emulator lane this session may not touch

- [x] 6.1 Do NOT edit `scripts/e2e-verify.mjs`. Instead report the assertions owed: a `setRunTaskStatus`
      scenario (pause a task, assert `requestNextTask` never returns it while other tasks remain;
      resume it and assert it becomes assignable again), a holder scenario (assign the task, pause
      it, assert the holder can still `completeTask` and is scored), an unwinnable scenario (assert
      `failed-precondition` with `details.code === 'stageUnwinnable'` and that the run document is
      unchanged, then that `force: true` applies it), and four authz-matrix rows
      (participant / stranger / other-run-staff denied, owner and run-staff allowed). Note that the
      callable coverage guard fails the suite until such a scenario exists, so the new callable ships
      RED by design.

## 7. Gates

- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm test`
- [x] 7.4 `npm run creator:build`
- [x] 7.5 `npm run play:build`
- [x] 7.6 `npm run bundle:budget`
- [x] 7.7 `npm run i18n:check:strict` — PART A clean, zero NEW PART B warnings.
- [x] 7.8 `npx openspec validate live-task-pause --strict`
- [x] 7.9 Record verbatim gate output and state what stays unverified (every emulator-bound gate and
      any on-device rendering).
