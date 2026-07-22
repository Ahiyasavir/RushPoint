## Why

A creator opening the RushPoint Builder for the first time is asked to solve the hardest problem
first and is told they are wrong before they have typed anything. `blankTask()` ships
`coordinates: {lat: 0, lng: 0}` (`apps/creator-web/src/lib/wizardLogic.ts:22`) with no
`triggerMode`, so `isTaskLocationValid` is false and the wizard's **Next** button is disabled
(`TaskWizard.tsx:74`, `:119`) until the creator loads a ~500 KB MapLibre chunk and drops a pin.
Naming the task — the one thing the creator actually has in their head — is behind that gate. The
gate is also ineffective: the step tabs at `TaskWizard.tsx:84` are not gated, so an impatient
creator simply clicks "3" and the gate only punishes the compliant path.

At the same time, the single highest-leverage fix for this is **already written, already unit-tested,
and simply not wired up**: `lib/taskTemplates.ts:34-201` holds `TASK_SAMPLES` — 14 fully-authored
sample tasks covering all 9 task types — plus `applySample()`, which preserves the task's `id`,
`coordinates` and `triggerMode`. It is covered by `components/__tests__/BuilderRedesign.test.ts:15,71-86`
and referenced by exactly nothing in the UI. Its i18n string `loadSampleFor` ("Load a sample for
{label}", `i18n.ts:677`/`:1521`) is likewise unreferenced.

The result is a Builder that reads as "extremely complicated and scary" even though the underlying
model only genuinely requires four fields per task.

## What Changes

**Ungate the wizard — name first, pin later.**
- Location stops being a hard prerequisite for steps 2 and 3. A task with no real pin renders an
  explicit, calm **"not placed yet"** state instead of a disabled **Next**.
- The wizard's own step order puts naming/typing ahead of placement, so the first thing a creator
  does is the thing they came to do.
- Placement remains fully required to *launch* — the enforcement moves from "you cannot proceed"
  to "this is listed as a blocking issue until you fix it".

**Wire up Inspiration Mode (the dead code).**
- The type picker gains a per-type **"Load a sample"** action backed by the existing `TASK_SAMPLES`
  / `applySample`, so one click turns an empty task into a working, completable example the creator
  can edit rather than author from nothing.

**Stop shouting at untouched fields.**
- A freshly-opened quiz no longer shows `quizNeedsCorrect` before a choice has been typed
  (`QuizChoicesEditor.tsx:37,92-96`); a fresh ordering quiz no longer shows `orderingCountError`
  against its own auto-padded empty rows (`TaskWizard.tsx:276,299-304`); step 3 no longer shows
  `interactionIncomplete` on every brand-new quiz/numeric/station/sequence task (`:109-110`).
- Validation messages appear once the relevant field has been **dirtied**, or once the creator
  attempts to finish the task — never on open.

**One honest, complete readiness surface.**
- The four launch-time `dialog.alert` gates (`BuilderPage.tsx:293-321` — empty stage, incomplete
  answer key, unpinned task, unwinnable stage) each name a single offending task and return, so
  three broken tasks costs three failed launch attempts. They are replaced by a persistent
  **"Ready to launch"** panel that lists **every** blocking issue at once, each one clicking
  through to the offending stage/task.
- Launch still refuses to proceed while blocking issues exist; it just stops being the only way
  to discover them.

**Fix two correctness bugs surfaced by the audit.**
- `wizardSections.ts:65,80-83`: the `advanced` section can never auto-open and its "n set" badge
  can never fire, so a configured `expiresAfterMinutes` is invisible at rest — contradicting the
  module's own stated invariant at `wizardSections.ts:11-14`. The badge becomes honest.
- `TaskWizard.tsx:1014-1016` warns about `task.releaseAt`, a field the Builder has no editor for.
  The dead warning path is resolved.

## Capabilities

### New Capabilities
- `builder-task-authoring-flow`: The Builder's task wizard lets a creator author a task in the
  order they think in — name and type first, placement whenever — surfaces a working sample for
  every task type on one click, withholds validation messaging until a field is dirtied or the
  creator tries to finish, and reports every launch-blocking issue in the game at once through a
  persistent readiness surface rather than one modal alert per attempt.

### Modified Capabilities
- `task-creation-wizard`: the existing spec normatively binds step 1 to placement, step 2 to
  metadata and step 3 to the type picker. "Name first, pin later" contradicts those three
  ordinal-bound requirements, so they are removed and re-added ordinal-free, and "opens at step 1"
  is modified. The section/disclosure model itself is preserved — only the ordering contract and
  the placement gate change.

## Impact

- **Surfaces touched:** `apps/creator-web` **only**. No callables, no Firestore rules, no
  `packages/shared` types, no `play-web`.
- **Files:** `src/components/TaskWizard.tsx`, `src/components/QuizChoicesEditor.tsx`,
  `src/pages/BuilderPage.tsx`, `src/lib/wizardLogic.ts`, `src/lib/wizardSections.ts`,
  `src/lib/taskTemplates.ts` (wire-up only), plus a new pure-logic module for readiness
  computation and new/renamed keys in `src/i18n.ts` (both dictionaries).
- **No capability is removed.** Every field reachable today stays reachable; placement, answer
  keys and stage rules remain enforced before launch.
- **Risk:** the readiness computation duplicates rules currently inline in `BuilderPage.tsx`'s
  launch guards. It is extracted to a pure function so the guards and the panel cannot drift.
- **Testing:** new pure logic (readiness/blocking issues, dirty-field validation gating, sample
  application, section badge counts) lands in `apps/creator-web/src/lib/` with co-located tests in
  the existing `npm test` lane; `npm run test:ui` covers render smoke. No emulator needed.
