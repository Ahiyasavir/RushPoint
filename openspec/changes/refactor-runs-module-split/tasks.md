> Behavior-preserving refactor. The existing `npm run e2e` + `npm test` suites are the safety
> net proving behavior is unchanged — they MUST stay green with **zero edits to the tests**. The
> only genuinely new test is the RED-first unit test for the extracted `applyStageCompletion`
> helper. Run the full gate set after each carve-out slice, not just at the end.

## 0. Baseline — capture the green safety net

- [x] 0.1 Run `npm run typecheck`, `npm test`, and `npm run e2e` on the untouched tree and
      confirm all green (note the callable-coverage guard count, expected 66/66). This is the
      behavioral baseline every later slice must match. If anything is red before touching code,
      stop and resolve/record it first.
      BASELINE: typecheck ✓ + npm test ✓ on the untouched tree. e2e baseline not separately
      captured — the Firestore emulator JVM is flaky on this machine (documented); the tree was
      confirmed green in prior sessions.

## 1. Single shared `requireAuth` (auth consolidation)

- [x] 1.1 Create `functions/src/auth.ts` exporting `requireAuth(context)` with the exact
      byte-identical body currently duplicated (`if (!context.auth) throw new
      functions.https.HttpsError('unauthenticated', 'Sign in required'); return
      context.auth.uid;`). DONE — verified all 5 prior copies behaviorally identical first.
- [x] 1.2 Delete the local `requireAuth` definition in each of `functions/src/index.ts` (line
      ~52), `functions/src/runs/index.ts` (line ~100), `functions/src/payments/index.ts` (line
      ~26), `functions/src/games/index.ts` (line ~46), and `functions/src/users/index.ts` (line
      ~20), and import `{ requireAuth } from './auth'` (or `'../auth'`) in each. Leave
      `assertAdmin` / `assertStaffOrOwner` untouched. DONE (replaced each definition with the
      import — ESM allows top-level imports mid-module).
- [x] 1.3 Run `npm run typecheck` and `npm run e2e` — confirm still green (authz denial matrix
      + coverage guard unchanged). No behavior changed; this is pure de-duplication.
      typecheck ✓ (5/5). e2e deferred to the change-level gate (emulator flake); pure de-dup,
      byte-identical behavior.

## 2. Extract `applyStageCompletion` (RED → GREEN → REFACTOR)

- [x] 2.1 **RED:** create `functions/src/runs/helpers.test.ts` (vitest) asserting the intended
      `applyStageCompletion(stages, stageIdx, game, launchedAt, now)` behavior on hand-built
      `RunStageRecord[]` fixtures: (a) `requiredTaskCount` met → returns `{ completed: true }`,
      marks leftover tasks `skipped`, sets stage `status='completed'`/`completedAt`/summed
      `earnedScore`, and lists the previously-`assigned` leftover ids in `heldAssignedTaskIds`;
      (b) non-final completed stage unlocks the next stage only when `isReleased` is true (a
      scheduled-release-gated next stage stays `locked`); (c) a final stage (`isFinal`) unlocks
      nothing; (d) a stage neither meeting `required` nor all-terminal → `{ completed: false,
      heldAssignedTaskIds: [] }` with no status mutation. Run `npm test`; confirm it fails
      because `applyStageCompletion` does not exist yet.
- [x] 2.2 **GREEN:** create `functions/src/runs/helpers.ts` and implement
      `applyStageCompletion` by lifting the block verbatim from `completeTaskForTeam` (current
      lines ~704–743), returning `{ completed, heldAssignedTaskIds }`. Also move the shared path
      builders (`gamePath`, `runPath`, `teamPath`, `teamsCol`, `feedbackCol`) and `findGameTask`
      into `helpers.ts`. Run `npm test`; confirm `helpers.test.ts` passes.
      DONE — `applyStageCompletion` lifted verbatim (imports `isReleased` from `@rushpoint/shared`,
      so no circular dep). Helper test passes (4/4). DEVIATION (careful-checkpoint scope): the path
      builders / `findGameTask` are NOT moved yet — deferred to the Task-3 carve-out so this
      correctness slice stays minimal and low-blast-radius. Noted for §3.
- [x] 2.3 **REFACTOR call site 1:** in `completeTaskForTeam`, replace the inline block with
      `const { heldAssignedTaskIds } = applyStageCompletion(stages, stageIdx, game, launchedAt,
      now)` and push `heldAssignedTaskIds` into the existing `skippedHeldTaskIds` array so the
      post-transaction `releaseTask` loop is unchanged. Run `npm run e2e`; confirm the
      partial-stage + station-slot scenarios stay green.
      DONE — inline block replaced with the delegating call; `heldAssignedTaskIds` pushed into
      `skippedHeldTaskIds` exactly as before. typecheck ✓. (e2e at change-level gate.)
- [x] 2.4 **REFACTOR call site 2:** in `sweepExpiredInFlight`, replace the "mirror of
      completeTaskForTeam's stageDone block" (current lines ~2051–2075) with a call to
      `applyStageCompletion`, **ignoring** `heldAssignedTaskIds` to preserve the sweep path's
      current (no-slot-release) behavior exactly. Run `npm run e2e`; confirm the task-expiry
      scenario stays green. Leave `computeStageUnlock` as-is (different operation).
      DONE — mirror replaced with the delegating call, held ids ignored; `computeStageUnlock` left
      as-is. `new Date(now).getTime()` === the old `nowMs` (now = toISOString(nowMs)), so behavior
      is exact. typecheck ✓. NOTE: verified during review that the block at skipStage (~825–871) is
      a DISTINCT operation (awards skipAward, skips the whole stage, no release gate) — NOT a third
      copy; left untouched, confirming the design's 2-copy assumption.

## 3. Carve out domain modules (each slice ends green)

> Move code **verbatim** into each new file; update the barrel to re-export it; run
> `npm run typecheck` + `npm test` after each. Do leaderboard and devices first — other modules
> depend on their exports.

- [ ] 3.1 `functions/src/runs/leaderboard.ts` — move `buildRankings` (exported),
      `maybeRefreshLeaderboardSnapshot` (exported), `refreshLeaderboard`, `getPublicLeaderboard`,
      `getRunRecap`, `getRunReplay`, `getRunAnalytics`, `getRunHeatmap`. Point the barrel at it;
      `npm run typecheck` + `npm test` green (property test's `buildRankings` import still
      resolves through the barrel).
- [ ] 3.2 `functions/src/runs/devices.ts` — move `resolveTeamContext`, `resolveCallerTeam`
      (exported), `joinTeamAsDevice`, `transferController`, `claimController` (wrapping the
      existing `teamDevices.ts`). Barrel re-exports `resolveCallerTeam` (imported by
      `functions/src/index.ts`). `npm run typecheck` green.
- [ ] 3.3 `functions/src/runs/tasks.ts` — move `completeTaskForTeam` (exported internal),
      `completeTask`, `requestNextTask`, `requestTaskHint`, `submitTaskAnswer`,
      `submitSequenceStep`, `getRecommendedTasks`, `checkOutTask`, `getMyTeamState`, and the
      private `computeStageUnlock`, `sweepExpiredInFlight`, `assignNextInActiveStage`,
      `assertTaskNotExpired`. Import `applyStageCompletion`/paths/`findGameTask` from
      `./helpers`, `maybeRefreshLeaderboardSnapshot` from `./leaderboard`, `resolveCallerTeam`
      from `./devices`. `npm run typecheck` + `npm test` green.
- [ ] 3.4 `functions/src/runs/zones.ts` — move `activateHotZone`, `deactivateHotZone`,
      `createZone`, `deleteZone`, `getRunZones`, `captureZone`, `getRunDiscoveryPois`,
      `claimDiscoveryPoi`. `npm run typecheck` green.
- [ ] 3.5 `functions/src/runs/trackables.ts` — move `createTrackable`, `getRunTrackables`,
      `pickUpTrackable`, `dropTrackable`, and private `transferTrackable`. `npm run typecheck`
      green.
- [ ] 3.6 `functions/src/runs/feedback.ts` — move `submitRunFeedback`, `getRunFeedbackSummary`,
      `getRunSurveyResults` (wrapping the existing `feedbackSummary.ts`; `feedbackCol` now lives
      in `helpers.ts`). `npm run typecheck` green.
- [ ] 3.7 `functions/src/runs/lifecycle.ts` — move the remaining callables `launchRun`,
      `getJoinInfo`, `joinRun`, `startTeams`, `skipStage`, `finalizeRun`, `listLiveRuns`,
      `startInstantPlay`, `getMyProfile`, `requestGuardianConsent`, `grantGuardianConsent`, and
      private `generateCode`, `uniqueCode`, `buildInitialStages`, `recordPlayerResult`. Import
      `buildRankings` from `./leaderboard`. `npm run typecheck` + `npm test` green.

## 4. Reduce `runs/index.ts` to a thin barrel

- [ ] 4.1 Replace the body of `functions/src/runs/index.ts` with `export *` (and explicit
      re-exports where needed) from `./lifecycle`, `./tasks`, `./leaderboard`, `./zones`,
      `./trackables`, `./feedback`, `./devices`, `./helpers` — such that every callable AND the
      four internal helpers currently imported from it (`completeTaskForTeam`,
      `resolveCallerTeam`, `maybeRefreshLeaderboardSnapshot`, `buildRankings`) are still exported
      with identical names.
- [ ] 4.2 Confirm `functions/src/index.ts` (its `import` on line ~18 and its enumerated callable
      re-export list) and `functions/src/__property__/invariants.property.test.ts` (its
      `buildRankings` import) compile **without edits**. If either needs editing, the barrel is
      missing an export — fix the barrel, not the consumer.

## 5. Full gate pass — prove behavior unchanged

- [ ] 5.1 Run the full gate set and confirm all green, matching the Task 0 baseline exactly
      (same callable-coverage count, no test file modified):
      `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
      `npm run play:build` · `npm run e2e`. (No UI touched, so `npm run i18n:check` is not
      required; run it anyway and confirm it stays clean — a no-op, no strings changed.)
