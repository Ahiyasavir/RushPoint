# Design: quiz-location-verification

## Type change

`packages/shared/src/types/index.ts` — add to `interface Task` (near the `hideLocation` /
`geofenceRadiusMeters` located-task fields):

```ts
  // Optional presence gate for ANSWER-graded tasks (quiz / numeric / survey)
  // (change: quiz-location-verification). When true AND the task has real
  // `coordinates`, submitTaskAnswer only grades an answer if the submitted GPS is
  // within a LENIENT radius (`geofenceRadiusMeters` or PRESENCE_DEFAULT_RADIUS_M,
  // 150m). Default absent = OFF (existing games unchanged). NOT a secret — the
  // client needs it to know it must send GPS, so the sanitizer passes it through.
  requirePresence?: boolean;
```

## Pure helper (shared, unit-testable)

`packages/shared/src/geo.ts` — reuse `haversineKm` / `isValidCoord`; keep the leniency knob here so
the server can't drift from the tested rule:

```ts
/** Lenient default presence radius (metres) for an answer task with requirePresence. */
export const PRESENCE_DEFAULT_RADIUS_M = 150;

/**
 * Evaluate whether an answer may be graded given the team's submitted GPS.
 * Opt-in leniency: a task WITHOUT valid coordinates always passes (the flag is a
 * no-op, never a lockout). With coordinates, missing/invalid GPS is refused (no
 * "disable location to bypass" escape), and distance must be within
 * `radiusM` (when finite & > 0) else PRESENCE_DEFAULT_RADIUS_M. The reason carries
 * NO distance and NO answer, so it leaks nothing even for a hidden-location task.
 */
export function evaluatePresence(
  taskCoords: GeoPoint | undefined,
  submitted: { lat?: number; lng?: number },
  radiusM?: number,
): { ok: boolean; reason?: string; distanceM?: number } {
  if (!taskCoords || !isValidCoord(taskCoords.lat, taskCoords.lng)) return { ok: true };
  if (!isValidCoord(submitted.lat, submitted.lng)) {
    return { ok: false, reason: 'Location required to answer here' };
  }
  const distM = haversineKm(taskCoords, { lat: submitted.lat as number, lng: submitted.lng as number }) * 1000;
  const limit = radiusM != null && Number.isFinite(radiusM) && radiusM > 0 ? radiusM : PRESENCE_DEFAULT_RADIUS_M;
  if (distM > limit) return { ok: false, reason: 'Move closer to the location to answer', distanceM: distM };
  return { ok: true, distanceM: distM };
}
```

Exported from the shared barrel via the existing `export * from './geo'`.

## submitTaskAnswer gate

`functions/src/runs/index.ts` — add `evaluatePresence` to the `@rushpoint/shared` import (alongside
`haversineKm` / `evaluateTrigger`). Insert the gate in `submitTaskAnswer` **right after** the
answer-type check (`if (task.type !== 'quiz' && task.type !== 'numeric' && task.type !== 'survey')`,
~L2487) and **before** the survey / grading branches, so it covers all three answer types uniformly:

```ts
  // Optional presence gate (change: quiz-location-verification): when the creator
  // opted this task into requirePresence AND it has real coordinates, the submitted
  // GPS must be within a LENIENT radius before we grade — so a quiz/trivia can't be
  // answered from anywhere. Default OFF ⇒ existing games unaffected. The reason text
  // carries no distance and no answer, so it leaks nothing (safe for hidden tasks).
  if (task.requirePresence) {
    const verdict = evaluatePresence(task.coordinates, { lat, lng }, task.geofenceRadiusMeters);
    if (!verdict.ok) {
      throw new functions.https.HttpsError('failed-precondition', verdict.reason ?? 'Move closer to answer this task');
    }
  }
```

`lat` / `lng` are already destructured from the callable `data`. Placing the gate before grading means
a wrong-attempt is NOT recorded and no attempt-limit is consumed when the team is out of range (they
never reached the grading path) — correct: a location refusal is not a wrong answer.

## Sanitizer exposure

`requirePresence` is top-level and is **not** one of the destructured secrets in
`sanitizeTaskForParticipant` (`smart, hint, answers, numericAnswer, steps, orderItems`), so it already
flows through `...rest` to the participant unchanged — the client reads it to decide it must attach
GPS to `submitTaskAnswer`. No answer-key secrecy is affected (the gate only consults `coordinates` +
`geofenceRadiusMeters`, both already sent for located tasks). The only code change is adding
`requirePresence` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` so the sanitizer allowlist oracle
stays green.

## Builder toggle + i18n

`apps/creator-web/src/components/TaskWizard.tsx` — render a checkbox for answer tasks
(`task.type === 'quiz' || 'numeric' || 'survey'`), styled like the existing `hideLocation` block:

```tsx
{(task.type === 'quiz' || task.type === 'numeric' || task.type === 'survey') && (
  <label className="flex items-start gap-2 cursor-pointer ...">
    <input type="checkbox" checked={!!task.requirePresence}
      onChange={(e) => set({ requirePresence: e.target.checked || undefined })} />
    <span>
      <span className="...">{b.requirePresence}</span>
      <span className="...">{b.requirePresenceDesc}</span>
    </span>
  </label>
)}
```

New keys in **both** `he` and `en` of `apps/creator-web/src/i18n.ts` (Hebrew pure Hebrew, English pure
English, no dash separators):

| key | en | he |
|---|---|---|
| `requirePresence` | `Require players to be at the location` | `חייבים להיות במיקום כדי לענות` |
| `requirePresenceDesc` | `Players must be near the spot (about 150m) to submit an answer.` | `השחקנים חייבים להימצא ליד המקום (בערך 150 מטר) כדי לשלוח תשובה.` |

## Lenient-policy rationale

- **Radius is the leniency knob:** 150m default (vs. the 40m `radius` / 4m `exact` completion gates) is
  deliberately generous so noisy urban GPS never blocks a team that is genuinely there. A creator can
  override via `geofenceRadiusMeters`.
- **Missing GPS is refused, not waved through:** allowing "no GPS = pass" would let anyone bypass by
  disabling location, defeating the complaint this change fixes. The refusal message is friendly and
  actionable ("Location required to answer here"), matching the tone of the existing completeTask gate.
- **Coordinate-less task = no-op:** turning the flag on for a locationless/uncoordinated task can never
  lock a team out — `evaluatePresence` returns `{ ok: true }`, so the feature is safe by construction.

## Test strategy

- **Pure helper (`scripts/test-presence.ts`, tsx, no emulator, auto-run by `npm test`):** asserts
  `evaluatePresence` — passes within the 150m default; refuses beyond it; refuses missing/invalid GPS;
  passes when the task has no coordinates; honors a custom finite radius; and its reason string never
  contains the distance figure. RED before the helper exists.
- **E2E (`scripts/e2e-verify.mjs`, `npm run e2e`):** a scenario builds a `quiz` task with
  `requirePresence: true` + coordinates, then asserts `submitTaskAnswer` with a **far** `lat`/`lng`
  (and the correct answer) is refused with `failed-precondition` (NOT graded), while the same correct
  answer submitted **at** the coordinates returns `{ correct: true }`. Also asserts the sanitized task
  payload carries `requirePresence` (allowlist) but still no `answers`/`numericAnswer`.

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run e2e` · `npm run i18n:check` (UI changed).
