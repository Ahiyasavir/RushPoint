## 1. RED — pin the ceiling and every site that ignores it

- [x] 1.1 Add `packages/shared/src/mutualExclusion.winnability.test.ts` (vitest) covering
      `maxCompletableTasks`: no groups, three groups of two (the reported case), mixed grouped and
      ungrouped, a one-task group, an empty group, a task listed in two groups, a group naming a
      task of another stage, zero tasks, and the runtime `opts.isAvailable` form (one member of a
      pair unavailable ⇒ the group still counts; both unavailable ⇒ it does not).
- [x] 1.2 Extend `apps/creator-web/src/lib/__tests__/builderFirstTaskFlow.test.ts`: readiness reports
      `stageUnwinnable` for a stage requiring more than its group ceiling, and reports nothing when
      `requiredTaskCount` is undefined.
- [x] 1.3 Extend the `functions` vitest for `stagesProblems`: an unreachable `requiredTaskCount` is a
      problem; a reachable one is not.
- [x] 1.4 Extend `packages/shared/src/liveTaskStatus.test.ts`: pausing one member of a pair does not
      flag `stageUnwinnable`; pausing both does.
- [x] 1.5 Run `npm test` and record the failures verbatim.

## 2. GREEN — one function, every site

- [x] 2.1 `packages/shared/src/mutualExclusion.ts`: implement `maxCompletableTasks(stage, opts?)`;
      keep `maxAttainableCompletions` as a thin alias so existing callers and tests do not move.
      Export from `packages/shared/src/index.ts`.
- [x] 2.2 `packages/shared/src/liveTaskStatus.ts` (ADDITIVE, shared with the live-task-pause lane):
      compute `availableAfter` and `requiredCount` through `maxCompletableTasks`.
- [x] 2.3 `functions/src/games/index.ts` `stagesProblems`: reject
      `requiredTaskCount > maxCompletableTasks(stage)`, naming stage, count and maximum. Covers
      `updateGame` and `importGameFile` in one edit.
- [x] 2.4 `apps/creator-web/src/lib/gameReadiness.ts`: add the ceiling to `stageUnwinnable`.
- [x] 2.5 `apps/creator-web/src/lib/reorder.ts` `clampRequiredTaskCount`: clamp against the ceiling.
- [x] 2.6 `apps/creator-web/src/pages/BuilderPage.tsx`: cap the completion `<Select>` at the ceiling,
      keep a stored out-of-range value visible as a disabled option, explain the cap in the helper
      text, and add the "set it to N" action to the existing warning.
- [x] 2.7 `apps/creator-web/src/i18n.ts` (ADDITIVE, shared file): HE + EN copy for the cap
      explanation and the correction action. No em-dashes.
- [x] 2.8 Re-run `npm test` — green.

## 3. REFACTOR / verify

- [x] 3.1 Confirm no site re-derives the ceiling locally (single-definition check).
- [x] 3.2 Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
- [x] 3.3 `npx openspec validate stage-winnability --strict`.
- [x] 3.4 Report the e2e assertions owed (that lane owns `scripts/e2e-verify.mjs`) and the
      unlock-gate-into-exclusive-group follow-up.
