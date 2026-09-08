## Context

RushPoint located tasks always send `coordinates` to the participant, and `NavMap` draws a marker
for every task in the active stage — the player navigates to the visible pin. The trigger-mode work
(`task-trigger-modes`) already gives us **server-side GPS validation** in `completeTask`
(`functions/src/runs/index.ts:1248`): `radius`/`exact` tasks call `haversineKm` + `evaluateTrigger`
and reject out-of-range check-ins with a `failed-precondition` that *includes the distance*. Secrets
are already stripped centrally by `sanitizeTaskForParticipant` (`functions/src/runs/index.ts:1493`),
which today passes `coordinates` straight through via `...rest`.

This change reuses all of that. A hidden-location task is an ordinary `radius`/`exact` located task
with one extra flag (`hideLocation`) plus a visible clue. The only new server behavior is: strip
coordinates for hidden tasks in the sanitizer, and suppress the distance figure in the gate's
rejection message for hidden tasks. The map and task UI react to a `locationHidden` flag.

## Goals / Non-Goals

**Goals:**
- Hide a located task's coordinates from every participant payload while keeping full server-side
  GPS validation.
- Give the player a free, always-visible clue (EN/HE) to find the spot.
- Reveal "you found it" + complete on validated arrival; default arrival = complete.
- Prevent triangulation: the out-of-range error for a hidden task leaks no distance/direction.
- Authorable in the Builder with i18n-correct strings.

**Non-Goals:**
- No hot/cold meter or directional arrow (opposite of the feature).
- No new `TaskType` — `hideLocation` is an orthogonal flag.
- No scoring/routing change; no new callable; no security-rule or Firestore-index change.

## Decisions

### D1 — Orthogonal flag, not a new task type
Add `Task.hideLocation?: boolean` rather than a `TaskType` member. **Why:** the discovery behavior
must compose with any located type (a hidden `photo` station, a hidden `field` check-in). A new type
would force an either/or and duplicate every type's verification. Alternative (new `hidden` type)
rejected for that reason.

### D2 — Separate `locationClue` field, reuse the paid `hint` as-is
Add `Task.locationClue?: string` + `Task.locationClueHe?: string`. **Why:** the existing `hint` is a
*paid, stripped* reveal (`requestTaskHint`, point cost). The discovery clue must be **free and always
visible** — different lifecycle, different secrecy. Overloading `hint` would either leak the paid
hint or hide the clue. The clue is rendered with `dir="auto"` (user-authored bilingual content).

### D3 — Strip coordinates + emit `locationHidden` in the sanitizer
In `sanitizeTaskForParticipant`, when `task.hideLocation`, destructure out `coordinates` and
`geofenceRadiusMeters` (and `coordinates` inside any injected station coords) and add
`locationHidden: true`, `locationClue`, `locationClueHe`. **Why:** the sanitizer is the single choke
point already used for secret-stripping — consistent with `secretCode`/answers handling. This is the
core RED test target (pure function over a `Task`).

### D4 — Non-leaking gate message keyed on `hideLocation`
In the `completeTask` proximity gate, when `gtask.hideLocation` and the verdict fails, throw a
generic message (e.g. `t`-independent server string `'Not here yet — keep following the clue'`)
instead of the `${distM}m away` text. The GPS math and accept/reject decision are unchanged — only
the message differs. **Why:** distance polling would let a player binary-search the spot. Alternative
(coarsen/round the distance) rejected — still leaks gradient.

### D5 — Map + TaskRunner react to `locationHidden`
`NavMap` filters out tasks with `locationHidden` (or missing `coordinates`) before building markers.
`TaskRunner` shows the clue + a "hidden location" badge instead of a distance row, and shows the
arrival reveal on the successful `completeTask`. **Why:** client already only has what the sanitizer
gives it (no coordinates), so suppression is natural; the flag makes intent explicit rather than
inferring from absent coordinates.

### D6 — Validation: hidden ⇒ must have coordinates + radius
Game write validation (shared `validation.ts` + the `createGame`/`updateGame` path) requires a hidden
task to still carry valid `coordinates` and a `radius`/`exact` trigger; a missing/empty clue is a
soft warning, not a hard error (a hidden task with no clue is allowed but discouraged). **Why:** a
hidden task with no real spot can never be completed (server gate would always fail).

## Test Strategy

Test-first (RED → GREEN → REFACTOR). Lanes:

1. **Pure logic — sanitizer (vitest, co-located in `functions/`):** new
   `functions/src/runs/sanitizeTaskForParticipant.test.ts` (export the function if not already).
   Failing assertions: hidden task → no `coordinates`, `locationHidden === true`, clue present, paid
   `hint` still stripped; visible task → `coordinates` present, no `locationHidden`. Wire via vitest
   (auto-run by `turbo run test`).
2. **Pure logic — non-leaking message helper:** factor the gate's reject-message choice into a tiny
   pure helper (e.g. `triggerRejectionMessage(distM, hidden)`), unit-test it in a
   `scripts/test-hidden-location-gate.ts` (auto-picked by `run-unit-tests.mjs`) OR co-located vitest:
   hidden ⇒ message contains no digits/`m away`; visible ⇒ message contains the distance.
3. **Callable e2e (`scripts/e2e-verify.mjs`):** add a hidden-location task to the e2e game. Assert:
   `getMyTeamState` returns the task with no `coordinates` and `locationHidden`; `completeTask` with
   far GPS rejects with a message containing no distance; `completeTask` within radius completes and
   assigns next. Keep `npm run e2e` green.
4. **UI (preview + i18n):** Builder toggle + clue field, play-web pin suppression + clue/badge +
   arrival reveal. Verify via preview tools; **`npm run i18n:check` must be clean** and
   `npm run i18n:check:strict` adds zero PART B findings — every new string via `t.*` in both
   `apps/creator-web/src/i18n.ts` and `apps/play-web/src/i18n.ts`.

## Files to touch

- `packages/shared/src/types/index.ts` — add `hideLocation`, `locationClue`, `locationClueHe` to `Task`.
- `packages/shared/src/validation.ts` — hidden ⇒ requires coordinates + radius (helper + test).
- `functions/src/runs/index.ts` — `sanitizeTaskForParticipant` (strip coords, emit flag/clue) and the
  `completeTask` gate message; export the sanitizer for the vitest.
- `functions/src/runs/sanitizeTaskForParticipant.test.ts` — new vitest (RED first).
- `scripts/test-hidden-location-gate.ts` *or* co-located vitest — non-leaking message (RED first).
- `scripts/e2e-verify.mjs` — hidden-location lifecycle assertions.
- `apps/creator-web/src/components/{TaskWizard,LocationStep,TaskCard,builderIcons}.tsx` +
  `pages/BuilderPage.tsx` — toggle + clue inputs.
- `apps/play-web/src/components/{NavMap,TaskRunner}.tsx` — pin suppression, clue/badge, arrival reveal.
- `apps/creator-web/src/i18n.ts` + `apps/play-web/src/i18n.ts` — new EN/HE strings.

## Risks / Trade-offs

- [Client could still cache a previously-leaked coordinate if a task is flipped to hidden mid-run] →
  hidden is authored at build time before launch; document that flipping hide-location on a live run
  is not supported in this change.
- [A hidden task with no clue is unwinnable-by-design confusion] → soft Builder warning; server still
  validates coordinates so completion is possible by physically standing there.
- [Non-leaking message hides legitimate "you're close" feedback] → intentional per the feature; the
  visible variant (`hideLocation:false`) is unchanged for creators who want distance feedback.
- [GPS jitter near a tight `exact` radius is more frustrating when there's no pin] → creators are
  steered toward `radius` (40m) for hidden tasks via the default; `exact` remains available.

## Migration Plan

Purely additive — new optional fields default to absent (= visible, today's behavior). No data
migration, no rules/index change. Existing games and the e2e lifecycle are unaffected until a creator
opts a task into `hideLocation`. Rollback = revert the code; the unused fields are harmless.

## Open Questions

- Should the arrival reveal optionally show the spot's name/coordinates *after* completion (so the
  player learns where they were)? Default for this change: show the task title only; revealing
  coordinates post-completion is a candidate follow-up.
