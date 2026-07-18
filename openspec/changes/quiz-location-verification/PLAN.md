# PLAN — quiz-location-verification (implementation blueprint)

Opt-in, lenient presence check so trivia/quiz/numeric/survey answers can't be submitted from anywhere.
Default OFF ⇒ zero behavior change for existing games. Do NOT weaken answer-key secrecy; reuse the
existing geo helpers; all UI text via `t.*`.

## Exact files to touch

| # | File | Change |
|---|---|---|
| 1 | `packages/shared/src/geo.ts` | add `PRESENCE_DEFAULT_RADIUS_M` + pure `evaluatePresence()` |
| 2 | `packages/shared/src/types/index.ts` | add `Task.requirePresence?: boolean` |
| 3 | `functions/src/runs/index.ts` | import `evaluatePresence`; add gate in `submitTaskAnswer` |
| 4 | `apps/creator-web/src/components/TaskWizard.tsx` | presence toggle for answer tasks |
| 5 | `apps/creator-web/src/i18n.ts` | `requirePresence` + `requirePresenceDesc` in `he` + `en` |
| 6 | `scripts/e2e-verify.mjs` | add `requirePresence` to `ALLOWED_TASK_KEYS`; new scenario |
| 7 | `scripts/test-presence.ts` (new) | pure RED test for `evaluatePresence` |

## 1. Type change — `packages/shared/src/types/index.ts`

Add to `interface Task`, near `hideLocation` / the located-task `geofenceRadiusMeters` (~L316):

```ts
  // change: quiz-location-verification. Opt-in presence gate for ANSWER tasks
  // (quiz/numeric/survey). When true AND the task has valid `coordinates`,
  // submitTaskAnswer grades only if the submitted GPS is within a LENIENT radius
  // (`geofenceRadiusMeters` or PRESENCE_DEFAULT_RADIUS_M = 150m). Default absent =
  // OFF. NOT secret — the client needs it to know it must send GPS; sanitizer
  // passes it through via `...rest`.
  requirePresence?: boolean;
```

## 2. Pure helper — `packages/shared/src/geo.ts`

Append after `evaluateTrigger` (reuses `haversineKm` / `isValidCoord`, both already in this file;
exported via the existing `export * from './geo'` barrel):

```ts
/** Lenient default presence radius (metres) for a requirePresence answer task. */
export const PRESENCE_DEFAULT_RADIUS_M = 150;

/**
 * Whether an answer may be graded given the team's submitted GPS.
 * - No valid task coordinates → pass (opt-in flag is a no-op, never a lockout).
 * - Missing/invalid submitted GPS → refuse (no "disable location to bypass").
 * - Else within `radiusM` (finite & > 0) else PRESENCE_DEFAULT_RADIUS_M.
 * Reason carries NO distance and NO answer (safe for hidden-location tasks).
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

Run `npm run shared:build` after editing so functions/creator pick up the new export.

## 3. submitTaskAnswer gate — `functions/src/runs/index.ts`

**Import** (add `evaluatePresence` to the existing `@rushpoint/shared` import block that already pulls
`normalizeTriggerMode`, `evaluateTrigger`, `haversineKm`).

**Gate** — insert immediately after the answer-type guard (~L2489, right after the
`if (task.type !== 'quiz' && task.type !== 'numeric' && task.type !== 'survey') { throw ... }`) and
before the `if (task.type === 'survey')` branch, so it covers all three answer types once:

```ts
  // change: quiz-location-verification. Opt-in, lenient presence gate: when the
  // creator turned on requirePresence AND the task has real coordinates, the
  // submitted GPS must be within a lenient radius before grading — a quiz/trivia
  // can no longer be answered from anywhere. Default OFF ⇒ existing games
  // unaffected. Placed BEFORE grading so an out-of-range attempt is not recorded
  // as wrong and consumes no attempt-limit slot. Reason has no distance/answer.
  if (task.requirePresence) {
    const verdict = evaluatePresence(task.coordinates, { lat, lng }, task.geofenceRadiusMeters);
    if (!verdict.ok) {
      throw new functions.https.HttpsError('failed-precondition', verdict.reason ?? 'Move closer to answer this task');
    }
  }
```

`lat` / `lng` are already destructured from `data` at the top of `submitTaskAnswer`. No signature change.

## 4. Builder toggle — `apps/creator-web/src/components/TaskWizard.tsx`

Add after the per-type config block (near the `hideLocation` block, ~L887), shown for answer tasks:

```tsx
{(task.type === 'quiz' || task.type === 'numeric' || task.type === 'survey') && (
  <div className="rounded-lg border border-[--rp-border] bg-[--surface-2] px-3 py-2">
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={!!task.requirePresence}
        onChange={(e) => set({ requirePresence: e.target.checked || undefined })} />
      <span>
        <span className="text-sm font-medium text-[--ink-1]">{b.requirePresence}</span>
        <span className="block text-[11px] text-[--ink-3] leading-snug">{b.requirePresenceDesc}</span>
      </span>
    </label>
  </div>
)}
```

(`b` is the builder i18n slice already in scope in this component, e.g. `b.hideLocation`.)

## 5. i18n keys — `apps/creator-web/src/i18n.ts`

Add to BOTH dictionaries next to `hideLocation` / `hideLocationDesc`:

**he** (near L527):
```ts
    requirePresence: 'חייבים להיות במיקום כדי לענות',
    requirePresenceDesc: 'השחקנים חייבים להימצא ליד המקום (בערך 150 מטר) כדי לשלוח תשובה.',
```

**en** (near L1264):
```ts
    requirePresence: 'Require players to be at the location',
    requirePresenceDesc: 'Players must be near the spot (about 150m) to submit an answer.',
```

HE is pure Hebrew (digits/`מטר` allowed), EN pure English, no `—`/`–`/` - ` separators. Run
`npm run i18n:check` (PART A hard gate) after; add zero new PART B findings.

## 6. e2e — `scripts/e2e-verify.mjs`

- Add `'requirePresence'` to `ALLOWED_TASK_KEYS` (the sanitizer allowlist oracle, ~L203) with a
  one-line comment: not a secret, the client needs it to know it must send GPS.
- New scenario (RED before the gate lands): build a `quiz` task
  `{ type:'quiz', requirePresence:true, coordinates:{lat:31.78,lng:35.21}, answers:['blue'] }`, then:
  - `submitTaskAnswer` with far GPS (e.g. `lat:32.10,lng:34.85`) + `answer:'blue'` → expect thrown
    `failed-precondition` (assert NOT `{ correct:true }`).
  - `submitTaskAnswer` with GPS at the coordinates + `answer:'blue'` → expect `{ correct:true }`.
  - Assert the sanitized payload (via `getMyTeamState`) has `requirePresence === true` and still no
    `answers`/`numericAnswer`.

## 7. RED tests

**`scripts/test-presence.ts`** (tsx, picked up by `npm test` aggregator) — assert `evaluatePresence`:
1. within 150m of coords → `{ ok:true }`.
2. ~1km away → `{ ok:false }`, and `reason` does NOT include the distance number.
3. missing/invalid submitted GPS → `{ ok:false }` (location-required).
4. `taskCoords` undefined / invalid → `{ ok:true }` (no lockout).
5. custom `radiusM: 500` admits a 300m-away point that the default would reject... (choose a distance
   between 150 and 500 to prove the override).
6. `radiusM: 0` / `NaN` falls back to the 150m default.

RED order: write `test-presence.ts` first (fails: `evaluatePresence` undefined), and the e2e scenario
(fails: far answer grades) — then implement §2/§3 to green.

## Gates (all must pass before done)

```
npm run typecheck
npm test                 # + new scripts/test-presence.ts
npm run lint
npm run creator:build
npm run play:build
npm run e2e              # far-answer refused, near-answer grades; allowlist + 66/66 coverage green
npm run i18n:check       # UI changed — PART A clean, zero new PART B
```
