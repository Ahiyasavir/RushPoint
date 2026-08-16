## Context

The Builder (`apps/creator-web/src/pages/BuilderPage.tsx` → `StepStages` → `StageRail` +
`TaskCanvas` + `TaskWizard`) is a 3-pane workspace with an implicit hierarchy: stages live in a
left rail, tasks for the currently-selected stage live in a canvas, and editing a task opens a
slide-in wizard. There is no on-screen label stating "you are editing mission 3 of stage 2." Copy
in the Builder consistently says "task" (`addTask`, "Add task" tile, "Task Name" field) while the
Gallery, Run Console, Flash Mission UI, and the Builder's own stage-delete confirm dialog say
"mission" for the identical `Task` object. Both are confirmed by direct code read (not inferred).

`Task` as a TypeScript type, Firestore field, and callable parameter name is used pervasively
across `packages/shared`, `functions/`, and both apps — renaming it is a large, high-risk,
purely-cosmetic-value change. The actual complaint is what creators *read*, not what the code is
*called*, so the fix is scoped to presentation only.

## Goals / Non-Goals

**Goals:**
- Every user-facing string a creator or participant can read says "mission," never "task," for
  this concept — including edge cases like the stage-delete confirm dialog that currently mixes
  both words in one sentence.
- The Builder header always shows which stage and which mission (if any) is currently active, so
  hierarchy is never something the user has to infer from panel position.
- A regression test (scanning both apps' translation maps) makes a future re-introduction of
  "task" as user-facing copy a `npm test` failure, mirroring the existing `test-no-dashes.ts`
  pattern for `ui-text-standards`.

**Non-Goals:**
- Renaming `Task`, `addTask`, `taskId`, `TaskType`, Firestore paths, or any callable
  parameter/return field. Internal vocabulary is unaffected.
- Changing wizard step order, validation rules, or task-type behavior.
- Rewriting `CreatorTour` copy (tracked as an obvious fast-follow, not blocking this change —
  the tour already uses "task" in 2 spots and will read slightly stale until it's touched, which
  is acceptable since the tour is opt-in/dismissible, not the primary surface).

## Decisions

**1. Copy-only rename, not a type/data rename.**
Alternative considered: rename the `Task` type to `Mission` throughout (`packages/shared`,
`functions/`, both apps, Firestore field names). Rejected — it multiplies the blast radius by
~10x (every callable, every Firestore document shape, every test fixture) for zero behavioral or
even visible gain beyond what a copy-only sweep already achieves. The user only ever sees
rendered strings; internal identifiers are invisible to them.

**2. Where the "task" string constant lives for the regression test.**
The new test (`scripts/test-no-task-copy.ts`, mirroring `scripts/test-no-dashes.ts`) scans the
`translations` maps in `apps/creator-web/src/i18n.ts` and `apps/play-web/src/i18n.ts` for the
substring "task" (case-insensitive) in a *value*, with an explicit allowlist for legitimate
non-UI uses (there are none expected, but the allowlist mechanism itself mirrors
`scripts/lib/i18nLeak.ts`'s per-line `// i18n-ignore` convention rather than a hardcoded
exceptions list, so a genuinely intentional literal stays inline and reviewable). JSX literal
scanning (component files with hardcoded strings, not routed through `t.*`) is already covered by
`npm run i18n:check:strict` PART B — this change doesn't duplicate that scanner, it only adds the
"task"-as-vocabulary check to the dictionary-level scan, since PART B already flags any hardcoded
JSX string regardless of content.

**3. Breadcrumb is derived state, not a new store field.**
The `Stage 2: Old City → Mission 3: Find the Fountain` label is computed in `BuilderPage.tsx` (or
a small pure helper `lib/builderBreadcrumb.ts` if the derivation grows past a few lines) from the
already-selected stage id + open task id already held in Builder local state. No new Firestore
field, no new callable — this is view-only, matching how `lib/runConsoleSignals.ts` and similar
pure, clock-free view-model helpers are structured elsewhere in the Builder/Run Console. When no
task is open, the breadcrumb shows just the stage: `Stage 2: Old City`.

**4. i18n keys, not hardcoded strings, for the breadcrumb.**
The breadcrumb template ("Stage {n}: {name}" / "Mission {n}: {name}") is added to both apps'
`i18n.ts` (only creator-web needs it live, but the key is added following existing dictionary
parity conventions so `i18n:check` PART A doesn't flag a missing EN/HE pair) and interpolated, not
built from template literals in JSX — required to pass `i18n:check:strict` PART B on new UI.

## Risks / Trade-offs

- **[Risk]** A global find/replace of "task"→"mission" in translation values could sweep in a
  legitimate distinct word (e.g., an unrelated English sentence containing "multitasking" or a
  future onboarding "task list" for a *different* concept). → **Mitigation**: no automated
  find/replace; every translation-map string touched is manually reviewed as part of the task
  list below, and the new regression test only flags remaining occurrences after the manual sweep
  rather than performing the rename itself.
- **[Risk]** `CreatorTour` copy left unchanged means it briefly says "task" while the rest of the
  Builder says "mission," reintroducing a small version of the exact inconsistency this change
  fixes. → **Mitigation**: explicitly called out as a Non-Goal/fast-follow in the proposal so it
  isn't forgotten; low severity since the tour is a one-time, dismissible overlay, not persistent
  chrome.
- **[Risk]** Breadcrumb string could overflow on narrow/mobile Builder widths if stage/mission
  names are long. → **Mitigation**: verify via the preview tools at the existing mobile breakpoint
  (project already has a `useMediaQuery` hook and mobile-responsive Builder work); truncate with
  ellipsis via existing Tailwind `truncate` utility if needed, same pattern already used
  elsewhere in the Builder header for the game title.

## Migration Plan

No data migration — copy-only + one new derived UI element. Deploy as a normal creator-web (and
play-web, for the handful of participant-facing "task"→"mission" strings) build. Rollback is a
normal revert of the commit; no Firestore data shape changes to unwind.
