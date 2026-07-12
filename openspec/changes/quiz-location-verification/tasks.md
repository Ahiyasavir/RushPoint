# Tasks: quiz-location-verification

## 1. RED
- [ ] Add `scripts/test-presence.ts` (tsx) asserting `evaluatePresence`: passes within the 150m
      default radius; refuses beyond it; refuses missing/invalid GPS; passes when the task has no
      coordinates; honors a custom finite radius; and the refusal `reason` never contains the distance
      figure. Confirm RED (helper does not exist yet).
- [ ] In `scripts/e2e-verify.mjs`, add a scenario: a `quiz` task with `requirePresence: true` +
      coordinates; assert `submitTaskAnswer` with a FAR lat/lng + correct answer is refused
      (`failed-precondition`, not graded), and the SAME correct answer at the coordinates returns
      `{ correct: true }`. Confirm RED (no gate yet — the far answer grades).

## 2. GREEN
- [ ] `packages/shared/src/geo.ts`: add `PRESENCE_DEFAULT_RADIUS_M = 150` and the pure
      `evaluatePresence(taskCoords, submitted, radiusM?)` helper (reusing `haversineKm`/`isValidCoord`).
- [ ] `packages/shared/src/types/index.ts`: add optional `requirePresence?: boolean` to `Task`.
- [ ] `functions/src/runs/index.ts`: import `evaluatePresence`; in `submitTaskAnswer`, after the
      answer-type check and before grading, gate on `task.requirePresence` via `evaluatePresence`
      (throw `failed-precondition` with the verdict reason when not ok).
- [ ] `scripts/e2e-verify.mjs`: add `requirePresence` to `ALLOWED_TASK_KEYS`.
- [ ] `npm run shared:build`; pure test passes GREEN.

## 3. UI
- [ ] `apps/creator-web/src/components/TaskWizard.tsx`: add a `requirePresence` checkbox for answer
      tasks (`quiz`/`numeric`/`survey`), wired through `set({ requirePresence })`.
- [ ] `apps/creator-web/src/i18n.ts`: add `requirePresence` + `requirePresenceDesc` to BOTH `he` and
      `en` (Hebrew pure Hebrew, English pure English, no dash separators).
- [ ] `npm run i18n:check` clean (PART A hard gate; zero new PART B findings for the toggle).

## 4. Gates
- [ ] `npm run typecheck` green.
- [ ] `npm test` green (includes the new pure presence test).
- [ ] `npm run lint` green.
- [ ] `npm run creator:build` green.
- [ ] `npm run play:build` green.
- [ ] `npm run e2e` green (out-of-range refused, in-range grades; sanitizer allowlist + callable
      coverage guard still 66/66).
