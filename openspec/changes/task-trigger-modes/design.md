## Context

`Task` (`packages/shared/src/types/index.ts:192`) has `coordinates`, `geofenceRadiusMeters?`, and a
`locationless?` boolean. At completion, `functions/src/runs/index.ts` `completeTask` (~870–883)
special-cases `gtask.type === 'geofence'`: requires GPS, computes `haversineKm(...)*1000`, rejects if
`distM > (geofenceRadiusMeters ?? 50)`. Other types skip the proximity gate. `haversineKm` and
`isValidCoord` already exist in `packages/shared/src/geo.ts`.

The `task-creation-wizard` change defines Step 1 with a binary locationless toggle and
`isTaskLocationValid` in `apps/creator-web/src/lib/wizardLogic.ts`. We extend that model to an
explicit 4-mode trigger.

## Goals / Non-Goals

**Goals:** add `triggerMode` to the model; a pure `evaluateTrigger` the server uses to gate
completion; defaults (40m/4m); keep `locationless` in sync; replace the wizard binary toggle with a
4-mode selector; e2e for exact + instant.

**Non-Goals:** remove the geofence type; passive/background geofencing; routing-weight changes.

## Decisions

### D1 — Model: `TriggerMode` union + `Task.triggerMode`
```ts
export type TriggerMode = 'radius' | 'exact' | 'instant' | 'locationless';
// Task: triggerMode?: TriggerMode  // default 'radius'
```
`geofenceRadiusMeters` carries the radius for `radius`/`exact`. Invariant:
`triggerMode === 'locationless'` ⇔ `locationless === true`. A `normalizeTriggerMode(task)` resolves
legacy tasks: `locationless` → `'locationless'`; `type==='geofence'` → `'radius'`; else default
`'radius'`. (Existing non-geofence located tasks become `radius` with their existing radius or the
40m default, preserving "near enough" behavior; a creator can tighten to `exact` or relax to
`instant`.)

### D2 — Pure gate helper in shared
`packages/shared/src/geo.ts` (co-located with `haversineKm`):
- `defaultRadiusFor(mode): number` → `radius`:40, `exact`:4, `instant`:0, `locationless`:0.
- `evaluateTrigger(mode, distanceM, radiusM?)`: returns `{ ok: boolean; reason?: string }`.
  - `instant` / `locationless` → always `{ ok: true }` (no GPS needed).
  - `radius` / `exact` → require a finite `distanceM`; `ok = distanceM <= (radiusM ?? default)`.
- Pure and synchronous so both the server and tests use the same logic (no drift).

### D3 — Server enforcement in `completeTask`
Replace the `type === 'geofence'`-only block with: resolve `mode = normalizeTriggerMode(gtask)`; if
`mode` is `radius` or `exact`, require valid `lat/lng` + `gtask.coordinates`, compute `distM`, and
reject with `failed-precondition` when `evaluateTrigger(mode, distM, gtask.geofenceRadiusMeters).ok`
is false (message includes distance). `instant`/`locationless` skip the GPS gate. The `geofence`
type keeps working because it normalizes to `radius`.

### D4 — Sanitizer
`sanitizeTaskForParticipant` continues to expose `triggerMode` + `geofenceRadiusMeters` +
`coordinates` (already non-secret) so the client can show the right "get within Xm" hint; no answer
keys involved.

### D5 — Wizard Step 1 selector (edits `task-creation-wizard`)
Replace the binary "Locationless task" toggle with a 4-card/segment selector bound to
`task.triggerMode`. Selecting `locationless` sets `locationless=true` and hides the map (current
behavior); the other three keep the map. A radius number input (default from `defaultRadiusFor`)
shows only for `radius`/`exact`. `wizardLogic.ts` gains `TRIGGER_MODE_META` (icon/label/description ×4)
and `isTaskLocationValid` is updated so `instant`/`locationless` are valid without coordinates while
`radius`/`exact` require real coordinates.

## Test strategy

**Pure logic** — `scripts/test-trigger-modes.ts` (aggregator-picked, no emulator):
- `defaultRadiusFor` → 40/4/0/0.
- `evaluateTrigger('radius', 30, 40).ok === true`; `evaluateTrigger('radius', 60, 40).ok === false`.
- `evaluateTrigger('exact', 3, 4).ok === true`; `evaluateTrigger('exact', 10, 4).ok === false`.
- `evaluateTrigger('instant', undefined).ok === true`; `evaluateTrigger('locationless', undefined).ok === true`.
- defaults applied when `radiusM` omitted (`evaluateTrigger('exact', 3).ok === true`,
  `evaluateTrigger('exact', 6).ok === false`).
- `normalizeTriggerMode`: legacy geofence → `'radius'`; `locationless:true` → `'locationless'`;
  bare located task → `'radius'`. Invariant `locationless` ⇔ `'locationless'` holds.
- `TRIGGER_MODE_META` has exactly 4 entries with non-empty label + description.

**Callable behavior** — `scripts/e2e-verify.mjs`: add a stage with an `exact` task — a far
`completeTask` (with GPS ~50m away) is rejected `failed-precondition`; a near one (within 4m) is
accepted. Add an `instant` task — `completeTask` with no GPS succeeds.

**UI verification:** preview the wizard Step 1 — 4-mode selector; radius input appears only for
radius/exact; locationless hides the map.

## Risks / Trade-offs

- [Risk: legacy data without `triggerMode`] → `normalizeTriggerMode` derives it from existing fields;
  no migration needed. Tests pin the legacy mappings.
- [Risk: `exact` 4m is too tight for consumer GPS] → it is a creator-chosen mode with an editable
  radius; default documented; `radius` (40m) remains the default mode.
- [Risk: array/`.set(merge)` footguns when writing tasks] → tasks are written as a full array via the
  existing `updateGame` pipeline; no dotted-array update. (Respects the documented footgun.)
- [Trade-off: keep the `geofence` type AND `triggerMode`] → avoids a breaking migration; `geofence`
  is treated as `radius` everywhere.
