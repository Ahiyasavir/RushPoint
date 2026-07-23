> **Status.** Groups 1–3 are implemented and verified in code
> (`adaptiveDifficultyMatch` in `functions/src/routing/assignNextTask.ts`, no `skillAware`
> parameter anywhere; `requiredTaskCount: 1` in `BuilderPage.blankStage` and the
> `templates.ts` `stage()` factory). What is left is listed below and is **not** silently
> pending — each open box says why it is open.

## 1. Adaptive routing — RED then GREEN (pure routing math, TDD)

- [x] 1.1 RED: in `functions/src/routing/assignNextTask.test.ts` add a `priorityScore — adaptive difficulty` describe with two equidistant, equal-load candidates differing only in `difficulty` (easy=2, hard=9): a **strong** team (`skillRatio -0.8`) must score `hard > easy`; a **weak** team (`skillRatio +0.8`) must score `easy > hard`; a **neutral** team (`skillRatio 0`) with difficulties symmetric around 5 (2 and 8) must score them **equal**. Write these against the NEW `priorityScore` signature (no `skillAware` arg). Run `npm test`, confirm they fail for the right reason (wrong direction / signature).
- [x] 1.2 GREEN: in `functions/src/routing/assignNextTask.ts` rename `skillMatch` → `adaptiveDifficultyMatch` and flip the target to `−skillRatio` (`1 - Math.abs(-skillRatio - normalizedDifficulty)`); make `priorityScore` always apply it with the unified `0.5·load − 0.3·transit + 0.2·adaptive + zoneBonus` formula; remove the `skillAware` parameter from `priorityScore`, `buildRecommendations`, and `assignTask`. `npm test` → 1.1 passes.
- [x] 1.3 Update the existing `priorityScore — hot-zone routing bias` tests to the new signature (drop the `false` skillAware argument); confirm they stay green (their tasks are difficulty 5 → adaptive term constant → asserted differences unchanged).

## 2. Wire call sites (functions/src/runs/index.ts)

- [x] 2.1 `assignNextInActiveStage`: drop the `game.scoringPreset === 'smart_weighted'` argument from the `assignTask(...)` call.
- [x] 2.2 `getRecommendedTasks`: drop the trailing preset argument from the `buildRecommendations(...)` call. `npm run typecheck` (all workspaces) green.

## 3. Default requiredTaskCount = 1 for new stages (creator-web)

- [x] 3.1 `apps/creator-web/src/pages/BuilderPage.tsx` `blankStage`: return `requiredTaskCount: 1` alongside the blank task.
- [x] 3.2 `apps/creator-web/src/templates.ts` `stage()` factory: default `requiredTaskCount: 1` (still overridable via the `over` spread).
- [x] 3.3 Verify the completion-rule control (`m > 1` block, ~L714) reads correctly with the new default ("complete 1 of N — best-suited, others skipped"); adjust `completion*` copy ONLY if misleading, keeping EN+HE parity via `t.*` (no hardcoded strings).

## 4. Verification via preview + i18n (UI)

- [ ] 4.1 **NOT DONE — deliberately skipped.** Browser-preview check of creator-web: add a stage, add
  a 2nd task → the completion control appears defaulting to "1 of 2 (routed)"; changing it to a
  higher count / all still works. Skipped because driving the preview means starting a creator-web
  dev/preview server on this machine, where an always-on `playtest:prod` stack owns the app ports
  and the emulator, and a build would write the directories that stack serves. The underlying
  default is covered non-visually: `blankStage` and the `stage()` factory both return
  `requiredTaskCount: 1`, and the `clampRequiredTaskCount` arithmetic the control reads is pinned by
  `scripts/test-builder-dnd.ts`. Run this at the next natural stack restart.
- [x] 4.2 `npm run i18n:check` clean (and `npm run i18n:check:strict` adds zero new findings if any copy changed).

## 5. Full gate set (final)

> Open on purpose: these are the branch-wide gates, owed by the lane that commits this branch.
> They were **not** run from the change lane — `npm run verify` rewrites `packages/shared/dist`
> in place and builds `apps/*/dist`, and other agents plus a live playtest stack are on this
> tree. Do not tick them from a doc pass; tick them from the run that actually executes them.

- [ ] 5.1 `npm run typecheck` — all workspaces green.
- [ ] 5.2 `npm run lint` — creator-web eslint, 0 errors.
- [ ] 5.3 `npm test` — routing vitest (adaptive + hot-zone) + all pure lanes green.
- [ ] 5.4 `npm run creator:build` and `npm run play:build` — both pass.
- [ ] 5.5 `npm run e2e` — full lifecycle vs emulator stays green (partial-stage scenario still exercises `requiredTaskCount`; no new callable).
- [ ] 5.6 `npm run i18n:check` — clean.
