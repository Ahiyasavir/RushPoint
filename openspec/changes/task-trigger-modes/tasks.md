## 1. RED — Failing pure-logic test for the trigger helpers

- [ ] 1.1 Create `scripts/test-trigger-modes.ts` importing `evaluateTrigger`, `defaultRadiusFor`,
  `normalizeTriggerMode` from `@rushpoint/shared` (not yet implemented). Encode all cases in
  design "Test strategy → Pure logic" (radius 30/60 @40, exact 3/10 @4, instant/locationless always
  ok, default-radius application, legacy normalization, invariant).
- [ ] 1.2 Run `npm test`; confirm failure (not exported) (RED).

## 2. GREEN — Shared model + helpers

- [ ] 2.1 Add `export type TriggerMode = 'radius' | 'exact' | 'instant' | 'locationless'` and
  `triggerMode?: TriggerMode` to `Task` in `packages/shared/src/types/index.ts` (documented default
  `'radius'`).
- [ ] 2.2 Add `defaultRadiusFor`, `evaluateTrigger`, `normalizeTriggerMode` to
  `packages/shared/src/geo.ts`; re-export from `packages/shared/src/index.ts`.
- [ ] 2.3 Run `npm test`; confirm `test-trigger-modes.ts` passes (GREEN).

## 3. RED → GREEN — Server enforcement in completeTask

- [ ] 3.1 Add failing assertions to `scripts/e2e-verify.mjs`: an `exact` task rejects a far check-in
  and accepts a near one; an `instant` task completes with no GPS. Run `npm run e2e`; confirm the new
  assertions fail (RED) against current geofence-only logic.
- [ ] 3.2 In `functions/src/runs/index.ts` `completeTask`, replace the `type==='geofence'` block with
  `mode = normalizeTriggerMode(gtask)`; gate `radius`/`exact` via `evaluateTrigger(mode, distM,
  gtask.geofenceRadiusMeters)`; skip GPS for `instant`/`locationless`. Keep the geofence type working.
- [ ] 3.3 Confirm `sanitizeTaskForParticipant` exposes `triggerMode`+`geofenceRadiusMeters`
  (non-secret); no answer-key leak.
- [ ] 3.4 Run `npm run e2e`; confirm all assertions pass (GREEN).

## 4. GREEN — Wizard Step 1 selector (edits task-creation-wizard)

- [ ] 4.1 Add `TRIGGER_MODE_META` (4 entries: icon/label/description) to
  `apps/creator-web/src/lib/wizardLogic.ts`; update `isTaskLocationValid` so `instant`/`locationless`
  are valid without coordinates and `radius`/`exact` require real coordinates.
- [ ] 4.2 In `BuilderPage.tsx` TaskEditor Step 1, replace the binary locationless toggle with a
  4-mode selector bound to `task.triggerMode`; keep `locationless` in sync; show a radius input
  (default via `defaultRadiusFor`) only for `radius`/`exact`; hide the map for `locationless`.
- [ ] 4.3 Update the `task-creation-wizard` change's `specs/task-creation-wizard/spec.md` Step 1
  requirement + scenarios and its `tasks.md` 4.4 to describe the 4-mode selector (see this change's
  spec delta).

## 5. Verify

- [ ] 5.1 `npm run typecheck` — 0 errors.
- [ ] 5.2 `npm test` — trigger-modes test green.
- [ ] 5.3 `npm run lint` and `npm run creator:build` — pass.
- [ ] 5.4 `npm run e2e` — full lifecycle incl. exact + instant assertions green.
- [ ] 5.5 Preview wizard Step 1: 4 modes; radius input only for radius/exact; locationless hides map.
