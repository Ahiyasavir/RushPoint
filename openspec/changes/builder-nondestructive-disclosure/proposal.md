## Why

Three defects in the Builder's task/stage editing surface, all reported by the platform owner
against a game created from a template. Two are data-loss defects.

**1. Every optional group opens by itself.** The task editor's opt-in groups (Hint, Timer &
points, Media, Prerequisites & rules) mount expanded whenever `groupHasContent()` sees a value
differing from `TASK_FIELD_DEFAULTS`. **Verified root cause:** `blankTask()`
(`apps/creator-web/src/lib/wizardLogic.ts:51`) seeds `maxConcurrentTeams: 3` — the value
`TASK_FIELD_DEFAULTS` mirrors — but the template seeder
(`apps/creator-web/src/templates.ts:26`) seeds `maxConcurrentTeams: 5`. So **every task in every
template-derived game** trips the rules group, and the pervasive per-task `difficulty`/`pointValue`
overrides (1–6 and 60–170 across the 11 templates) trip the timer group. The creator opens step 3
and finds three or four sections already unfolded showing settings they never chose.

**2. "הסר" (Remove) destroys authored data.** `removeGroup` in `TaskWizard.tsx:120-123` calls
`clearGroupPatch(k)` — which nulls `hint`/`hintPenalty`/media/prereqs/tags and resets
`difficulty`/`pointValue`/`maxConcurrentTeams` — and *then* folds the section away. The creator
reads the control as "hide this section"; it silently wipes the fields underneath, and the wipe
rides the Builder's 1.5 s autosave straight into `updateGame`. There is no undo affordance in
reach and no confirmation.

**3. A control labelled "Close" hard-deletes an entire stage.** `BuilderPage.tsx:1689` renders
`✕` with `aria-label={b.exclusiveClose}` (Hebrew "סגירה" — *Close*) but its `onClick` is
`removeStage(activeStage.id)`, which filters the stage — and every task inside it — out of
`game.stages` with **no confirmation dialog**. Every other destructive path in this codebase
(deleting a game, skipping a mission) is gated; this one is a single misread click from
destroying a stage's whole contents.

## What Changes

- **Opt-in groups mount COLLAPSED, always.** `defaultActiveGroups` no longer consults
  `groupHasContent`. Discoverability is preserved by the mechanism the chips already have: an
  unopened chip carrying content renders its count badge (`groupSummary` →
  `b.sectionSetCount(n)`, `TaskWizard.tsx:236-238`), so authored data is advertised rather than
  hidden — the concern the old always-expand rule existed to serve, met without unfolding
  everything.
- **Hiding a group no longer edits the task.** The group control becomes a pure
  collapse: it folds the section and touches no field. `clearGroupPatch` is retained and still
  unit-tested, but is no longer wired to the fold control — a creator who wants a field gone
  clears that field.
- **The group control is relabelled** from "הסר"/"Remove" to "הסתר"/"Hide", so what it says and
  what it does agree.
- **The stage ✕ tells the truth and asks first.** Correct destructive label
  (`b.deleteStage`) plus a `dialog.confirm` naming the stage and its task count, matching the
  confirmation posture of every other destructive control in the console.
- `groupHasContent` keeps its meaning (**"does this group hold authored data?"**) and keeps
  driving the chip badge — only its role as the *expansion* trigger is removed. **BREAKING** to
  the `task-editor-progressive-disclosure` spec's always-expand requirement.

### Non-goals
- No change to what any group's fields *do*, to scoring, or to any server-side behaviour.
- No change to `clearGroupPatch`'s semantics (still the correct reset when a caller wants one).
- Not adding undo/redo — the Builder already has an undo stack; this change simply stops
  manufacturing the data loss that would need it.
- Not touching the deliberate per-field ✕ controls (one media item, one quiz choice, one
  sequence step), which are correctly labelled and correctly scoped.

## Capabilities

### New Capabilities
- `builder-nondestructive-disclosure`: how the Builder discloses optional task settings (always
  collapsed on load, advertised by chip badge) and the rule that no disclosure control — group
  fold or stage ✕ — may destroy authored data without saying so and asking.

### Modified Capabilities
- None. The earlier `task-editor-progressive-disclosure` change introduced the always-expand rule
  this change inverts, but it is still un-archived (no `openspec/specs/` entry), so there is no
  published requirement to delta against. The new capability above supersedes its load-time rule
  and says so explicitly.

## Impact

- `apps/creator-web/src/lib/taskOptInGroups.ts` — `defaultActiveGroups` stops reading
  `groupHasContent`; doc comments restated.
- `apps/creator-web/src/components/TaskWizard.tsx` — `removeGroup` → `hideGroup` (collapse only);
  `OptInGroup`'s control relabelled.
- `apps/creator-web/src/pages/BuilderPage.tsx` — stage ✕ label + confirmation.
- `apps/creator-web/src/i18n.ts` — `hideSection` + `deleteStage`/confirm copy, HE and EN.
- `scripts/test-task-opt-in-groups.ts` — the always-expand assertions invert; new assertions that
  hiding preserves every field.
- No callable, no Firestore, no rules, no shared-package change.
