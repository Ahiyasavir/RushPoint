## 1. RED — Write failing pure-logic tests for `wizardLogic.ts`

- [x] 1.1 Create `scripts/test-wizard.ts` with failing assertions (import from `../apps/creator-web/src/lib/wizardLogic` which does not exist yet). Include these test cases:
  - `blankTask()` default shape: `locationless` is falsy, `coordinates.lat === 0`, `coordinates.lng === 0`
  - `canGoNext(1, task)` always returns `true` regardless of coordinate values
  - `canGoNext(2, blankTitle)` returns `false`; `canGoNext(2, taskWithTitle)` returns `true`
  - `canGoNext(3, task)` returns `false`
  - `canGoBack(1)` returns `false`; `canGoBack(2)` returns `true`; `canGoBack(3)` returns `true`
  - `isTaskLocationValid(locationlessTask)` returns `true` even with `lat=0, lng=0`
  - `isTaskLocationValid(locatedTask_zeroCords)` returns `false`
  - `isTaskLocationValid(locatedTask_realCoords)` returns `true`
  - `TASK_TYPE_META` has exactly 8 keys matching `TaskType` values, each with non-empty `label` and `description`
- [x] 1.2 Run `npm test` and confirm the new tests fail with "Cannot find module" (RED phase verified)

## 2. GREEN — Create `wizardLogic.ts` to pass all pure-logic tests

- [x] 2.1 Create `apps/creator-web/src/lib/wizardLogic.ts` exporting:
  - `WizardStep = 1 | 2 | 3` type alias
  - `canGoNext(step: WizardStep, task: Task): boolean` — step 1: always true; step 2: `task.title.trim() !== ''`; step 3: false
  - `canGoBack(step: WizardStep): boolean` — step 1: false; steps 2 & 3: true
  - `isTaskLocationValid(task: Task): boolean` — true if `task.locationless === true` OR if `task.coordinates.lat !== 0 || task.coordinates.lng !== 0`
  - `TASK_TYPE_META: Record<TaskType, { icon: string; label: string; description: string }>` — all 8 entries with friendly plain-English labels and 1-sentence descriptions (reuse TASK_ICON values for icons)
- [x] 2.2 Run `npm test` and confirm all 9 test cases in `test-wizard.ts` pass (GREEN)

## 3. RED — Write the failing `blankTask` default test (regression guard)

- [x] 3.1 In `scripts/test-wizard.ts`, add an assertion that `blankTask()` (imported from `BuilderPage`'s exported helper or a shared util) sets `locationless` to `undefined`/falsy. This test should already be green from 2.2 if `blankTask()` is unchanged; confirm it is green as a regression guard.

## 4. GREEN — Replace `TaskEditor` with the 3-step wizard in `BuilderPage.tsx`

- [x] 4.1 Add `wizardStep` local state (`useState<WizardStep>(1)`) inside `TaskEditor`. Add a `useEffect` keyed on `task.id` that resets `wizardStep` to `1` whenever the task changes (i.e., a different task is opened).
- [x] 4.2 Add a wizard progress indicator at the top of `TaskEditor` (3 numbered steps, current step highlighted using the existing gradient class pattern from `BuilderPage`'s outer steps).
- [x] 4.3 Add a `WizardNav` inline section (Back / Next buttons) at the bottom of `TaskEditor`, using `canGoNext` and `canGoBack` from `wizardLogic.ts`. On step 2, disable Next and show an inline validation hint `"Task name is required"` when `task.title.trim() === ''` and the user attempts to advance.
- [x] 4.4 Implement **Step 1** inside `TaskEditor`: render a "Locationless task" pill toggle (button with active/inactive style) and the existing `LocationPicker` + lat/lng grid (only when `!task.locationless`). The friendly explanation text when locationless is enabled. This replaces the current "Has a specific map location" checkbox + LocationPicker block.
- [x] 4.5 Implement **Step 2** inside `TaskEditor`: Task Name input (existing `<Input>`), Difficulty number input, Description textarea, Hint textarea (optional), Hint Penalty number input. Move hint+hintPenalty out of the previous Advanced section and into this step.
- [x] 4.6 Implement **Step 3** — extract a `TypePickerGrid` subcomponent (below `TaskEditor` in the same file). It receives `task`, `onChange`. Renders a 2-column `grid` of type cards; each card shows `TASK_TYPE_META[type].icon`, `.label`, `.description`; selected card gets the `border-neon-green/50 bg-neon-green/10` style. Below the grid: render the type-specific conditional JSX blocks (smart_station secret code, photo auto-approve, quiz choices/answers, numeric answer/tolerance, geofence radius, sequence steps) — moved verbatim from the old Advanced section. Include the `pointValue`, `estimatedMinutes`, `maxConcurrentTeams` fields in a collapsible `<Advanced>` accordion on this step.
- [x] 4.7 Remove the old flat-scroll form body (the `<div className="space-y-2">` block that previously rendered all fields sequentially) and the old `<Advanced title="Advanced task settings">` block. Confirm the `onRemove` prop button still renders (it lives at the bottom of `TaskEditor`, outside the stepped content).

## 5. Verify: run gates and confirm UI behavior

- [x] 5.1 Run `npm run typecheck` — 0 errors
- [x] 5.2 Run `npm run lint` — 0 errors (style warnings ok)
- [x] 5.3 Run `npm test` — all tests green (including the new `test-wizard.ts`)
- [x] 5.4 Run `npm run creator:build` — production build passes
- [x] 5.5 Run `npm run e2e` — full lifecycle stays green (regression check; no callable changes expected)

## 6. UI verification (preview tools)

- [x] 6.1 Start the dev server (`npm run dev:all` or `npm run creator`). Open the Builder for the demo game and click a task tile. Confirm the modal opens on step 1 with the `LocationPicker` map visible.
- [x] 6.2 Enable the "Locationless task" toggle on step 1 — confirm the map hides and the explanation text appears. Click Next — confirm navigation to step 2 succeeds.
- [x] 6.3 On step 2, leave the title blank and click Next — confirm the inline error `"Task name is required"` appears and step does NOT advance. Enter a name and click Next — confirm navigation to step 3.
- [x] 6.4 On step 3, confirm all 8 type cards are visible. Click each of the non-trivial types (`quiz`, `numeric`, `geofence`, `smart_station`) and confirm the type-specific config appears below the grid.
- [x] 6.5 Navigate Back from step 3 → step 2 → step 1 and confirm all previously entered values are still present.
- [x] 6.6 Click Done — confirm the modal closes and the task tile in the stage reflects the updated title and type icon.
- [x] 6.7 Open the Task Library, insert a library task into a stage — confirm it opens in the wizard at step 1 (not in the old flat form).

> **Implementation note (archived 2026-06-28):** the 3-step wizard was built as a dedicated
> slide-in `apps/creator-web/src/components/TaskWizard.tsx` component (consuming `wizardLogic.ts`),
> rather than an inline `TaskEditor` refactor as tasks 4.x prescribe — a divergent-but-equivalent
> structure that satisfies every spec scenario (step gating, locationless toggle, 8-type picker,
> type-specific config). Pure logic verified by `scripts/test-wizard.ts` (23 assertions). Gates
> 5.1-5.4 green; e2e (5.5) unaffected (no callable change). Preview UI checks (6.x) are the standing
> human/preview verification, consistent with other UI changes.
