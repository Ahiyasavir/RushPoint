## Why

Real-user testing flagged the Builder's location controls as confusing. A creator configuring
where/how a task fires sees a 4-way button row — Radius / Exact / Instant / Anywhere
(`TaskWizard.tsx:229-237`, `fireQuestion` "How do players complete this task?") — plus, in a
separate section further down the form, an unrelated-looking "Hide location" checkbox
(`TaskWizard.tsx:1120-1126`) that reveals a required clue field. An initial pass collapsed this to
3 buttons; product direction is that even 3 is too many technical choices for a first-time
creator. The redesign target is **exactly 2 top-level choices**, with every technical detail —
radius numbers, GPS-check behavior, location-hiding — pushed behind sensible defaults into an
Advanced panel a creator only opens if they need it.

## What Changes

- Collapse the picker to **exactly 2 top-level buttons**:
  - **"Anywhere"** → `triggerMode: 'locationless'`. No map pin, nothing to configure — this button
    has no Advanced panel at all.
  - **"Specific Location"** → `triggerMode: 'radius'` with today's 40m default. The radius number
    is **not shown** at top level; a creator who does nothing gets the same 40m arrival check that
    "Radius" gives today.
- **A single Advanced panel, nested under "Specific Location" only**, holds every technical
  control that used to be separate top-level buttons or a disconnected section:
  - The radius number input (today's `geofenceRadiusMeters` control,
    `TaskWizard.tsx:1298-1300`), with 40m / 4m as one-tap presets (replacing the old separate
    "Exact" button — dialing the radius to 4m reproduces exactly what "Exact" did today).
  - A **"Skip GPS check"** toggle. When on, it writes `triggerMode: 'instant'` instead of
    `'radius'`/`'exact'` — the task **keeps its map pin and keeps getting routed to** exactly as
    today; it just doesn't verify GPS on arrival (useful for spots GPS can't reach, e.g. indoors).
    This is a deliberate design decision: `'instant'` is NOT merged into "Anywhere," because
    "Anywhere"/`locationless` tasks have zero transit and no pin, while `'instant'` tasks are fully
    located and routed — collapsing them would silently zero out routing distance and change
    scoring for any task already using `'instant'` mode.
  - The existing "Hide location" toggle + clue field (`hideLocation`/`locationClue`,
    `TaskWizard.tsx:1120-1151`) moves here from its current disconnected `rules` section — the
    type comment already documents it as "layers on any located task"
    (`types/index.ts:296`), so it belongs inside the one control that governs location, not a
    separate section a creator has to discover independently.
- Update `fireQuestion`/`fireRadiusDesc`/`fireExactDesc`/`fireInstantDesc`/`fireAnywhereDesc` and
  add copy for the new Advanced toggles in both `i18n.ts` dictionaries (HE + EN) — no hardcoded
  strings, `npm run i18n:check:strict` stays clean.

### Non-goals
- No change to `Task.triggerMode`, `geofenceRadiusMeters`, `hideLocation`, `locationClue`, or any
  server-side routing/verification logic (`functions/src/routing/assignNextTask.ts`,
  `reportArrival`). This is a Builder UI/labeling change only — every existing stored value keeps
  its exact current meaning.
- No change to `smart_station` task type configuration (separate axis — task *type*, not trigger
  mode).
- No change to `hiddenSearchArea.ts` or the participant-facing sealed-hidden-mission search circle.
- No decision here about the task editor's broader field layout (title/description/type placement,
  step order, points/hints/media grouping) — that is a separate change,
  `task-editor-progressive-disclosure`, which places this Location picker as its own dedicated
  Step 1.

## Capabilities

### New Capabilities
- `creator-task-location-picker`: The Builder presents exactly 2 top-level location/trigger
  choices — Anywhere and Specific Location — with every technical control (radius, GPS-check
  behavior, hide-location) nested in a single Advanced panel under Specific Location.

## Impact

- **Surfaces touched:** `apps/creator-web` only (`TaskWizard.tsx`, `i18n.ts`). No shared type, no
  callable, no Firestore rule change.
- **Files:** `apps/creator-web/src/components/TaskWizard.tsx` (trigger-mode button group +
  Advanced panel + hide-location reposition), `apps/creator-web/src/i18n.ts` (both dictionaries).
- **Risk:** low technically (no schema/migration — every `TriggerMode` value keeps its exact
  meaning). The Instant/Anywhere distinction is deliberately preserved rather than collapsed,
  specifically to avoid a silent routing/scoring regression for existing tasks.
- **Testing:** the radius→triggerMode derivation (`'exact'` vs `'radius'` cutoff) and the
  skip-GPS-check→`'instant'` mapping become pure functions with co-located vitest tests; UI
  grouping verified via the preview tools (no component test runner exists per repo convention).
  `npm run i18n:check:strict` for the copy changes.
