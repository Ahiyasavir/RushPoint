# Proposal — Four explicit task trigger modes (Wizard Step 1)

## Why

Today a task's "how does it fire" behavior is implicit and scattered: a `geofence` type auto-checks
in within `geofenceRadiusMeters` (default 50), a `locationless` boolean removes the map pin, and
everything else relies on a manual/field check-in. Wizard Step 1 (from the in-flight
`task-creation-wizard` change) offers only a binary "Locationless task" toggle. Creators have no
clear, first-class way to choose how proximity gates a task. We want an explicit 4-mode trigger
selector on Step 1.

## What Changes

> Observable behavior. Creators pick one of four trigger modes per task; the server enforces the
> chosen proximity rule on completion.

- New `Task.triggerMode: 'radius' | 'exact' | 'instant' | 'locationless'` (default `'radius'`):
  - **radius** — fires when the participant is within a creator-set radius (default **40m**, editable).
  - **exact** — fires only on precise arrival (tight default **4m**, editable).
  - **instant** — fires immediately when the participant advances to the task, no GPS/proximity check.
  - **locationless** — purely digital task, no map pin, no geospatial gate (existing behavior).
- `geofenceRadiusMeters` is reused as the radius value for `radius`/`exact`. `triggerMode` and the
  existing `locationless` boolean are kept in sync for backward compatibility.
- The server completion check (`completeTask`) is generalized from "geofence type only" to
  "trigger-mode aware" via a pure shared helper, so radius/exact gates can't be spoofed.
- Wizard Step 1 presents a 4-mode selector (replacing the binary toggle) with a radius input shown
  only for `radius`/`exact`.

## Capabilities

### New Capabilities
- `task-trigger-modes`: a per-task trigger-mode model + server-enforced proximity gate + creator UI.

### Modified Capabilities
- `task-creation-wizard`: Step 1 changes from a binary locationless toggle to the 4-mode selector
  (delta authored against that change's spec).

## Surfaces touched

- **shared:** `packages/shared/src/types/index.ts` (`TriggerMode` + `Task.triggerMode`); new pure
  helpers `evaluateTrigger`, `defaultRadiusFor`, `normalizeTriggerMode` in
  `packages/shared/src/geo.ts` (or `trigger.ts`); re-export from `index.ts`.
- **functions:** `functions/src/runs/index.ts` `completeTask` proximity check generalized; sanitizer
  continues to expose trigger info without secrets.
- **creator-web:** `BuilderPage.tsx` TaskEditor Step 1 + `wizardLogic.ts` + `LocationPicker`.
- **Tests:** `scripts/test-trigger-modes.ts` (pure); `scripts/e2e-verify.mjs` (exact + instant).
- **No new Firestore index or rule.** This adds a callable *behavior* change (completion gate) → e2e
  coverage required.

## Non-goals

- No removal of the `geofence` task *type* (it maps onto `triggerMode='radius'` semantics; kept for
  back-compat).
- No background/passive geofencing (completion still happens on a `completeTask` call; the server
  validates the supplied GPS).
- No change to routing weights beyond existing locationless transit=0 handling.
