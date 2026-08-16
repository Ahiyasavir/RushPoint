## Why

Creators report they don't understand "stages" and mission-building when using the Builder. Two
root causes, confirmed by reading the current code: (1) the same object is called "task" inside the
Builder (`TaskWizard`, "add task", task tile) but "mission" everywhere else a creator sees it
(Gallery, Run Console, Flash Mission, and even the Builder's own stage-delete confirmation dialog
— "Delete this stage and its 3 missions?"), so the vocabulary silently flips mid-flow; and (2) the
stage → task/mission hierarchy is never labeled on screen — a creator infers which stage is
currently open, and which task they're editing, purely from rail-vs-canvas layout position, with no
persistent "Stage 2 → Mission 3" indicator anywhere in the Builder header.

## What Changes

- Standardize all user-facing UI copy on **"mission"** (creator-web + play-web translation maps and
  JSX literals). "Task" stays as the internal/code/type/DB vocabulary (`Task`, `addTask`, `taskId`,
  Firestore field names, `TaskType`) — this is a **copy-only rename**, not a data model or API
  change.
- Add a persistent breadcrumb/label in the Builder header showing the active hierarchy position,
  e.g. `Stage 2: Old City → Mission 3: Find the Fountain`, updating live as the creator selects a
  different stage or opens a different task in the wizard.
- Sweep the Builder's own stage-delete confirmation dialog (currently mixes "stage" + "missions" in
  one sentence) and the wizard step labels/buttons ("Add task" → "Add mission", "Task Name" →
  "Mission Name", etc.) to the standardized wording.
- Re-run `npm run i18n:check:strict` after the sweep — zero new PART B warnings, PART A stays green.

## Non-goals

- No change to `Task` as a TypeScript type name, Firestore field/collection names, callable
  parameter names, or any wire-format key. Nothing here touches `functions/`.
- No change to stage/task *behavior* (routing, scoring, ordering, partial-completion, exclusive
  groups). This is copy + one new header label, not new game logic.
- No redesign of the 3-step wizard flow itself (Location → Details → Interaction stays as-is);
  only its labels/copy change.
- No change to the guided tour (`CreatorTour`) content in this change — its copy already says
  "tasks" in a couple of spots and will drift out of sync once this ships, but re-authoring tour
  copy is left as a fast, obvious follow-up rather than bundled here.

## Capabilities

### Modified Capabilities

- `task-creation-wizard`: step labels, field labels, and button copy change from "task" wording to
  "mission" wording (e.g. "Add task" tile → "Add mission" tile, "Task Name" input → "Mission Name"
  input); no scenario's *behavior* changes, only the string content scenarios assert on. Also adds
  the new persistent stage/mission breadcrumb requirement in the Builder header.
- `ui-text-standards`: extends the existing user-facing-copy conventions doc with a new requirement
  that "task" is not used as user-facing vocabulary for a field mission (mirrors the existing
  no-dash-separator requirement's shape: a scan + a regression test).

## Impact

- **creator-web**: `apps/creator-web/src/i18n.ts` (translation map sweep, both EN and HE),
  `pages/BuilderPage.tsx` (new breadcrumb label), `components/TaskWizard.tsx` / `StepStages` /
  `StageRail` / `TaskCanvas` (button/label copy), stage-delete confirmation dialog copy.
- **play-web**: `apps/play-web/src/i18n.ts` — any remaining "task" user-facing strings brought in
  line with "mission" (Run recap, Final screen, etc., wherever they currently say "task" instead of
  "mission").
- **Tests**: `scripts/check-i18n.ts` / `npm run i18n:check:strict` (existing gate, must stay green);
  a new pure test (mirroring `test-no-dashes.ts`) scanning both apps' translation maps for
  "task"-as-mission-noun leaks, wired into `npm test` via the `scripts/test-*.ts` auto-discovery.
- No `functions/`, `packages/shared` types, or Firestore rules changes.
