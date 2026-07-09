## 1. Shared predicate + validator — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `scripts/test-gating.ts` asserting `isUnlocked` (absent/empty gate → unlocked; all-met → unlocked; partially-met/unmet → locked) and `validateUnlockGraph` (self-reference error; unknown/cross-stage id error; 2-cycle + 3-cycle errors; valid diamond DAG → no errors; `requiredTaskCount` > reachable → warning). Run `npm test`, confirm it fails for the right reason (module missing).
- [x] 1.2 GREEN: implement `isUnlocked` + `validateUnlockGraph` in `packages/shared/src/gating.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types
- [x] 2.1 Add `unlockAfterTaskIds?: string[]` to `Task` (doc comment: same-stage ids, AND semantics, not secret). `npm run typecheck`.

## 3. Server enforcement (functions)
- [x] 3.1 `routing/assignNextTask.ts`: drop `!isUnlocked(t, completedTaskIds)` candidates in BOTH `buildRecommendations` and the `assignTask` transaction filter.
- [x] 3.2 `runs/index.ts` `completeTaskForTeam`: inside the transaction, refuse an un-unlocked `gameTask` with `failed-precondition` (completed ids from the freshly-read `team.stages`).
- [x] 3.3 `games/index.ts` `updateGame`: run `validateUnlockGraph` per stage when `stages` is present; throw `invalid-argument` on errors. `npm run typecheck`.

## 4. e2e — allowlist + scenario
- [x] 4.1 Add `unlockAfterTaskIds` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs`.
- [x] 4.2 Add the `unlockable tasks` scenario: routing never assigns locked B first; direct `completeTask(B)` → `failed-precondition`; complete A → B assigns + completes; sanitized B payload carries `unlockAfterTaskIds` and stays allowlisted; cyclic `updateGame` → `invalid-argument`.
- [ ] 4.3 `npm run e2e` — green (batch gate).

## 5. creator-web — Builder authoring
- [x] 5.1 `TaskWizard.tsx`: collapsible "Unlocks after…" sibling-task multi-select writing `unlockAfterTaskIds` (empty ⇒ undefined); save guard runs `validateUnlockGraph` (errors block, warnings inline).
- [x] 5.2 creator-web i18n keys (`unlockAfterLead`, `unlockAfterNone`, `unlockCycleError`, `unlockRequiredCountWarn`) EN + HE.

## 6. play-web — locked rendering
- [x] 6.1 `PlayScreen.tsx`: stage task list renders a locked row (🔒 + title + "complete X first" from prerequisite titles) using shared `isUnlocked` + `team.stages` completed ids.
- [x] 6.2 play-web i18n keys (`lockedTaskLabel`, `lockedCompleteFirst`) EN + HE.

## 7. Gates
- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm test` (gating pure test green)
- [x] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e`
- [x] 7.6 `npm run i18n:check` (clean; `i18n:check:strict` adds zero new findings)
