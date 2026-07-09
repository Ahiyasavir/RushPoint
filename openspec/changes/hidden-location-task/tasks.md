## 1. Shared types (foundation)

- [x] 1.1 Add `hideLocation?: boolean`, `locationClue?: string`, `locationClueHe?: string` to the
  `Task` interface in `packages/shared/src/types/index.ts` with doc comments (orthogonal flag; clue
  is free+visible, distinct from the paid `hint`). Run `npm run typecheck`.

## 2. Sanitizer — strip coordinates for hidden tasks (RED → GREEN → REFACTOR)

- [x] 2.1 RED: add `functions/src/runs/sanitizeTaskForParticipant.test.ts` (vitest). Export the
  function from `functions/src/runs/index.ts` if needed. Assert: (a) hidden task → returned payload
  has NO `coordinates`, `locationHidden === true`, `locationClue` present; (b) the paid `hint` text
  is still stripped (only `hasHint`/`hintPenalty`); (c) a non-hidden located task → `coordinates`
  present and no `locationHidden`. Run vitest, confirm it FAILS for the right reason.
- [x] 2.2 GREEN: extend `sanitizeTaskForParticipant` to destructure out `coordinates` +
  `geofenceRadiusMeters` when `task.hideLocation`, and emit `locationHidden: true`, `locationClue`,
  `locationClueHe`. Re-run vitest → green.
- [x] 2.3 REFACTOR: tidy the destructure, ensure visible-task path is byte-for-byte unchanged; re-run
  vitest.

## 3. Non-leaking proximity gate (RED → GREEN → REFACTOR)

- [x] 3.1 RED: add a pure helper test — `scripts/test-hidden-location-gate.ts` (auto-picked by
  `run-unit-tests.mjs`) OR co-located vitest — for a `triggerRejectionMessage(distM, hidden)` helper:
  hidden ⇒ message has no digits / no `m away`; visible ⇒ message contains the distance. Run
  `npm test`, confirm FAIL.
- [x] 3.2 GREEN: implement the helper and use it in the `completeTask` gate
  (`functions/src/runs/index.ts` ~1255) so a hidden task throws the generic "keep following the clue"
  message while keeping the GPS accept/reject decision identical. Re-run `npm test` → green.
- [x] 3.3 REFACTOR: confirm visible-task message/behavior unchanged; keep the helper exported + tested.

## 4. Game-write validation (RED → GREEN)

- [x] 4.1 RED: add a test (co-located vitest or `scripts/test-*.ts`) asserting a `hideLocation: true`
  task WITHOUT valid coordinates / radius is rejected, and a hidden task WITH coordinates is accepted.
  Confirm FAIL.
- [x] 4.2 GREEN: enforce in `packages/shared/src/validation.ts` (and the `createGame`/`updateGame`
  path) that hidden ⇒ valid coordinates + `radius`/`exact`; empty clue is a soft warning only.
  Re-run → green.

## 5. Callable e2e coverage

- [x] 5.1 Extend `scripts/e2e-verify.mjs`: add a hidden-location task to the e2e game. Assert
  `getMyTeamState` returns it with NO `coordinates` and `locationHidden === true` and the clue;
  `completeTask` far away rejects with a distance-free message; `completeTask` within radius completes
  and assigns the next task. Run `npm run e2e` → green.
- [x] 5.2 If a typed wrapper signature changed, update `services/calls.ts` in the consuming app(s) so
  the new payload field (`locationHidden`, `locationClue`) is typed end-to-end.

## 6. Creator UI — author a hidden-location task

- [x] 6.1 Add a "hide location on map" toggle and a clue input (EN/HE) to the located-task editor
  (`apps/creator-web/src/components/TaskWizard.tsx` / `LocationStep.tsx`, surfaced on `TaskCard.tsx`
  / `BuilderPage.tsx`). Persist `hideLocation` + `locationClue`/`locationClueHe` via `updateGame`.
- [x] 6.2 Block saving a hidden task with no coordinates (reuse the validation from §4); show the
  soft "add a clue" hint. Add all new strings to `apps/creator-web/src/i18n.ts` (EN + HE) via `t.*`.

## 7. Participant UI — discover by clue

- [x] 7.1 `apps/play-web/src/components/NavMap.tsx`: skip marker creation for tasks with
  `locationHidden` (or missing `coordinates`).
- [x] 7.2 `apps/play-web/src/components/TaskRunner.tsx`: render the clue + a "hidden location" badge
  instead of a distance row; show the arrival "you found it" reveal on a successful `completeTask`.
  Add all new strings to `apps/play-web/src/i18n.ts` (EN + HE) via `t.*`.

## 8. Gates (all green)

- [x] 8.1 Run the full gate set and confirm green: `npm run typecheck` · `npm run lint` ·
  `npm test` · `npm run creator:build` · `npm run e2e`.
- [x] 8.2 UI gate: `npm run i18n:check` clean (PART A hard gate) and `npm run i18n:check:strict`
  adds ZERO new PART B findings for the new Builder/play-web strings. Preview-verify the Builder
  toggle, map pin suppression, and the arrival reveal.
