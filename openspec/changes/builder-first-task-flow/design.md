## Context

The Builder's task editor is `apps/creator-web/src/components/TaskWizard.tsx` (1043 lines), driven by
two pure modules, `src/lib/wizardLogic.ts` (110 lines) and `src/lib/wizardSections.ts` (99 lines), and
hosted by `src/pages/BuilderPage.tsx` (1506 lines).

**The gate.** `blankTask()` (`wizardLogic.ts:17-29`) ships `coordinates: { lat: 0, lng: 0 }`
(`:22`) and no `triggerMode`, so `normalizeTriggerMode` resolves to a located mode and
`isTaskLocationValid` (`:38-41`) is false. `TaskWizard.tsx:74` turns that into
`stepValid`, and `:119` disables **Next** on it. The wizard's steps are ordered
`1 Location → 2 Details → 3 Interaction` (`wizardLogic.ts:3-4, 31-35`; bodies at
`TaskWizard.tsx:103-105`), so the name field (`DetailsStepBody`, `:406-417`) and the type picker
(`InteractionStepBody`, `:791-838`) both sit behind a pin the creator has not dropped and behind the
lazily-loaded MapLibre chunk that `LocationStep` pulls in. The gate is also one-sided: the step tabs
at `TaskWizard.tsx:81-92` call `setStep(s)` with no condition, so it only slows a creator who uses the
control the interface points at.

**The dead code.** `src/lib/taskTemplates.ts` holds `applySample()` (`:19-30`) and `TASK_SAMPLES`
(`:34-201`) — **13** authored samples covering all 9 task types. A repository-wide grep for
`TASK_SAMPLES`, `applySample` and `loadSampleFor` returns only: the two test lanes
(`src/components/__tests__/BuilderRedesign.test.ts:15, 71-86` and
`scripts/test-builder-redesign.ts:84-97`), the module itself, and two orphan dictionary entries
`loadSampleFor` at `src/i18n.ts:728` (Hebrew) and `:1622` (English). **No component imports either
symbol.** It is fully authored, doubly tested, and unreachable.

**Error-on-open.** `QuizChoicesEditor.tsx:34-39` seeds two empty rows to invite multiple-choice
authoring, then `:47` computes `anyCorrect` over them and `:92-96` renders `quizNeedsCorrect`
immediately. `OrderingItemsEditor` pads its row list to `ORDER_ITEMS_MIN` (`TaskWizard.tsx:274-278`)
and then errors on the padding at `:298-304`. `TaskWizard.tsx:109-111` renders
`interactionIncomplete` whenever `isTaskInteractionValid` (`wizardLogic.ts:63-85`) is false, which is
true for every brand-new quiz, numeric, station and sequence task, and `:121` disables **Done** on the
same predicate.

**Launch alerts.** `saveAndLaunch` (`BuilderPage.tsx:288-335`) runs four sequential guards, each a
`dialog.alert` naming one offender followed by `return`: empty stage (`:293-295`), incomplete answer
key (`:300-303`), unpinned task (`:308-311`), unwinnable stage (`:315-321`). Nothing surfaces any of
them before a launch is attempted, and each attempt reveals at most one.

**Two bugs.** `wizardSections.ts` documents its own invariant at `:10-14` ("a section opens only when
it already carries authored content"; "the `n` badge the collapsed header shows, so the at-rest form
still tells you what is configured"), then breaks it for `advanced`: `defaultOpenSections`
hardcodes `advanced: false` (`:65`) and `sectionSummary` hardcodes `advanced → 0` (`:80-83`). A task
with `expiresAfterMinutes` set is therefore invisible at rest. Separately, `TaskWizard.tsx:1014-1016`
warns when `task.releaseAt && task.expiresAfterMinutes`; `Task.releaseAt`
(`packages/shared/src/types/index.ts:337`) is honored by the server (`functions/src/runs/index.ts:2887`,
`functions/src/index.ts:934, 1067`) but the Builder has **no editor for it** — nor for task-level
`releaseAfterMinutes`, which is what the sibling branch at `:1012` (`validateAvailabilityWindow`,
`packages/shared/src/schedule.ts:133-141`) tests. Both branches are unreachable for a Builder-authored
task, yet a task can carry either field through duplication, import or a seed script, and the server
will silently gate on it.

**The test lane.** `apps/creator-web/vitest.config.ts` runs `include: ['src/**/*.test.ts']` in a
`node` environment and is wired into the repo-wide `npm test` through `turbo run test`. The house
precedent, `src/components/__tests__/BuilderRedesign.test.ts`, proves Builder behavior entirely at the
pure-logic layer without rendering React. `scripts/test-wizard-sections.ts` and
`scripts/test-wizard.ts` are the second (tsx aggregator) lane over the same modules. No emulator is
involved in either.

## Goals / Non-Goals

**Goals:**

- A creator's first action in a new task is typing its name. Nothing is disabled before they have
  entered anything.
- One click turns an empty task into a working example of any of the nine types.
- A validation message is a response to something the creator did, never a greeting.
- Every reason a game cannot launch is visible at once, before a launch is attempted, and clicking one
  lands on the thing to fix.
- The readiness rules and the launch guards are literally the same function, so they cannot drift.
- Nothing a task carries is invisible at rest, including a setting the Builder cannot author.
- Every ordering, gating, reveal, readiness and badge decision is a pure function in
  `apps/creator-web/src/lib/` with a test written before the implementation.

**Non-Goals:**

- **No backend work.** No callable added, changed or removed; no Firestore rule, index or security
  change; no `packages/shared` type change; no new env var. `launchRun` and `updateGame` keep their
  exact signatures.
- **No capability removal.** Every `Task` field and every stage setting reachable in the Builder today
  stays reachable. Placement, answer keys and stage rules remain enforced before launch, verbatim.
- **No new dependency** and **no new UI primitive.** `Advanced` (`components/ui.tsx:167-190`),
  `EmptyState` (`:210`), `Badge` (`:142`), `Card`, `Button` and `RichTooltip` are reused as-is;
  `ui.tsx` itself is not edited.
- **No visual redesign** beyond that reuse and the existing Tailwind tokens (`--rp-border`,
  `--surface-*`, `--ink-*`, `rp-fire`/`rp-amber`/`rp-go`). No new colour, spacing or type system.
- **No `play-web` change** and no change to what a participant or a staff member sees.
- **No file split of `TaskWizard.tsx` or `BuilderPage.tsx`.** Decomposing those god-files is tracked
  by `frontend-component-decomposition`; doing both at once would make either unreviewable.
- **No AI or generative authoring.** Samples are the existing hand-authored `TASK_SAMPLES` data.

**Design principle: the interface reacts to what the creator did, and tells them everything at once.**

## Decisions

### D1 — The step order is declared data, and placement stops gating

`wizardLogic.ts` stops encoding the order as the literals `1 | 2 | 3` bound to fixed meanings and
instead exports a declared sequence:

```
type WizardStepKey = 'details' | 'interaction' | 'placement';
const WIZARD_STEP_ORDER: readonly WizardStepKey[] = ['details', 'interaction', 'placement'];
stepKeyAt(index: number): WizardStepKey
stepIndexOf(key: WizardStepKey): number
canGoNext(key: WizardStepKey, task: Task): boolean   // 'details' → title non-empty; else true
```

`TaskWizard.tsx:103-105` renders the body for `stepKeyAt(step)`, and `:81-92` labels the tabs from the
same sequence, so a tab and its body cannot disagree. `stepValid` (`:74`) and its use at `:119` are
**deleted**: `isTaskLocationValid` stops being a navigation input entirely and survives only as a
readiness rule (D5) and as the input to the "not placed yet" state (D2).

*Alternative considered:* keep the numeric steps and simply swap which body renders at each index.
Rejected — the meaning would then live in two places (the `STEP_LABEL` map and the body switch), which
is the same drift class as the `advanced` badge bug this change is fixing.

*Alternative considered:* leave the order alone and merely un-disable **Next**. Rejected — the
proposal's complaint is not only the disabled control, it is that the hardest decision is asked first.
Un-gating without reordering still opens a map before a name field.

`blankTask()` is left exactly as it is. Its `{ lat: 0, lng: 0 }` is the sentinel the whole placement
model reads; replacing it with `undefined` would touch the shared `Task` type, which is a non-goal.

### D2 — Placement has three states, not two

`wizardLogic.ts` gains

```
type PlacementState = 'placed' | 'unplaced' | 'notRequired';
taskPlacementState(task: Task): PlacementState
```

`notRequired` when the trigger mode is `locationless` or `instant` or `task.locationless` is set;
`placed` when either coordinate is non-zero; `unplaced` otherwise. `isTaskLocationValid` is kept and
reimplemented as `taskPlacementState(task) !== 'unplaced'` so its two existing spec scenarios and its
call sites keep their exact meaning while there is only one rule.

`unplaced` renders a calm `EmptyState`-styled block on the placement step, in the `--ink-3` /
`--surface-2` register the wizard already uses for informational copy (`TaskWizard.tsx:203-206`), with
a "place it on the map" action. It is not `rp-fire`, because at this point in the flow it is not an
error, it is an unfinished step.

### D3 — Reveal gating: a monotonic touched-set plus one reveal-all flag

This is the change's core model, and it is deliberately small enough to test exhaustively.

```
type ValidationField =
  | 'title' | 'quizChoices' | 'quizOrdering' | 'numericAnswer'
  | 'stationCode' | 'sequenceSteps' | 'surveyChoices' | 'placement';

type RevealState = { touched: ReadonlySet<ValidationField>; revealAll: boolean };

initialRevealState(opts?: { revealAll?: boolean }): RevealState
markTouched(state, field): RevealState                 // monotonic, returns a new state
shouldReveal(state, field): boolean                    // state.revealAll || state.touched.has(field)
nextFinishAction(state, blockers: ValidationField[]): 'reveal' | 'close'
```

Four decisions are baked into that shape, each with a reason:

1. **Granularity is the field *group*, not the input.** "No choice is marked correct" is a property of
   the choice list, not of choice #2. The union above has exactly one member per message the editor
   can show, so `shouldReveal` is total over the set of messages by construction and a new message
   without a reveal rule is a typecheck failure.

2. **`touched` is monotonic within a session.** Typing into a field group and then clearing it leaves
   the group touched. Once a creator has engaged with the answer key, telling them it is empty is
   help, not scolding. This is the standard `touched` semantic of every form library, and the
   alternative (recompute dirtiness from a comparison with the opened value) would make a message
   flicker off when a creator restores the original value, which reads as a bug.

3. **Reveal state does *not* survive close and re-open.** It lives in `TaskWizard`'s own state, keyed
   by `task.id`, and resets on mount. Rationale: re-opening a task is a *reading* action, and the
   persistent, game-wide truth about what is broken now lives on the readiness surface (D5), so the
   editor no longer has to nag. Persisting the touched-set would also mean persisting it *somewhere* —
   `localStorage` or the game document — and the game document is the wrong place for a transient UI
   state, while `localStorage` would resurrect stale messages after an unrelated edit on another
   device.

4. **The one exception: arriving from the readiness surface.** A readiness entry that names a task
   opens that task's editor with `initialRevealState({ revealAll: true })`, because the creator
   arrived by clicking the statement of the problem and would otherwise land on a silent form. This is
   the only path that reveals without an edit, and it is the same "reveal" the finish control produces.

**"Tries to finish" is defined precisely.** Today `Done` is `disabled` on `!isTaskInteractionValid`
(`TaskWizard.tsx:121`), which is a dead end: the creator cannot close and cannot see why in the same
glance. `nextFinishAction` replaces it:

- `Done` is **always enabled**.
- Pressing it with an unrevealed blocker returns `'reveal'`: every blocker becomes visible, the editor
  stays open, and the first offending field is scrolled to.
- Pressing it again returns `'close'`: the editor closes and the task keeps whatever it has.

This is never a trap (the second press always works), never an error on open, and never a way to ship
a broken task, because the readiness surface still refuses the launch. It also closes the hole the
current code documents at `BuilderPage.tsx:296-299` and `:304-307`: an incomplete task closed with
`✕`/Esc already ships today, so the `Done` gate was buying nothing.

*Alternative considered:* a per-input `dirty` boolean map keyed by DOM field name. Rejected — the
messages are group-level, so the mapping from input to message would be a second table to keep in
sync.

*Alternative considered:* reveal everything as soon as the creator leaves a step. Rejected — a creator
who tabs forward to look at the type picker and comes back would be greeted by errors they did not
cause, which is the exact behavior being removed.

### D4 — Inspiration Mode wiring, with an overwrite guard

`taskTemplates.ts` gains two pure functions beside the existing `applySample`:

```
samplesForType(type: TaskType): TaskSample[]
sampleWouldOverwrite(draft: Task, sample: TaskSample): ValidationField[]   // authored fields the sample replaces
```

The type picker (`TaskWizard.tsx:807-838`) gains, on each card, a sample action labelled with the
already-present-but-unused `b.loadSampleFor(label)` (`i18n.ts:728` / `:1622`). Behaviour:

- one sample for the type → apply it directly;
- more than one → present the sample labels and apply the chosen one;
- either way, when `sampleWouldOverwrite` returns a non-empty list, name those fields in a
  `dialog.confirm` first, so a one-click action can never silently destroy authored work;
- the action sets `task.type` to the card's type and applies the sample to the same draft in one
  `onChange`, so the auto-save debounce sees a single coherent task.

`applySample` itself is unchanged. Its identity guarantees hold by construction: `patch` is typed
`Partial<Omit<Task, 'smart' | 'id'>>` so `id` cannot be patched, and no sample in `TASK_SAMPLES`
carries `coordinates`, `triggerMode` or `locationless`. The RED tests pin that as a property over the
whole catalogue rather than trusting the current data.

Applying a sample marks **nothing** touched. A sample always produces a completable task, so there is
no message to reveal, and marking it touched would be a lie about who typed what.

### D5 — One readiness computation, shared by the panel and the launch guard

A new pure module `apps/creator-web/src/lib/gameReadiness.ts`:

```
type ReadinessCode = 'stageHasNoTask' | 'taskNotCompletable' | 'taskNotPlaced' | 'stageUnwinnable';

type ReadinessIssue = {
  code: ReadinessCode;
  stageId: string; stageTitle: string;
  taskId?: string; taskTitle?: string;
};

computeGameReadiness(game: Game): ReadinessIssue[]   // EVERY issue, ordered by stage then task
canLaunchGame(game: Game): boolean                   // computeGameReadiness(game).length === 0
```

The four rules are lifted **verbatim** from `BuilderPage.tsx:293-321`, keeping their current
predicates: `stages.length === 0 || tasks.length === 0`, `!isTaskInteractionValid(task)`,
`!isTaskLocationValid(task)`, and `validateUnlockGraph(stage)` returning **any** warning **or** error.
The `find(...) → alert → return` shape becomes a `flatMap` that collects all of them. `saveAndLaunch`
then reduces to: save, `if (!canLaunchGame(game)) { focus the readiness surface; return; }`, launch.
`computeGameReadiness` is the only place any of those rules lives, so the panel and the guard cannot
disagree — that identity is itself a named test.

Two deliberate preservations, both called out because they look like bugs and are not being fixed
here:

- `validateUnlockGraph`'s **warnings** block a launch today (`:317`). Keeping them blocking preserves
  behavior exactly; downgrading them would change what can launch, which is out of this change's
  scope. Recorded in Open Questions.
- An empty game (`stages.length === 0`) reports as `stageHasNoTask` with no stage to link to, matching
  today's `b.everyStageNeedsTask` alert. The panel renders it without a navigation target.

The surface itself is a persistent panel in the Builder shell, rendered next to the launch controls at
`BuilderPage.tsx:411-412` and available on the build tab without a launch attempt. It uses `Advanced`
for its body and `EmptyState` for its "ready to launch" state; the header carries the blocking-issue
count as a `Badge`. Activating an entry sets the active stage (`setActiveStageId`) and opens the named
task's editor with `revealAll: true` (D3.4). No new callable and no new read: the whole computation is
over the `game` object `BuilderPage` already holds.

*Alternative considered:* keep the alerts and merely add the panel. Rejected explicitly by the
proposal's risk note — two copies of four rules is the drift this change exists to prevent.

### D6 — Honest advanced badge, and the `releaseAt` resolution

`sectionSummary('advanced', task)` stops returning a constant and counts the section's **optional**
settings, defined as the fields a fresh `blankTask()` does not carry:
`expiresAfterMinutes`, `releaseAfterMinutes`, `releaseAt`. `pointValue`, `estimatedMinutes` and
`maxConcurrentTeams` are **not** counted, because `blankTask()` always sets them
(`wizardLogic.ts:23-26`) and counting them would badge every task in the game, which is the same as no
badge at all. `geofenceRadiusMeters` is not counted either, because `setMode` auto-seeds it
(`TaskWizard.tsx:67-71`) so it is a default, not a decision.

`defaultOpenSections(task).advanced` becomes `sectionSummary('advanced', task) > 0` — one rule, two
consumers, no drift, and the module's stated invariant (`wizardSections.ts:10-14`) becomes true.
This flips the assertion at `scripts/test-wizard-sections.ts:73` ("advanced never auto expands"),
which is exactly the RED signal wanted; `:74` ("advanced carries no badge" for a `fresh` task) stays
green because a fresh task carries none of the three fields.

**The dead `releaseAt` warning is resolved by disclosure, not by deletion and not by a new editor.**
The three options and why the third wins:

- *(a) Add a wall-clock `releaseAt` editor.* Rejected. A date-and-time picker with timezone semantics
  is a feature, not a flow fix; it adds UI surface, i18n and a new class of validation to a change
  whose non-goals forbid a redesign. It would also be the only Builder control that writes an absolute
  instant, which invites the release/expiry interaction the current warning is nervously gesturing at.
- *(b) Delete the warning and the `expiryReleaseAtWarn` key.* Rejected. `Task.releaseAt` is
  **server-honored** (`functions/src/runs/index.ts:2887`), and a task can acquire it by duplication,
  spreadsheet import or a seed script. Deleting the only trace of it in the Builder means a creator can
  hold a game whose task is gated shut at a time nothing in the interface mentions. That is strictly
  worse than a warning nobody sees.
- *(c) **Chosen.** Disclose it.* Whenever `task.releaseAt` is present, the advanced section states the
  instant the task opens, as read-only text, unconditionally on any expiry, and counts it in the badge
  above so a folded section still reports it. The conditional warning at `TaskWizard.tsx:1014-1016`
  is removed and `expiryReleaseAtWarn` is repurposed into the disclosure copy in both dictionaries.
  The `validateAvailabilityWindow` branch at `:1012` is kept unchanged — it is equally unauthorable
  today, but it is a genuine error rather than a warning, and the same disclosure logic makes
  `releaseAfterMinutes` visible beside it.

This satisfies `wizardSections.ts`'s own rule, quoted at `:8-9`: "never hide a field that matters for
this task type, never show a dead one."

### D7 — Copy and i18n

New strings live under `t.builder.*` in **both** dictionaries of `apps/creator-web/src/i18n.ts`: the
three step labels for the new order, the "not placed yet" title/body/action, the sample-picker labels
and the overwrite confirmation, the readiness panel title, its ready state, one label per
`ReadinessCode`, the count badge format, and the `releaseAt` disclosure. `loadSampleFor`
(`:728`/`:1622`) is finally consumed rather than added. `expiryReleaseAtWarn` (`:646`/`:1539`) is
reworded from a warning into a statement. Copy obeys INSTRUCTIONS.md §3.C: no `—`, `–` or ` - ` as a
separator, enforced inside `npm test` by `scripts/test-no-dashes.ts`.

## TEST STRATEGY

`apps/creator-web` has **no component test runner**, so this change is designed so that every decision
above is pure and provable without rendering. All new logic lands in `apps/creator-web/src/lib/` with
co-located `*.test.ts` files picked up by `apps/creator-web/vitest.config.ts`
(`include: ['src/**/*.test.ts']`, `environment: 'node'`) and therefore by the repo-wide `npm test`
(`node scripts/run-unit-tests.mjs && turbo run test`). **No emulator is needed.** Per
`openspec/config.yaml`, the first task of every section below is the failing test.

**Lane 1 — pure logic (vitest), written RED first.**

`src/lib/__tests__/builderFirstTaskFlow.test.ts`:

- `WIZARD_STEP_ORDER` / `stepKeyAt` / `canGoNext`
  - the order is exactly `['details', 'interaction', 'placement']`
  - `canGoNext('details', task)` is false for an empty title, true for a non-empty one
  - `canGoNext` is true for `'interaction'` and `'placement'` regardless of coordinates, trigger mode
    or answer key — the regression test for the removed gate
  - `canGoNext` is total over `WizardStepKey`
- `taskPlacementState`
  - located mode + `{0,0}` → `'unplaced'`; located mode + real coordinates → `'placed'`;
    `locationless` / `instant` / `task.locationless` → `'notRequired'`
  - `isTaskLocationValid(task) === (taskPlacementState(task) !== 'unplaced')` for a table of tasks
    covering every trigger mode, pinning the existing spec's two scenarios
- `initialRevealState` / `markTouched` / `shouldReveal` / `nextFinishAction`
  - a fresh state reveals **nothing** for every `ValidationField` (the error-on-open regression test)
  - `markTouched(s, 'quizChoices')` reveals `quizChoices` and still hides `numericAnswer`
  - touching is monotonic: touch then "untouch" is not expressible, and a second `markTouched` of the
    same field is a no-op
  - `initialRevealState({ revealAll: true })` reveals every field with no touch
  - `nextFinishAction` returns `'reveal'` for unrevealed blockers, `'close'` once they are revealed,
    and `'close'` immediately when the blocker list is empty
  - `shouldReveal` is total over the `ValidationField` union
- `samplesForType` / `sampleWouldOverwrite` / `applySample`
  - every `TaskType` yields at least one sample, each with a non-empty label and title
  - **property over the whole catalogue:** applying any sample to a draft with a real id, real
    coordinates and an explicit trigger mode leaves all three byte-identical
  - **property over the whole catalogue:** for every type whose completion needs an answer key, every
    sample of that type yields `isTaskInteractionValid === true`
  - `sampleWouldOverwrite` returns `[]` for a blank draft and names the title / description / answer
    key fields for an authored one
- `computeGameReadiness` / `canLaunchGame`
  - a game with three uncompletable tasks returns **three** issues, not one (the headline regression)
  - one issue per rule: empty stage, missing answer key, located task at `{0,0}`, unwinnable stage
  - a locationless task at `{0,0}` produces **no** `taskNotPlaced` issue
  - every issue carries a resolvable `stageId`, and a task issue carries a resolvable `taskId`
  - issues are ordered by stage order then task order, so the panel is stable across renders
  - a fully valid game returns `[]` and `canLaunchGame` is true
  - **the identity test:** for a table of games covering all four rules plus the valid case,
    `canLaunchGame(game)` equals "none of the four legacy guard predicates fires", the predicates
    being re-expressed inline in the test from `BuilderPage.tsx:293-321` so the extraction is proven
    faithful rather than assumed
- `sectionSummary('advanced', …)` / `defaultOpenSections(…).advanced`
  - a task with `expiresAfterMinutes` reports 1 and starts **open**
  - a task with `expiresAfterMinutes` + `releaseAt` reports 2
  - a fresh `blankTask()` reports 0 and starts closed
  - a task carrying only `pointValue` / `estimatedMinutes` / `maxConcurrentTeams` reports 0
  - `defaultOpenSections(t).advanced === (sectionSummary('advanced', t) > 0)` over the table

**Lane 2 — the existing pure lanes stay green.** `scripts/test-wizard-sections.ts:73` currently
asserts the buggy "advanced never auto expands" and MUST be updated in the same task that fixes it
(`:74` is unaffected). `scripts/test-wizard.ts`, `scripts/test-builder-redesign.ts` and
`src/components/__tests__/BuilderRedesign.test.ts` must pass unchanged except where they pin a
behavior this change deliberately replaces; any such edit is called out in its task.

**Lane 3 — i18n (hard gate).** Every new label, message, confirmation, empty state and accessible name
goes into **both** `he` and `en` in `apps/creator-web/src/i18n.ts` and is read via `t.builder.*`.
`npm run i18n:check` PART A (key parity + Hebrew is Hebrew, English is English) must be clean;
`npm run i18n:check:strict` must add **zero** new PART B hardcoded-string findings. INSTRUCTIONS.md
§3.C (no dash separators) is enforced by `scripts/test-no-dashes.ts` inside `npm test`.

**Lane 4 — render smoke.** `npm run test:ui` (Playwright, `e2e-ui/`) confirms the Builder still mounts
without a white-screen crash after the step reorder.

**Lane 5 — manual preview.** Enumerated in the final task: a fresh task opens on the name field with
no map request; a fresh quiz/numeric/station/sequence shows no message; a sample makes each type
completable in one click; three broken tasks produce three panel entries in one pass; an entry
navigates and reveals; launch refuses while the panel is non-empty and proceeds when it is empty.

**Explicitly out of the gate set: `npm run e2e`.** This change touches no callable, no payload, no
Firestore rule and no `packages/shared` type, so the emulator lifecycle suite has nothing new to
assert and its existing assertions are unaffected. It is also excluded operationally: a live playtest
tunnel owns the emulator for the duration of this work, and booting a second suite against the same
ports would wedge it (see `scripts/free-ports.mjs`). The gate set for this change is
`npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`, `npm run play:build`,
`npm run i18n:check`, `npm run i18n:check:strict`, `npm run test:ui`.

## Risks / Trade-offs

- **[Reordering the steps confuses a creator who knows the current wizard]** → The three step bodies
  are unchanged; only their order and labels move, and the step tabs let anyone jump straight to the
  step they want, exactly as today (`TaskWizard.tsx:81-92`). The reorder is also recorded as a
  spec delta on `task-creation-wizard` rather than left implicit.
- **[Un-gating placement lets more unpinned tasks reach the end of authoring]** → It already did:
  the tabs at `:81-92` were never gated and `BuilderPage.tsx:304-307` documents that a task closed with
  `✕` ships unpinned today. The change replaces a gate that caught one path with a readiness surface
  that catches all of them, and launch still refuses.
- **[The readiness rules drift from the launch guards again]** → They are one function, and the
  identity is a named test that re-expresses the four legacy predicates inline and asserts equality.
- **[Withholding validation lets a creator finish a task they think is done]** → The finish control
  reveals every blocker on the first press before it will close, the task card carries a needs-
  attention marker, and the readiness panel lists it persistently. Silence only ever precedes the
  creator's own first edit.
- **[The reveal state resetting on re-open re-hides a real problem]** → The readiness panel is the
  persistent record, and its links re-open the editor with everything revealed, so the only way to see
  a silent form is to open a task nobody flagged.
- **[A one-click sample destroys authored work]** → `sampleWouldOverwrite` names the fields and
  requires confirmation; a blank draft skips the prompt.
- **[Counting `releaseAt` in the advanced badge surfaces a field the Builder cannot edit]** → That is
  the point: the field is server-honored and previously invisible. It is disclosed read-only, so the
  Builder gains information without gaining a scheduling feature.
- **[New copy leaks English into the Hebrew Builder]** → the recurring Builder bug (INSTRUCTIONS.md
  §3.D). Every string goes through `t.*` in both dictionaries and `npm run i18n:check` PART A is a hard
  gate on the final task.
- **[Touching `TaskWizard.tsx` and `BuilderPage.tsx` conflicts with `frontend-component-decomposition`
  or `run-console-progressive-disclosure`]** → This change adds `lib/` modules and edits only the step
  scaffold, the type picker, the advanced section and `saveAndLaunch`. The `lib/` modules are immune to
  a later file split, and no run-console file is touched.

## Migration Plan

None required. This is a client-side presentation and validation change: no persisted schema, no
callable, no rule, no index and no `packages/shared` type is altered, and no `Task` written before this
change reads differently after it. `blankTask()`'s `{ lat: 0, lng: 0 }` sentinel is preserved, so
games authored by the old Builder classify identically under `taskPlacementState`. Rollback is a revert
of the creator-web commit; nothing needs cleanup.

## Open Questions

- `validateUnlockGraph`'s **warnings** currently block a launch alongside its errors
  (`BuilderPage.tsx:315-321`). This change preserves that exactly to avoid changing what can launch,
  which means the readiness panel will report a warning-only stage as *blocking*. Splitting readiness
  into blocking issues and non-blocking advisories is the obvious follow-up, and deliberately not done
  here.
- Should the readiness panel also report **non-blocking** quality signals it can already compute, such
  as `partialStageStarvationWarning` (surfaced today at `BuilderPage.tsx:1123`)? Kept out of the first
  cut so that "an entry in the panel" means exactly "launch will refuse".
- Should `blankTask()` eventually carry an explicit `triggerMode` so `{0,0}` stops doubling as both
  "unplaced" and "coordinates zero"? That is a `packages/shared` conversation and a non-goal here;
  `taskPlacementState` isolates the sentinel so the later change has one call site to fix.
