## Context

`TaskEditor` is a ~170-line flat-scroll modal in `apps/creator-web/src/pages/BuilderPage.tsx`. It is the only place creators configure tasks; it is opened via `setEditing({ stageId, taskId })` and updates the task live through an `onChange` callback. The parent `StepStages` component handles auto-save via the existing `game → debounce → updateGame` pipeline.

The problem is layout, not logic: the task type selector is buried in an "Advanced" accordion, location configuration appears after the name, and first-time creators have no mental scaffolding for which decisions matter most.

No backend, Firestore, or shared-type changes are needed. This is a pure creator-web UI refactor.

## Goals / Non-Goals

**Goals:**
- Replace the `TaskEditor` form body with a 3-step wizard that presents decisions in the order: location → name/difficulty/description → interaction type.
- Extract a pure-logic helper `apps/creator-web/src/lib/wizardLogic.ts` containing `canGoNext`, `canGoBack`, `TASK_TYPE_META`, and `isTaskLocationValid` — all covered by `scripts/test-wizard.ts` (auto-picked up by `node scripts/run-unit-tests.mjs`).
- Preserve every existing `Task` field; no regressions to auto-save, library insert, or onRemove flows.
- All gates pass: `typecheck`, `lint`, `npm test`, `creator:build`, `e2e`.

**Non-Goals:**
- Hebrew i18n for wizard step labels or type descriptions.
- Drag-to-reorder tasks or task duplication from within the wizard.
- AI-assisted task generation.
- Modifying `BuilderPage`'s existing outer 3-step flow (Details / Stages & Tasks / Preview).
- Any play-web, functions/, or packages/shared changes.

## Decisions

### D1 — Extract `wizardLogic.ts` as the testable pure-logic layer

**Decision:** Create `apps/creator-web/src/lib/wizardLogic.ts` exporting:
- `WIZARD_STEPS = [1, 2, 3] as const` and `WizardStep = 1 | 2 | 3`
- `canGoNext(step: WizardStep, task: Task): boolean` — step 1 always true; step 2 requires `task.title.trim() !== ''`; step 3 returns false (last step).
- `canGoBack(step: WizardStep): boolean` — step 2 and 3 return true; step 1 false.
- `isTaskLocationValid(task: Task): boolean` — returns true when `task.locationless === true` OR when `task.coordinates.lat !== 0 || task.coordinates.lng !== 0`.
- `TASK_TYPE_META: Record<TaskType, { label: string; description: string }>` — friendly label + 1-sentence plain-English description for all 8 types.

**Why over inlining in the component:** inline predicates cannot be unit-tested without rendering. Extracting them ensures the navigation guard (`title required on step 2`) and the locationless exemption are provably correct without spinning up a browser.

### D2 — Wizard step state is local to `TaskEditor`

**Decision:** Add `const [wizardStep, setWizardStep] = useState<WizardStep>(1)` inside `TaskEditor`. Reset to `1` when the modal opens (handled by React key or explicit reset via `useEffect` on task.id).

**Why not lifting to `StepStages`:** the parent already holds `editing` state; adding wizard step there would require threading it through props for a concern that is entirely modal-internal. The task data itself flows through the existing `onChange` — no need for a separate draft.

**Alternative considered — a separate draft task:** copying task into local draft and only calling `onChange` on Done. Rejected: the existing auto-save pipeline expects live updates, and a draft would require merging on Done which risks losing concurrent edits from other fields.

### D3 — Wizard navigation sits inside the modal body, NOT the outer Modal footer

**Decision:** Render `<WizardNav step={wizardStep} task={task} onBack={…} onNext={…} />` as the last child of the `TaskEditor` `<div>`, before the existing Done button the parent renders. The outer `Modal` continues to render its `<Button className="w-full mt-3" onClick={() => setEditing(null)}>Done</Button>` — it is not changed.

**Why:** the Done/close button belongs to the parent (it calls `setEditing(null)`) — it cannot be owned by `TaskEditor`. Keeping wizard navigation internal to `TaskEditor` means the step counter and canGoNext logic are fully encapsulated.

**Step 3 note:** On step 3, "Next" becomes a no-op (canGoNext returns false); the parent's Done button is the exit. A subtle `← Back` only shows on step 3 to let the creator revise.

### D4 — `TASK_TYPE_META` lives in `wizardLogic.ts`, consumed by `TypePickerGrid`

**Decision:** The 8 `TaskType` entries in `TASK_TYPE_META` define `icon` (reusing the existing `TASK_ICON` record), `label` (plain-English name), and `description` (1-sentence). A new `TypePickerGrid` subcomponent renders the 2-column card grid. Selecting a type calls `onChange` immediately and reveals the inline type-specific config below the grid (the same conditional JSX blocks already in `TaskEditor`, moved here).

**Why a separate subcomponent:** the grid + config blocks total ~80 lines; keeping them in a dedicated `TypePickerGrid` makes `TaskEditor` readable at a glance.

### D5 — Test strategy

**Pure-logic tests** (`scripts/test-wizard.ts`, picked up by the aggregator):
1. `blankTask()` defaults: `locationless` is falsy, `coordinates.lat === 0`, `coordinates.lng === 0`.
2. `canGoNext(2, task)` — `title = ''` → false; `title = 'X'` → true.
3. `canGoNext(1, task)` — always true regardless of coordinates.
4. `isTaskLocationValid` — locationless task with `lat=0, lng=0` → true; located task with `lat=0, lng=0` → false; located task with non-zero coords → true.
5. `TASK_TYPE_META` — every value of `TaskType` is a key; no key is missing; every entry has non-empty `label` and `description`.
6. `canGoBack(1)` → false; `canGoBack(2)` → true; `canGoBack(3)` → true.

**UI verification** (preview tools, post-implementation):
- Open a task tile → wizard step 1 renders map.
- Navigate to step 2 → title input is visible.
- Attempt Next with blank title → stays on step 2 with validation hint.
- Navigate to step 3 → type card grid renders all 8 cards.

**Regression gate:** `npm run e2e` (no callable changes; e2e exercises the full game lifecycle and will catch any task-field regressions if the wizard silently drops a field).

## Risks / Trade-offs

- [Risk: Wizard step resets unexpectedly when auto-save round-trips update the task] → The parent passes the same `task` object identity back through `onChange`; as long as `TaskEditor` uses `task.id` as a React key (or a `useEffect` reset keyed on `task.id`), the wizard step only resets when the editor opens for a *different* task.
- [Risk: Type-specific config blocks lost in refactor] → Each conditional block is moved verbatim into `TypePickerGrid`; the migration task explicitly lists each block to verify.
- [Risk: `hint` and `hintPenalty` fields were previously in Advanced and could be dropped] → Design explicitly moves them to step 2 as first-class fields; the test for `blankTask` coverage implicitly catches if they disappear from the form (the e2e `paid hints` assertion will also catch functional regression).
- [Trade-off: Done button is outside the wizard] → Creators must scroll to the Done button after step 3. Acceptable given the outer Modal already renders it and changing that ownership would require more invasive refactoring with no additional correctness benefit.
