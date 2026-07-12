# Proposal: quiz-location-verification

## Why

A real family playtest surfaced a fairness complaint: **trivia / quiz tasks can be answered from
anywhere.** A team never has to physically reach the spot — they can sit at the finish and type in
answers, or one runner can relay the question to a teammate at home. `submitTaskAnswer` (quiz /
numeric / survey) grades the answer with **no proximity check at all**, even though the participant
app already sends `lat`/`lng` on the call. By contrast, `completeTask` for `radius`/`exact` tasks
already re-validates GPS server-side (`functions/src/runs/index.ts` ~L2330). Answer-graded tasks are
the one located task family with no such gate, so the "be there to score" promise silently breaks for
exactly the tasks (trivia at a landmark) where creators most expect it.

The fix must be **opt-in and lenient**: existing games must not change behavior, GPS in a city is
noisy, and we never want a legitimately-present team blocked by a tight radius.

## What Changes

- **New optional task field `Task.requirePresence?: boolean`** (top-level, default absent = OFF). When
  a creator turns it on for an answer task (`quiz` / `numeric` / `survey`) that has real
  `coordinates`, the answer is only graded if the submitted GPS is within a **lenient** radius.
- **`submitTaskAnswer` presence gate:** before grading (for every answer type), when
  `task.requirePresence` is set and the task has valid `coordinates`, verify the submitted `lat`/`lng`
  is within `task.geofenceRadiusMeters` or a generous default (`PRESENCE_DEFAULT_RADIUS_M = 150 m`).
  Out of range, or missing/invalid GPS → refuse with a friendly "move closer" `failed-precondition`
  (the message carries **no distance and no answer**, so it leaks nothing). In range → grade as today.
- **Pure, unit-testable proximity helper** `evaluatePresence(taskCoords, submitted, radiusM?)` added to
  `packages/shared/src/geo.ts`, reusing the existing `haversineKm` / `isValidCoord`. A task with no
  coordinates passes (opt-in flag on a locationless task is a no-op, never a lockout).
- **Sanitizer:** `requirePresence` is a non-secret flag (the client needs it to know it must send GPS),
  so it rides the existing `...rest` passthrough in `sanitizeTaskForParticipant` and is added to the
  e2e `ALLOWED_TASK_KEYS` allowlist. **No answer key is exposed** — the gate reads only `coordinates`
  and `geofenceRadiusMeters`, both already participant-visible for located tasks.
- **Builder toggle** in `TaskWizard` for answer tasks (`quiz`/`numeric`/`survey`), bilingual via
  `t.*` (`requirePresence` / `requirePresenceDesc`).

## Non-goals

- No change to grading, scoring, routing, or callable signatures.
- Not tightening the existing `radius`/`exact` `completeTask` gate (already covered) or the smart
  station code gate.
- No retroactive enforcement: without the flag, an answer task behaves exactly as before.
- No "allow when GPS is unavailable" escape hatch — that would let a cheater simply disable location
  and defeat the whole feature. Leniency is expressed through the generous radius, not a GPS bypass.

## Capabilities

### New Capabilities
- `quiz-location-verification`: an answer-graded task may optionally require the team to be physically
  present (within a lenient radius) before an answer is accepted.

## Impact

- **Surfaces touched:** shared (`packages/shared/src/geo.ts` helper + `types/index.ts` field), functions
  (`runs/index.ts` `submitTaskAnswer` gate + import), creator-web (`TaskWizard.tsx` toggle + `i18n.ts`
  keys), e2e allowlist (`scripts/e2e-verify.mjs`).
- **Callables affected (behavior only, no signature change):** `submitTaskAnswer`.
- **Tests:** pure-logic (`scripts/test-presence.ts`) for `evaluatePresence`; an e2e scenario asserting
  an out-of-range answer is refused and an in-range answer grades.
